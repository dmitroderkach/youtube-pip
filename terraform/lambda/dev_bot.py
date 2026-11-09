"""Dev worker bot (docs/DEV_WORKER.md).

Two entry points:
- Telegram webhook (Lambda Function URL): /up starts the dev-worker ECS task, /down stops it, any other message
  (text, photo, voice, audio, file with its caption) goes to the worker's SQS FIFO queue and starts the worker when
  it is not running. While a stopped worker is still saving its session, the start is deferred to its STOPPED event
  (marker state/pending-start.json in the state bucket). Only requests with the webhook secret token from the owner's chat are served.
  A button pressed under a worker message (callback_query: questions, plan approval, permission prompts, /mode) is
  acknowledged and queued for the running worker; with no worker running it only gets a notice.
- EventBridge "ECS Task State Change" (STOPPED) of the dev-worker cluster: a stop the worker did not report itself
  (exit code other than 0 / REPORTED_EXIT_CODE, failed start, killed task) is reported in the chat.

Statuses go to the chat through the Bot API. Always answers Telegram with 200, so it never retries an update.
"""

import json
import os
import time
import urllib.request
from datetime import datetime, timezone

import boto3

ecs = boto3.client("ecs")
sqs = boto3.client("sqs")
s3 = boto3.client("s3")
secrets = boto3.client("secretsmanager")

CLUSTER_ARN = os.environ["CLUSTER_ARN"]
TASK_DEFINITION_ARN = os.environ["TASK_DEFINITION_ARN"]
CONTAINER_NAME = os.environ.get("CONTAINER_NAME", "dev-worker")
SUBNET_IDS = [s for s in os.environ["SUBNET_IDS"].split(",") if s]
SECURITY_GROUP_IDS = [s for s in os.environ["SECURITY_GROUP_IDS"].split(",") if s]
QUEUE_URL = os.environ["QUEUE_URL"]
STATE_BUCKET = os.environ["STATE_BUCKET"]
ONCALL_SECRET_ARN = os.environ["ONCALL_SECRET_ARN"]
DEV_SECRET_ARN = os.environ["DEV_SECRET_ARN"]
# Exit code of a failure the worker has already reported (scripts/dev-worker/worker.mjs)
REPORTED_EXIT_CODES = {0, 10}
# Text of a replied-to message passed to the worker (an on-call report is up to ~4000 chars per Telegram message)
REPLY_MAX_CHARS = 8000
STARTED_BY = "telegram"
META_KEY = "state/meta.json"
# Written by the worker: {lastAnswerAt, turnActive, stopping} (scripts/dev-worker/worker.mjs)
ACTIVITY_KEY = "state/activity.json"
# Last answer the watchdog warned about, so it warns once per answer
IDLE_ALERT_KEY = "state/idle-alert.json"
# Above the worker's 10-minute idle stop, so a worker going to sleep is never warned about
IDLE_ALERT_MINUTES = int(os.environ.get("IDLE_ALERT_MINUTES", "15"))
# Start requested while a stopped worker was still saving: consumed by the STOPPED event of that task
PENDING_START_KEY = "state/pending-start.json"

_config = None


def config():
    """Bot token, owner chat id and webhook secret (cached per Lambda instance)."""
    global _config
    if _config is None:
        oncall = json.loads(secrets.get_secret_value(SecretId=ONCALL_SECRET_ARN)["SecretString"])
        dev = json.loads(secrets.get_secret_value(SecretId=DEV_SECRET_ARN)["SecretString"])
        _config = {
            "bot_token": oncall["telegram_bot_token"],
            "chat_id": str(oncall["telegram_chat_id"]),
            "webhook_secret": dev.get("telegram_webhook_secret", ""),
        }
    return _config


def bot_api(method, payload):
    """Call the Bot API; never raises (a status that does not arrive must not fail the command)."""
    cfg = config()
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{cfg['bot_token']}/{method}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            response.read()
    except Exception as error:
        print(f"telegram {method} failed: {error}")


def say(text):
    bot_api("sendMessage", {"chat_id": config()["chat_id"], "text": text, "disable_web_page_preview": True})


def worker_tasks():
    """Tasks of the worker that are starting or running: [{arn, lastStatus}]."""
    arns = ecs.list_tasks(cluster=CLUSTER_ARN, desiredStatus="RUNNING").get("taskArns", [])
    if not arns:
        return []
    tasks = ecs.describe_tasks(cluster=CLUSTER_ARN, tasks=arns).get("tasks", [])
    return [
        {"arn": t["taskArn"], "lastStatus": t.get("lastStatus", ""), "startedAt": t.get("startedAt")} for t in tasks
    ]


