# Terraform: Lambda + ECS Fargate GitHub Runner

This folder provisions an on-demand GitHub Actions runner solution:

- Lambda webhook receiver for `workflow_job` events
- ECS Fargate ephemeral runner tasks
- ECR repository for runner images
- IAM roles/policies
- Optional Terraform backend bootstrap (`bootstrap/`) for S3 + DynamoDB state

## 1) Bootstrap remote state (one-time)

```bash
cd terraform/bootstrap
terraform init
terraform apply -var="state_bucket_name=<globally-unique-bucket>"
```

Use outputs in `terraform/main.tf` backend block:

- `bucket` = `state_bucket_name`
- `dynamodb_table` = `lock_table_name`
- `region` = your region

## 2) Configure main stack

Create `terraform.tfvars` in `terraform/`:

```hcl
aws_region             = "eu-central-1"
project_name           = "youtube-pip"
environment            = "prod"
vpc_cidr               = "10.90.0.0/16"
public_subnet_cidr     = "10.90.1.0/24"
private_subnet_cidr    = "10.90.2.0/24"
github_owner           = "YOUR_ORG_OR_USER"
github_repo            = "youtube-pip"
github_app_id              = "1234567"
github_app_installation_id = "12345678"
runner_labels          = ["self-hosted", "fargate"]
runner_image           = ""
runner_image_tag       = "latest"
```

Create these two secrets manually in AWS Secrets Manager before `terraform apply`
(Terraform reads them via `data.aws_secretsmanager_secret` by static names):

- `youtube-pip-github-app-private-key` -> `SecretString` = full PEM private key content.
- `youtube-pip-github-webhook-secret` -> `SecretString` = GitHub webhook secret.

Then deploy:

```bash
cd terraform
rm -rf lambda/layer/python/*
mkdir -p lambda/layer/python
# Install Linux x86_64 wheels (matches Fargate/Lambda); do not use macOS `pip -t lambda/python`.
docker run --rm --platform linux/amd64 \
  -v "$(pwd)/lambda/requirements.txt:/req.txt:ro" \
  -v "$(pwd)/lambda/layer/python:/out" \
  python:3.12-slim-bookworm \
  bash -c "pip install --no-cache-dir -r /req.txt -t /out"
terraform init
terraform apply
```

## 3) Build and push runner image to ECR

From repo root:

```bash
# Get account and region
AWS_REGION=eu-central-1
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# ECR repo name follows: <project_name>-<environment>-runner
ECR_REPO="youtube-pip-prod-runner"
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"

aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

docker build -t "${ECR_URI}:latest" -f terraform/runner/Dockerfile terraform/runner
docker push "${ECR_URI}:latest"
```

If you use custom tag, set `runner_image_tag` accordingly in `terraform.tfvars`.

## 4) GitHub webhook setup

Use output `lambda_function_url` as webhook URL in repo settings.

- Content type: `application/json`
- Secret: value stored in Secrets Manager secret `youtube-pip-github-webhook-secret`
- Event: `workflow_job`

## 5) GitHub workflow label usage

To dispatch Fargate runner, job labels must contain all labels from `runner_labels`.

Example:

```yaml
runs-on: [self-hosted, fargate]
```

## Notes

- Stack creates a dedicated VPC with public/private subnets and NAT EC2 instance (with EIP).
- Fargate tasks run in private subnet with `assignPublicIp=DISABLED`.
- Dispatcher Lambda starts NAT instance before `RunTask`.
- Event-driven `nat_scale_down` Lambda is triggered by ECS `Task STOPPED` event and stops NAT when no `RUNNING`/`PENDING` tasks remain.
- Outbound traffic goes through NAT instance with static Elastic IP (`runner_nat_eip` output).
- By default, task image resolves to this stack ECR repo: `<repo_url>:<runner_image_tag>`.
- You can still override with a full `runner_image` value.
- This setup uses GitHub App credentials (App ID + Installation ID + private key) to mint short-lived installation tokens for runner registration.
- Sensitive values are read at runtime from Secrets Manager by static secret names (`youtube-pip-github-app-private-key`, `youtube-pip-github-webhook-secret`).
- Dispatcher Lambda signs GitHub App JWT via `PyJWT[crypto]` from Lambda Layer (`lambda/python`).
