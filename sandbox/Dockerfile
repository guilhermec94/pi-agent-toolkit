FROM node:22-slim

# Minimal runtime deps. ca-certificates is required for TLS to the model API.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install pi. NOTE: the package is @mariozechner/pi-coding-agent
# (the CLI binary is `pi`), not @pi-coding-agent/cli.
RUN npm install -g @mariozechner/pi-coding-agent

# Entrypoint that seeds an optional read-only /config mount into the writable
# agent dir (so pi can write lock files + sessions against a copy, not the host).
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Pre-create the sessions dir (node-owned) so a named volume mounted there
# inherits the right ownership on first use.
RUN mkdir -p /home/node/.pi/agent/sessions && chown -R node:node /home/node/.pi/agent

# Run as the non-root `node` user (uid 1000) so a sandboxed agent is not root.
USER node

WORKDIR /workspace
ENTRYPOINT ["/entrypoint.sh"]