def worker_stopping():
    """True while a stopped worker task is still shutting down (saving its session to S3)."""
    arns = ecs.list_tasks(cluster=CLUSTER_ARN, desiredStatus="STOPPED").get("taskArns", [])
    if not arns:
        return False
    tasks = ecs.describe_tasks(cluster=CLUSTER_ARN, tasks=arns).get("tasks", [])
    return any(t.get("lastStatus") != "STOPPED" for t in tasks)


def start_worker(up_at):
    """Run the worker task; messages sent before `up_at` (unix seconds) are skipped by it. True on success."""
    try:
        response = ecs.run_task(
            cluster=CLUSTER_ARN,
            taskDefinition=TASK_DEFINITION_ARN,
            launchType="FARGATE",
            count=1,
            startedBy=STARTED_BY,
            networkConfiguration={
                "awsvpcConfiguration": {
                    "subnets": SUBNET_IDS,
                    "securityGroups": SECURITY_GROUP_IDS,
                    "assignPublicIp": "ENABLED",
                }
            },
            overrides={
                "containerOverrides": [
                    {
                        "name": CONTAINER_NAME,
                        # Messages sent before this start (left in the queue) are skipped by the worker
                        "environment": [{"name": "UP_AT", "value": str(up_at)}],
                    }
                ]
            },
        )
        failures = response.get("failures") or []
        if failures or not response.get("tasks"):
            reason = "; ".join(f"{f.get('reason')} {f.get('detail') or ''}".strip() for f in failures)
            say(f"🔴 Не вдалося підняти воркера: {reason or 'ECS не створив таск'}")
            return False
        return True
    except Exception as error:
        say(f"🔴 Не вдалося підняти воркера: {error}")
        return False


def request_start_after_stop(up_at):
    """A worker is still stopping: start a new one once it has stopped (its STOPPED event, see task_stopped)."""
    try:
        existing = json.loads(s3.get_object(Bucket=STATE_BUCKET, Key=PENDING_START_KEY)["Body"].read())
        up_at = min(up_at, int(existing.get("up_at", up_at)))
    except Exception:
        pass
    s3.put_object(Bucket=STATE_BUCKET, Key=PENDING_START_KEY, Body=json.dumps({"up_at": up_at}).encode())
    # It may have stopped between the check and the write: then its event saw no request, so start now
    if not worker_stopping() and not worker_tasks():
        start_pending()


def start_pending():
    """Start the worker for a pending request, if there is one (exactly once: the request is deleted first)."""
    try:
        pending = json.loads(s3.get_object(Bucket=STATE_BUCKET, Key=PENDING_START_KEY)["Body"].read())
    except Exception:
        return False
    s3.delete_object(Bucket=STATE_BUCKET, Key=PENDING_START_KEY)
    say("⏳ Піднімаю новий воркер…")
    return start_worker(int(pending.get("up_at", time.time())))


def up(message):
    tasks = worker_tasks()
    if tasks:
        running = any(t["lastStatus"] == "RUNNING" for t in tasks)
        say("🟢 Воркер уже працює" if running else "⏳ Воркер уже піднімається")
        return
    if worker_stopping():
        # A new task would restore the state before the stopping one has saved it: start after it stops
        say("⏳ Попередній воркер ще вимикається: підніму новий, щойно він зупиниться")
        request_start_after_stop(message.get("date", int(time.time())))
        return
    say("⏳ Піднімаю воркера…")
    start_worker(message.get("date", int(time.time())))


def down():
    tasks = worker_tasks()
    if not tasks:
        say("⚪ Воркер і так не запущений")
        return
    say("⏳ Зупиняю, зберігаю контекст…")
    for task in tasks:
        # SIGTERM: the worker saves the session to S3, reports and exits (stopTimeout 120 s)
        ecs.stop_task(cluster=CLUSTER_ARN, task=task["arn"], reason="/down from Telegram")


def attachments_of(message):
    """Photos, voice, audio and files of a message: the worker downloads them through the Bot API."""
    found = []
    if message.get("photo"):
        # Sizes ascending: the last one is the original resolution
        found.append({"kind": "photo", "file_id": message["photo"][-1]["file_id"], "mime_type": "image/jpeg"})
    for kind in ("voice", "audio", "document"):
        item = message.get(kind)
        if item:
            found.append(
                {
                    "kind": kind,
                    "file_id": item["file_id"],
                    "file_name": item.get("file_name"),
                    "mime_type": item.get("mime_type"),
                }
            )
    return found


