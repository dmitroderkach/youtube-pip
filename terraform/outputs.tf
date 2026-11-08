output "lambda_function_url" {
  description = "GitHub webhook target URL (workflow_job)."
  value       = aws_lambda_function_url.dispatcher.function_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name for ephemeral runners."
  value       = aws_ecs_cluster.runner.name
}

output "ecs_task_definition" {
  description = "Runner task definition ARN."
  value       = aws_ecs_task_definition.runner.arn
}

output "runner_ecr_repository_url" {
  description = "ECR repository URL for custom runner image builds."
  value       = aws_ecr_repository.runner.repository_url
}

output "runner_nat_eip" {
  description = "Static outbound Elastic IP used by Fargate tasks via NAT EC2 instance."
  value       = aws_eip.nat.public_ip
}

output "dev_bot_webhook_url" {
  description = "Telegram webhook URL of the dev worker bot (scripts/dev-worker/setup-telegram.mjs)."
  value       = aws_lambda_function_url.dev_bot.function_url
}

output "dev_worker_ecr_repository_url" {
  description = "ECR repository of the dev worker image (scripts/build-dev-worker-image.sh)."
  value       = aws_ecr_repository.dev_worker.repository_url
}
