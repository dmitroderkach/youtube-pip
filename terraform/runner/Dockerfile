FROM ubuntu:24.04

# Keep in sync with https://github.com/actions/runner/releases — old versions are rejected at connect time.
ARG RUNNER_VERSION=2.334.0

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    jq \
    unzip \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -d /home/runner -s /bin/bash runner

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
