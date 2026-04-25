import hashlib
import hmac
import json
import os

import boto3

_secrets_client = boto3.client("secretsmanager")
_sqs_client = boto3.client("sqs")
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

    job = payload.get("workflow_job") or {}
    dispatch_payload = {
        "repo_url": repo_url,
        "labels": labels,
        "run_id": job.get("run_id", "unknown"),
    }

    _sqs_client.send_message(
        QueueUrl=os.environ["DISPATCH_QUEUE_URL"],
        MessageBody=json.dumps(dispatch_payload),
    )
    return {"statusCode": 202, "body": "accepted"}
