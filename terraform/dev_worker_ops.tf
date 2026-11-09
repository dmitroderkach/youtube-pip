# Dev worker operations (docs/DEV_WORKER.md, "Infrastructure and images"): Terraform and Docker images for the dev
# worker, which itself only reads AWS. Changes go through the owner's button in Telegram:
#
# - tf-plan (CodeBuild, read-only role): plans main, posts the plan to the owner's chat with ✅ Apply / 🚫 and keeps it
#   (with the Lambda zips it was made with) in the ops bucket. Started by the dev-ops Lambda, which the worker invokes.
# - tf-apply (CodeBuild, apply role): applies exactly that saved plan. Started only by dev-bot when the owner presses ✅
#   under the message tf-plan sent; dev-bot checks the pressed message against the gate record tf-plan wrote.
# - image-build (CodeBuild): builds an image from any branch / commit into the candidates repository, which neither CI
#   nor the worker runs. Started by the dev-ops Lambda.
# - image-publish (CodeBuild): builds an image from a main commit and pushes it as :latest. Started only by dev-bot when
#   the owner presses ✅ under the request the dev-ops Lambda posted.
#
# The worker never holds write credentials: it cannot start tf-apply / image-publish nor write the ops bucket, and
# only main is ever applied. The gate itself (this file, the worker's and dev-bot's roles, the dev-bot Lambda) is out
# of reach of the apply role and of every role it may create (the permissions boundary below): changes to it are
# applied by the owner locally, and tf-plan offers no ✅ for a plan that touches it (output dev_worker_gate_addresses).
#
# Extending what the gated apply may manage: add a statement to aws_iam_policy.project_apply (and the reads a plan of
# it needs to aws_iam_policy.project_read), then apply locally.

