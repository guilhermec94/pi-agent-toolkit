# pi-agent-toolkit

A shareable set of [pi](https://github.com/badlogic/pi-coding-agent) skills, extensions,
subagents, and prompt templates for Go, Terraform/Terragrunt, Docker, and CLI work.

The philosophy: the agent is agentic by default, and **you** decide the delegation scope
per task. It plans in the actual technology (Go types and signatures, Terraform
resources, Dockerfile stages), and a few always-on safety rails keep destructive or
sensitive operations in check without adding friction.

## Prerequisites

- [pi](https://github.com/badlogic/pi-coding-agent)
- [go-task](https://taskfile.dev) (`task`)
- `go` — for the `go_test` tool and footer
- `golangci-lint` — for the `go_lint` tool
- `terraform` — for the `terraform_plan` tool

Tools degrade with a clear error when a binary is missing.

## Install

```sh
git clone <this-repo> pi-agent-toolkit
cd pi-agent-toolkit
task install
```

`task install` backs up any existing `skills/`, `extensions/`, `agents/`, and `prompts/`
in `~/.pi/agent/` to a timestamped `backup-*` directory, then copies the repo's contents
into place. Run `/reload` in pi (or restart) to load them.

If you already have config you care about, you can also back up manually first:

```sh
task backup
```

## What's included

### Skills

| Skill | Purpose |
|---|---|
| `plan-first` | Design in the actual technology (Go types/signatures, Terraform resources, Dockerfile stages) before writing; wait for approval. |
| `code-mode` | Set delegation scope per task: `/skill:code-mode scaffold\|half\|full`. |
| `go-conventions` | Layout, errors, context, interfaces, tests, tooling, module hygiene. |
| `go-cli` | CLI design with cobra/kong/urfave: flags, exit codes, signals, completion. |
| `go-testing-debugging` | Tests, race, fuzz, pprof, delve, goroutine leaks. |
| `go-release` | goreleaser, ldflags versioning, Homebrew, containers, signing. |
| `terraform-module` | Module structure, variables, outputs, providers, backends, environments. |
| `terraform-change-review` | Plan semantics, replacements, drift, state moves/imports. |
| `terraform-policy` | terraform test, tflint, trivy, checkov, conftest, infracost. |
| `cloud-readonly-ops` | Safe read-only AWS/GCP/Azure investigation commands. |
| `shell-scripting` | Strict mode, traps, quoting, portability, shellcheck. |
| `pr-review` | Commit hygiene, PR descriptions, review checklists. |

### Extensions

| Extension | Purpose |
|---|---|
| `infra-guard.ts` | Confirms terraform apply/destroy, kubectl/helm/cloud destructive commands, force push, `rm -rf`, sudo. Blocks them in non-interactive mode. |
| `protected-paths.ts` | Blocks writes to tfstate, `.terraform/`, `.git/`, `vendor/`, kubeconfig, keys, `.env`; warns on `go.sum`, `go.mod`, `*.tfvars`. |
| `terraform-plan.ts` | `terraform_plan` tool: plan + compact summary, validate, and apply only a plan created this session. |
| `go-test.ts` | `go_test` tool: `go test -json` with compact failures and coverage. |
| `go-lint.ts` | `go_lint` tool: golangci-lint diagnostics grouped by file. |
| `plan-mode/` | `/plan` read-only mode with Go/Terraform-aware bash allowlist and plan-progress tracking. |
| `subagent/` | `subagent` tool for isolated specialist review/implementation. |
| `todo.ts` | `todo` tool and `/todo` command. |
| `git-checkpoint.ts` | Git stash checkpoints for `/fork` restoration. |
| `dirty-repo-guard.ts` | Warns before switching/forking with uncommitted changes. |
| `notify.ts` | Desktop notification when the agent finishes (interactive only). |
| `custom-footer.ts` | `/footer` toggle; shows branch, Go version, Terraform workspace, tokens, model. |

### Subagents

`scout`, `planner`, `worker`, `reviewer`, `go-reviewer`, `terraform-reviewer`, `cli-reviewer`.

Use them directly or through chains:

```
Use scout to map the auth code
Use go-reviewer to review the current diff
Use a chain: scout -> planner -> worker
```

### Prompt templates

`/implement`, `/implement-and-review`, `/scout-and-plan` — prewired subagent chains.

## The workflow

The core loop is two skills:

1. **`plan-first`** — before writing anything, the agent reads the code and presents a
   plan written in the *actual technology*: Go interfaces and function signatures,
   Terraform resource blocks, Dockerfile stages. It waits for your approval.

2. **`code-mode`** — you decide how much the agent writes versus you:

   | mode | agent writes | you write |
   |---|---|---|
   | `scaffold` | layout, types, wiring, tests — logic left as stubs | every function body with real logic |
   | `half` | CRUD, marshalling, glue, plumbing | the hard/design-critical parts (stubs + failing tests) |
   | `full` | everything | nothing (still plans first) |

In `scaffold` and `half`, the agent leaves compiling stubs with a contract comment and a
failing test — the hand-off is explicit, so the hard part stays yours if you want it.

## Dev mode

Symlink the repo into `~/.pi/agent` so edits apply after `/reload` without reinstalling:

```sh
task link
```

## Uninstall

```sh
task uninstall
```

## License

MIT — see [LICENSE](LICENSE).