def context_of(message):
    """What the message answers or carries over: the replied-to message (and the quoted part) and a forward's origin."""
    context = {}
    reply = message.get("reply_to_message")
    if reply:
        context["reply_to"] = {
            "text": (reply.get("text") or reply.get("caption") or "")[:REPLY_MAX_CHARS],
            "from_bot": bool((reply.get("from") or {}).get("is_bot")),
            "date": reply.get("date", 0),
            "attachments": [a["kind"] for a in attachments_of(reply)],
        }
        quote = (message.get("quote") or {}).get("text")
        if quote:
            context["reply_to"]["quote"] = quote[:REPLY_MAX_CHARS]
    origin = message.get("forward_origin")
    if origin:
        sender = origin.get("sender_user") or {}
        context["forwarded_from"] = (
            " ".join(filter(None, [sender.get("first_name"), sender.get("last_name")]))
            + (" (bot)" if sender.get("is_bot") else "")
            or origin.get("sender_user_name")
            # MessageOriginChat (a group) has sender_chat, MessageOriginChannel has chat
            or (origin.get("sender_chat") or origin.get("chat") or {}).get("title")
            or origin.get("type", "unknown")
        )
    return context


def forward(message, text, attachments):
    tasks = worker_tasks()
    if not tasks:
        # Not running: start it for this message (it is delivered once the worker is ready)
        if worker_stopping():
            # Queue it and start a new worker once the stopping one has saved its session
            say("⏳ Попередній воркер ще вимикається: підніму новий і передам повідомлення")
            request_start_after_stop(message.get("date", int(time.time())))
        else:
            say("⏳ Воркер не був запущений: піднімаю, передам повідомлення, щойно підніметься")
            if not start_worker(message.get("date", int(time.time()))):
                return
        tasks = [{"lastStatus": "PROVISIONING"}]
        announced = True
    else:
        announced = False
    sqs.send_message(
        QueueUrl=QUEUE_URL,
        MessageBody=json.dumps(
            {"text": text, "attachments": attachments, "date": message.get("date", 0), **context_of(message)}
        ),
        MessageGroupId=str(message["chat"]["id"]),
        MessageDeduplicationId=str(message["message_id"]),
    )
    if not announced and not any(t["lastStatus"] == "RUNNING" for t in tasks):
        say("📥 Отримав, передам, щойно підніметься")


def callback(query):
    """A button under a worker message: stop Telegram's spinner, then hand it to the running worker."""
    chat_id = str(((query.get("message") or {}).get("chat") or {}).get("id"))
    if chat_id != config()["chat_id"]:
        return {"statusCode": 200, "body": "ignored"}
    running = any(t["lastStatus"] == "RUNNING" for t in worker_tasks())
    answer = {"callback_query_id": query["id"]}
    if not running:
        # The question it answers went away with the worker's run
        answer["text"] = "Воркер не запущений: /up"
    bot_api("answerCallbackQuery", answer)
    if not running:
        return {"statusCode": 200, "body": "no worker"}
    now = int(time.time())
    sqs.send_message(
        QueueUrl=QUEUE_URL,
        MessageBody=json.dumps(
            {
                "callback": {"data": query.get("data", ""), "message_id": query["message"]["message_id"]},
                "date": now,
            }
        ),
        MessageGroupId=chat_id,
        MessageDeduplicationId=f"callback-{query['id']}",
    )
    return {"statusCode": 200, "body": "ok"}


def telegram_update(event):
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    cfg = config()
    if not cfg["webhook_secret"] or headers.get("x-telegram-bot-api-secret-token") != cfg["webhook_secret"]:
        return {"statusCode": 403, "body": "forbidden"}
    body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        import base64

        body = base64.b64decode(body).decode()
    update = json.loads(body)
    if update.get("callback_query"):
        return callback(update["callback_query"])
    message = update.get("message") or {}
    if str((message.get("chat") or {}).get("id")) != cfg["chat_id"]:
        return {"statusCode": 200, "body": "ignored"}
    text = (message.get("text") or message.get("caption") or "").strip()
    attachments = attachments_of(message)
    if not text and not attachments:
        say("Такий тип повідомлень не підтримую: текст, фото, голосові, аудіо або файли")
        return {"statusCode": 200, "body": "ok"}
    command = text.split()[0].split("@")[0].lower() if text and not attachments else ""
    if command == "/up":
        up(message)
    elif command == "/down":
        down()
    elif command == "/start":
        say(
            "Команди: /up — підняти воркера, /down — зупинити. Поки він працює, пиши йому сюди; "
            "/mode — режим (bypass, auto, manual, plan), /model, /effort, /agents — субагенти, /plans — збережені плани, "
            "/compact — стиснути контекст."
        )
    else:
        forward(message, text, attachments)
    return {"statusCode": 200, "body": "ok"}