locals {
  # Keep in sync with terraform/dev-worker/Dockerfile (TERRAFORM_VERSION)
  dev_ops_terraform_version = "1.15.4"
  dev_ops_repo_url          = "https://github.com/${var.github_owner}/${var.github_repo}.git"
  account_id                = data.aws_caller_identity.current.account_id
  # The account holds other projects too: this one's resources are named youtube-pip-…
  project_glob = "${var.project_name}-*"

  dev_ops_bucket_name   = "${local.name_prefix}-dev-ops-${local.account_id}"
  dev_ops_lambda_name   = "${local.name_prefix}-dev-ops"
  tf_plan_project       = "${local.name_prefix}-tf-plan"
  tf_apply_project      = "${local.name_prefix}-tf-apply"
  image_build_project   = "${local.name_prefix}-image-build"
  image_publish_project = "${local.name_prefix}-image-publish"
  boundary_policy_arn   = "arn:aws:iam::${local.account_id}:policy/${local.name_prefix}-permissions-boundary"

  # Roles of the gate: nothing but the owner changes them, and nothing the apply role creates may be given them
  gate_role_names = [
    "${local.name_prefix}-dev-ops-lambda-role",
    "${local.name_prefix}-tf-plan-role",
    "${local.name_prefix}-tf-apply-role",
    "${local.name_prefix}-image-build-role",
    "${local.name_prefix}-image-publish-role",
    "${local.name_prefix}-dev-bot-role",
  ]
  # Unchangeable too, but passed to the worker's task definition, which a gated apply may change
  gate_passable_role_names = [
    "${local.name_prefix}-dev-worker-task-role",
    "${local.name_prefix}-dev-worker-execution-role",
  ]
  gate_role_arns = [
    for name in concat(local.gate_role_names, local.gate_passable_role_names) : "arn:aws:iam::${local.account_id}:role/${name}"
  ]
  gate_policy_arns = [
    for name in ["permissions-boundary", "project-read", "project-apply"] :
    "arn:aws:iam::${local.account_id}:policy/${local.name_prefix}-${name}"
  ]
  gate_function_arns = flatten([
    for name in [local.dev_ops_lambda_name, "${local.name_prefix}-dev-bot"] : [
      "arn:aws:lambda:${var.aws_region}:${local.account_id}:function:${name}",
      "arn:aws:lambda:${var.aws_region}:${local.account_id}:function:${name}:*",
    ]
  ])
  gate_project_arns = [
    for name in [local.tf_plan_project, local.tf_apply_project, local.image_build_project, local.image_publish_project] :
    "arn:aws:codebuild:${var.aws_region}:${local.account_id}:project/${name}"
  ]

  # Part of the permissions boundary of every role a gated apply may change or create (and of the apply role itself)
  gate_deny_statements = [
    {
      Sid      = "GateRolesUnchanged"
      Effect   = "Deny"
      Action   = ["iam:Attach*", "iam:Detach*", "iam:Put*", "iam:Delete*", "iam:Update*", "iam:Tag*", "iam:Untag*", "iam:CreateRole"]
      Resource = local.gate_role_arns
    },
    {
      Sid      = "GateRolesNotPassed"
      Effect   = "Deny"
      Action   = "iam:PassRole"
      Resource = [for name in local.gate_role_names : "arn:aws:iam::${local.account_id}:role/${name}"]
    },
    {
      Sid      = "GatePoliciesUnchanged"
      Effect   = "Deny"
      Action   = ["iam:CreatePolicy", "iam:CreatePolicyVersion", "iam:DeletePolicy", "iam:DeletePolicyVersion", "iam:SetDefaultPolicyVersion", "iam:TagPolicy", "iam:UntagPolicy"]
      Resource = local.gate_policy_arns
    },
    {
      Sid      = "BoundaryStays"
      Effect   = "Deny"
      Action   = "iam:DeleteRolePermissionsBoundary"
      Resource = "*"
    },
    {
      # A role created or given rights by a bounded role has this boundary too
      Sid       = "RolesOnlyWithBoundary"
      Effect    = "Deny"
      Action    = ["iam:CreateRole", "iam:PutRolePermissionsBoundary", "iam:PutRolePolicy", "iam:AttachRolePolicy", "iam:DeleteRolePolicy", "iam:DetachRolePolicy"]
      Resource  = "*"
      Condition = { StringNotEquals = { "iam:PermissionsBoundary" = local.boundary_policy_arn } }
    },
    {
      Sid    = "NoUsersOrKeys"
      Effect = "Deny"
      Action = [
        "iam:CreateUser", "iam:CreateAccessKey", "iam:UpdateAccessKey", "iam:CreateLoginProfile", "iam:UpdateLoginProfile",
        "iam:PutUserPolicy", "iam:AttachUserPolicy", "iam:AddUserToGroup", "iam:PutGroupPolicy", "iam:AttachGroupPolicy",
        "iam:CreateOpenIDConnectProvider", "iam:UpdateOpenIDConnectProviderThumbprint", "iam:AddClientIDToOpenIDConnectProvider",
        "iam:CreateSAMLProvider", "iam:CreateServiceSpecificCredential", "iam:UploadSSHPublicKey"
      ]
      Resource = "*"
    },
    {
      Sid      = "GateFunctionsUnchanged"
      Effect   = "Deny"
      Action   = ["lambda:Update*", "lambda:Delete*", "lambda:Put*", "lambda:AddPermission", "lambda:RemovePermission", "lambda:CreateFunctionUrlConfig", "lambda:CreateAlias", "lambda:PublishVersion", "lambda:TagResource", "lambda:UntagResource"]
      Resource = local.gate_function_arns
    },
    {
      Sid       = "GateProjectsUnchanged"
      Effect    = "Deny"
      NotAction = ["codebuild:BatchGet*", "codebuild:List*", "codebuild:Describe*"]
      Resource  = local.gate_project_arns
    },
    {
      Sid       = "OpsBucketReadOnly"
      Effect    = "Deny"
      NotAction = ["s3:Get*", "s3:List*"]
      Resource  = ["arn:aws:s3:::${local.dev_ops_bucket_name}", "arn:aws:s3:::${local.dev_ops_bucket_name}/*"]
    },
    {
      # The webhook secret would let anyone fake the owner's ✅; the GitHub token is the worker's
      Sid       = "WorkerSecretUnread"
      Effect    = "Deny"
      NotAction = ["secretsmanager:DescribeSecret", "secretsmanager:ListSecretVersionIds", "secretsmanager:GetResourcePolicy"]
      Resource  = data.aws_secretsmanager_secret.dev_worker.arn
    },
    {
      Sid      = "NoMessagesAsTheOwner"
      Effect   = "Deny"
      Action   = "sqs:SendMessage"
      Resource = aws_sqs_queue.dev_worker_inbox.arn
    },
  ]

  # Resources a gated apply never touches (IAM denies it): tf-plan offers no ✅ for a plan that changes one of them
  gate_addresses = [
    "aws_iam_policy.project_boundary",
    "aws_iam_policy.project_read",
    "aws_iam_policy.project_apply",
    "aws_s3_bucket.dev_ops",
    "aws_s3_bucket_public_access_block.dev_ops",
    "aws_s3_bucket_server_side_encryption_configuration.dev_ops",
    "aws_s3_bucket_lifecycle_configuration.dev_ops",
    "aws_cloudwatch_log_group.dev_ops",
    "aws_iam_role.dev_ops_lambda",
    "aws_iam_role_policy_attachment.dev_ops_lambda_basic",
    "aws_iam_role_policy.dev_ops_lambda",
    "aws_lambda_function.dev_ops",
    "aws_iam_role.tf_plan",
    "aws_iam_role_policy_attachment.tf_plan_read",
    "aws_iam_role_policy.tf_plan",
    "aws_codebuild_project.tf_plan",
    "aws_iam_role.tf_apply",
    "aws_iam_role_policy_attachment.tf_apply_read",
    "aws_iam_role_policy_attachment.tf_apply_apply",
    "aws_iam_role_policy.tf_apply",
    "aws_codebuild_project.tf_apply",
    "aws_iam_role.image_build",
    "aws_iam_role_policy.image_build",
    "aws_codebuild_project.image_build",
    "aws_iam_role.image_publish",
    "aws_iam_role_policy.image_publish",
    "aws_codebuild_project.image_publish",
    "aws_iam_role.dev_worker_task",
    "aws_iam_role_policy.dev_worker_task",
    "aws_iam_role_policy_attachment.dev_worker_task_read",
    "aws_iam_role.dev_worker_execution",
    "aws_iam_role_policy.dev_worker_execution_secrets",
    "aws_iam_role_policy_attachment.dev_worker_execution_default",
    "aws_iam_role.dev_bot",
    "aws_iam_role_policy.dev_bot",
    "aws_iam_role_policy_attachment.dev_bot_basic",
    "aws_lambda_function.dev_bot",
    "aws_lambda_function_url.dev_bot",
    "aws_lambda_permission.dev_bot_function_url_invoke",
    "aws_lambda_permission.dev_bot_function_invoke_via_url",
    "aws_lambda_permission.dev_bot_events",
    "aws_lambda_permission.dev_bot_idle_watch",
  ]

  codebuild_trust = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [{
        Effect    = "Allow"
        Principal = { Service = "codebuild.amazonaws.com" }
        Action    = "sts:AssumeRole"
        Condition = { StringEquals = { "aws:SourceAccount" = local.account_id } }
      }],
      local.dev_ops_test_trust
    )
  })
  # Local check of a role (var.dev_ops_test_principal_arn): the owner assumes it and runs terraform plan / apply
  dev_ops_test_trust = var.dev_ops_test_principal_arn == "" ? [] : [{
    Effect    = "Allow"
    Principal = { AWS = var.dev_ops_test_principal_arn }
    Action    = "sts:AssumeRole"
  }]

  install_terraform = [
    "curl -fsSLo /tmp/terraform.zip https://releases.hashicorp.com/terraform/${local.dev_ops_terraform_version}/terraform_${local.dev_ops_terraform_version}_linux_amd64.zip",
    "curl -fsSL https://releases.hashicorp.com/terraform/${local.dev_ops_terraform_version}/terraform_${local.dev_ops_terraform_version}_SHA256SUMS | grep ' terraform_${local.dev_ops_terraform_version}_linux_amd64.zip$' | awk '{print $1\"  /tmp/terraform.zip\"}' | sha256sum -c -",
    "unzip -oq /tmp/terraform.zip terraform -d /usr/local/bin",
  ]
  telegram_secrets = {
    TELEGRAM_BOT_TOKEN = "${data.aws_secretsmanager_secret.oncall.arn}:telegram_bot_token"
    TELEGRAM_CHAT_ID   = "${data.aws_secretsmanager_secret.oncall.arn}:telegram_chat_id"
  }
}

