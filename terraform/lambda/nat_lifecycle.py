import os

import boto3


def _ensure_nat_running(ec2, nat_instance_id: str) -> None:
    """Start NAT if needed; if instance is stopping, wait until stopped first (same as former worker path)."""
    response = ec2.describe_instances(InstanceIds=[nat_instance_id])
    reservations = response.get("Reservations") or []
    if not reservations or not reservations[0].get("Instances"):
        raise RuntimeError(f"NAT instance not found: {nat_instance_id}")
    state = reservations[0]["Instances"][0]["State"]["Name"]
    if state == "stopping":
        ec2.get_waiter("instance_stopped").wait(InstanceIds=[nat_instance_id])
        state = "stopped"
    if state == "stopped":
        ec2.start_instances(InstanceIds=[nat_instance_id])
        ec2.get_waiter("instance_running").wait(InstanceIds=[nat_instance_id])
    elif state == "pending":
        ec2.get_waiter("instance_running").wait(InstanceIds=[nat_instance_id])


def _ensure_nat_stopped(ec2, nat_instance_id: str) -> str:
    instances = ec2.describe_instances(InstanceIds=[nat_instance_id])
    reservations = instances.get("Reservations", [])
    if not reservations or not reservations[0].get("Instances"):
        return "nat instance not found"
    state = reservations[0]["Instances"][0]["State"]["Name"]
    if state in {"stopping", "stopped"}:
        return f"nat already {state}"
    ec2.stop_instances(InstanceIds=[nat_instance_id])
    return "nat stop requested"


def handler(event, _context):
    """Reconcile NAT with runner ECS workload; invoked from EventBridge on selected ECS task transitions."""
    nat_instance_id = os.environ.get("NAT_INSTANCE_ID")
    if not nat_instance_id:
        return {"statusCode": 200, "body": "nat disabled"}

    ecs = boto3.client("ecs")
    ec2 = boto3.client("ec2")
    cluster_arn = os.environ["ECS_CLUSTER_ARN"]

    running = ecs.list_tasks(cluster=cluster_arn, desiredStatus="RUNNING").get("taskArns", [])
    pending = ecs.list_tasks(cluster=cluster_arn, desiredStatus="PENDING").get("taskArns", [])

    if running or pending:
        _ensure_nat_running(ec2, nat_instance_id)
        detail = (event or {}).get("detail") or {}
        last = detail.get("lastStatus", "")
        return {"statusCode": 200, "body": f"nat running (tasks present); event lastStatus={last}"}

    msg = _ensure_nat_stopped(ec2, nat_instance_id)
    detail = (event or {}).get("detail") or {}
    last = detail.get("lastStatus", "")
    return {"statusCode": 200, "body": f"{msg}; event lastStatus={last}"}
