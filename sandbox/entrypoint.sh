#!/bin/sh
set -e

# If a read-only config is mounted at /config, copy it into the writable agent
# dir so pi can create lock files and sessions against a COPY, never the host's
# real config. Host session history is deliberately not copied.
AGENT_DIR="${PI_CODING_AGENT_DIR:-/home/node/.pi/agent}"

if [ -d /config ]; then
  mkdir -p "$AGENT_DIR"
  find /config -mindepth 1 -maxdepth 1 ! -name sessions -exec cp -a {} "$AGENT_DIR/" \;
fi

exec pi "$@"
