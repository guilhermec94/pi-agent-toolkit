# pi-sandbox

Part of the [pi-agent-toolkit](../README.md).

Run [pi](https://github.com/badlogic/pi-coding-agent) in a disposable container so the
agent can only touch the directory you mount as `/workspace` — not your system.

## Setup

Pick one. Both build the image automatically on first use.

### Shell function (recommended)

Add this to `~/.bashrc.d/pi-sandbox.sh` (your `.bashrc` already sources `~/.bashrc.d/*`):

```bash
pi() {
  docker image inspect pi-sandbox >/dev/null 2>&1 || \
    docker build -t pi-sandbox "$HOME/projects/pi-agent-toolkit/sandbox"

  # Forward any *_API_KEY from the host so any provider works.
  local -a key_envs=()
  local name
  for name in $(env | grep -oE '^[A-Z0-9_]+_API_KEY' || true); do
    key_envs+=(-e "$name")
  done
  [ "${#key_envs[@]}" -eq 0 ] && \
    echo "WARNING: no *_API_KEY set; pi may not authenticate." >&2

  local it=""; [ -t 0 ] && it="-it"
  local -a config=()
  [ "${PI_SANDBOX_CONFIG:-0}" = "1" ] && config=(-v "$HOME/.pi/agent:/config:ro")

  docker run ${it} --rm \
    --add-host=host.docker.internal:host-gateway \
    "${key_envs[@]}" \
    "${config[@]}" \
    -v pi-sessions:/home/node/.pi/agent/sessions \
    -v "$(pwd):/workspace" \
    pi-sandbox "$@"
}
```

Then `source ~/.bashrc` (or open a new shell).

> Note: this shadows `/usr/local/bin/pi`. Use `command pi` for the local, unsandboxed
> binary when you deliberately want it.

### Or: `run.sh` (no shell change)

```sh
./run.sh "summarize this repo"
```

## Usage

`pi` mounts the current directory at `/workspace` and forwards your `*_API_KEY`
environment variables (whatever provider you use).

```sh
pi "summarize this repo"        # interactive TUI (multi-turn, you keep prompting)
pi -p "explain main.go"         # print mode: one task, then exit
pi -c                           # continue the last sandbox session
pi -r                           # pick a session to resume
PI_SANDBOX_CONFIG=1 pi          # run with your skills/extensions
command pi                      # the local (unsandboxed) pi binary
```

## Sessions

Sessions persist in a named Docker volume (`pi-sessions`) across runs, but stay separate
from your real `~/.pi/agent/sessions`. Wipe them with:

```sh
docker volume rm pi-sessions
```

## How auth works

pi reads the API key for its configured provider from an environment variable — e.g.
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, and so on (the provider's
`models.json` sets `"apiKey": "<ENV_VAR>"`). The sandbox forwards whatever `*_API_KEY`
variables you have set on the host, so no credentials are baked into the image.

## What's isolated / not

| thing | sandboxed? |
|---|---|
| system files, `/etc`, other projects | ✅ untouched |
| network | ✅ reachable (model API) |
| the mounted `/workspace` (= `$(pwd)`) | ⚠️ read-write — your real project |
| session history | ✅ in the `pi-sessions` volume, not your host sessions |
| everything else in the container | ✅ ephemeral (`--rm`) |

To work on a *copy* instead of your real project:

```sh
cp -r my-project /tmp/work && cd /tmp/work && pi
```

## Your skills & extensions

By default the sandbox has no custom skills/extensions. Set `PI_SANDBOX_CONFIG=1` to
mount `~/.pi/agent` read-only; the entrypoint copies it into a writable location so pi
works against a copy and your real config is never modified:

```sh
PI_SANDBOX_CONFIG=1 pi
```

The copy is refreshed on every run. Note: if your config includes `go_test`/`go_lint`/
`terraform_plan`, you'll need `go`, `golangci-lint`, and `terraform` in the image too —
add them to the Dockerfile.

## Docker permission fix

If `docker` fails with "permission denied ... docker.sock":

```sh
sudo usermod -aG docker "$USER"
```

then log out and back in (or `newgrp docker`).
