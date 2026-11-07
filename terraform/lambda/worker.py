import copy
import json
import os
import time
import urllib.request

import boto3
import jwt

_secrets_client = boto3.client("secretsmanager")
_secret_cache = {}


def _read_secret(secret_arn):
    cached = _secret_cache.get(secret_arn)
    if cached is not None:
        return cached

    response = _secrets_client.get_secret_value(SecretId=secret_arn)
    value = response.get("SecretString")
    if value is None:
        raise ValueError(f"SecretString is empty for secret: {secret_arn}")
    _secret_cache[secret_arn] = value
    return value


def _github_app_jwt():
    app_id = os.environ["GITHUB_APP_ID"]
    private_key_secret_arn = os.environ["GITHUB_APP_PRIVATE_KEY_SECRET_ARN"]
    private_key = _read_secret(private_key_secret_arn)
    now = int(time.time())
    payload = {"iat": now - 60, "exp": now + 540, "iss": app_id}
    return jwt.encode(payload, private_key, algorithm="RS256")


def _github_installation_token():
    installation_id = os.environ["GITHUB_APP_INSTALLATION_ID"]
    jwt_token = _github_app_jwt()
    url = f"https://api.github.com/app/installations/{installation_id}/access_tokens"

    req = urllib.request.Request(
        url=url,
        method="POST",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {jwt_token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "github-runner-dispatcher-worker",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload["token"]


def _github_registration_token():
    owner = os.environ["GITHUB_OWNER"]
    repo = os.environ["GITHUB_REPO"]
    installation_token = _github_installation_token()
    url = f"https://api.github.com/repos/{owner}/{repo}/actions/runners/registration-token"

    req = urllib.request.Request(
        url=url,
        method="POST",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {installation_token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "github-runner-dispatcher-worker",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload["token"]


def _github_get(path, installation_token):
    req = urllib.request.Request(
        url=f"https://api.github.com{path}",
        method="GET",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {installation_token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "github-runner-dispatcher-worker",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def _is_oncall_job(labels):
    oncall_label = os.environ.get("ONCALL_LABEL", "").lower()
    return bool(oncall_label) and oncall_label in {str(label).lower() for label in labels}


def _oncall_run_allowed(run_id):
    """The on-call task definition carries the Telegram / Claude secrets. Any workflow file (also one changed in a
    pull request) can ask for the `oncall` label, so check the run itself: only scheduled or manual runs of our
    repository's default branch get it."""
    owner = os.environ["GITHUB_OWNER"]
    repo = os.environ["GITHUB_REPO"]
    allowed_events = {e.strip() for e in os.environ.get("ONCALL_ALLOWED_EVENTS", "").split(",") if e.strip()}
    allowed_branch = os.environ.get("ONCALL_BRANCH", "main")
    run = _github_get(f"/repos/{owner}/{repo}/actions/runs/{run_id}", _github_installation_token())
    head_repo = ((run.get("head_repository") or {}).get("full_name") or "").lower()
    allowed = (
        run.get("event") in allowed_events
        and run.get("head_branch") == allowed_branch
        and head_repo == f"{owner}/{repo}".lower()
    )
    if not allowed:
        print(
            f"run {run_id}: on-call runner refused (event={run.get('event')}, "
            f"branch={run.get('head_branch')}, repo={head_repo})"
        )
    return allowed


def _process_message(body):
    payload = json.loads(body)
    repo_url = payload["repo_url"]
    labels = payload.get("labels") or []
    run_id = payload.get("run_id", "unknown")

    ecs = boto3.client("ecs")

    task_definition = os.environ["TASK_DEFINITION_ARN"]
    if _is_oncall_job(labels):
        if not _oncall_run_allowed(run_id):
            return
        task_definition = os.environ["TASK_DEFINITION_ONCALL_ARN"]

    token = _github_registration_token()
    runner_name = f"fargate-{run_id}"
    assign_public_ip = os.environ.get("ASSIGN_PUBLIC_IP", "DISABLED")

    run_task_args = {
        "cluster": os.environ["ECS_CLUSTER_ARN"],
        "taskDefinition": task_definition,
        "networkConfiguration": {
            "awsvpcConfiguration": {
                "subnets": os.environ["SUBNET_IDS"].split(","),
                "securityGroups": os.environ["SECURITY_GROUP_IDS"].split(","),
                "assignPublicIp": assign_public_ip,
            }
        },
        "overrides": {
            "containerOverrides": [
                {
                    "name": "github-runner",
                    "environment": [
                        {"name": "REPO_URL", "value": repo_url},
                        {"name": "RUNNER_NAME", "value": runner_name},
                        {"name": "RUNNER_TOKEN", "value": token},
                        {"name": "LABELS", "value": ",".join(labels)},
                    ],
                }
            ]
        },
    }
    _run_runner_task(ecs, run_task_args, run_id)


def _with_runner_capacity(run_task_args, capacity):
    """Copy of the RunTask args with RUNNER_CAPACITY in the runner container's environment: the workflow warns
    when a job runs on on-demand FARGATE (Spot unavailable) instead of FARGATE_SPOT."""
    args = copy.deepcopy(run_task_args)
    args["overrides"]["containerOverrides"][0]["environment"].append(
        {"name": "RUNNER_CAPACITY", "value": capacity}
    )
    return args


def _run_runner_task(ecs, run_task_args, run_id):
    """Start the runner on FARGATE_SPOT when enabled; fall back to on-demand FARGATE when Spot gives no task
    (no capacity is reported in `failures`, not raised), so the job is never left without a runner."""
    if os.environ.get("USE_FARGATE_SPOT", "false").lower() == "true":
        try:
            response = ecs.run_task(
                capacityProviderStrategy=[{"capacityProvider": "FARGATE_SPOT", "weight": 1}],
                **_with_runner_capacity(run_task_args, "FARGATE_SPOT"),
            )
            if response.get("tasks"):
                print(f"run {run_id}: runner started on FARGATE_SPOT")
                return
            print(f"run {run_id}: FARGATE_SPOT gave no task, falling back to FARGATE: {response.get('failures')}")
        except Exception as error:  # noqa: BLE001 - any Spot failure falls back to on-demand
            print(f"run {run_id}: FARGATE_SPOT run_task failed, falling back to FARGATE: {error}")

    response = ecs.run_task(launchType="FARGATE", **_with_runner_capacity(run_task_args, "FARGATE"))
    if not response.get("tasks"):
        raise RuntimeError(f"run {run_id}: FARGATE run_task started no task: {response.get('failures')}")
    print(f"run {run_id}: runner started on FARGATE")

def handler(event, _context):
    records = event.get("Records") or []
    for record in records:
        _process_message(record["body"])
    return {"statusCode": 200, "body": f"processed {len(records)} messages"}
