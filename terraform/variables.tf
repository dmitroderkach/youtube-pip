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

variable "oncall_schedule" {
  description = "EventBridge Scheduler expression of the daily on-call run (Manual E2E via workflow_dispatch), in oncall_schedule_timezone."
  type        = string
  default     = "cron(0 18 * * ? *)"
}

variable "claude_code_update_schedule" {
  description = "EventBridge Scheduler expression of the weekly Claude Code update check (claude-code-update.yml), in oncall_schedule_timezone."
  type        = string
  default     = "cron(0 21 ? * MON *)"
}

variable "oncall_schedule_timezone" {
  description = "Time zone of oncall_schedule (follows daylight saving time)."
  type        = string
  default     = "Europe/Warsaw"
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

variable "dev_worker_tts_monthly_budget_usd" {
  description = "Off switch of the dev worker's Gemini speech: 0 = off (Chirp 3 HD only); any other value = on. The limit itself is Google's: the Cloud Billing budget tts-voice-monthly, read by the worker through Pub/Sub (docs/DEV_WORKER.md)."
  type        = number
  default     = 10
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
  description = "Dev worker temporary files (claude/: subagent transcripts, tool results; inbox/: voice uploads) not written for this many days expire; transcripts/, state/, plans/ and memory/ are kept."
  type        = number
  default     = 7
}

variable "dev_worker_state_noncurrent_days" {
  description = "Dev worker state bucket (versioned): days a previous version of an object (overwritten or deleted) is kept, per prefix. Small and precious (memory, plans): a year; transcripts (Claude Code trims them after a compaction): a month; the working copy and temporary files, rewritten after every answer: a day."
  type        = map(number)
  default = {
    memory      = 365
    plans       = 365
    transcripts = 30
    state       = 1
    claude      = 1
    inbox       = 1
  }
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

variable "dev_ops_test_principal_arn" {
  description = "Temporarily lets this principal (e.g. the owner's IAM user) assume the worker's task role, tf-plan and tf-apply to check their rights locally (docs/DEV_WORKER.md). Empty: no one but their services."
  type        = string
  default     = ""
}
