# Dev worker image (docs/DEV_WORKER.md): Claude Code driven from Telegram. Build context = repository root:
#   scripts/build-dev-worker-image.sh
FROM node:24-bookworm-slim

# Keep in sync with @playwright/test in package-lock.json (browsers for narrowed local e2e runs).
ARG PLAYWRIGHT_VERSION=1.58.2

ENV DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Claude Code comes with the Agent SDK (scripts/dev-worker/package.json, same version line as the on-call's CLI):
# no self-update inside the container
ENV DISABLE_AUTOUPDATER=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg jq less procps tar unzip \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli.gpg \
    && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscli.zip \
    && unzip -q /tmp/awscli.zip -d /tmp && /tmp/aws/install && rm -rf /tmp/aws /tmp/awscli.zip \
    && npx -y playwright@${PLAYWRIGHT_VERSION} install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm

# Terraform for checks of terraform/ (fmt, init -backend=false, validate). The worker has no AWS rights: no plan /
# apply. Keep close to the owner's local version.
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
COPY --from=python:3.12-slim-bookworm /usr/local/bin/python3.12 /usr/local/bin/python3.12
COPY --from=python:3.12-slim-bookworm /usr/local/lib/python3.12 /usr/local/lib/python3.12
COPY --from=python:3.12-slim-bookworm /usr/local/lib/libpython3.12.so.1.0 /usr/local/lib/
RUN ldconfig \
    && ln -s python3.12 /usr/local/bin/python3 && ln -s python3.12 /usr/local/bin/python \
    && python3 -m pip install --no-cache-dir --root-user-action=ignore boto3

# Claude Code refuses --dangerously-skip-permissions as root: run as a regular user
RUN useradd -m -d /home/worker -s /bin/bash worker \
    && mkdir -p /home/worker/.terraform.d/plugin-cache && chown -R worker:worker /home/worker/.terraform.d
# Providers are downloaded once per run into the cache (outside the workspace that is saved to S3)
ENV TF_PLUGIN_CACHE_DIR=/home/worker/.terraform.d/plugin-cache
# Agent SDK (bundles the Claude Code executable for linux-x64), installed from the lockfile
COPY scripts/dev-worker/package.json scripts/dev-worker/package-lock.json /opt/dev-worker/
RUN cd /opt/dev-worker && npm ci --omit=dev --no-audit --no-fund && rm -rf /root/.npm
COPY --chown=worker:worker scripts/dev-worker/worker.mjs scripts/dev-worker/telegram-format.mjs \
     scripts/dev-worker/system-prompt.md scripts/dev-worker/english-only-hook.mjs /opt/dev-worker/
# User settings: the PreToolUse hook that keeps text sent to GitHub / git history in English
COPY --chown=worker:worker scripts/dev-worker/claude-settings.json /home/worker/.claude/settings.json
COPY terraform/dev-worker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER worker
WORKDIR /home/worker
ENTRYPOINT ["/entrypoint.sh"]
