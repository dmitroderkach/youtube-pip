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
  description = "Fargate task CPU units."
  type        = number
  default     = 2048
}

variable "runner_memory" {
  description = "Fargate task memory in MB."
  type        = number
  default     = 4096
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
