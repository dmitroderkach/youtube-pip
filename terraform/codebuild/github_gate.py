"""github-gate (terraform/dev_worker_ops.tf): merges a PR or tags a release with the gate GitHub App, after the owner's ✅.

Started only by dev-bot, for a request the dev-ops Lambda recorded (terraform/lambda/dev_ops.py, actions merge /
release). Embedded into the CodeBuild buildspec by Terraform (part of the gate: changed only by the owner's local
apply), so the code that holds the App's key never comes from the repository at run time.

Env:
  ACTION   merge | release
  SHA      the commit the owner approved (the PR head / the main commit)
  PR       the PR number (merge)
  VERSION  X.Y.Z (release)
  GITHUB_REPO                       owner/name
  GATE_APP_ID, GATE_APP_INSTALLATION_ID, GATE_APP_PRIVATE_KEY   from the secret youtube-pip-prod-gate-github-app
Prints one line for the chat; exits 1 when nothing was done.
"""

import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

API = "https://api.github.com"
REPO = os.environ["GITHUB_REPO"]
CHECK_OK = {"success", "neutral", "skipped"}


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def app_jwt():
    """JWT of the App (RS256, signed with openssl: no extra Python packages in the build image)."""
    now = int(time.time())
    header = b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    payload = b64url(json.dumps({"iat": now - 60, "exp": now + 540, "iss": os.environ["GATE_APP_ID"]}).encode())
    with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as key:
        key.write(os.environ["GATE_APP_PRIVATE_KEY"].replace("\\n", "\n"))
    try:
        signature = subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", key.name],
            input=f"{header}.{payload}".encode(),
            capture_output=True,
            check=True,
        ).stdout
    finally:
        os.unlink(key.name)
    return f"{header}.{payload}.{b64url(signature)}"


