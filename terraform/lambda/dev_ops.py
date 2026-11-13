"""Dev worker operations (docs/DEV_WORKER.md, "Infrastructure and images"; terraform/dev_worker_ops.tf).

Invoked by the worker (scripts/dev-worker/dev-ops.sh) with one of:

- {"action": "plan"}: terraform plan of main in CodeBuild (tf-plan); the plan goes to the owner's chat with ✅ Apply.
- {"action": "build", "image": "runner" | "dev-worker", "ref": "<branch or commit>"}: builds the image into the
  candidates repository (CodeBuild image-build), which neither CI nor the worker runs.
- {"action": "publish", "image": "runner" | "dev-worker"}: asks the owner (✅ / 🚫 under a message sent from here) to
  publish :latest built from the current main commit; dev-bot starts image-publish on ✅.
- {"action": "telegram"}: asks the owner to set the bot up from the current main commit (webhook to dev-bot, the command
  menu of scripts/dev-worker/setup-telegram.mjs, listed in the request); dev-bot starts telegram-setup on ✅.
- {"action": "merge", "pr": <number>}: asks the owner to squash-merge an open PR into main at its current head commit;
  the request shows facts read from GitHub (files, +/−, ⚠️ sensitive paths, checks), not the worker's words. On ✅
  dev-bot starts github-gate, which merges with the gate GitHub App only if the head is still that commit.
- {"action": "release"}: asks the owner to release the version in package.json of the current main commit (main has no
  check runs of its own: it only gets merges whose PR checks passed); on ✅
  github-gate creates the tag vX.Y.Z on that commit with the gate App (release.yml builds and publishes the release).

Nothing started here changes the infrastructure or a published image: what changes them waits for the owner's button,
and the message with the button is sent from here or from tf-plan, never by the worker.
"""

import json
import os
import re
import time
import urllib.error
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


def github(path):
    """GitHub REST API of the repository (public: no token), JSON."""
    request = urllib.request.Request(
        f"https://api.github.com/repos/{GITHUB_REPO}{path}",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "youtube-pip-dev-ops"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read())


def raw_file(sha, path):
    request = urllib.request.Request(
        f"https://raw.githubusercontent.com/{GITHUB_REPO}/{sha}/{path}", headers={"User-Agent": "youtube-pip-dev-ops"}
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return response.read().decode()


# Changes there decide what runs with which rights or what reaches users: marked ⚠️ in a merge request
SENSITIVE_PATHS = (
    ".github/",
    "terraform/",
    "scripts/dev-worker/",
    "scripts/oncall/",
    "scripts/claude-update/",
    ".cursor/",
    "CLAUDE.md",
    "vite.config.ts",
    "package.json",
    "package-lock.json",
)
# Check runs that count as passed (a skipped job is fine: the workflow decided it has nothing to run)
CHECK_OK = {"success", "neutral", "skipped"}


def checks_of(sha):
    """(ok, summary) of the check runs of a commit: every run completed and passed, at least one run."""
    runs = github(f"/commits/{sha}/check-runs?per_page=100").get("check_runs", [])
    pending = [r["name"] for r in runs if r.get("status") != "completed"]
    failed = [r["name"] for r in runs if r.get("status") == "completed" and r.get("conclusion") not in CHECK_OK]
    if not runs:
        return False, "перевірок нема"
    if pending:
        return False, "ще йдуть: " + ", ".join(pending)
    if failed:
        return False, "впали: " + ", ".join(failed)
    return True, f"зелені ({len(runs)})"


def merge(event):
    try:
        number = int(event.get("pr"))
    except (TypeError, ValueError):
        return {"error": "pr must be a PR number"}
    pr = github(f"/pulls/{number}")
    if pr.get("state") != "open" or pr.get("merged"):
        return {"error": f"PR #{number} is not open"}
    if (pr.get("base") or {}).get("ref") != "main":
        return {"error": f"PR #{number} does not target main"}
    if ((pr.get("head") or {}).get("repo") or {}).get("full_name") != GITHUB_REPO:
        return {"error": f"PR #{number} comes from a fork: refused"}
    sha = pr["head"]["sha"]
    ok, checks = checks_of(sha)
    if not ok:
        return {"error": f"PR #{number} checks are not green: {checks}"}
    files = github(f"/pulls/{number}/files?per_page=100")
    sensitive = sorted({f["filename"] for f in files if f["filename"].startswith(SENSITIVE_PATHS)})
    text = (
        f"🔀 Змерджити PR #{number} у main (squash)?\n«{pr.get('title', '')[:150]}»\n\n"
        f"Коміт {sha[:7]}, файлів: {pr.get('changed_files', len(files))}, "
        f"+{pr.get('additions', 0)}/−{pr.get('deletions', 0)}; перевірки {checks}.\n"
        + (
            "⚠️ Чутливі шляхи:\n" + "\n".join(f"• {name}" for name in sensitive[:20]) + "\n"
            if sensitive
            else ""
        )
        + f"\nДиф: https://github.com/{GITHUB_REPO}/pull/{number}/files\n"
        "Змерджить github-gate лише цей коміт: якщо в гілку щось допушать, мердж не відбудеться. Кнопка діє годину."
    )
    request_id = ask_owner("merge", sha, text[:3900], "✅ Змерджити", {"pr": number})
    return {"request_id": request_id, "pr": number, "sha": sha, "checks": checks, "sensitive": len(sensitive)}


VERSION = re.compile(r"^\d+\.\d+\.\d+$")


def release(_event):
    sha, subject = main_commit()
    version = json.loads(raw_file(sha, "package.json")).get("version", "")
    if not VERSION.match(version):
        return {"error": f"package.json version {version!r} is not X.Y.Z"}
    tag = f"v{version}"
    try:
        github(f"/git/ref/tags/{tag}")
        return {"error": f"tag {tag} already exists: bump the version first"}
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    # No checks on main itself (CI runs on PRs): main only gets merges whose PR checks passed (ruleset)
    changelog = raw_file(sha, "CHANGELOG.md")
    section = re.search(rf"^## \[?{re.escape(version)}\]?.*?(?=^## |\Z)", changelog, re.M | re.S)
    notes = section.group(0).strip()[:1500] if section else "(у CHANGELOG.md нема розділу цієї версії)"
    text = (
        f"🚀 Випустити реліз {tag} з main@{sha[:7]}?\n«{subject[:120]}»\n\n{notes}\n\n"
        "github-gate створить тег на цьому коміті; release.yml збере і опублікує реліз (Greasy Fork, оновлення "
        "встановлених скриптів). Кнопка діє годину."
    )
    request_id = ask_owner("release", sha, text[:3900], "✅ Випустити", {"version": version})
    return {"request_id": request_id, "version": version, "sha": sha}


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


ACTIONS = {
    "plan": plan,
    "build": build_image,
    "publish": publish,
    "telegram": telegram_setup,
    "merge": merge,
    "release": release,
}


def handler(event, _context):
    action = ACTIONS.get((event or {}).get("action"))
    if not action:
        return {"error": f"action must be one of {sorted(ACTIONS)}"}
    try:
        return action(event)
    except Exception as error:
        print(f"{event.get('action')} failed: {error!r}")
        return {"error": str(error)}
