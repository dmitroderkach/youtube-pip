import hashlib
import hmac
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


def _header(event, name):
    headers = event.get("headers") or {}
    for k, v in headers.items():
        if k.lower() == name.lower():
            return v
    return ""


def _verify_signature(event):
    secret_arn = os.environ.get("GITHUB_WEBHOOK_SECRET_ARN", "")
    if not secret_arn:
        return False
    secret = _read_secret(secret_arn)
    if not secret:
        return False

    signature = _header(event, "x-hub-signature-256")
    if not signature.startswith("sha256="):
        return False

    body = event.get("body") or ""
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"),
        body.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


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
            "User-Agent": "github-runner-dispatcher",
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
            "User-Agent": "github-runner-dispatcher",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload["token"]


def _matches_labels(job_labels, required_labels):
    label_set = {str(x).lower() for x in job_labels}
    return all(label.lower() in label_set for label in required_labels)


def handler(event, _context):
    if event.get("requestContext", {}).get("http", {}).get("method") != "POST":
        return {"statusCode": 405, "body": "method not allowed"}

    if not _verify_signature(event):
        return {"statusCode": 401, "body": "invalid signature"}

    payload = json.loads(event.get("body") or "{}")
    if payload.get("action") != "queued":
        return {"statusCode": 200, "body": "ignored: action is not queued"}

    job = payload.get("workflow_job") or {}
    labels = job.get("labels") or []
    required = [x for x in os.environ.get("RUNNER_LABELS", "").split(",") if x]
    if required and not _matches_labels(labels, required):
        return {"statusCode": 200, "body": "ignored: labels do not match"}

    repo = payload.get("repository") or {}
    repo_url = repo.get("html_url")
    if not repo_url:
        return {"statusCode": 400, "body": "repository URL missing"}

    token = _github_registration_token()
    run_id = payload.get("workflow_job", {}).get("run_id", "unknown")
    runner_name = f"fargate-{run_id}"
    assign_public_ip = os.environ.get("ASSIGN_PUBLIC_IP", "DISABLED")
    nat_instance_id = os.environ.get("NAT_INSTANCE_ID")

    ec2 = boto3.client("ec2")
    ecs = boto3.client("ecs")

    if nat_instance_id:
        response = ec2.describe_instances(InstanceIds=[nat_instance_id])
        state = response["Reservations"][0]["Instances"][0]["State"]["Name"]
        if state in {"stopped", "stopping"}:
            ec2.start_instances(InstanceIds=[nat_instance_id])
            waiter = ec2.get_waiter("instance_running")
            waiter.wait(InstanceIds=[nat_instance_id])

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

    return {"statusCode": 202, "body": "runner task started"}
