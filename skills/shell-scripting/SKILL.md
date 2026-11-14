---
name: shell-scripting
description: Robust Bash scripting for infra and CLI tooling with strict mode, traps, quoting, portability, and shellcheck. Use when writing or reviewing shell scripts, CI helpers, or release automation.
---

# Shell Scripting

## Baseline

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
```

- `-E` propagates ERR traps into functions and subshells.
- Never use `set -e` as the only error handling; check critical commands explicitly.
- Use `#!/usr/bin/env bash` unless the script must run under POSIX `sh`.

## Structure

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

log()  { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die()  { log "ERROR: $*"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"; }

cleanup() { rm -rf -- "${tmp_dir:-}"; }
trap cleanup EXIT

main() { ... }
main "$@"
```

## Quoting and arrays

- Always quote expansions: `"$var"`, `"${array[@]}"`.
- Never use `$*` for arguments; use `"$@"`.
- Build commands as arrays, not strings:
  ```bash
  args=(-input=false -no-color)
  [[ -n "${var_file:-}" ]] && args+=("-var-file=${var_file}")
  terraform "${args[@]}"
  ```
- Avoid `eval`; if unavoidable, validate every input.
- Use `--` before paths that may start with `-`.
- Use `printf` instead of `echo -e`.

## Argument parsing

```bash
usage() { cat <<'EOF'
usage: tool [-n] [-f FILE] TARGET
EOF
}

dry_run=0
file=""
while getopts ":nf:h" opt; do
  case "$opt" in
    n) dry_run=1 ;;
    f) file=$OPTARG ;;
    h) usage; exit 0 ;;
    :) die "option -$OPTARG requires an argument" ;;
    \?) die "unknown option -$OPTARG" ;;
  esac
done
shift $((OPTIND - 1))
[[ $# -ge 1 ]] || { usage; exit 2; }
```

- Exit 2 for usage errors.
- Support `--help` and `--dry-run` in scripts that mutate anything.

## Files and temp dirs

```bash
tmp_dir="$(mktemp -d)"
tmp_file="$(mktemp)"
trap 'rm -rf -- "$tmp_dir" "$tmp_file"' EXIT
```

- Never write temp files into the repo.
- Use `install -m 0755` for installed binaries.
- Resolve paths with `cd ... && pwd -P` before using them.

## Portability

- `mktemp -d` works on Linux/macOS.
- `sed -i` differs on macOS (needs `-i ''`); prefer `perl -pi -e` or test.
- `readlink -f` is not on older macOS; use a portable helper.
- GNU `date` and BSD `date` differ; prefer UTC ISO formats and test.
- Avoid `grep -P`; not always available.
- Check `bash --version` if using associative arrays or `${var,,}`.

## Shellcheck

```bash
shellcheck -x script.sh
shfmt -d -i 2 -ci script.sh
```

Fix SC2086 (quoting), SC2046 (word splitting), SC2155 (declare and assign separately), and SC2317 (unreachable) first. Add `# shellcheck source=...` for sourced files.

## Idempotency and safety

- Use `--dry-run`/`--check` where the tool supports it.
- Never `rm -rf` an unvalidated variable: `[[ -n "$dir" && "$dir" != "/" ]] || die`.
- Check `git status --porcelain` before scripts that modify a repo.
- Lock concurrent runs with `flock` when needed.
- Use `timeout` for network operations.
- Log commands with secrets redacted.

## CI considerations

- Fail fast, but print diagnostics on failure (`trap 'log "failed at line $LINENO"' ERR`).
- Do not depend on interactive shells, aliases, or `~/.bashrc`.
- Set `GIT_TERMINAL_PROMPT=0` to avoid hanging on auth prompts.
- Use `set -x` only behind a `DEBUG` flag, and never with secrets.
