# Dev worker (docs/DEV_WORKER.md): Claude Code (Opus) on an on-demand ECS task, started / stopped and talked to from
# the on-call Telegram chat through the dev-bot Lambda. Own ECS cluster and the public subnet with a public IP: the
# NAT instance exists for the e2e runs, and its lifecycle Lambda starts it whenever the runner cluster has a task.

locals {
  # JSON: github_token (fine-grained, this repository only), telegram_webhook_secret (scripts/dev-worker/setup-telegram.mjs)
  dev_worker_secret_name = "youtube-pip-dev-worker"
  dev_worker_container   = "dev-worker"
}

data "aws_secretsmanager_secret" "dev_worker" {
  name = local.dev_worker_secret_name
}

resource "aws_ecs_cluster" "dev_worker" {
  name = "${local.name_prefix}-dev-worker"
}

resource "aws_ecr_repository" "dev_worker" {
  name                 = "${local.name_prefix}-dev-worker"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "dev_worker" {
  repository = aws_ecr_repository.dev_worker.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 3 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 3
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "dev_worker" {
  name              = "/ecs/${local.name_prefix}-dev-worker"
  retention_in_days = 14
}

# Session transcripts (one object per transcript), working copy snapshot and session id. Everything not written
# for a week expires: a session untouched for a week starts fresh.
resource "aws_s3_bucket" "dev_worker_state" {
  bucket = "${local.name_prefix}-dev-worker-state-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "dev_worker_state" {
  bucket                  = aws_s3_bucket.dev_worker_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "dev_worker_state" {
  bucket = aws_s3_bucket.dev_worker_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "dev_worker_state" {
  bucket = aws_s3_bucket.dev_worker_state.id

  rule {
    id     = "expire-after-a-week"
    status = "Enabled"
    filter {}
    expiration {
      days = var.dev_worker_state_retention_days
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# The owner's messages in order; kept while the worker starts (the worker skips ones sent before its /up).
resource "aws_sqs_queue" "dev_worker_inbox" {
  name                        = "${local.name_prefix}-dev-worker-inbox.fifo"
  fifo_queue                  = true
  content_based_deduplication = false
  message_retention_seconds   = 86400
  visibility_timeout_seconds  = 60
}

resource "aws_iam_role" "dev_worker_execution" {
  name = "${local.name_prefix}-dev-worker-execution-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "dev_worker_execution_default" {
  role       = aws_iam_role.dev_worker_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "dev_worker_execution_secrets" {
  name = "${local.name_prefix}-dev-worker-execution-secrets"
  role = aws_iam_role.dev_worker_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [data.aws_secretsmanager_secret.oncall.arn, data.aws_secretsmanager_secret.dev_worker.arn]
    }]
  })
}

# The worker's own AWS rights: its state bucket, its queue and AWS Transcribe for voice messages, nothing else.
resource "aws_iam_role" "dev_worker_task" {
  name = "${local.name_prefix}-dev-worker-task-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "dev_worker_task" {
  name = "${local.name_prefix}-dev-worker-task-policy"
  role = aws_iam_role.dev_worker_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.dev_worker_state.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.dev_worker_state.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = aws_sqs_queue.dev_worker_inbox.arn
      },
      {
        # Voice / audio messages: speech to text (the media is uploaded to the state bucket, inbox/)
        Effect   = "Allow"
        Action   = ["transcribe:StartTranscriptionJob", "transcribe:GetTranscriptionJob", "transcribe:DeleteTranscriptionJob"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_ecs_task_definition" "dev_worker" {
  family                   = "${local.name_prefix}-dev-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = tostring(var.dev_worker_cpu)
  memory                   = tostring(var.dev_worker_memory)
  execution_role_arn       = aws_iam_role.dev_worker_execution.arn
  task_role_arn            = aws_iam_role.dev_worker_task.arn

  container_definitions = jsonencode([
    {
      name      = local.dev_worker_container
      image     = "${aws_ecr_repository.dev_worker.repository_url}:latest"
      essential = true
      # SIGTERM (/down, StopTask) → the worker saves the session to S3 and reports; Fargate allows at most 120 s
      stopTimeout = 120
      environment = [
        { name = "AWS_REGION", value = var.aws_region },
        { name = "QUEUE_URL", value = aws_sqs_queue.dev_worker_inbox.id },
        { name = "STATE_BUCKET", value = aws_s3_bucket.dev_worker_state.bucket },
        { name = "GITHUB_REPO", value = "${var.github_owner}/${var.github_repo}" },
        { name = "CLAUDE_MODEL", value = "opus" },
        { name = "TRANSCRIBE_LANGUAGE", value = "uk-UA" },
        { name = "IDLE_TIMEOUT_SECONDS", value = tostring(var.dev_worker_idle_timeout_seconds) },
        { name = "MAX_LIFETIME_SECONDS", value = tostring(var.dev_worker_max_lifetime_seconds) },
        { name = "GIT_USER_NAME", value = var.dev_worker_git_user_name },
        { name = "GIT_USER_EMAIL", value = var.dev_worker_git_user_email },
        # The test account session is not in the worker: auth-backed e2e specs are skipped there
        { name = "SKIP_AUTH_E2E_ON_CI", value = "true" }
      ]
      secrets = [
        { name = "CLAUDE_CODE_OAUTH_TOKEN", valueFrom = "${data.aws_secretsmanager_secret.oncall.arn}:claude_code_oauth_token::" },
        { name = "TELEGRAM_BOT_TOKEN", valueFrom = "${data.aws_secretsmanager_secret.oncall.arn}:telegram_bot_token::" },
        { name = "TELEGRAM_CHAT_ID", valueFrom = "${data.aws_secretsmanager_secret.oncall.arn}:telegram_chat_id::" },
        { name = "GITHUB_TOKEN", valueFrom = "${data.aws_secretsmanager_secret.dev_worker.arn}:github_token::" },
        # Voice replies (Google Cloud Text-to-Speech API key, docs/DEV_WORKER.md); the key must exist in the secret
        { name = "GOOGLE_TTS_API_KEY", valueFrom = "${data.aws_secretsmanager_secret.dev_worker.arn}:google_tts_api_key::" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.dev_worker.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "dev-worker"
        }
      }
    }
  ])
}

# ------------------------------------------------------------------------------------------------ dev-bot Lambda

resource "aws_iam_role" "dev_bot" {
  name = "${local.name_prefix}-dev-bot-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "dev_bot_basic" {
  role       = aws_iam_role.dev_bot.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "dev_bot" {
  name = "${local.name_prefix}-dev-bot-policy"
  role = aws_iam_role.dev_bot.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = ["${aws_ecs_task_definition.dev_worker.arn_without_revision}:*"]
      },
      {
        Effect    = "Allow"
        Action    = ["ecs:ListTasks", "ecs:DescribeTasks", "ecs:StopTask"]
        Resource  = "*"
        Condition = { ArnEquals = { "ecs:cluster" = aws_ecs_cluster.dev_worker.arn } }
      },
      {
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = [aws_iam_role.dev_worker_execution.arn, aws_iam_role.dev_worker_task.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.dev_worker_inbox.arn
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [data.aws_secretsmanager_secret.oncall.arn, data.aws_secretsmanager_secret.dev_worker.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.dev_worker_state.arn}/state/meta.json"
      },
      {
        # Start requested while a stopped worker was still saving its session (consumed on its STOPPED event)
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.dev_worker_state.arn}/state/pending-start.json"
      }
    ]
  })
}

data "archive_file" "dev_bot" {
  type        = "zip"
  source_file = "${path.module}/lambda/dev_bot.py"
  output_path = "${path.module}/lambda/dev_bot.zip"
}

resource "aws_lambda_function" "dev_bot" {
  function_name    = "${local.name_prefix}-dev-bot"
  role             = aws_iam_role.dev_bot.arn
  runtime          = "python3.12"
  architectures    = ["x86_64"]
  handler          = "dev_bot.handler"
  filename         = data.archive_file.dev_bot.output_path
  source_code_hash = data.archive_file.dev_bot.output_base64sha256
  timeout          = 30

  environment {
    variables = {
      CLUSTER_ARN         = aws_ecs_cluster.dev_worker.arn
      TASK_DEFINITION_ARN = aws_ecs_task_definition.dev_worker.arn_without_revision
      CONTAINER_NAME      = local.dev_worker_container
      SUBNET_IDS          = aws_subnet.public.id
      SECURITY_GROUP_IDS  = aws_security_group.runner.id
      QUEUE_URL           = aws_sqs_queue.dev_worker_inbox.id
      STATE_BUCKET        = aws_s3_bucket.dev_worker_state.bucket
      ONCALL_SECRET_ARN   = data.aws_secretsmanager_secret.oncall.arn
      DEV_SECRET_ARN      = data.aws_secretsmanager_secret.dev_worker.arn
    }
  }
}

# Telegram webhook target; requests are authenticated by X-Telegram-Bot-Api-Secret-Token and the owner's chat id.
resource "aws_lambda_function_url" "dev_bot" {
  function_name      = aws_lambda_function.dev_bot.function_name
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "dev_bot_function_url_invoke" {
  statement_id           = "AllowPublicInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.dev_bot.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "dev_bot_function_invoke_via_url" {
  statement_id  = "AllowPublicInvokeFunctionForFunctionUrl"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.dev_bot.function_name
  principal     = "*"
}

# Stops of the worker task → dev-bot reports the ones the worker did not report itself (crash, failed start).
resource "aws_cloudwatch_event_rule" "dev_worker_stopped" {
  name        = "${local.name_prefix}-dev-worker-stopped"
  description = "Dev worker ECS task stopped (docs/DEV_WORKER.md)"
  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.dev_worker.arn]
      lastStatus = ["STOPPED"]
    }
  })
}

resource "aws_cloudwatch_event_target" "dev_worker_stopped" {
  rule      = aws_cloudwatch_event_rule.dev_worker_stopped.name
  target_id = "dev-bot-lambda"
  arn       = aws_lambda_function.dev_bot.arn
}

resource "aws_lambda_permission" "dev_bot_events" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.dev_bot.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.dev_worker_stopped.arn
}
