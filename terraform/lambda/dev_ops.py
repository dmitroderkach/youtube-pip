"""Dev worker operations (docs/DEV_WORKER.md, "Infrastructure and images"; terraform/dev_worker_ops.tf).

Invoked by the worker (scripts/dev-worker/dev-ops.sh) with one of:

- {"action": "plan"}: terraform plan of main in CodeBuild (tf-plan); the plan goes to the owner's chat with ✅ Apply.
- {"action": "build", "image": "runner" | "dev-worker", "ref": "<branch or commit>"}: builds the image into the
  candidates repository (CodeBuild image-build), which neither CI nor the worker runs.
- {"action": "publish", "image": "runner" | "dev-worker"}: asks the owner (✅ / 🚫 under a message sent from here) to
  publish :latest built from the current main commit; dev-bot starts image-publish on ✅.
- {"action": "telegram"}: asks the owner to set the bot up from the current main commit (webhook to dev-bot, the command
  menu of scripts/dev-worker/setup-telegram.mjs, listed in the request); dev-bot starts telegram-setup on ✅.

Nothing started here changes the infrastructure or a published image: what changes them waits for the owner's button,
and the message with the button is sent from here or from tf-plan, never by the worker.
"""

import json
import os
import re
import time
import urllib.request
import uuid

import boto3

codebuild = boto3.client("codebuild")
s3 = boto3.client("s3")
secrets = boto3.client("secretsmanager")

TF_PLAN_PROJECT = os.environ["TF_PLAN_PROJECT"]
IMAGE_BUILD_PROJECT = os.environ["IMAGE_BUILD_PROJECT"]
OPS_BUCKET = os.environ["OPS_BUCKET"]
ONCALL_SECRET_ARN = os.environ["ONCALL_SECRET_ARN"]
GITHUB_REPO = os.environ["GITHUB_REPO"]
CANDIDATES_REPO_URL = os.environ["CANDIDATES_REPO_URL"]

IMAGES = {
    "runner": "Ранер виконує весь CI: нові джоби підуть уже на ньому.",
    "dev-worker": "Воркер візьме його на наступному /up.",
}
# A branch name or a commit (no option-like or path-escaping refs)
REF = re.compile(r"^[A-Za-z0-9._/][A-Za-z0-9._/-]{0,199}$")

_telegram = None


def telegram(method, payload):
    global _telegram
    if _telegram is None:
        oncall = json.loads(secrets.get_secret_value(SecretId=ONCALL_SECRET_ARN)["SecretString"])
        _telegram = {"token": oncall["telegram_bot_token"], "chat_id": str(oncall["telegram_chat_id"])}
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{_telegram['token']}/{method}",
        data=json.dumps({"chat_id": _telegram["chat_id"], **payload}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read())["result"]


def main_commit():
    """(sha, subject) of the head of main (public repository: no token)."""
    request = urllib.request.Request(
        f"https://api.github.com/repos/{GITHUB_REPO}/commits/main",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "youtube-pip-dev-ops"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        commit = json.loads(response.read())
    return commit["sha"], commit["commit"]["message"].splitlines()[0]


def plan(_event):
    build = codebuild.start_build(projectName=TF_PLAN_PROJECT)["build"]
    return {"build_id": build["id"], "run_id": build["id"].split(":")[-1]}


def build_image(event):
    image, ref = event.get("image"), event.get("ref") or "main"
    if image not in IMAGES:
        return {"error": f"image must be one of {sorted(IMAGES)}"}
    if not REF.match(ref) or ".." in ref:
        return {"error": "ref must be a branch name or a commit"}
    tag = re.sub(r"[^A-Za-z0-9._-]", "-", ref)[:80] + "-" + time.strftime("%Y%m%d%H%M%S", time.gmtime())
    build = codebuild.start_build(
        projectName=IMAGE_BUILD_PROJECT,
        environmentVariablesOverride=[
            {"name": "IMAGE", "value": image, "type": "PLAINTEXT"},
            {"name": "REF", "value": ref, "type": "PLAINTEXT"},
            {"name": "TAG", "value": tag, "type": "PLAINTEXT"},
        ],
    )["build"]
    return {"build_id": build["id"], "image_uri": f"{CANDIDATES_REPO_URL}:{image}-{tag}"}


def ask_owner(kind, sha, text, button, extra):
    """The request with ✅ / 🚫 and its gate record (what dev-bot compares the pressed message with)."""
    request_id = str(uuid.uuid4())
    markup = {
        "inline_keyboard": [
            [
                {"text": button, "callback_data": f"gate:{request_id}:ok"},
                {"text": "🚫 Відхилити", "callback_data": f"gate:{request_id}:no"},
            ]
        ]
    }
    message = telegram("sendMessage", {"text": text, "reply_markup": markup, "disable_web_page_preview": True})
    s3.put_object(
        Bucket=OPS_BUCKET,
        Key=f"gate/{request_id}.json",
        Body=json.dumps(
            {
                "kind": kind,
                "id": request_id,
                "sha": sha,
                "message_id": message["message_id"],
                "text": message.get("text", ""),
                "reply_markup": message.get("reply_markup") or {},
                "created_at": int(time.time()),
                **extra,
            }
        ).encode(),
    )
    return request_id


def menu_commands(sha):
    """The command menu setup-telegram.mjs sets at that commit: ["/up — …", …]."""
    request = urllib.request.Request(
        f"https://raw.githubusercontent.com/{GITHUB_REPO}/{sha}/scripts/dev-worker/setup-telegram.mjs",
        headers={"User-Agent": "youtube-pip-dev-ops"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        source = response.read().decode()
    found = re.findall(r"\{\s*command:\s*'([^']+)',\s*description:\s*'([^']*)'\s*\}", source)
    return [f"/{name} — {description}" for name, description in found]


def telegram_setup(_event):
    sha, subject = main_commit()
    commands = menu_commands(sha)
    text = (
        f"🤖 Налаштувати Telegram-бота з main@{sha[:7]}?\n«{subject[:120]}»\n\n"
        "Вебхук на dev-bot (секрет вебхука лишається), меню команд:\n"
        + ("\n".join(commands) if commands else "(не вдалося прочитати меню з setup-telegram.mjs)")
        + "\n\nЗапустить CodeBuild telegram-setup з цього коміту. Кнопка діє годину."
    )
    request_id = ask_owner("telegram", sha, text[:3900], "✅ Налаштувати", {})
    return {"request_id": request_id, "sha": sha, "commands": len(commands)}


def publish(event):
    image = event.get("image")
    if image not in IMAGES:
        return {"error": f"image must be one of {sorted(IMAGES)}"}
    sha, subject = main_commit()
    text = (
        f"🐳 Опублікувати образ {image}:latest з main@{sha[:7]}?\n«{subject[:120]}»\n\n"
        f"{IMAGES[image]} Збере CodeBuild з цього коміту. Кнопка діє годину."
    )
    request_id = ask_owner("image", sha, text, "✅ Опублікувати", {"image": image})
    return {"request_id": request_id, "image": image, "sha": sha}


ACTIONS = {"plan": plan, "build": build_image, "publish": publish, "telegram": telegram_setup}


def handler(event, _context):
    action = ACTIONS.get((event or {}).get("action"))
    if not action:
        return {"error": f"action must be one of {sorted(ACTIONS)}"}
    try:
        return action(event)
    except Exception as error:
        print(f"{event.get('action')} failed: {error!r}")
        return {"error": str(error)}
