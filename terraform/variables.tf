variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "eu-central-1"
}

variable "project_name" {
  description = "Project prefix for resources."
  type        = string
  default     = "youtube-pip"
}

variable "environment" {
  description = "Environment suffix for resources."
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  description = "CIDR block for dedicated runner VPC."
  type        = string
  default     = "10.90.0.0/16"
}

variable "public_subnet_cidr" {
  description = "Public subnet CIDR for NAT Gateway."
  type        = string
  default     = "10.90.1.0/24"
}

variable "private_subnet_cidr" {
  description = "Private subnet CIDR where Fargate runner tasks execute."
  type        = string
  default     = "10.90.2.0/24"
}

variable "nat_instance_type" {
  description = "EC2 instance type for on-demand NAT instance."
  type        = string
  default     = "t4g.nano"
}

variable "runner_image" {
  description = "Optional full runner image reference. Leave empty to use the stack ECR repository + runner_image_tag."
  type        = string
  default     = ""
}

variable "runner_image_tag" {
  description = "Tag for the runner image in the stack ECR repository (used when runner_image is empty)."
  type        = string
  default     = "latest"
}

variable "runner_cpu" {
  description = "Fargate task CPU units. 8192 (8 vCPU) runs 8 Playwright workers; 8 vCPU needs at least 16 GB memory."
  type        = number
  default     = 8192
}

variable "runner_memory" {
  description = "Fargate task memory in MB (~1 GB per Playwright worker plus the runner)."
  type        = number
  default     = 16384
}

variable "oncall_branch" {
  description = "Only scheduled / manual runs of this branch get the on-call runner (Telegram / Claude secrets). Point it at a feature branch only while testing the on-call job."
  type        = string
  default     = "main"
}

variable "oncall_runner_cpu" {
  description = "Fargate CPU units of the on-call task (reads CI results, scans flags, runs Claude Code headless)."
  type        = number
  default     = 1024
}

variable "oncall_runner_memory" {
  description = "Fargate memory in MB of the on-call task."
  type        = number
  default     = 2048
}

variable "runner_use_fargate_spot" {
  description = "Start runner tasks on FARGATE_SPOT and fall back to on-demand FARGATE when Spot capacity is unavailable."
  type        = bool
  default     = true
}

variable "runner_idle_timeout_seconds" {
  description = "Idle timeout (seconds) for runner self-termination when no job is picked up. Set 0 to disable."
  type        = number
  default     = 600
}

variable "github_owner" {
  description = "GitHub repository owner."
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name."
  type        = string
}

variable "github_app_id" {
  description = "GitHub App ID used to mint installation access tokens."
  type        = string
}

variable "github_app_installation_id" {
  description = "GitHub App installation ID for the target repository/organization."
  type        = string
}

variable "runner_labels" {
  description = "Labels Lambda expects in workflow_job to trigger Fargate runner."
  type        = list(string)
  default     = ["self-hosted", "fargate"]
}

variable "project_monthly_budget_usd" {
  description = "Monthly budget threshold (USD) for this project tag in AWS Budgets."
  type        = number
  default     = 10
}

variable "project_budget_alert_threshold_percent" {
  description = "Budget alert threshold percent (for ACTUAL spend)."
  type        = number
  default     = 80
}

variable "dev_worker_cpu" {
  description = "Fargate CPU units of the dev worker task (docs/DEV_WORKER.md)."
  type        = number
  default     = 2048
}

variable "dev_worker_memory" {
  description = "Fargate memory in MB of the dev worker task."
  type        = number
  default     = 4096
}

variable "dev_worker_idle_alert_minutes" {
  description = "The dev-bot warns in the chat when the worker is still up this long after its last answer with no turn running. Keep it above the idle stop (dev_worker_idle_timeout_seconds)."
  type        = number
  default     = 15
}

variable "dev_worker_idle_timeout_seconds" {
  description = "The dev worker stops after this long without a message or work in progress."
  type        = number
  default     = 600
}

variable "dev_worker_state_retention_days" {
  description = "Dev worker state (session transcripts, working copy; not the saved plans and memory) not written for this many days expires."
  type        = number
  default     = 7
}

variable "dev_worker_git_user_name" {
  description = "Git author name of the dev worker's commits."
  type        = string
  default     = "Dmytro Derkach"
}

variable "dev_worker_git_user_email" {
  description = "Git author email of the dev worker's commits (GitHub no-reply address)."
  type        = string
  default     = "14731091+dmitroderkach@users.noreply.github.com"
}