output "dev_worker_gate_addresses" {
  description = "Resources of the dev worker's gate (dev_worker_ops.tf): applied by the owner locally, never through tf-apply."
  value       = local.gate_addresses
}

output "dev_worker_permissions_boundary" {
  description = "Boundary every role changed by tf-apply must carry: tf-plan offers no Apply for a plan with a role without it."
  value       = local.boundary_policy_arn
}

# ------------------------------------------------------------------------------------------------ policies

# Every role a gated apply may change or create carries this boundary: anything but the gate.
resource "aws_iam_policy" "project_boundary" {
  name        = "${local.name_prefix}-permissions-boundary"
  description = "Boundary of the project's roles: everything except changing the dev worker's gate (dev_worker_ops.tf)."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [{ Sid = "Everything", Effect = "Allow", Action = "*", Resource = "*" }],
      local.gate_deny_statements
    )
  })
}

# What a terraform plan of this stack reads, limited to this project's resources (the account holds other projects):
# the worker, tf-plan and tf-apply. No secret values except the budget alert e-mail, which the plan reads (and which
# the state and the budget itself hold anyway).
resource "aws_iam_policy" "project_read" {
  name        = "${local.name_prefix}-project-read"
  description = "Reads of a terraform plan of the youtube-pip stack (dev worker, tf-plan, tf-apply)."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Metadata only (no data of other projects: no Lambda configurations, objects, items or log events)
        Sid    = "Describe"
        Effect = "Allow"
        Action = [
          "ec2:Describe*", "ecs:Describe*", "ecs:List*",
          "ecr:Describe*", "ecr:List*", "ecr:GetLifecyclePolicy", "ecr:GetRepositoryPolicy", "ecr:GetAuthorizationToken",
          "lambda:ListLayers", "lambda:ListLayerVersions", "lambda:ListEventSourceMappings", "lambda:GetAccountSettings",
          "iam:Get*", "iam:List*",
          "sqs:ListQueues", "sqs:GetQueueAttributes", "sqs:GetQueueUrl", "sqs:ListQueueTags",
          "events:Describe*", "events:List*", "scheduler:List*",
          "logs:Describe*", "logs:ListTagsForResource", "logs:ListTagsLogGroup",
          "secretsmanager:ListSecrets",
          "budgets:ViewBudget", "budgets:ListTagsForResource",
          "servicecatalog:Get*", "servicecatalog:List*", "resource-groups:Get*", "resource-groups:List*", "tag:Get*",
          "codebuild:BatchGet*", "codebuild:List*",
          "cloudwatch:Describe*", "cloudwatch:Get*", "cloudwatch:List*",
          "s3:ListAllMyBuckets",
        ]
        Resource = "*"
      },
      {
        Sid    = "ProjectLambdas"
        Effect = "Allow"
        Action = ["lambda:Get*", "lambda:List*"]
        Resource = [
          "arn:aws:lambda:${var.aws_region}:${local.account_id}:function:${local.project_glob}",
          "arn:aws:lambda:${var.aws_region}:${local.account_id}:layer:${local.project_glob}",
          "arn:aws:lambda:${var.aws_region}:${local.account_id}:event-source-mapping:*",
        ]
      },
      {
        Sid      = "ProjectSchedules"
        Effect   = "Allow"
        Action   = ["scheduler:Get*"]
        Resource = ["arn:aws:scheduler:${var.aws_region}:${local.account_id}:schedule/*/${local.project_glob}", "arn:aws:scheduler:${var.aws_region}:${local.account_id}:schedule-group/*"]
      },
      {
        Sid      = "ProjectBuckets"
        Effect   = "Allow"
        Action   = ["s3:Get*", "s3:List*"]
        Resource = ["arn:aws:s3:::${local.project_glob}", "arn:aws:s3:::${local.project_glob}/*"]
      },
      {
        # Logs of the project's Lambdas, ECS tasks and CodeBuild builds (debugging, dev-ops status)
        Sid      = "ProjectLogs"
        Effect   = "Allow"
        Action   = ["logs:GetLogEvents", "logs:FilterLogEvents", "logs:StartLiveTail"]
        Resource = [for group in ["/aws/lambda/", "/ecs/", "/aws/codebuild/"] : "arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:${group}${local.project_glob}"]
      },
      {
        Sid      = "ProjectSecretsMetadata"
        Effect   = "Allow"
        Action   = ["secretsmanager:DescribeSecret", "secretsmanager:GetResourcePolicy", "secretsmanager:ListSecretVersionIds"]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${local.account_id}:secret:${local.project_glob}"
      },
      {
        Sid      = "BudgetAlertEmail"
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = data.aws_secretsmanager_secret.project_budget_alert_email.arn
      },
      {
        # terraform plan locks the state
        Sid      = "StateLock"
        Effect   = "Allow"
        Action   = ["dynamodb:DescribeTable", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${local.account_id}:table/${var.project_name}-terraform-locks"
      },
      {
        Sid      = "ProjectImages"
        Effect   = "Allow"
        Action   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
        Resource = "arn:aws:ecr:${var.aws_region}:${local.account_id}:repository/${local.project_glob}"
      },
      {
        # User data of other projects' instances and launch templates can hold their secrets
        Sid       = "OtherInstancesUserData"
        Effect    = "Deny"
        Action    = ["ec2:DescribeInstanceAttribute", "ec2:DescribeLaunchTemplateVersions"]
        Resource  = "*"
        Condition = { StringNotEquals = { "aws:ResourceTag/Project" = var.project_name } }
      },
    ]
  })
}