def last_save_time():
    try:
        saved = s3.head_object(Bucket=STATE_BUCKET, Key=META_KEY)["LastModified"]
        return saved.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    except Exception:
        return "немає"


def task_stopped(event):
    detail = event.get("detail") or {}
    if detail.get("lastStatus") != "STOPPED":
        return {"statusCode": 200, "body": "not stopped"}
    containers = detail.get("containers") or []
    exit_code = next((c.get("exitCode") for c in containers if c.get("name") == CONTAINER_NAME), None)
    if exit_code not in REPORTED_EXIT_CODES:
        report_unexpected_stop(detail, containers, exit_code)
    else:
        # The worker said why it stops and that the context is saved; only now is the task really stopped
        say("⚪ Воркер зупинено")
    # A start requested while this task was saving its session
    if not worker_tasks():
        start_pending()
    return {"statusCode": 200, "body": "handled"}


def report_unexpected_stop(detail, containers, exit_code):
    reason = detail.get("stoppedReason") or detail.get("stopCode") or "невідома причина"
    container_reason = next((c.get("reason") for c in containers if c.get("reason")), "")
    parts = [reason]
    if container_reason:
        parts.append(container_reason)
    if exit_code is not None:
        parts.append(f"exit code {exit_code}")
    say(f"🔴 Воркер несподівано зупинився ({'; '.join(parts)}). Контекст останнього збереження: {last_save_time()}")


def read_json(key):
    try:
        return json.loads(s3.get_object(Bucket=STATE_BUCKET, Key=key)["Body"].read())
    except Exception:
        return None


def idle_watch():
    """
    Scheduled: once the worker is still up IDLE_ALERT_MINUTES after its last answer with no turn running, warn the owner
    and tell the worker (its Claude stops the orphaned background tasks); again every IDLE_ALERT_MINUTES while it stays so.
    """
    running = [t for t in worker_tasks() if t["lastStatus"] == "RUNNING" and t["startedAt"]]
    if not running:
        return {"status": "no worker"}
    activity = read_json(ACTIVITY_KEY) or {}
    last = activity.get("lastAnswerAt")
    if activity.get("stopping"):
        return {"status": "stopping"}
    if not last or activity.get("turnActive"):
        return {"status": "busy or unknown"}
    answered = datetime.fromisoformat(last.replace("Z", "+00:00"))
    # A new run writes its activity only once its session is restored: until then the file is the previous run's
    if answered < max(t["startedAt"] for t in running):
        return {"status": "starting"}
    minutes = (datetime.now(timezone.utc) - answered).total_seconds() / 60
    if minutes < IDLE_ALERT_MINUTES:
        return {"status": "recent answer"}
    # Round after round: again every IDLE_ALERT_MINUTES while nothing changes (a worker that does not answer)
    alert = read_json(IDLE_ALERT_KEY) or {}
    if alert.get("lastAnswerAt") == last and time.time() - alert.get("at", 0) < IDLE_ALERT_MINUTES * 60:
        return {"status": "already warned"}
    # Marked before the message: a failed mark (and EventBridge's retry of the invocation) never warns twice
    now = int(time.time())
    s3.put_object(Bucket=STATE_BUCKET, Key=IDLE_ALERT_KEY, Body=json.dumps({"lastAnswerAt": last, "at": now}))
    say(
        f"🟡 Воркер працює вже {int(minutes)} хв після останньої відповіді, а задачі в роботі немає: "
        "можливо, висить фонова задача, що не дає йому заснути. Передав воркеру: осиротілі фонові задачі він "
        "зупинить сам і засне. /background — подивитись, /down — зупинити"
    )
    # The worker gets it too: Claude stops the orphaned background tasks, then the idle timer stops the worker
    sqs.send_message(
        QueueUrl=QUEUE_URL,
        MessageBody=json.dumps(
            {"watchdog": "idle", "lastAnswerAt": last, "minutes": int(minutes), "date": now}
        ),
        MessageGroupId=str(config()["chat_id"]),
        MessageDeduplicationId=f"idle-watchdog-{last}-{now}",
    )
    return {"status": "warned"}


def handler(event, _context):
    if event.get("source") == "aws.ecs":
        return task_stopped(event)
    if event.get("source") == "aws.events" and event.get("detail-type") == "Scheduled Event":
        return idle_watch()
    try:
        return telegram_update(event)
    except Exception as error:
        print(f"update failed: {error}")
        # 200: Telegram would otherwise retry the same update again and again
        return {"statusCode": 200, "body": "error"}
