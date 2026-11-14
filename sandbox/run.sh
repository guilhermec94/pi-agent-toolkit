#!/usr/bin/env bash
set -euo pipefail

IMAGE="pi-sandbox"
HERE="$(cd "$(dirname "$0")" && pwd)"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Building $IMAGE ..."
  docker build -t "$IMAGE" "$HERE"
fi

# Forward any *_API_KEY from the host so any provider works
# (OPENAI_API_KEY, ANTHROPIC_API_KEY, DEEPSEEK_API_KEY, ...).
KEY_ENVS=()
for name in $(env | grep -oE '^[A-Z0-9_]+_API_KEY' || true); do
  KEY_ENVS+=(-e "$name")
done
if [ "${#KEY_ENVS[@]}" -eq 0 ]; then
  echo "WARNING: no *_API_KEY environment variable set; pi may not be able to authenticate." >&2
fi

# Optional: mount your real config read-only so skills/extensions/models are available.
# The entrypoint copies it into a writable dir, so the host config is never modified.
CONFIG_ARGS=()
if [ "${PI_SANDBOX_CONFIG:-0}" = "1" ]; then
  CONFIG_ARGS=(-v "$HOME/.pi/agent:/config:ro")
fi

exec docker run -it --rm \
  --add-host=host.docker.internal:host-gateway \
  "${KEY_ENVS[@]}" \
  "${CONFIG_ARGS[@]}" \
  -v pi-sessions:/home/node/.pi/agent/sessions \
  -v "$(pwd):/workspace" \
  "$IMAGE" "$@"
