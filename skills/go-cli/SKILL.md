---
name: go-cli
description: Go CLI design and implementation with cobra, kong, or urfave/cli. Use when adding commands or flags, handling config precedence, signals, exit codes, help text, or shell completion.
---

# Go CLI Development

## Decide the framework

- `spf13/cobra` — large command trees, many flags, ecosystem familiarity.
- `alecthomas/kong` — struct-tag driven, concise for small/medium CLIs.
- `urfave/cli/v2` (or v3) — simple apps, minimal dependencies.
- Standard `flag` — only for tiny tools; no subcommands, weak help.

Match the existing repo. Do not introduce a second CLI framework.

## Structure

```
cmd/<binary>/main.go        # main() only: os.Exit(run(...))
internal/cli/root.go        # root command, global flags, wiring
internal/cli/<verb>.go      # one file per command
internal/cli/run.go         # func run(args []string, stdout, stderr io.Writer) int
```

- Return an exit code; do not call `os.Exit` deep in the call stack.
- Pass `io.Writer` for stdout/stderr so tests can capture output.
- Inject dependencies (clients, clock, filesystem) into commands.
- Keep business logic in packages, not in `RunE` bodies.

## Flag conventions

- Long flags kebab-case: `--dry-run`, `--output-format`.
- Short flags reserved for common actions only.
- Every flag has a help string and a sensible default.
- Mutually exclusive flags validated with `MarkFlagsMutuallyExclusive` (cobra).
- Destructive actions require `--yes` or interactive confirmation; never default to destructive.
- Support `--` for positional args.
- Accept config from flag > env > file > default and document it.

## Output contract

- Human output to stdout; progress/logs to stderr.
- `--json` (or `--output json`) emits one JSON document, no banner text.
- `--quiet` suppresses non-essential output but keeps errors.
- Stable machine output: no timestamps or colors unless requested.
- Detect TTY for color; honor `NO_COLOR`.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | success |
| 1 | runtime failure |
| 2 | usage/validation error |

Keep codes consistent across commands and document them.

## Signals and shutdown

```go
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()
```

- Propagate `ctx` to all I/O.
- On cancel, stop accepting work, flush output, and exit with a non-zero code if the operation was interrupted.
- Avoid `os.Exit` in deferred cleanup paths; return errors up.

## Version and completion

- Embed version/commit/date with ldflags.
- Add `version` and `completion` subcommands.
- For cobra: `rootCmd.GenBashCompletion`, `GenZshCompletion`, `GenFishCompletion`, `GenPowerShellCompletionWithDesc`.
- Test completion generation in CI (does not require a shell).

## Testing CLIs

- Unit test `run([]string{...}, &out, &errOut)` without spawning a process.
- Golden files for help text and structured output.
- Integration tests with `os/exec` only for wiring you cannot otherwise cover.
- Test: no args, unknown flag, missing required value, invalid enum, `--help`, `--version`, and error paths.

## Checklist

- [ ] Naming and flags consistent with existing commands
- [ ] Help text includes examples
- [ ] Config precedence documented
- [ ] Exit codes consistent
- [ ] SIGINT/SIGTERM handled
- [ ] JSON output is clean and stable
- [ ] Version embedding works
- [ ] Completion scripts generated
- [ ] Cross-platform paths (use `filepath`, not string concatenation)
- [ ] No unescaped user input passed to a shell
