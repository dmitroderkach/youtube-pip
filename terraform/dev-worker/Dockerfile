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

# Claude Code refuses --dangerously-skip-permissions as root: run as a regular user
RUN useradd -m -d /home/worker -s /bin/bash worker
# Agent SDK (bundles the Claude Code executable for linux-x64), installed from the lockfile
COPY scripts/dev-worker/package.json scripts/dev-worker/package-lock.json /opt/dev-worker/
RUN cd /opt/dev-worker && npm ci --omit=dev --no-audit --no-fund && rm -rf /root/.npm
COPY --chown=worker:worker scripts/dev-worker/worker.mjs scripts/dev-worker/system-prompt.md \
     scripts/dev-worker/english-only-hook.mjs /opt/dev-worker/
# User settings: the PreToolUse hook that keeps text sent to GitHub / git history in English
COPY --chown=worker:worker scripts/dev-worker/claude-settings.json /home/worker/.claude/settings.json
COPY terraform/dev-worker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER worker
WORKDIR /home/worker
ENTRYPOINT ["/entrypoint.sh"]