# Changes a gated apply may make: this project's resources (by name, or by the Project tag for EC2). With
# project_read and under the permissions boundary (attached to tf-apply).
resource "aws_iam_policy" "project_apply" {
  name        = "${local.name_prefix}-project-apply"
  description = "Changes of a gated terraform apply of the youtube-pip stack (tf-apply)."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ProjectLambdas"
        Effect = "Allow"
        Action = "lambda:*"
        Resource = [
          "arn:aws:lambda:${var.aws_region}:${local.account_id}:function:${local.project_glob}",
          "arn:aws:lambda:${var.aws_region}:${local.account_id}:layer:${local.project_glob}",
        ]
      },
      {
        Sid       = "ProjectEventSourceMappings"
        Effect    = "Allow"
        Action    = ["lambda:CreateEventSourceMapping", "lambda:UpdateEventSourceMapping", "lambda:DeleteEventSourceMapping", "lambda:GetEventSourceMapping"]
        Resource  = "*"
        Condition = { ArnLikeIfExists = { "lambda:FunctionArn" = "arn:aws:lambda:${var.aws_region}:${local.account_id}:function:${local.project_glob}" } }
      },
      {
        Sid      = "ProjectBuckets"
        Effect   = "Allow"
        Action   = "s3:*"
        Resource = ["arn:aws:s3:::${local.project_glob}", "arn:aws:s3:::${local.project_glob}/*"]
      },
      {
        Sid      = "ProjectQueues"
        Effect   = "Allow"
        Action   = "sqs:*"
        Resource = "arn:aws:sqs:${var.aws_region}:${local.account_id}:${local.project_glob}"
      },
      {
        Sid      = "ProjectRepositories"
        Effect   = "Allow"
        Action   = "ecr:*"
        Resource = "arn:aws:ecr:${var.aws_region}:${local.account_id}:repository/${local.project_glob}"
      },
      {
        Sid    = "ProjectEcs"
        Effect = "Allow"
        Action = "ecs:*"
        Resource = [
          "arn:aws:ecs:${var.aws_region}:${local.account_id}:cluster/${local.project_glob}",
          "arn:aws:ecs:${var.aws_region}:${local.account_id}:task-definition/${local.project_glob}",
          "arn:aws:ecs:${var.aws_region}:${local.account_id}:service/${local.project_glob}",
          "arn:aws:ecs:${var.aws_region}:${local.account_id}:capacity-provider/*",
        ]
      },
      {
        # ECS actions without resource-level permissions
        Sid      = "EcsTaskDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:RegisterTaskDefinition", "ecs:DeregisterTaskDefinition", "ecs:CreateCluster", "ecs:TagResource"]
        Resource = "*"
      },
      {
        Sid      = "ProjectLogGroups"
        Effect   = "Allow"
        Action   = "logs:*"
        Resource = [for group in ["/aws/lambda/", "/ecs/", "/aws/codebuild/"] : "arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:${group}${local.project_glob}"]
      },
      {
        Sid      = "ProjectRules"
        Effect   = "Allow"
        Action   = "events:*"
        Resource = "arn:aws:events:${var.aws_region}:${local.account_id}:rule/${local.project_glob}"
      },
      {
        Sid      = "ProjectSchedules"
        Effect   = "Allow"
        Action   = "scheduler:*"
        Resource = ["arn:aws:scheduler:${var.aws_region}:${local.account_id}:schedule/*/${local.project_glob}", "arn:aws:scheduler:${var.aws_region}:${local.account_id}:schedule-group/default"]
      },
      {
        Sid      = "ProjectBudgets"
        Effect   = "Allow"
        Action   = "budgets:*"
        Resource = "arn:aws:budgets::${local.account_id}:budget/${local.project_glob}"
      },
      {
        # AppRegistry application (by id) and its association by the Project tag (null_resource with the aws CLI)
        Sid      = "AppRegistry"
        Effect   = "Allow"
        Action   = ["servicecatalog:*"]
        Resource = "*"
      },
      {
        Sid       = "ProjectEc2"
        Effect    = "Allow"
        Action    = "ec2:*"
        Resource  = "*"
        Condition = { StringEquals = { "aws:ResourceTag/Project" = var.project_name } }
      },
      {
        # New EC2 resources carry the Project tag (provider default_tags)
        Sid       = "NewProjectEc2"
        Effect    = "Allow"
        Action    = ["ec2:Create*", "ec2:RunInstances", "ec2:AllocateAddress"]
        Resource  = "*"
        Condition = { StringEquals = { "aws:RequestTag/Project" = var.project_name } }
      },
      {
        Sid       = "TagsOnCreate"
        Effect    = "Allow"
        Action    = "ec2:CreateTags"
        Resource  = "*"
        Condition = { Null = { "ec2:CreateAction" = "false" } }
      },
      {
        # Rights of a role only with the permissions boundary (so no role it creates or changes can reach the gate)
        Sid       = "ProjectRoleRights"
        Effect    = "Allow"
        Action    = ["iam:CreateRole", "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:PutRolePermissionsBoundary"]
        Resource  = "arn:aws:iam::${local.account_id}:role/${local.project_glob}"
        Condition = { StringEquals = { "iam:PermissionsBoundary" = local.boundary_policy_arn } }
      },
      {
        Sid      = "ProjectRoles"
        Effect   = "Allow"
        Action   = ["iam:DeleteRole", "iam:UpdateRole", "iam:UpdateRoleDescription", "iam:UpdateAssumeRolePolicy", "iam:TagRole", "iam:UntagRole", "iam:PassRole"]
        Resource = "arn:aws:iam::${local.account_id}:role/${local.project_glob}"
      },
      {
        Sid      = "ProjectPolicies"
        Effect   = "Allow"
        Action   = ["iam:CreatePolicy", "iam:CreatePolicyVersion", "iam:DeletePolicy", "iam:DeletePolicyVersion", "iam:SetDefaultPolicyVersion", "iam:TagPolicy", "iam:UntagPolicy"]
        Resource = "arn:aws:iam::${local.account_id}:policy/${local.project_glob}"
      },
      {
        Sid       = "ServiceLinkedRoles"
        Effect    = "Allow"
        Action    = "iam:CreateServiceLinkedRole"
        Resource  = "*"
        Condition = { StringEquals = { "iam:AWSServiceName" = ["ecs.amazonaws.com", "appregistry.servicecatalog.amazonaws.com"] } }
      },
    ]
  })
}

