"""Dev worker bot (docs/DEV_WORKER.md).

Two entry points:
- Telegram webhook (Lambda Function URL): /up starts the dev-worker ECS task, /down stops it, any other text goes
  to the worker's SQS FIFO queue. Only requests with the webhook secret token from the owner's chat are served.
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
STARTED_BY = "telegram"
META_KEY = "state/meta.json"

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


def say(text):
    cfg = config()
    body = json.dumps({"chat_id": cfg["chat_id"], "text": text, "disable_web_page_preview": True}).encode()
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{cfg['bot_token']}/sendMessage",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            response.read()
    except Exception as error:  # a status that does not arrive must not fail the command
        print(f"telegram sendMessage failed: {error}")


def worker_tasks():
    """Tasks of the worker that are starting or running: [{arn, lastStatus}]."""
    arns = ecs.list_tasks(cluster=CLUSTER_ARN, desiredStatus="RUNNING").get("taskArns", [])
    if not arns:
        return []
    tasks = ecs.describe_tasks(cluster=CLUSTER_ARN, tasks=arns).get("tasks", [])
    return [{"arn": t["taskArn"], "lastStatus": t.get("lastStatus", "")} for t in tasks]


def up(message):
    tasks = worker_tasks()
    if tasks:
        running = any(t["lastStatus"] == "RUNNING" for t in tasks)
        say("🟢 Воркер уже працює" if running else "⏳ Воркер уже піднімається")
        return
    say("⏳ Піднімаю воркера…")
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
                        # Messages sent before this /up (left in the queue) are skipped by the worker
                        "environment": [{"name": "UP_AT", "value": str(message.get("date", int(time.time())))}],
                    }
                ]
            },
        )
        failures = response.get("failures") or []
        if failures or not response.get("tasks"):
            reason = "; ".join(f"{f.get('reason')} {f.get('detail') or ''}".strip() for f in failures)
            say(f"🔴 Не вдалося підняти воркера: {reason or 'ECS не створив таск'}")
    except Exception as error:
        say(f"🔴 Не вдалося підняти воркера: {error}")


def down():
    tasks = worker_tasks()
    if not tasks:
        say("⚪ Воркер і так не запущений")
        return
    say("⏳ Зупиняю, зберігаю контекст…")
    for task in tasks:
        # SIGTERM: the worker saves the session to S3, reports and exits (stopTimeout 120 s)
        ecs.stop_task(cluster=CLUSTER_ARN, task=task["arn"], reason="/down from Telegram")


def forward(message):
    tasks = worker_tasks()
    if not tasks:
        say("Воркер не запущений. Напиши /up")
        return
    sqs.send_message(
        QueueUrl=QUEUE_URL,
        MessageBody=json.dumps({"text": message["text"], "date": message.get("date", 0)}),
        MessageGroupId=str(message["chat"]["id"]),
        MessageDeduplicationId=str(message["message_id"]),
    )
    if not any(t["lastStatus"] == "RUNNING" for t in tasks):
        say("📥 Отримав, передам, щойно підніметься")


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
    message = update.get("message") or {}
    if str((message.get("chat") or {}).get("id")) != cfg["chat_id"]:
        return {"statusCode": 200, "body": "ignored"}
    text = (message.get("text") or "").strip()
    if not text:
        say("Поки що розумію лише текст")
        return {"statusCode": 200, "body": "ok"}
    command = text.split()[0].split("@")[0].lower()
    if command == "/up":
        up(message)
    elif command == "/down":
        down()
    elif command == "/start":
        say("Команди: /up — підняти воркера, /down — зупинити. Поки він працює, пиши йому сюди.")
    else:
        forward(message)
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
    if exit_code in REPORTED_EXIT_CODES:
        return {"statusCode": 200, "body": "reported by the worker"}
    reason = detail.get("stoppedReason") or detail.get("stopCode") or "невідома причина"
    container_reason = next((c.get("reason") for c in containers if c.get("reason")), "")
    parts = [reason]
    if container_reason:
        parts.append(container_reason)
    if exit_code is not None:
        parts.append(f"exit code {exit_code}")
    say(f"🔴 Воркер несподівано зупинився ({'; '.join(parts)}). Контекст останнього збереження: {last_save_time()}")
    return {"statusCode": 200, "body": "reported"}


def handler(event, _context):
    if event.get("source") == "aws.ecs":
        return task_stopped(event)
    try:
        return telegram_update(event)
    except Exception as error:
        print(f"update failed: {error}")
        # 200: Telegram would otherwise retry the same update again and again
        return {"statusCode": 200, "body": "error"}
