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

# Session transcripts (transcripts/), working copy snapshot, session id and settings, background task records (state/),
# plans of plan mode (plans/), Claude Code's memory (memory/): kept for good. Subagent transcripts and tool results
# (claude/) and voice uploads (inbox/) are temporary and expire a week after they were written.
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

# Versioning: a deleted or overwritten object (a memory file, a plan, a transcript trimmed by Claude Code) can be
# restored from its previous version for a while; how long per prefix: var.dev_worker_state_noncurrent_days.
resource "aws_s3_bucket_versioning" "dev_worker_state" {
  bucket = aws_s3_bucket.dev_worker_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "dev_worker_state" {
  bucket = aws_s3_bucket.dev_worker_state.id
  # Rules on noncurrent versions need versioning on first
  depends_on = [aws_s3_bucket_versioning.dev_worker_state]

  # One rule per prefix (S3 lifecycle filters cannot exclude a prefix): previous versions expire after the prefix's
  # days; the temporary prefixes (claude/, inbox/) also expire themselves a week after they were written.
  dynamic "rule" {
    for_each = var.dev_worker_state_noncurrent_days
    content {
      id     = "${rule.key}-versions"
      status = "Enabled"
      filter {
        prefix = "${rule.key}/"
      }
      dynamic "expiration" {
        for_each = contains(["claude", "inbox"], rule.key) ? [var.dev_worker_state_retention_days] : []
        content {
          days = expiration.value
        }
      }
      noncurrent_version_expiration {
        noncurrent_days = rule.value
      }
    }
  }

  # Delete markers left alone once their object's previous versions have expired
  rule {
    id     = "expired-delete-markers"
    status = "Enabled"
    filter {}
    expiration {
      expired_object_delete_marker = true
    }
  }

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
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

# The worker's own AWS rights: its state bucket, its queue, AWS Transcribe for voice messages, reads of this project's
# resources (terraform plan, logs; aws_iam_policy.project_read) and the dev-ops Lambda (dev_worker_ops.tf). No changes
# to the infrastructure and no secret values (but the budget alert e-mail a plan reads): those go through the owner.
resource "aws_iam_role" "dev_worker_task" {
  name = "${local.name_prefix}-dev-worker-task-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }], local.dev_ops_test_trust)
  })
}

resource "aws_iam_role_policy_attachment" "dev_worker_task_read" {
  role       = aws_iam_role.dev_worker_task.name
  policy_arn = aws_iam_policy.project_read.arn
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
      },
      {
        # Plans of main, image builds and publish requests (dev-ops CLI)
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = aws_lambda_function.dev_ops.arn
      },
      {
        # Whatever else gets attached: no secret values
        Effect      = "Deny"
        Action      = ["secretsmanager:GetSecretValue", "secretsmanager:BatchGetSecretValue"]
        NotResource = data.aws_secretsmanager_secret.project_budget_alert_email.arn
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
        { name = "TTS_MONTHLY_BUDGET_USD", value = tostring(var.dev_worker_tts_monthly_budget_usd) },
        { name = "GIT_USER_NAME", value = var.dev_worker_git_user_name },
        { name = "GIT_USER_EMAIL", value = var.dev_worker_git_user_email },
        # The test account session is not in the worker: auth-backed e2e specs are skipped there
        { name = "SKIP_AUTH_E2E_ON_CI", value = "true" },
        # dev-ops CLI (scripts/dev-worker/dev-ops.sh, dev_worker_ops.tf)
        { name = "DEV_OPS_FUNCTION", value = aws_lambda_function.dev_ops.function_name },
        { name = "OPS_BUCKET", value = aws_s3_bucket.dev_ops.bucket },
        { name = "DEV_OPS_PROJECTS", value = join(",", [aws_codebuild_project.tf_plan.name, aws_codebuild_project.tf_apply.name, aws_codebuild_project.image_build.name, aws_codebuild_project.image_publish.name, local.telegram_setup_project]) }
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
        # Idle watchdog: the worker's activity, and the last answer already warned about
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.dev_worker_state.arn}/state/activity.json"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "${aws_s3_bucket.dev_worker_state.arn}/state/idle-alert.json"
      },
      {
        # Start requested while a stopped worker was still saving its session (consumed on its STOPPED event)
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.dev_worker_state.arn}/state/pending-start.json"
      },
      {
        # Scheduled tasks of the owner (written by the worker): due ones are read, sent and removed
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.dev_worker_state.arn}/state/scheduled/*"
      },
      {
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = aws_s3_bucket.dev_worker_state.arn
        Condition = { StringLike = { "s3:prefix" = ["state/scheduled/*"] } }
      },
      {
        # Gate (dev_worker_ops.tf): what the owner is asked to approve, and the answer, written once
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.dev_ops.arn}/gate/*"
      },
      {
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.dev_ops.arn}/gate/*.decision.json"
      },
      {
        # Only on the owner's ✅
        Effect   = "Allow"
        Action   = "codebuild:StartBuild"
        Resource = [aws_codebuild_project.tf_apply.arn, aws_codebuild_project.image_publish.arn, aws_codebuild_project.telegram_setup.arn]
      }
    ]
  })
}

data "archive_file" "dev_bot" {
  type        = "zip"
  source_file = "${path.module}/lambda/dev_bot.py"
  output_path = "${path.module}/lambda/dev_bot.zip"
  # Same zip (and hash) on every machine: a plan in CodeBuild matches one made locally
  output_file_mode = "0666"
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
      CLUSTER_ARN            = aws_ecs_cluster.dev_worker.arn
      TASK_DEFINITION_ARN    = aws_ecs_task_definition.dev_worker.arn_without_revision
      CONTAINER_NAME         = local.dev_worker_container
      SUBNET_IDS             = aws_subnet.public.id
      SECURITY_GROUP_IDS     = aws_security_group.runner.id
      QUEUE_URL              = aws_sqs_queue.dev_worker_inbox.id
      STATE_BUCKET           = aws_s3_bucket.dev_worker_state.bucket
      ONCALL_SECRET_ARN      = data.aws_secretsmanager_secret.oncall.arn
      DEV_SECRET_ARN         = data.aws_secretsmanager_secret.dev_worker.arn
      IDLE_ALERT_MINUTES     = tostring(var.dev_worker_idle_alert_minutes)
      OPS_BUCKET             = aws_s3_bucket.dev_ops.bucket
      TF_APPLY_PROJECT       = aws_codebuild_project.tf_apply.name
      IMAGE_PUBLISH_PROJECT  = aws_codebuild_project.image_publish.name
      TELEGRAM_SETUP_PROJECT = local.telegram_setup_project
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

# Idle watchdog (docs/DEV_WORKER.md): every few minutes the dev-bot checks whether the worker is still up long after
# its last answer with no turn running, and warns in the chat once per answer.
resource "aws_cloudwatch_event_rule" "dev_worker_idle_watch" {
  name                = "${local.name_prefix}-dev-worker-idle-watch"
  description         = "Dev worker scheduled tasks (due ones go to the worker) and idle watchdog (docs/DEV_WORKER.md)"
  schedule_expression = "rate(1 minute)"
}

resource "aws_cloudwatch_event_target" "dev_worker_idle_watch" {
  rule      = aws_cloudwatch_event_rule.dev_worker_idle_watch.name
  target_id = "dev-bot-lambda"
  arn       = aws_lambda_function.dev_bot.arn
}

resource "aws_lambda_permission" "dev_bot_idle_watch" {
  statement_id  = "AllowExecutionFromIdleWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.dev_bot.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.dev_worker_idle_watch.arn
}