# ------------------------------------------------------------------------------------------------ ops bucket

# tf-runs/<run>/: the saved plan with the files it was made with (bundle.tgz) and its text; gate/<id>.json: what the
# owner is asked to approve (written by tf-plan / dev-ops), gate/<id>.decision.json: the answer (dev-bot, once).
resource "aws_s3_bucket" "dev_ops" {
  bucket = local.dev_ops_bucket_name
}

resource "aws_s3_bucket_public_access_block" "dev_ops" {
  bucket                  = aws_s3_bucket.dev_ops.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "dev_ops" {
  bucket = aws_s3_bucket.dev_ops.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "dev_ops" {
  bucket = aws_s3_bucket.dev_ops.id
  rule {
    id     = "expire-after-two-weeks"
    status = "Enabled"
    filter {}
    expiration {
      days = 14
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# Images built from branches (image-build): checked, never run by CI or the worker
resource "aws_ecr_repository" "image_candidates" {
  name                 = "${local.name_prefix}-image-candidates"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "aws_ecr_lifecycle_policy" "image_candidates" {
  repository = aws_ecr_repository.image_candidates.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire a week after the push"
      selection = {
        tagStatus   = "any"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 7
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "dev_ops" {
  for_each          = toset([local.tf_plan_project, local.tf_apply_project, local.image_build_project, local.image_publish_project])
  name              = "/aws/codebuild/${each.value}"
  retention_in_days = 30
}

# ------------------------------------------------------------------------------------------------ dev-ops Lambda

resource "aws_iam_role" "dev_ops_lambda" {
  name = "${local.name_prefix}-dev-ops-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "dev_ops_lambda_basic" {
  role       = aws_iam_role.dev_ops_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "dev_ops_lambda" {
  name = "${local.name_prefix}-dev-ops-lambda-policy"
  role = aws_iam_role.dev_ops_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "codebuild:StartBuild"
        Resource = [aws_codebuild_project.tf_plan.arn, aws_codebuild_project.image_build.arn]
      },
      {
        # Publish requests (the message the owner answers)
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.dev_ops.arn}/gate/*"
      },
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = data.aws_secretsmanager_secret.oncall.arn
      }
    ]
  })
}

data "archive_file" "dev_ops" {
  type             = "zip"
  source_file      = "${path.module}/lambda/dev_ops.py"
  output_path      = "${path.module}/lambda/dev_ops.zip"
  output_file_mode = "0666"
}

resource "aws_lambda_function" "dev_ops" {
  function_name    = local.dev_ops_lambda_name
  role             = aws_iam_role.dev_ops_lambda.arn
  runtime          = "python3.12"
  architectures    = ["x86_64"]
  handler          = "dev_ops.handler"
  filename         = data.archive_file.dev_ops.output_path
  source_code_hash = data.archive_file.dev_ops.output_base64sha256
  timeout          = 30

  environment {
    variables = {
      TF_PLAN_PROJECT     = aws_codebuild_project.tf_plan.name
      IMAGE_BUILD_PROJECT = aws_codebuild_project.image_build.name
      OPS_BUCKET          = aws_s3_bucket.dev_ops.bucket
      ONCALL_SECRET_ARN   = data.aws_secretsmanager_secret.oncall.arn
      GITHUB_REPO         = "${var.github_owner}/${var.github_repo}"
      CANDIDATES_REPO_URL = aws_ecr_repository.image_candidates.repository_url
    }
  }
}

# ------------------------------------------------------------------------------------------------ tf-plan

resource "aws_iam_role" "tf_plan" {
  name               = "${local.name_prefix}-tf-plan-role"
  assume_role_policy = local.codebuild_trust
}

resource "aws_iam_role_policy_attachment" "tf_plan_read" {
  role       = aws_iam_role.tf_plan.name
  policy_arn = aws_iam_policy.project_read.arn
}

resource "aws_iam_role_policy" "tf_plan" {
  name = "${local.name_prefix}-tf-plan-policy"
  role = aws_iam_role.tf_plan.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.dev_ops[local.tf_plan_project].arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = ["${aws_s3_bucket.dev_ops.arn}/tf-runs/*", "${aws_s3_bucket.dev_ops.arn}/gate/*"]
      },
      {
        # The plan goes to the owner's chat
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = data.aws_secretsmanager_secret.oncall.arn
      }
    ]
  })
}

resource "aws_codebuild_project" "tf_plan" {
  name                   = local.tf_plan_project
  description            = "Dev worker: terraform plan of main, sent to the owner with an Apply button (dev_worker_ops.tf)."
  service_role           = aws_iam_role.tf_plan.arn
  build_timeout          = 20
  concurrent_build_limit = 1

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    type         = "LINUX_CONTAINER"
    compute_type = "BUILD_GENERAL1_SMALL"
    image        = "aws/codebuild/amazonlinux-x86_64-standard:5.0"

    environment_variable {
      name  = "OPS_BUCKET"
      value = aws_s3_bucket.dev_ops.bucket
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.dev_ops[local.tf_plan_project].name
    }
  }

  source {
    type = "NO_SOURCE"
    # Always main: the plan the owner approves is of merged code only
    buildspec = yamlencode({
      version = "0.2"
      env     = { shell = "bash", "secrets-manager" = local.telegram_secrets }
      phases = {
        install = {
          "runtime-versions" = { python = "3.12" }
          commands           = local.install_terraform
        }
        build = {
          commands = [
            "git clone --quiet --depth 1 --branch main ${local.dev_ops_repo_url} /tmp/repo",
            "bash /tmp/repo/terraform/gate/plan.sh",
          ]
        }
      }
    })
  }
}

# ------------------------------------------------------------------------------------------------ tf-apply

resource "aws_iam_role" "tf_apply" {
  name                 = "${local.name_prefix}-tf-apply-role"
  assume_role_policy   = local.codebuild_trust
  permissions_boundary = aws_iam_policy.project_boundary.arn
}

resource "aws_iam_role_policy_attachment" "tf_apply_read" {
  role       = aws_iam_role.tf_apply.name
  policy_arn = aws_iam_policy.project_read.arn
}

resource "aws_iam_role_policy_attachment" "tf_apply_apply" {
  role       = aws_iam_role.tf_apply.name
  policy_arn = aws_iam_policy.project_apply.arn
}

resource "aws_iam_role_policy" "tf_apply" {
  name = "${local.name_prefix}-tf-apply-policy"
  role = aws_iam_role.tf_apply.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.dev_ops[local.tf_apply_project].arn}:*"
      },
      {
        # The result goes to the owner's chat
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = data.aws_secretsmanager_secret.oncall.arn
      }
    ]
  })
}

resource "aws_codebuild_project" "tf_apply" {
  name                   = local.tf_apply_project
  description            = "Dev worker: applies a plan of tf-plan the owner approved (started by dev-bot only, dev_worker_ops.tf)."
  service_role           = aws_iam_role.tf_apply.arn
  build_timeout          = 60
  concurrent_build_limit = 1

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    type         = "LINUX_CONTAINER"
    compute_type = "BUILD_GENERAL1_SMALL"
    image        = "aws/codebuild/amazonlinux-x86_64-standard:5.0"

    environment_variable {
      name  = "OPS_BUCKET"
      value = aws_s3_bucket.dev_ops.bucket
    }
    # Set by dev-bot: the approved run of tf-plan
    environment_variable {
      name  = "RUN_ID"
      value = ""
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.dev_ops[local.tf_apply_project].name
    }
  }

  source {
    type = "NO_SOURCE"
    buildspec = yamlencode({
      version = "0.2"
      env     = { shell = "bash", "secrets-manager" = local.telegram_secrets }
      phases = {
        install = { commands = local.install_terraform }
        build = {
          commands = [
            "[[ \"$RUN_ID\" =~ ^[0-9a-f-]{36}$ ]]",
            "mkdir -p /tmp/repo/terraform",
            "aws s3 cp --quiet \"s3://$OPS_BUCKET/tf-runs/$RUN_ID/bundle.tgz\" /tmp/bundle.tgz",
            "tar xzf /tmp/bundle.tgz -C /tmp/repo/terraform",
            "bash /tmp/repo/terraform/gate/apply.sh",
          ]
        }
      }
    })
  }
}

# ------------------------------------------------------------------------------------------------ images

resource "aws_iam_role" "image_build" {
  name               = "${local.name_prefix}-image-build-role"
  assume_role_policy = local.codebuild_trust
}

resource "aws_iam_role_policy" "image_build" {
  name = "${local.name_prefix}-image-build-policy"
  role = aws_iam_role.image_build.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.dev_ops[local.image_build_project].arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        # The candidates repository only
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload",
          "ecr:PutImage", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:DescribeImages"
        ]
        Resource = aws_ecr_repository.image_candidates.arn
      }
    ]
  })
}

resource "aws_codebuild_project" "image_build" {
  name          = local.image_build_project
  description   = "Dev worker: builds an image from a branch / commit into the candidates repository (dev_worker_ops.tf)."
  service_role  = aws_iam_role.image_build.arn
  build_timeout = 60

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    type            = "LINUX_CONTAINER"
    compute_type    = "BUILD_GENERAL1_MEDIUM"
    image           = "aws/codebuild/amazonlinux-x86_64-standard:5.0"
    privileged_mode = true

    environment_variable {
      name  = "ECR_REPO"
      value = aws_ecr_repository.image_candidates.name
    }
    # Set by the dev-ops Lambda
    environment_variable {
      name  = "IMAGE"
      value = ""
    }
    environment_variable {
      name  = "REF"
      value = "main"
    }
    environment_variable {
      name  = "TAG"
      value = ""
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.dev_ops[local.image_build_project].name
    }
  }

  source {
    type = "NO_SOURCE"
    buildspec = yamlencode({
      version = "0.2"
      env     = { shell = "bash" }
      phases = {
        build = {
          commands = [
            "[[ \"$IMAGE\" == runner || \"$IMAGE\" == dev-worker ]] && [[ \"$REF\" =~ ^[A-Za-z0-9._/][A-Za-z0-9._/-]*$ ]] && [[ \"$TAG\" =~ ^[A-Za-z0-9._-]+$ ]]",
            "git clone --quiet ${local.dev_ops_repo_url} /tmp/repo",
            "cd /tmp/repo && (git checkout --quiet --detach \"origin/$REF\" 2>/dev/null || git checkout --quiet --detach \"$REF\") && git log -1 --format='%H %s'",
            "cd /tmp/repo && bash \"scripts/build-$IMAGE-image.sh\" \"$IMAGE-$TAG\"",
          ]
        }
      }
    })
  }
}

resource "aws_iam_role" "image_publish" {
  name               = "${local.name_prefix}-image-publish-role"
  assume_role_policy = local.codebuild_trust
}

resource "aws_iam_role_policy" "image_publish" {
  name = "${local.name_prefix}-image-publish-policy"
  role = aws_iam_role.image_publish.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.dev_ops[local.image_publish_project].arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload",
          "ecr:PutImage", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:DescribeImages"
        ]
        Resource = [aws_ecr_repository.runner.arn, aws_ecr_repository.dev_worker.arn]
      },
      {
        # The result goes to the owner's chat
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = data.aws_secretsmanager_secret.oncall.arn
      }
    ]
  })
}

resource "aws_codebuild_project" "image_publish" {
  name          = local.image_publish_project
  description   = "Dev worker: builds an image from a main commit and pushes it as :latest (started by dev-bot only, dev_worker_ops.tf)."
  service_role  = aws_iam_role.image_publish.arn
  build_timeout = 60

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    type            = "LINUX_CONTAINER"
    compute_type    = "BUILD_GENERAL1_MEDIUM"
    image           = "aws/codebuild/amazonlinux-x86_64-standard:5.0"
    privileged_mode = true

    environment_variable {
      name  = "RUNNER_REPO"
      value = aws_ecr_repository.runner.name
    }
    environment_variable {
      name  = "DEV_WORKER_REPO"
      value = aws_ecr_repository.dev_worker.name
    }
    # Set by dev-bot: what the owner approved
    environment_variable {
      name  = "IMAGE"
      value = ""
    }
    environment_variable {
      name  = "REF"
      value = ""
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.dev_ops[local.image_publish_project].name
    }
  }

  source {
    type = "NO_SOURCE"
    buildspec = yamlencode({
      version = "0.2"
      env     = { shell = "bash", "secrets-manager" = local.telegram_secrets }
      phases = {
        build = {
          commands = [
            "[[ \"$IMAGE\" == runner || \"$IMAGE\" == dev-worker ]] && [[ \"$REF\" =~ ^[0-9a-f]{40}$ ]]",
            "git clone --quiet ${local.dev_ops_repo_url} /tmp/repo",
            # Only a commit of main is ever published
            "cd /tmp/repo && git merge-base --is-ancestor \"$REF\" origin/main && git checkout --quiet --detach \"$REF\"",
            "cd /tmp/repo && if [ \"$IMAGE\" = runner ]; then export ECR_REPO=$RUNNER_REPO; else export ECR_REPO=$DEV_WORKER_REPO; fi && bash \"scripts/build-$IMAGE-image.sh\" latest",
          ]
        }
        post_build = {
          commands = [
            "if [ \"$CODEBUILD_BUILD_SUCCEEDING\" = 1 ]; then TEXT=\"✅ Образ $IMAGE:latest опубліковано з main@$${REF:0:7}\"; else TEXT=\"🔴 Публікація $IMAGE:latest з main@$${REF:0:7} не вдалася, лог: $CODEBUILD_BUILD_ID\"; fi; curl -fsS -o /dev/null \"https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage\" --data-urlencode \"chat_id=$TELEGRAM_CHAT_ID\" --data-urlencode \"text=$TEXT\" || true",
          ]
        }
      }
    })
  }
}
