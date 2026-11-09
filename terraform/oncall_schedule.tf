# Daily on-call: EventBridge Scheduler starts the Manual E2E workflow (and with it the on-call job) through
# workflow_dispatch. GitHub's own `schedule` trigger started it hours late and stopped for good once GitHub disabled
# the schedule of this public repository after 60 days without activity (docs/ONCALL.md).

resource "aws_lambda_function" "oncall_schedule" {
  function_name    = "${local.name_prefix}-oncall-schedule"
  role             = aws_iam_role.oncall_schedule_lambda.arn
  runtime          = "python3.12"
  architectures    = ["x86_64"]
  handler          = "worker.schedule_handler"
  filename         = data.archive_file.lambda_worker.output_path
  source_code_hash = data.archive_file.lambda_worker.output_base64sha256
  timeout          = 30
  layers           = [aws_lambda_layer_version.lambda_deps.arn]

  environment {
    variables = {
      GITHUB_OWNER                      = var.github_owner
      GITHUB_REPO                       = var.github_repo
      GITHUB_APP_ID                     = var.github_app_id
      GITHUB_APP_INSTALLATION_ID        = var.github_app_installation_id
      GITHUB_APP_PRIVATE_KEY_SECRET_ARN = data.aws_secretsmanager_secret.github_app_private_key.arn
      SCHEDULED_WORKFLOW                = "e2e-manual.yml"
      SCHEDULED_REF                     = var.oncall_branch
    }
  }
}

resource "aws_iam_role" "oncall_schedule_lambda" {
  name = "${local.name_prefix}-oncall-schedule-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "oncall_schedule_lambda" {
  name = "${local.name_prefix}-oncall-schedule-lambda-policy"
  role = aws_iam_role.oncall_schedule_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "*"
      },
      {
        # The GitHub App key: an installation token with Actions: write starts the workflow
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = data.aws_secretsmanager_secret.github_app_private_key.arn
      }
    ]
  })
}

resource "aws_iam_role" "oncall_scheduler" {
  name = "${local.name_prefix}-oncall-scheduler-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

resource "aws_iam_role_policy" "oncall_scheduler" {
  name = "${local.name_prefix}-oncall-scheduler-policy"
  role = aws_iam_role.oncall_scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.oncall_schedule.arn
    }]
  })
}

resource "aws_scheduler_schedule" "oncall" {
  name = "${local.name_prefix}-oncall-daily"

  schedule_expression          = var.oncall_schedule
  schedule_expression_timezone = var.oncall_schedule_timezone

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.oncall_schedule.arn
    role_arn = aws_iam_role.oncall_scheduler.arn

    retry_policy {
      maximum_retry_attempts       = 3
      maximum_event_age_in_seconds = 3600
    }
  }
}
