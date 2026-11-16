# Fast lane of the dev chat (docs/DEV_WORKER.md, "Fast lane"): a Lambda that answers the owner in seconds while the
# worker sleeps or is busy, with read-only in-process tools (chat log, progress, memory, plans, GitHub reads) and a
# hand-over to the worker for real work. The same image as the worker (scripts/dev-worker/fast-lane.mjs as the entry
# point, its own Lambda Runtime API loop). dev-bot puts the owner's messages into its FIFO queue and wakes it with
# {"wake": true}; one invocation at a time (reserved concurrency 1) reads the queue until about a minute of silence.
#
# Secrets: the on-call secret (Claude token, Telegram bot), read into the handler's memory at start, never into
# environment variables; Claude Code gets only the token proxy's placeholder (scripts/dev-worker/anthropic-proxy.mjs).

locals {
  fast_lane_function = "${local.name_prefix}-fast-lane"
}

# The owner's messages for the fast lane, in order (MessageGroupId "owner", the same body as the worker's queue)
resource "aws_sqs_queue" "fast_lane_inbox" {
  name                        = "${local.name_prefix}-fast-lane-inbox.fifo"
  fifo_queue                  = true
  content_based_deduplication = false
  message_retention_seconds   = 3600
  visibility_timeout_seconds  = 60
}

# The image's single manifest (scripts/build-dev-worker-image.sh tags it `<tag>-lambda`: :latest is an image index
# with a SOCI index, which Lambda does not take). By digest, so a plan after `dev-ops publish dev-worker` moves the
# fast lane to the new image.
data "aws_ecr_image" "fast_lane" {
  repository_name = aws_ecr_repository.dev_worker.name
  image_tag       = "latest-lambda"
}

resource "aws_cloudwatch_log_group" "fast_lane" {
  name              = "/aws/lambda/${local.fast_lane_function}"
  retention_in_days = 14
}

resource "aws_lambda_function" "fast_lane" {
  function_name = local.fast_lane_function
  role          = aws_iam_role.fast_lane.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.dev_worker.repository_url}@${data.aws_ecr_image.fast_lane.image_digest}"
  architectures = ["x86_64"]
  timeout       = 900
  # CPU scales with memory (the handler uses ~440 MB): Claude Code's start is CPU-bound and took 2-101 s at 2048 MB.
  # 3008 MB (about 1.75 vCPU) is this account's limit: 4096 failed with "Member must have value less than or equal to
  # 3008" (raising it is a Service Quotas request)
  memory_size = 3008
  # One conversation, one session: never two invocations at once (a second wake waits as a throttled async event)
  reserved_concurrent_executions = 1

  image_config {
    entry_point       = ["node", "/opt/dev-worker/fast-lane.mjs"]
    working_directory = "/opt/dev-worker"
  }

  ephemeral_storage {
    size = 2048
  }

  environment {
    variables = {
      STATE_BUCKET      = aws_s3_bucket.dev_worker_state.bucket
      QUEUE_URL         = aws_sqs_queue.fast_lane_inbox.id
      DEV_BOT_FUNCTION  = aws_lambda_function.dev_bot.function_name
      ONCALL_SECRET_ARN = data.aws_secretsmanager_secret.oncall.arn
      GITHUB_REPO       = "${var.github_owner}/${var.github_repo}"
      # Claude Code's debug log in CloudWatch: on while the slow session start (28-101 s) is diagnosed
      FAST_LANE_CLAUDE_DEBUG = "1"
    }
  }

  depends_on = [aws_cloudwatch_log_group.fast_lane, aws_ecr_repository_policy.dev_worker_lambda]
}

# A wake that finds the function busy is not retried for long: the running invocation reads the queue anyway
resource "aws_lambda_function_event_invoke_config" "fast_lane" {
  function_name                = aws_lambda_function.fast_lane.function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 300
}

