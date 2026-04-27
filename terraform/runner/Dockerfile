FROM ubuntu:24.04

# Keep in sync with https://github.com/actions/runner/releases — old versions are rejected at connect time.
ARG RUNNER_VERSION=2.334.0

ENV DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    jq \
    unzip \
    ca-certificates \
    git \
    gpg \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js only temporarily to fetch Playwright Chromium + OS deps.
# Keep browser/system deps, then remove Node to slim runtime image.
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && npx -y playwright@1.58.0 install --with-deps --only-shell chromium \
    && apt-get purge -y nodejs \
    && apt-get autoremove -y \
    && rm -f /etc/apt/sources.list.d/nodesource.list /etc/apt/keyrings/nodesource.gpg \
    && rm -rf /root/.npm /var/lib/apt/lists/*

RUN useradd -m -d /home/runner -s /bin/bash runner
RUN echo "runner ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/runner \
    && chmod 440 /etc/sudoers.d/runner

WORKDIR /home/runner

RUN mkdir -p /home/runner/actions-runner \
    && cd /home/runner/actions-runner \
    && curl -fsSL -o actions-runner.tar.gz "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
    && tar xzf actions-runner.tar.gz \
    && rm actions-runner.tar.gz \
    && ./bin/installdependencies.sh

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
    && chown -R runner:runner /home/runner

USER runner

WORKDIR /home/runner/actions-runner

ENTRYPOINT ["/entrypoint.sh"]
