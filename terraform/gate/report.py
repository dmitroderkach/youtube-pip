#!/usr/bin/env python3
"""Owner's chat reports of the dev worker's gated Terraform runs (terraform/dev_worker_ops.tf, docs/DEV_WORKER.md).

Runs in CodeBuild (stdlib only, S3 through the aws CLI):

  report.py plan <plan.json>          tf-plan: the full plan as a file, then a summary with ✅ Apply / 🚫 and the gate
                                      record dev-bot checks before it starts tf-apply (no buttons when there is nothing
                                      to apply or the plan touches the gate, which only the owner applies locally)
  report.py plan-failed <log>         tf-plan: terraform plan failed
  report.py apply <exit code> <log>   tf-apply: the result, as a reply to the plan message

Environment: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, OPS_BUCKET; SHA, SUBJECT, RUN_ID for the plan modes.
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import uuid

MAX_TEXT = 3800
SYMBOLS = {
    ("create",): "+",
    ("delete",): "-",
    ("update",): "~",
    ("delete", "create"): "-/+",
    ("create", "delete"): "+/-",
}


def telegram(method, payload=None, files=None):
    """Bot API call; returns its result (raises on failure: a report that does not arrive fails the build)."""
    url = f"https://api.telegram.org/bot{os.environ['TELEGRAM_BOT_TOKEN']}/{method}"
    if files:
        boundary = uuid.uuid4().hex
        body = b""
        for name, value in (payload or {}).items():
            body += f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        for name, (filename, content) in files.items():
            body += (
                f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
                "Content-Type: text/plain\r\n\r\n"
            ).encode() + content + b"\r\n"
        body += f"--{boundary}--\r\n".encode()
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    else:
        body = json.dumps(payload or {}).encode()
        headers = {"Content-Type": "application/json"}
    request = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())["result"]


def say(text, **extra):
    return telegram(
        "sendMessage",
        {"chat_id": os.environ["TELEGRAM_CHAT_ID"], "text": text[:MAX_TEXT], "disable_web_page_preview": True, **extra},
    )


def s3_put_json(key, value):
    subprocess.run(
        ["aws", "s3", "cp", "--quiet", "-", f"s3://{os.environ['OPS_BUCKET']}/{key}"],
        input=json.dumps(value).encode(),
        check=True,
    )


def s3_get_json(key):
    result = subprocess.run(
        ["aws", "s3", "cp", "--quiet", f"s3://{os.environ['OPS_BUCKET']}/{key}", "-"], capture_output=True
    )
    return json.loads(result.stdout) if result.returncode == 0 else None


def base_address(address):
    """aws_x.name["key"] / aws_x.name[0] → aws_x.name"""
    return re.sub(r"\[[^\]]*\]$", "", address)


def has_unknown(value):
    """after_unknown mirrors the attribute's shape: True marks a value known only after apply."""
    if isinstance(value, dict):
        return any(has_unknown(v) for v in value.values())
    if isinstance(value, list):
        return any(has_unknown(v) for v in value)
    return value is True


def changed_attributes(change):
    before = change.get("before") or {}
    after = change.get("after") or {}
    unknown = change.get("after_unknown") or {}
    names = [
        k
        for k in sorted(set(before) | set(after))
        if (k in after and before.get(k) != after.get(k)) or (has_unknown(unknown.get(k)) and before.get(k) is not None)
    ]
    # Computed attributes that change with any update say nothing
    names = [n for n in names if n not in ("last_modified", "version", "qualified_arn", "qualified_invoke_arn")]
    return names


def summarize(plan):
    """[(symbol, address, detail)] of the resource changes and the gate resources among them."""
    gate = set(((plan.get("planned_values") or {}).get("outputs") or {}).get("dev_worker_gate_addresses", {}).get("value") or [])
    lines, touched = [], []
    for rc in plan.get("resource_changes") or []:
        if rc.get("mode") != "managed":
            continue
        actions = tuple(rc["change"]["actions"])
        if actions in (("no-op",), ("read",)):
            continue
        symbol = SYMBOLS.get(actions, "/".join(actions))
        detail = ""
        if actions == ("update",):
            names = changed_attributes(rc["change"])
            detail = ", ".join(names[:4]) + (" …" if len(names) > 4 else "")
        elif "delete" in actions and "create" in actions:
            paths = [".".join(map(str, p)) for p in rc["change"].get("replace_paths") or []]
            detail = "заміна: " + ", ".join(paths[:3]) if paths else "заміна"
        lines.append((symbol, rc["address"], detail))
        if base_address(rc["address"]) in gate:
            touched.append(rc["address"])
    outputs = [name for name, change in (plan.get("output_changes") or {}).items() if change.get("actions") != ["no-op"]]
    return lines, touched, outputs


