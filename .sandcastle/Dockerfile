FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \
  git \
  curl \
  jq \
  && rm -rf /var/lib/apt/lists/*

# Enable corepack so pnpm is available, version-pinned via the
# packageManager field in package.json. Runs as root before USER switch.
RUN corepack enable

# Pre-activate pnpm at the version pinned by package.json's packageManager field.
# Eliminates the corepack download cost on first invocation inside containers.
RUN corepack prepare pnpm@10.14.0 --activate

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

# Rename the base image's "node" user (UID 1000) to "agent".
# This keeps UID 1000 so that --userns=keep-id (Podman) and
# --user 1000:1000 (Docker) map to the correct home directory owner.
RUN usermod -d /home/agent -m -l agent node
USER agent

# Pre-seed minimal ~/.claude/ config so that CLAUDE_CODE_OAUTH_TOKEN auth works
# in fresh containers without the CLI walking through interactive setup.
# Workaround for anthropics/claude-code#8938.
RUN mkdir -p /home/agent/.claude && \
    echo '{"hasCompletedOnboarding": true, "theme": "dark"}' > /home/agent/.claude/settings.json

# Install Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash

# Add Claude to PATH
ENV PATH="/home/agent/.local/bin:$PATH"

# Make /home/agent writable to any UID, including the host UID Docker passes
# through on macOS (~501) which differs from the image's UID 1000. Placed last
# so it covers files the Claude Code installer wrote during build. Container
# is ephemeral and network-isolated; loose home perms are not a security risk.
RUN chmod -R 0777 /home/agent

WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at /home/agent/workspace
# and overrides the working directory to /home/agent/workspace at container start.
# Structure your Dockerfile so that /home/agent/workspace can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
