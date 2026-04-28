aws_region          = "eu-central-1"
project_name        = "youtube-pip"
environment         = "prod"
vpc_cidr            = "10.90.0.0/16"
public_subnet_cidr  = "10.90.1.0/24"
private_subnet_cidr = "10.90.2.0/24"

# GitHub repository where runners will register.
github_owner = "dmitroderkach"
github_repo  = "youtube-pip"

# GitHub App credentials for runner registration.
# Fill these before terraform apply.
github_app_id              = "3493443"
github_app_installation_id = "126821920"

# Runner dispatch labels expected in workflow_job payload.
runner_labels = ["self-hosted", "fargate"]

# Optional runner task tuning (defaults shown here).
# Leave runner_image empty to use this stack's ECR repository.
runner_image     = ""
runner_image_tag = "latest"
runner_cpu       = 2048
runner_memory    = 4096
runner_idle_timeout_seconds = 60
