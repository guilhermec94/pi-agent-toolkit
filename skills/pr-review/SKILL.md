---
name: pr-review
description: Pull request review and authoring workflow for Go, Terraform, and CLI repositories, including commit hygiene, PR descriptions, and review checklists. Use when preparing a PR or reviewing one.
---

# PR Review and Authoring

## Authoring

### Commits

- Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `build:`, `ci:`.
- One logical change per commit; keep formatting-only commits separate.
- Imperative subject under ~72 chars; body explains why, not what.
- Reference issues (`Refs #123`, `Fixes #123`) when applicable.
- Never commit secrets, `.env`, state files, or generated binaries.

### PR description

```markdown
## Summary
What changed and why.

## Changes
- ...

## Verification
- [ ] `go test ./...`
- [ ] `go test -race ./...`
- [ ] `golangci-lint run`
- [ ] `terraform validate`
- [ ] `terraform plan` (attached/summarized)
- [ ] CLI smoke test

## Risk / Rollout
Blast radius, migration steps, rollback plan.

## Screenshots / Output
Before/after for CLI or UX changes.
```

- Keep PRs small enough to review in one sitting; split refactors from behavior changes.
- Call out breaking changes explicitly.
- Attach or summarize Terraform plan output for infra changes; never paste secrets.
- Link the issue and any design doc.

## Reviewing

### Universal checklist

- [ ] The change does what the description says, and nothing unrelated.
- [ ] Tests cover the new behavior and failure paths.
- [ ] Error handling is explicit; no swallowed errors.
- [ ] Security: input validation, authz, secrets, injection, dependency risk.
- [ ] Observability: logs, metrics, traces where behavior matters.
- [ ] Backwards compatibility: APIs, flags, config keys, state, schemas.
- [ ] Performance: allocations, N+1 queries, unbounded loops, large payloads.
- [ ] Docs updated: README, help text, examples, changelog.

### Go-specific

- Context propagation and cancellation.
- Goroutine ownership and leaks.
- Error wrapping and `errors.Is/As`.
- Data races; `-race` tests.
- Exported API changes and interface design.
- Table-driven tests with clear failure messages.
- `gofmt`/`goimports` clean; no debug leftovers.

### Terraform-specific

- Plan counts: create/update/destroy/replace. No unexpected destroys.
- Replacement of stateful resources.
- Backend/workspace correctness (prod vs non-prod).
- Provider and lockfile changes.
- IAM, network, encryption, public exposure.
- State moves via `moved`/`import`, not ad-hoc surgery.
- Cost delta for large changes.

### CLI-specific

- Flag naming and defaults; help text and examples.
- Exit codes and stderr/stdout separation.
- Signal handling and timeouts.
- Config precedence and validation.
- JSON output stability.
- Version/completion behavior.

## Review output style

- Lead with the verdict: APPROVE / APPROVE WITH NITS / CHANGES REQUIRED.
- Order findings by severity: blocker, major, minor, nit.
- Reference `file:line` and explain the concrete failure mode.
- Suggest a fix; do not just point at the problem.
- Separate blocking issues from optional improvements.
- Acknowledge good decisions where relevant.
- Do not rewrite the whole file in a comment; propose a focused patch.

## Merging

- Squash for noisy WIP branches; merge/rebase for clean commit history.
- Ensure CI is green on the merge commit, not just the PR head.
- Delete the branch after merge.
- Verify the release/deploy pipeline after merge if the change is user-facing.
