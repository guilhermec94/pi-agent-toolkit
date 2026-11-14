---
name: go-conventions
description: Go project conventions for layout, error handling, context, interfaces, tests, tooling, and module hygiene. Use when writing or reviewing Go code, choosing package structure, or configuring Go tooling.
---

# Go Conventions

## First, inspect the repo

```bash
go version
cat go.mod
find . -name 'go.mod' -not -path '*/vendor/*'   # monorepo?
ls -la
test -f Makefile && sed -n '1,120p' Makefile
test -f Taskfile.yml && sed -n '1,120p' Taskfile.yml
ls .github/workflows 2>/dev/null
```

Follow CI commands exactly (`go test ./...`, `golangci-lint run`, `go generate`). Do not invent a new build system.

## Layout

- `cmd/<binary>/main.go` — thin entry points only. Parse flags, construct dependencies, call `run()`.
- `internal/` — code not meant for external import.
- `pkg/` — only if the module is genuinely consumed as a library.
- `api/` — OpenAPI/protobuf/CRD definitions if present.
- Keep packages cohesive; avoid `util`, `common`, `helpers` dumping grounds.
- Package name = directory name, short, lowercase, no underscores.
- One `main` per binary; no business logic in `main.go`.

## Errors

- Wrap with context: `fmt.Errorf("load config: %w", err)`.
- Check errors immediately; never discard without a comment.
- Sentinels for expected conditions (`ErrNotFound`), typed errors for structured data.
- `errors.Is` / `errors.As` for inspection; never string matching.
- Do not log and return the same error; pick one layer to log.
- Include actionable context: what failed, which input, which resource.

## Context

- `ctx context.Context` is the first parameter, named `ctx`.
- Never store a context in a struct.
- Do not pass `context.Background()` in request paths; derive from the caller.
- Respect cancellation in loops and before I/O.
- Use `context.WithTimeout` at boundaries, not deep inside libraries.

## Interfaces

- Define interfaces where they are consumed, not where implemented.
- Small interfaces (1–3 methods); accept interfaces, return concrete types.
- Avoid premature interfaces; start with concrete types.
- Use compile-time assertions for intended implementations: `var _ io.Reader = (*T)(nil)`.

## Concurrency

- Every goroutine needs an owner, a shutdown path, and an error path.
- Prefer `errgroup.Group` with a derived context.
- Protect shared state with a mutex or ownership; document the rule.
- Do not close a channel from the receiver; senders own closing.
- Use `sync.Once` for one-time initialization.
- Never copy types containing `sync.Mutex`, `sync.WaitGroup`, or `atomic` values.

## Tests

- Table-driven with `t.Run`; give each case a name.
- Use `t.Helper()` in helpers.
- Use `t.Cleanup` instead of manual teardown.
- Use `t.TempDir()` for files; `httptest` for HTTP; fake clocks instead of sleeps.
- Assert with got/want in messages: `t.Fatalf("got %v, want %v", got, want)`.
- Prefer behavior assertions over implementation coupling.

## Tooling

- Commit `go.mod` and `go.sum`; never edit `go.sum` by hand.
- Use `tool` directives or `tools.go` for pinned dev tools.
- `gofmt`/`goimports` is mandatory; add `go vet` to CI.
- Use `golangci-lint` with repo config; do not add `//nolint` without a reason.
- For monorepos, prefer `go.work` for local development but keep module versions in `go.mod`.

## Common pitfalls

- `append` aliasing when sharing slices.
- Range loop variable capture pre-Go 1.22.
- `defer` inside loops holding resources until function return.
- `time.Duration` mixing (`time.Second * 30` vs `30 * time.Second`).
- Comparing errors with `==` instead of `errors.Is`.
- Nil map writes; nil slice vs empty slice semantics in JSON.
- Forgetting `rows.Close()` and `http.Response.Body.Close()`.
- Returning `nil` error with a nil pointer that gets dereferenced later.

## Verification

```bash
gofmt -l .
go vet ./...
go build ./...
go test ./...
go test -race ./...
golangci-lint run
```

Use the `go_test` and `go_lint` pi tools when available to keep output compact.
