#!/usr/bin/env bash
# On-call agent as its own Linux user (docs/ONCALL.md, "Agent isolation"). The agent reads data downloaded from
# YouTube (bundles, pages), so a prompt injection there must find nothing worth stealing:
# - it runs as `oncall-agent`, not as the runner's user: the runner's processes (/proc/<pid>/environ with the
#   Telegram and Claude tokens, the ECS credentials URI) belong to another uid, and the runner's home (the checkout
#   with the job token in .git/config, the runner's credentials, step scripts) is closed to others;
# - not even the Claude token: a proxy run by the runner's user (scripts/dev-worker/anthropic-proxy.mjs) holds it and
#   adds it to the agent's API requests; the agent gets ANTHROPIC_BASE_URL and a placeholder that only this proxy
#   accepts. Every other variable is unset, and nothing passes on a command line (sudo --preserve-env);
# - it works on a copy: the repository at HEAD (git archive, no .git) and the on-call inputs in its own home;
# - Read / Grep / Glob are its whole tool set (--tools), confined to its copy (--restricted), and /proc, /sys, /dev
#   are denied on top (scripts/oncall/agent-settings.json).
# Self-checks fail the step before Claude starts when any of this does not hold (the message then falls back to the
# raw results).
#
# Usage: scripts/oncall/run-agent.sh <claude code npm spec> <prompt file> <transcript out>
# Env: CLAUDE_CODE_OAUTH_TOKEN (the proxy's only). Runs as the runner's user (passwordless sudo), from the repository
# root, with node on PATH.
set -euo pipefail

spec=$1
prompt_file=$2
out=$3
: "${CLAUDE_CODE_OAUTH_TOKEN:?CLAUDE_CODE_OAUTH_TOKEN is not set}"

AGENT=oncall-agent
AGENT_HOME=/home/$AGENT
WORK=$AGENT_HOME/work
CLI_DIR=/tmp/oncall-agent-cli
RUNNER_HOME=$(getent passwd "$(id -un)" | cut -d: -f6)
as_agent() { sudo -n -H -u "$AGENT" -- "$@"; }
# The same with the Claude token kept: everything else is dropped explicitly, whatever the sudoers env_keep says (a
# GitHub-hosted runner keeps its RUNNER_* / ACTIONS_* variables through sudo)
KEEP_ENV='CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_BASE_URL|HOME|USER|LOGNAME|SHELL|LANG|TERM'
as_agent_claude() {
  sudo -n -H -u "$AGENT" --preserve-env=CLAUDE_CODE_OAUTH_TOKEN,ANTHROPIC_BASE_URL -- /bin/bash -c '
    for name in $(compgen -e); do
      [[ $name =~ ^('"$KEEP_ENV"')$ ]] || unset "$name"
    done
    export PATH=/usr/local/bin:/usr/bin:/bin
    exec "$@"' run-agent "$@"
}

# The agent's user, and the runner's home closed to it
id "$AGENT" >/dev/null 2>&1 ||
  sudo -n useradd --create-home --home-dir "$AGENT_HOME" --shell /usr/sbin/nologin "$AGENT"
sudo -n chmod 700 "$AGENT_HOME"
sudo -n chmod 750 "$RUNNER_HOME"

# Claude Code (a native binary) installed by the runner's user: the agent may run it, not change it
if [[ ! -x $CLI_DIR/node_modules/@anthropic-ai/claude-code/bin/claude.exe ]]; then
  npm install --prefix "$CLI_DIR" --no-audit --no-fund --silent "$spec"
fi
chmod -R go-w "$CLI_DIR"
claude=$CLI_DIR/node_modules/@anthropic-ai/claude-code/bin/claude.exe

# The token proxy, as the runner's user; from here on this script only has the placeholder
proxy_env=$(mktemp)
node scripts/dev-worker/anthropic-proxy.mjs "$proxy_env" &
proxy_pid=$!
trap 'kill "$proxy_pid" 2>/dev/null || true; rm -f "$proxy_env"' EXIT
for _ in $(seq 1 50); do
  grep -q '^CLAUDE_CODE_OAUTH_TOKEN=' "$proxy_env" && break
  sleep 0.2
done
real_token=$CLAUDE_CODE_OAUTH_TOKEN
placeholder=$(sed -n 's/^CLAUDE_CODE_OAUTH_TOKEN=//p' "$proxy_env")
ANTHROPIC_BASE_URL=$(sed -n 's/^ANTHROPIC_BASE_URL=//p' "$proxy_env")
[[ -n $placeholder && -n $ANTHROPIC_BASE_URL ]] || { echo "run-agent: the token proxy did not start" >&2; exit 1; }
export CLAUDE_CODE_OAUTH_TOKEN=$placeholder ANTHROPIC_BASE_URL

# Its copy of the repository and of the inputs
as_agent rm -rf "$WORK"
as_agent mkdir "$WORK"
git archive --format=tar HEAD | as_agent tar -x -C "$WORK"
tar -c --exclude=oncall/claude-transcript.jsonl oncall | as_agent tar -x -C "$WORK"

# Self-checks: the isolation holds before the agent starts
fail() {
  echo "run-agent: isolation check failed: $1" >&2
  exit 1
}
as_agent test -r "$WORK/scripts/oncall/agent-settings.json" || fail "the agent cannot read its copy"
if as_agent test -r "$GITHUB_WORKSPACE/.git/config"; then fail "the agent can read the runner's checkout"; fi
if as_agent cat "/proc/$$/environ" >/dev/null 2>&1; then fail "the agent can read the runner's environment"; fi
if as_agent cat /proc/1/environ >/dev/null 2>&1; then fail "the agent can read the task's environment"; fi
# Its environment: the proxy's placeholder and nothing that looks like another credential
as_agent_claude /usr/bin/env |
  cut -d= -f1 | grep -E 'TOKEN|SECRET|PASSWORD|KEY|CREDENTIALS|^GITHUB_|^ACTIONS_|^RUNNER_|^AWS_' |
  grep -vx CLAUDE_CODE_OAUTH_TOKEN && fail "the agent's environment has more than its Claude token"
agent_token=$(as_agent_claude /bin/sh -c 'printf %s "$CLAUDE_CODE_OAUTH_TOKEN"')
[[ $agent_token == "$placeholder" && $agent_token != "$real_token" ]] ||
  fail "the agent's token is not the proxy's placeholder"
[[ $(as_agent_claude /bin/sh -c 'printf %s "$ANTHROPIC_BASE_URL"') == "$ANTHROPIC_BASE_URL" ]] ||
  fail "the proxy's address did not reach the agent"
echo "run-agent: isolation checks passed"

as_agent_claude /usr/bin/env --chdir="$WORK" "$claude" \
  -p "$(cat "$prompt_file")" \
  --tools "Read,Grep,Glob" --restricted --strict-mcp-config \
  --settings scripts/oncall/agent-settings.json \
  --allowedTools "Read,Grep,Glob" \
  --disallowedTools "Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task" \
  --model sonnet --max-turns 40 \
  --output-format stream-json --verbose >"$out"