def call(method, path, token, body=None, scheme="Bearer"):
    request = urllib.request.Request(
        f"{API}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"{scheme} {token}",
            "User-Agent": "youtube-pip-github-gate",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            text = response.read()
            return response.status, json.loads(text) if text else {}
    except urllib.error.HTTPError as error:
        text = error.read()
        try:
            return error.code, json.loads(text)
        except ValueError:
            return error.code, {"message": text.decode(errors="replace")[:300]}


def installation_token():
    """A token of the gate App for this repository only, with only what it needs."""
    status, body = call(
        "POST",
        f"/app/installations/{os.environ['GATE_APP_INSTALLATION_ID']}/access_tokens",
        app_jwt(),
        {"repositories": [REPO.split("/")[1]], "permissions": {"contents": "write", "pull_requests": "write"}},
    )
    if status != 201:
        sys.exit(f"🔴 github-gate: токен App не отримано ({status}: {body.get('message')})")
    return body["token"]


def checks_green(token, sha):
    status, body = call("GET", f"/repos/{REPO}/commits/{sha}/check-runs?per_page=100", token)
    runs = body.get("check_runs", []) if status == 200 else []
    bad = [r["name"] for r in runs if r.get("status") != "completed" or r.get("conclusion") not in CHECK_OK]
    return bool(runs) and not bad, bad


def merge(token):
    number, sha = int(os.environ["PR"]), os.environ["SHA"]
    status, pr = call("GET", f"/repos/{REPO}/pulls/{number}", token)
    if status != 200 or pr.get("state") != "open":
        sys.exit(f"🔴 PR #{number}: не відкритий, не мерджу")
    if pr["base"]["ref"] != "main" or pr["head"]["repo"]["full_name"] != REPO:
        sys.exit(f"🔴 PR #{number}: не в main або з форка, не мерджу")
    if pr["head"]["sha"] != sha:
        sys.exit(f"🔴 PR #{number}: після запиту в гілку допушили ({pr['head']['sha'][:7]} ≠ {sha[:7]}), не мерджу")
    ok, bad = checks_green(token, sha)
    if not ok:
        sys.exit(f"🔴 PR #{number}: перевірки не зелені ({', '.join(bad) or 'нема'}), не мерджу")
    # sha: GitHub refuses if the head moved in the meantime
    status, body = call(
        "PUT",
        f"/repos/{REPO}/pulls/{number}/merge",
        token,
        {"merge_method": "squash", "sha": sha, "commit_title": f"{pr['title']} (#{number})"},
    )
    if status == 200 and body.get("merged"):
        print(f"✅ PR #{number} змерджено в main (squash {body['sha'][:7]}): «{pr['title'][:120]}»")
        return
    if status >= 500:
        # GitHub may have merged anyway (2026-11-13: a 502 with the squash commit on main and the PR left open)
        merged = merged_anyway(token, number, sha)
        if merged:
            print(
                f"✅ PR #{number} змерджено в main ({merged[:7]}): GitHub відповів {status}, але на main саме "
                f"схвалений вміст «{pr['title'][:100]}»"
                + ("" if merged_pr(token, number) else "; PR лишився відкритим: закрий його вручну")
            )
            return
    sys.exit(f"🔴 PR #{number}: GitHub не змерджив ({status}: {body.get('message')})")


def merged_pr(token, number):
    status, pr = call("GET", f"/repos/{REPO}/pulls/{number}", token)
    return status == 200 and pr.get("merged")


def merged_anyway(token, number, sha):
    """After a 5xx: the merge commit, when the PR is merged or main's head has exactly the approved head's files."""
    for _ in range(6):
        time.sleep(10)
        status, pr = call("GET", f"/repos/{REPO}/pulls/{number}", token)
        if status == 200 and pr.get("merged"):
            return pr.get("merge_commit_sha") or "merged"
        status, approved = call("GET", f"/repos/{REPO}/git/commits/{sha}", token)
        status_main, main = call("GET", f"/repos/{REPO}/commits/main", token)
        if (
            status == 200
            and status_main == 200
            and main["commit"]["tree"]["sha"] == approved["tree"]["sha"]
            and main["sha"] != sha
        ):
            return main["sha"]
    return None


def release(token):
    version, sha = os.environ["VERSION"], os.environ["SHA"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        sys.exit("🔴 Реліз: неправильна версія або коміт")
    status, _ = call("GET", f"/repos/{REPO}/git/ref/tags/v{version}", token)
    if status == 200:
        sys.exit(f"🔴 Реліз: тег v{version} уже існує")
    # The approved commit must be on main (it was main's head when the owner was asked)
    status, compare = call("GET", f"/repos/{REPO}/compare/{sha}...main", token)
    if status != 200 or compare.get("status") not in ("identical", "ahead"):
        sys.exit(f"🔴 Реліз: коміт {sha[:7]} не з main")
    status, content = call("GET", f"/repos/{REPO}/contents/package.json?ref={sha}", token)
    found = json.loads(base64.b64decode(content.get("content", ""))).get("version") if status == 200 else None
    if found != version:
        sys.exit(f"🔴 Реліз: у package.json коміту {sha[:7]} версія {found}, а не {version}")
    # No check runs on main itself: it only gets merges whose PR checks passed (ruleset)
    status, body = call("POST", f"/repos/{REPO}/git/refs", token, {"ref": f"refs/tags/v{version}", "sha": sha})
    if status != 201:
        sys.exit(f"🔴 Реліз: тег v{version} не створено ({status}: {body.get('message')})")
    print(f"Тег v{version} створено на main@{sha[:7]}, чекаю на release.yml", flush=True)
    publish_to_release_branch(token, version, sha)


# What installed scripts (@updateURL / @downloadURL) and Greasy Fork read: a file on the protected branch `release`,
# which only the gate App (and the owner) may update. GitHub releases are only the download page and changelog.
RELEASE_BRANCH = "release"
SCRIPT = "youtube-pip.user.js"
ACTIONS_BOT = "github-actions[bot]"
RELEASE_WAIT_SECONDS = 20 * 60


def published_release(token, version):
    """The release of the tag once release.yml has published it, made by GitHub Actions itself (not by anyone else)."""
    deadline = time.time() + RELEASE_WAIT_SECONDS
    while time.time() < deadline:
        status, rel = call("GET", f"/repos/{REPO}/releases/tags/v{version}", token)
        if status == 200 and not rel.get("draft"):
            if (rel.get("author") or {}).get("login") != ACTIONS_BOT:
                sys.exit(f"🔴 Реліз v{version}: його створив не release.yml ({(rel.get('author') or {}).get('login')})")
            asset = next((a for a in rel.get("assets", []) if a.get("name") == SCRIPT), None)
            if not asset or (asset.get("uploader") or {}).get("login") != ACTIONS_BOT or asset.get("state") != "uploaded":
                sys.exit(f"🔴 Реліз v{version}: нема {SCRIPT} від release.yml")
            return asset
        time.sleep(20)
    sys.exit(f"🔴 Реліз v{version}: release.yml не опублікував реліз за {RELEASE_WAIT_SECONDS // 60} хв")


def publish_to_release_branch(token, version, sha):
    asset = published_release(token, version)
    # Public repository: the asset's download URL needs no token (and redirects to storage that refuses one)
    request = urllib.request.Request(asset["browser_download_url"], headers={"User-Agent": "youtube-pip-github-gate"})
    with urllib.request.urlopen(request, timeout=60) as response:
        script = response.read()
    if not re.search(rb"^// @version\s+" + re.escape(version.encode()) + rb"\s*$", script, re.M):
        sys.exit(f"🔴 Реліз v{version}: у {SCRIPT} з релізу інша @version")
    status, _ = call("GET", f"/repos/{REPO}/git/ref/heads/{RELEASE_BRANCH}", token)
    if status == 404:
        status, body = call("POST", f"/repos/{REPO}/git/refs", token, {"ref": f"refs/heads/{RELEASE_BRANCH}", "sha": sha})
        if status != 201:
            sys.exit(f"🔴 Гілку {RELEASE_BRANCH} не створено ({status}: {body.get('message')})")
    status, current = call("GET", f"/repos/{REPO}/contents/{SCRIPT}?ref={RELEASE_BRANCH}", token)
    body = {
        "message": f"Release v{version}: {SCRIPT}",
        "content": base64.b64encode(script).decode(),
        "branch": RELEASE_BRANCH,
        **({"sha": current["sha"]} if status == 200 else {}),
    }
    status, result = call("PUT", f"/repos/{REPO}/contents/{SCRIPT}", token, body)
    if status not in (200, 201):
        sys.exit(f"🔴 {SCRIPT} v{version} не записано в гілку {RELEASE_BRANCH} ({status}: {result.get('message')})")
    print(
        f"✅ Реліз v{version} опубліковано: тег на main@{sha[:7]}, release.yml зібрав реліз, {SCRIPT} у гілці "
        f"{RELEASE_BRANCH} (https://raw.githubusercontent.com/{REPO}/{RELEASE_BRANCH}/{SCRIPT}); "
        "встановлені скрипти і Greasy Fork оновляться звідти"
    )


if __name__ == "__main__":
    action = os.environ.get("ACTION")
    if action not in ("merge", "release"):
        sys.exit(f"🔴 github-gate: невідома дія {action!r}")
    {"merge": merge, "release": release}[action](installation_token())
