---
name: go-testing-debugging
description: Go testing, benchmarking, race detection, profiling, and debugging workflows. Use when fixing failing tests, investigating performance or memory issues, chasing goroutine leaks, or adding coverage.
---

# Go Testing and Debugging

## Fast triage

```bash
go test ./...                        # all packages
go test ./pkg/...                    # subtree
go test -run 'TestName' ./pkg        # one test
go test -run 'TestName/subcase' -v   # one subtest
go test -count=1 ./...               # bypass cache
go test -json ./...                  # machine-readable
go test -race ./...                  # concurrency
go test -short ./...                 # skip slow tests
```

In pi, prefer the `go_test` tool (compact failures + coverage) over raw bash.

## Test quality

- Table-driven tests with `t.Run` and named cases.
- `t.Helper()` in assertion helpers; `t.Cleanup()` for teardown.
- `t.TempDir()` for files; `httptest.NewServer` for HTTP.
- Fake clocks (`clockwork`, `synctest` in Go 1.24+) instead of `time.Sleep`.
- No assertions on log output unless the logs are the contract.
- Tests must pass with `-race` and in parallel where safe.

## Flaky test checklist

1. Reproduce with `-count=50 -run '^TestName$'`.
2. Run with `-race`.
3. Look for: sleeps, shared globals, ports, filesystem collisions, map iteration order, time zones, unseeded randomness.
4. Replace sleeps with channels, `sync.WaitGroup`, or polling helpers with deadlines.
5. Bind test servers to `127.0.0.1:0` and read the assigned port.
6. Use `t.Setenv` for environment isolation.

## Coverage

```bash
go test -coverprofile=cover.out ./...
go tool cover -func=cover.out | tail -n 5
go tool cover -html=cover.out
```

Focus coverage on changed packages, not a global percentage. Do not add tests that only execute lines.

## Benchmarks

```bash
go test -bench=. -benchmem -run='^$' ./pkg
go test -bench=. -benchtime=2s -count=5 ./pkg
```

- Use `b.ReportAllocs()` and `b.ResetTimer()`.
- Avoid optimizing before measuring; compare before/after with `benchstat`.
- Watch for compiler elision in microbenchmarks (`b.SetBytes`, sink values).

## Profiling

```bash
go test -bench=. -cpuprofile=cpu.out -memprofile=mem.out ./pkg
go tool pprof -http=:8080 cpu.out
go tool pprof -top -alloc_space mem.out
```

For services, expose `net/http/pprof` behind auth and capture:

```bash
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/profile?seconds=30
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/heap
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/goroutine
```

## Goroutine leaks and deadlocks

- Snapshot `runtime.NumGoroutine()` before/after, or use `go.uber.org/goleak`.
- Use `go test -race` first; then goroutine profiles.
- Look for blocked sends/receives, missing `cancel()`, and WaitGroups never released.
- Send SIGQUIT or `kill -QUIT` to dump all goroutine stacks.

## Delve

```bash
dlv debug ./cmd/tool -- -flag=value
dlv test ./pkg -- -test.run TestName
dlv attach <pid>
```

Useful commands: `break`, `continue`, `next`, `step`, `goroutines`, `goroutine <id> bt`, `print`, `locals`.

## Runtime diagnostics

- `GOTRACEBACK=all` for all goroutine stacks on panic.
- `GODEBUG=gctrace=1` for GC pauses; `GOMEMLIMIT` for memory pressure.
- `go tool trace` for scheduler latency, blocking, and syscalls.
- `net/http/pprof` + `expvar` for long-running services.

## Verification before handing off

```bash
gofmt -l .
go vet ./...
go test -count=1 ./...
go test -race ./...
```