def plan_report(plan_path):
    sha, subject, run_id = os.environ["SHA"], os.environ["SUBJECT"], os.environ["RUN_ID"]
    plan = json.load(open(plan_path))
    lines, touched, outputs = summarize(plan)
    head = f"🏗 Terraform plan: main@{sha[:7]}\n«{subject[:120]}»"
    if not lines and not outputs:
        say(f"{head}\n\n✅ Змін немає: AWS відповідає main.")
        return
    counts = {s: sum(1 for line in lines if line[0] == s) for s in ("+", "~", "-", "-/+")}
    body = [f"+{counts['+']} ~{counts['~']} -{counts['-']} -/+{counts['-/+']}", ""]
    for symbol, address, detail in lines:
        body.append(f"{symbol} {address}" + (f" ({detail})" if detail else ""))
    if outputs and not lines:
        body.append("Змінюються тільки outputs: " + ", ".join(outputs))
    text = head + "\n" + "\n".join(body)
    if len(text) > 3000:
        text = text[:3000].rsplit("\n", 1)[0] + "\n… (решта у файлі)"

    plan_text = open("plan.txt", "rb").read()
    telegram(
        "sendDocument",
        {"chat_id": os.environ["TELEGRAM_CHAT_ID"], "caption": f"Повний план main@{sha[:7]}"},
        {"document": (f"plan-{sha[:7]}.txt", plan_text)},
    )
    if touched:
        say(
            text
            + "\n\n🔒 Зачіпає захищені ресурси (ворота воркера): "
            + ", ".join(touched[:8])
            + ". Кнопкою не застосовується: terraform apply з main локально."
        )
        return
    markup = {
        "inline_keyboard": [
            [
                {"text": "✅ Apply", "callback_data": f"gate:{run_id}:ok"},
                {"text": "🚫 Відхилити", "callback_data": f"gate:{run_id}:no"},
            ]
        ]
    }
    message = say(text + "\n\nПовний план — у файлі вище. Кнопка діє годину.", reply_markup=markup)
    # What dev-bot compares the pressed message with: this exact message, unedited, with these buttons
    s3_put_json(
        f"gate/{run_id}.json",
        {
            "kind": "tf",
            "id": run_id,
            "sha": sha,
            "message_id": message["message_id"],
            "text": message.get("text", ""),
            "reply_markup": message.get("reply_markup") or {},
            "created_at": int(time.time()),
            "build_id": os.environ.get("CODEBUILD_BUILD_ID", ""),
        },
    )


def plan_failed(log_path):
    tail = "\n".join(open(log_path, errors="replace").read().strip().splitlines()[-25:])
    say(f"🔴 Terraform plan main@{os.environ['SHA'][:7]} не вдався:\n\n{tail}")


def apply_report(code, log_path):
    run = json.load(open("gate-run.json"))
    record = s3_get_json(f"gate/{run['run_id']}.json") or {}
    log = open(log_path, errors="replace").read().strip().splitlines()
    reply = {"reply_parameters": {"message_id": record["message_id"], "allow_sending_without_reply": True}} if record.get("message_id") else {}
    if code == "0":
        summary = next((line for line in reversed(log) if line.startswith("Apply complete!")), "Apply complete")
        say(f"✅ Apply main@{run['sha'][:7]} застосовано: {summary}", **reply)
    else:
        tail = "\n".join(log[-25:])
        say(f"🔴 Apply main@{run['sha'][:7]} не вдався (exit {code}):\n\n{tail}", **reply)


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "plan":
        plan_report(sys.argv[2])
    elif mode == "plan-failed":
        plan_failed(sys.argv[2])
    elif mode == "apply":
        apply_report(sys.argv[2], sys.argv[3])
    else:
        sys.exit(f"unknown mode {mode}")
