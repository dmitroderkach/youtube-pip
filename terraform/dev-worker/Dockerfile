# Dev worker image (docs/DEV_WORKER.md): Claude Code driven from Telegram. Build context = repository root:
#   scripts/build-dev-worker-image.sh (or CodeBuild image-build / image-publish, terraform/dev_worker_ops.tf)
# Docker official images from their ECR Public mirror: CodeBuild's shared addresses hit Docker Hub's pull limits
FROM public.ecr.aws/docker/library/node:24-bookworm-slim

# Keep in sync with @playwright/test in package-lock.json (browsers for narrowed local e2e runs).
ARG PLAYWRIGHT_VERSION=1.58.2

ENV DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Claude Code comes with the Agent SDK (scripts/dev-worker/package.json, same version line as the on-call's CLI):
# no self-update inside the container
ENV DISABLE_AUTOUPDATER=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg jq less procps sudo tar unzip \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli.gpg \
    && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscli.zip \
    && unzip -q /tmp/awscli.zip -d /tmp && /tmp/aws/install && rm -rf /tmp/aws /tmp/awscli.zip \
    && npx -y playwright@${PLAYWRIGHT_VERSION} install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm

# Terraform for checks of terraform/ (fmt, validate, plan with the worker's read-only rights; apply goes through the
# owner's button, dev-ops). Keep close to the owner's local version and to dev_ops_terraform_version
# (terraform/dev_worker_ops.tf).
ARG TERRAFORM_VERSION=1.15.4
RUN cd /tmp \
    && curl -fsSLO https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip \
    && curl -fsSL https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_SHA256SUMS \
      | grep " terraform_${TERRAFORM_VERSION}_linux_amd64.zip$" | sha256sum -c - \
    && unzip -q terraform_${TERRAFORM_VERSION}_linux_amd64.zip terraform -d /usr/local/bin \
    && rm terraform_${TERRAFORM_VERSION}_linux_amd64.zip

# Python of the Lambda runtime (python3.12, terraform/lambda/*.py) with boto3, which the Lambdas import: compile and
# test them with stubbed AWS clients. Copied from the official image of the same Debian release (node's /usr/local
# stays as is); the libraries it links against come from apt.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libbz2-1.0 libffi8 libgdbm6 liblzma5 libncursesw6 libreadline8 libsqlite3-0 libssl3 libuuid1 zlib1g \
    && rm -rf /var/lib/apt/lists/*
COPY --from=public.ecr.aws/docker/library/python:3.12-slim-bookworm /usr/local/bin/python3.12 /usr/local/bin/python3.12
COPY --from=public.ecr.aws/docker/library/python:3.12-slim-bookworm /usr/local/lib/python3.12 /usr/local/lib/python3.12
COPY --from=public.ecr.aws/docker/library/python:3.12-slim-bookworm /usr/local/lib/libpython3.12.so.1.0 /usr/local/lib/
RUN ldconfig \
    && ln -s python3.12 /usr/local/bin/python3 && ln -s python3.12 /usr/local/bin/python \
    && python3 -m pip install --no-cache-dir --root-user-action=ignore boto3

# Two users (docs/DEV_WORKER.md, "Claude Code as a separate user"):
# - devworker runs worker.mjs and holds the secrets (the task's environment); home /var/lib/dev-worker, private;
# - worker runs Claude Code and everything it starts, with none of them; home /home/worker (the working copy, Claude
#   Code's state, plans, inbox / outbox: the paths Claude has always had).
# devworker may run commands as worker (sudo, one rule) and is in worker's group for the shared files; worker has no
# sudo at all and cannot read devworker's process (another uid: /proc/<pid>/environ is refused).
RUN useradd -m -d /home/worker -s /bin/bash worker \
    && useradd -m -d /var/lib/dev-worker -s /bin/bash devworker \
    && usermod -aG worker devworker \
    && chmod 2770 /home/worker && chmod 700 /var/lib/dev-worker \
    && mkdir -p /home/worker/.terraform.d/plugin-cache && chown -R worker:worker /home/worker/.terraform.d \
    && mkdir -p /srv/dev-worker && chown devworker:worker /srv/dev-worker && chmod 2750 /srv/dev-worker \
    && printf '%s\n' 'Defaults:devworker !requiretty, umask=0002, umask_override' \
      'devworker ALL=(worker) NOPASSWD: ALL' > /etc/sudoers.d/dev-worker \
    && chmod 0440 /etc/sudoers.d/dev-worker && visudo -cf /etc/sudoers.d/dev-worker
# Providers are downloaded once per run into the cache (outside the workspace that is saved to S3)
ENV TF_PLUGIN_CACHE_DIR=/home/worker/.terraform.d/plugin-cache
# Agent SDK (bundles the Claude Code executable for linux-x64), installed from the lockfile
COPY scripts/dev-worker/package.json scripts/dev-worker/package-lock.json /opt/dev-worker/
RUN cd /opt/dev-worker && npm ci --omit=dev --no-audit --no-fund && rm -rf /root/.npm
COPY scripts/dev-worker/worker.mjs scripts/dev-worker/telegram-format.mjs scripts/dev-worker/session-state.mjs \
     scripts/dev-worker/isolation.mjs scripts/dev-worker/system-prompt.md scripts/dev-worker/english-only-hook.mjs \
     /opt/dev-worker/
# User settings: the PreToolUse hook that keeps text sent to GitHub / git history in English
COPY --chown=worker:worker scripts/dev-worker/claude-settings.json /home/worker/.claude/settings.json
COPY terraform/dev-worker/entrypoint.sh /entrypoint.sh
# Terraform plans of main and Docker images through CodeBuild (docs/DEV_WORKER.md, "Infrastructure and images")
COPY scripts/dev-worker/dev-ops.sh /usr/local/bin/dev-ops
COPY scripts/dev-worker/schedule.sh /usr/local/bin/schedule
# GitHub as the worker's own App: tokens for git (credential helper) and gh (a wrapper ahead of /usr/bin/gh); Claude's
# user gets them from devworker's token broker (github-token, a Unix socket in /srv/dev-worker)
COPY scripts/dev-worker/github-app-token.mjs /usr/local/bin/github-app-token
COPY scripts/dev-worker/github-token.sh /usr/local/bin/github-token
COPY scripts/dev-worker/gh-wrapper.sh /usr/local/bin/gh
RUN chmod +x /entrypoint.sh /usr/local/bin/dev-ops /usr/local/bin/schedule /usr/local/bin/github-app-token \
      /usr/local/bin/github-token /usr/local/bin/gh \
    && chmod 755 /opt/dev-worker && chmod 644 /opt/dev-worker/*.mjs /opt/dev-worker/*.md \
    && printf '%s\n' '[credential "https://github.com"]' \
      '\thelper = "!f() { [ \"$1\" = get ] || exit 0; echo username=x-access-token; echo \"password=$(github-token)\"; }; f"' \
      '[init]' '\tdefaultBranch = main' '[pull]' '\trebase = false' > /home/worker/.gitconfig \
    && chown worker:worker /home/worker/.gitconfig

# Claude Code's user and home (isolation.mjs); the broker's socket
ENV CLAUDE_USER=worker CLAUDE_HOME=/home/worker GITHUB_BROKER_SOCKET=/srv/dev-worker/github.sock

USER devworker
WORKDIR /var/lib/dev-worker
ENTRYPOINT ["/entrypoint.sh"]
