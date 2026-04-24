terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  backend "s3" {
    bucket         = "youtube-pip-tf-state-387568562943"
    key            = "github-runner-fargate/terraform.tfstate"
    region         = "eu-central-1"
    dynamodb_table = "youtube-pip-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name_prefix           = "${var.project_name}-${var.environment}"
  resolved_runner_image = var.runner_image != "" ? var.runner_image : "${aws_ecr_repository.runner.repository_url}:${var.runner_image_tag}"
  github_app_private_key_secret_name = "youtube-pip-github-app-private-key"
  github_webhook_secret_name         = "youtube-pip-github-webhook-secret"
}

data "aws_secretsmanager_secret" "github_app_private_key" {
  name = local.github_app_private_key_secret_name
}

data "aws_secretsmanager_secret" "github_webhook_secret" {
  name = local.github_webhook_secret_name
}

resource "aws_vpc" "runner" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${local.name_prefix}-vpc"
  }
}

resource "aws_internet_gateway" "runner" {
  vpc_id = aws_vpc.runner.id

  tags = {
    Name = "${local.name_prefix}-igw"
  }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.runner.id
  cidr_block              = var.public_subnet_cidr
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true

  tags = {
    Name = "${local.name_prefix}-public-subnet"
  }
}

resource "aws_subnet" "private" {
  vpc_id            = aws_vpc.runner.id
  cidr_block        = var.private_subnet_cidr
  availability_zone = data.aws_availability_zones.available.names[0]

  tags = {
    Name = "${local.name_prefix}-private-subnet"
  }
}

resource "aws_security_group" "nat_instance" {
  name        = "${local.name_prefix}-nat-sg"
  description = "Security group for NAT instance"
  vpc_id      = aws_vpc.runner.id

  ingress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.private_subnet_cidr]
  }

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
}

data "aws_ami" "nat" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-kernel-6.1-arm64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_instance" "nat" {
  ami                         = data.aws_ami.nat.id
  instance_type               = var.nat_instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.nat_instance.id]
  associate_public_ip_address = true
  source_dest_check           = false

  user_data = <<-EOF
              #!/bin/bash
              set -eux
              sysctl -w net.ipv4.ip_forward=1
              echo "net.ipv4.ip_forward = 1" >> /etc/sysctl.conf
              dnf install -y iptables-services
              iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
              service iptables save
              systemctl enable --now iptables
              EOF

  tags = {
    Name = "${local.name_prefix}-nat-instance"
  }
}

resource "aws_eip" "nat" {
  domain   = "vpc"
  instance = aws_instance.nat.id

  tags = {
    Name = "${local.name_prefix}-nat-eip"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.runner.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.runner.id
  }

  tags = {
    Name = "${local.name_prefix}-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.runner.id

  tags = {
    Name = "${local.name_prefix}-private-rt"
  }
}

resource "aws_route" "private_default_via_nat_instance" {
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  network_interface_id   = aws_instance.nat.primary_network_interface_id
}

resource "aws_route_table_association" "private" {
  subnet_id      = aws_subnet.private.id
  route_table_id = aws_route_table.private.id
}

resource "aws_cloudwatch_log_group" "runner" {
  name              = "/ecs/${local.name_prefix}-runner"
  retention_in_days = 14
}

resource "aws_security_group" "runner" {
  name        = "${local.name_prefix}-runner-sg"
  description = "Egress-only security group for ephemeral GitHub runner tasks"
  vpc_id      = aws_vpc.runner.id

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
}

resource "aws_ecr_repository" "runner" {
  name                 = "${local.name_prefix}-runner"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecs_cluster" "runner" {
  name = "${local.name_prefix}-cluster"
}

resource "aws_iam_role" "task_execution" {
  name = "${local.name_prefix}-task-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution_default" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "task_role" {
  name = "${local.name_prefix}-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_ecs_task_definition" "runner" {
  family                   = "${local.name_prefix}-runner"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = tostring(var.runner_cpu)
  memory                   = tostring(var.runner_memory)
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task_role.arn

  container_definitions = jsonencode([
    {
      name      = "github-runner"
      image     = local.resolved_runner_image
      essential = true
      environment = [
        { name = "RUNNER_SCOPE", value = "repo" },
        { name = "EPHEMERAL", value = "1" },
        { name = "DISABLE_AUTO_UPDATE", value = "1" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.runner.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "runner"
        }
      }
    }
  ])
}

resource "aws_iam_role" "lambda" {
  name = "${local.name_prefix}-dispatcher-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "lambda" {
  name = "${local.name_prefix}-dispatcher-lambda-policy"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecs:RunTask",
          "ecs:DescribeTasks",
          "ecs:ListTasks"
        ]
        Resource = [
          aws_ecs_task_definition.runner.arn,
          "${aws_ecs_task_definition.runner.arn_without_revision}:*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances",
          "ec2:StartInstances",
          "ec2:StopInstances"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          aws_iam_role.task_execution.arn,
          aws_iam_role.task_role.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          data.aws_secretsmanager_secret.github_app_private_key.arn,
          data.aws_secretsmanager_secret.github_webhook_secret.arn
        ]
      }
    ]
  })
}

