"""Dev worker operations (docs/DEV_WORKER.md, "Infrastructure and images"; terraform/dev_worker_ops.tf).

Invoked by the worker (scripts/dev-worker/dev-ops.sh) with one of:

- {"action": "plan"}: terraform plan of main in CodeBuild (tf-plan); the plan goes to the owner's chat with ✅ Apply.
- {"action": "build", "image": "runner" | "dev-worker", "ref": "<branch or commit>"}: builds the image into the
  candidates repository (CodeBuild image-build), which neither CI nor the worker runs.
- {"action": "publish", "image": "runner" | "dev-worker"}: asks the owner (✅ / 🚫 under a message sent from here) to
  publish :latest built from the current main commit; dev-bot starts image-publish on ✅.

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


def publish(event):
    image = event.get("image")
    if image not in IMAGES:
        return {"error": f"image must be one of {sorted(IMAGES)}"}
    sha, subject = main_commit()
    request_id = str(uuid.uuid4())
    markup = {
        "inline_keyboard": [
            [
                {"text": "✅ Опублікувати", "callback_data": f"gate:{request_id}:ok"},
                {"text": "🚫 Відхилити", "callback_data": f"gate:{request_id}:no"},
            ]
        ]
    }
    message = telegram(
        "sendMessage",
        {
            "text": (
                f"🐳 Опублікувати образ {image}:latest з main@{sha[:7]}?\n«{subject[:120]}»\n\n"
                f"{IMAGES[image]} Збере CodeBuild з цього коміту. Кнопка діє годину."
            ),
            "reply_markup": markup,
            "disable_web_page_preview": True,
        },
    )
    # What dev-bot compares the pressed message with
    s3.put_object(
        Bucket=OPS_BUCKET,
        Key=f"gate/{request_id}.json",
        Body=json.dumps(
            {
                "kind": "image",
                "id": request_id,
                "image": image,
                "sha": sha,
                "message_id": message["message_id"],
                "text": message.get("text", ""),
                "reply_markup": message.get("reply_markup") or {},
                "created_at": int(time.time()),
            }
        ).encode(),
    )
    return {"request_id": request_id, "image": image, "sha": sha}


ACTIONS = {"plan": plan, "build": build_image, "publish": publish}


def handler(event, _context):
    action = ACTIONS.get((event or {}).get("action"))
    if not action:
        return {"error": f"action must be one of {sorted(ACTIONS)}"}
    try:
        return action(event)
    except Exception as error:
        print(f"{event.get('action')} failed: {error!r}")
        return {"error": str(error)}
