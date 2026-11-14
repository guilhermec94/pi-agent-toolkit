# pi-sandbox

Part of the [pi-agent-toolkit](../README.md).

Run [pi](https://github.com/badlogic/pi-coding-agent) in a disposable container so the
agent can only touch the directory you mount as `/workspace` — not your system.

## Why

The agent can run arbitrary shell commands (`rm -rf`, install packages, write files).
Inside the container, all of that is isolated and thrown away on exit. The only thing it
can affect is what you explicitly mount.

## Usage

From a project directory:

```sh
./run.sh "summarize this repo"
```

or with extra args:

```sh
./run.sh -p "explain the code in main.go"   # print (non-interactive) mode
```

`run.sh` mounts the current directory at `/workspace` and passes `DEEPSEEK_API_KEY`
through from your environment.

## Shell function (recommended)

Make `pi` run sandboxed by default with a shell function (e.g. in `~/.bashrc.d/pi-sandbox.sh`,
sourced by your `.bashrc`):

```bash
pi() {
  docker image inspect pi-sandbox >/dev/null 2>&1 || \
    docker build -t pi-sandbox "$HOME/projects/pi-agent-toolkit/sandbox"
  [ -z "${DEEPSEEK_API_KEY:-}" ] && echo "WARNING: DEEPSEEK_API_KEY is not set" >&2
  local it=""; [ -t 0 ] && it="-it"
  local -a config=()
  [ "${PI_SANDBOX_CONFIG:-0}" = "1" ] && config=(-v "$HOME/.pi/agent:/config:ro")
  docker run ${it} --rm \
    --add-host=host.docker.internal:host-gateway \
    -e "DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY:-}" \
    "${config[@]}" -v "$(pwd):/workspace" pi-sandbox "$@"
}
```

Then:

```sh
pi "summarize this repo"        # interactive TUI
pi -p "explain main.go"         # print (non-interactive) mode
PI_SANDBOX_CONFIG=1 pi          # with your toolkit
command pi                      # the local (unsandboxed) pi binary
```

## How auth works

pi's DeepSeek provider reads its key from the `DEEPSEEK_API_KEY` environment variable
(your `~/.pi/agent/models.json` sets `"apiKey": "DEEPSEEK_API_KEY"`). So you don't need
to copy any credentials into the image — just have `DEEPSEEK_API_KEY` set on the host.

## What's isolated / not

| thing | sandboxed? |
|---|---|
| system files, `/etc`, other projects | ✅ untouched (container) |
| network | ✅ reachable (needed for the model API) |
| the mounted `/workspace` | ⚠️ read-write — this is your real project dir |
| everything else in the container | ✅ ephemeral, deleted on `--rm` |

If you want the agent to work on a *copy* instead of your real project, mount a copy:

```sh
cp -r my-project /tmp/work && cd /tmp/work && ../pi-sandbox/run.sh
```

## Optional: use your skills & extensions

By default the sandbox is empty (no custom skills/extensions). To give it your
`~/.pi/agent` config, mount it read-only at `/config` — the entrypoint copies it into a
writable location so pi works against a copy (your real config is never modified):

```sh
# with run.sh:
PI_SANDBOX_CONFIG=1 ./run.sh "summarize this repo"

# or directly:
docker run -it --rm \
  --add-host=host.docker.internal:host-gateway \
  -v "$(pwd):/workspace" \
  -v "$HOME/.pi/agent:/config:ro" \
  -e "DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY" \
  pi-sandbox
```

The copy happens fresh on every run (the container is `--rm`), so config changes on the
host are picked up next run, and anything the agent changes in its copy is discarded.

Note: if your config includes the `go_test`/`go_lint`/`terraform_plan` extensions, you'll
need `go`, `golangci-lint`, and `terraform` in the image too — add them to the Dockerfile.

## Docker permission fix

If `docker build`/`docker run` fail with "permission denied ... docker.sock", add yourself
to the docker group and re-login:

```sh
sudo usermod -aG docker "$USER"
```

Then log out and back in (or run `newgrp docker`).