# Lambda pulls the image from the worker's repository: only for this project's functions
resource "aws_ecr_repository_policy" "dev_worker_lambda" {
  repository = aws_ecr_repository.dev_worker.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "LambdaPull"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
      Condition = {
        StringLike = {
          "aws:sourceArn" = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${local.name_prefix}-*"
        }
      }
    }]
  })
}

resource "aws_iam_role" "fast_lane" {
  name = "${local.name_prefix}-fast-lane-role"
  # Changeable by a gated apply of the dev worker (dev_worker_ops.tf), which needs the boundary on every role it changes
  permissions_boundary = aws_iam_policy.project_boundary.arn

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Reads of the shared state (chat log, progress, memory, plans, settings), its own session (fast-lane/), the chat log
# appends, the owner's scheduled tasks; its queue and dev-bot (hand-over: dev-bot writes the worker's queue and starts it; the boundary keeps that queue
# dev-bot's alone).
# No Transcribe (outside the project's boundary): voice messages are handed over to the worker.
resource "aws_iam_role_policy" "fast_lane" {
  name = "${local.name_prefix}-fast-lane-policy"
  role = aws_iam_role.fast_lane.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.fast_lane.arn}:*"
      },
      {
        Effect = "Allow"
        Action = "s3:GetObject"
        Resource = [for key in [
          "state/chat-log.jsonl", "state/progress.json", "state/meta.json", "state/settings.json",
          "state/status.json", "state/voice-transcripts.json", "state/voice-usage.json", "state/scheduled/*",
          "state/background/*", "memory/*", "plans/*", "fast-lane/*",
        ] : "${aws_s3_bucket.dev_worker_state.arn}/${key}"]
      },
      {
        Effect = "Allow"
        Action = "s3:PutObject"
        # settings.json: both lanes' settings (settings.mjs); status.json: the pinned status of both lanes; memory/ and
        # plans/: the worker's memory and plans, written by the fast lane only while the worker sleeps (memory_write,
        # plan_write)
        Resource = [for key in [
          "state/chat-log.jsonl", "state/voice-transcripts.json", "state/voice-usage.json", "state/scheduled/*",
          "state/settings.json", "state/status.json", "fast-lane/*", "memory/*", "plans/*",
        ] : "${aws_s3_bucket.dev_worker_state.arn}/${key}"]
      },
      {
        Effect = "Allow"
        Action = "s3:DeleteObject"
        # busy.json: the busy marker dev-bot routes by (fast-lane-core.mjs BUSY_KEY), cleared after each answer
        Resource = [
          "${aws_s3_bucket.dev_worker_state.arn}/state/scheduled/*",
          "${aws_s3_bucket.dev_worker_state.arn}/fast-lane/busy.json",
        ]
      },
      {
        # Voice messages: AWS Transcribe when Gemini fails (voice.mjs transcribeAws): the audio in inbox/ for the job,
        # deleted after it
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.dev_worker_state.arn}/inbox/*"
      },
      {
        # Only jobs with the project's prefix (voice.mjs names them youtube-pip-voice-<time>); the permissions boundary
        # allows the same ARNs (dev_worker_ops.tf, a gate change applied first)
        Effect   = "Allow"
        Action   = ["transcribe:StartTranscriptionJob", "transcribe:GetTranscriptionJob", "transcribe:DeleteTranscriptionJob"]
        Resource = "arn:aws:transcribe:${var.aws_region}:${data.aws_caller_identity.current.account_id}:transcription-job/${local.project_glob}"
      },
      {
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.dev_worker_state.arn
        # Listing (scheduled tasks, memory, plans) and a 404 rather than a 403 for a missing object of these prefixes
        Condition = { StringLike = { "s3:prefix" = ["state/*", "memory/*", "plans/*", "fast-lane/*"] } }
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = aws_sqs_queue.fast_lane_inbox.arn
      },
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = data.aws_secretsmanager_secret.oncall.arn
      },
      {
        # Hand-over: the task in fast-lane/handover/<uuid>.json, then {"action": "hand_over", "key": …} (same account:
        # this policy is enough)
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = aws_lambda_function.dev_bot.arn
      },
    ]
  })
}