data "archive_file" "lambda" {
  type        = "zip"
  source_file = "${path.module}/lambda/handler.py"
  output_path = "${path.module}/lambda/handler.zip"
}

# Layer zip must have `python/` at the archive root (AWS Lambda Python layer layout).
data "archive_file" "lambda_deps_layer" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/layer"
  output_path = "${path.module}/lambda/deps-layer.zip"
}

resource "aws_lambda_layer_version" "lambda_deps" {
  layer_name               = "${local.name_prefix}-lambda-deps"
  filename                 = data.archive_file.lambda_deps_layer.output_path
  source_code_hash         = data.archive_file.lambda_deps_layer.output_base64sha256
  compatible_runtimes      = ["python3.12"]
  compatible_architectures = ["x86_64"]
}

resource "aws_lambda_function" "dispatcher" {
  function_name    = "${local.name_prefix}-github-runner-dispatcher"
  role             = aws_iam_role.lambda.arn
  runtime          = "python3.12"
  architectures    = ["x86_64"]
  handler          = "handler.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 30
  layers           = [aws_lambda_layer_version.lambda_deps.arn]

  environment {
    variables = {
      ECS_CLUSTER_ARN            = aws_ecs_cluster.runner.arn
      TASK_DEFINITION_ARN        = aws_ecs_task_definition.runner.arn
      SUBNET_IDS                 = aws_subnet.private.id
      SECURITY_GROUP_IDS         = aws_security_group.runner.id
      GITHUB_OWNER               = var.github_owner
      GITHUB_REPO                = var.github_repo
      GITHUB_APP_ID              = var.github_app_id
      GITHUB_APP_INSTALLATION_ID = var.github_app_installation_id
      GITHUB_APP_PRIVATE_KEY_SECRET_ARN = data.aws_secretsmanager_secret.github_app_private_key.arn
      GITHUB_WEBHOOK_SECRET_ARN         = data.aws_secretsmanager_secret.github_webhook_secret.arn
      RUNNER_LABELS              = join(",", var.runner_labels)
      ASSIGN_PUBLIC_IP           = "DISABLED"
      NAT_INSTANCE_ID            = aws_instance.nat.id
    }
  }
}

resource "aws_lambda_function_url" "dispatcher" {
  function_name      = aws_lambda_function.dispatcher.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = ["https://github.com"]
    allow_methods = ["POST"]
    allow_headers = ["*"]
  }
}

# Function URL with AUTH_TYPE_NONE still needs a resource policy so GitHub can invoke it.
resource "aws_lambda_permission" "dispatcher_function_url_invoke" {
  statement_id           = "AllowPublicInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.dispatcher.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

# Since Oct 2025, AWS requires BOTH InvokeFunctionUrl and InvokeFunction on the function
# resource policy for public Function URLs (see Lambda docs / urls-auth).
resource "aws_lambda_permission" "dispatcher_function_invoke_via_url" {
  statement_id  = "AllowPublicInvokeFunctionForFunctionUrl"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.dispatcher.function_name
  principal     = "*"
}

data "archive_file" "nat_scale_down_lambda" {
  type        = "zip"
  source_file = "${path.module}/lambda/nat_scale_down.py"
  output_path = "${path.module}/lambda/nat_scale_down.zip"
}

resource "aws_lambda_function" "nat_scale_down" {
  function_name    = "${local.name_prefix}-nat-scale-down"
  role             = aws_iam_role.lambda.arn
  runtime          = "python3.12"
  architectures    = ["x86_64"]
  handler          = "nat_scale_down.handler"
  filename         = data.archive_file.nat_scale_down_lambda.output_path
  source_code_hash = data.archive_file.nat_scale_down_lambda.output_base64sha256
  timeout          = 30

  environment {
    variables = {
      ECS_CLUSTER_ARN = aws_ecs_cluster.runner.arn
      NAT_INSTANCE_ID = aws_instance.nat.id
    }
  }
}

resource "aws_cloudwatch_event_rule" "ecs_task_stopped" {
  name        = "${local.name_prefix}-ecs-task-stopped"
  description = "Trigger NAT scale down when runner task stops"

  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.runner.arn]
      lastStatus = ["STOPPED"]
    }
  })
}

resource "aws_cloudwatch_event_target" "nat_scale_down_lambda" {
  rule      = aws_cloudwatch_event_rule.ecs_task_stopped.name
  target_id = "nat-scale-down-lambda"
  arn       = aws_lambda_function.nat_scale_down.arn
}

resource "aws_lambda_permission" "allow_events_invoke_nat_scale_down" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.nat_scale_down.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.ecs_task_stopped.arn
}
