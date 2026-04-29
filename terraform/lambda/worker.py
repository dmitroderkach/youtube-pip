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


def _process_message(body):
    payload = json.loads(body)
    repo_url = payload["repo_url"]
    labels = payload.get("labels") or []
    run_id = payload.get("run_id", "unknown")

    ecs = boto3.client("ecs")

    token = _github_registration_token()
    runner_name = f"fargate-{run_id}"
    assign_public_ip = os.environ.get("ASSIGN_PUBLIC_IP", "DISABLED")

    ecs.run_task(
        cluster=os.environ["ECS_CLUSTER_ARN"],
        taskDefinition=os.environ["TASK_DEFINITION_ARN"],
        launchType="FARGATE",
        networkConfiguration={
            "awsvpcConfiguration": {
                "subnets": os.environ["SUBNET_IDS"].split(","),
                "securityGroups": os.environ["SECURITY_GROUP_IDS"].split(","),
                "assignPublicIp": assign_public_ip,
            }
        },
        overrides={
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
    )


def handler(event, _context):
    records = event.get("Records") or []
    for record in records:
        _process_message(record["body"])
    return {"statusCode": 200, "body": f"processed {len(records)} messages"}
