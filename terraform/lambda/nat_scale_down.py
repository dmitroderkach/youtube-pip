import os

import boto3


def handler(_event, _context):
    ecs_cluster_arn = os.environ["ECS_CLUSTER_ARN"]
    nat_instance_id = os.environ["NAT_INSTANCE_ID"]

    ecs = boto3.client("ecs")
    ec2 = boto3.client("ec2")

    running = ecs.list_tasks(cluster=ecs_cluster_arn, desiredStatus="RUNNING").get("taskArns", [])
    pending = ecs.list_tasks(cluster=ecs_cluster_arn, desiredStatus="PENDING").get("taskArns", [])

    if running or pending:
        return {"statusCode": 200, "body": "runner tasks still active"}

    instances = ec2.describe_instances(InstanceIds=[nat_instance_id])
    reservations = instances.get("Reservations", [])
    if not reservations or not reservations[0].get("Instances"):
        return {"statusCode": 404, "body": "nat instance not found"}

    state = reservations[0]["Instances"][0]["State"]["Name"]
    if state in {"stopping", "stopped"}:
        return {"statusCode": 200, "body": f"nat already {state}"}

    ec2.stop_instances(InstanceIds=[nat_instance_id])
    return {"statusCode": 202, "body": "nat stop requested"}
