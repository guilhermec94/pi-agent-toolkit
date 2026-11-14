---
name: go-release
description: Go release engineering with goreleaser, ldflags versioning, multi-arch builds, Homebrew taps, containers, checksums, SBOMs, and signing. Use when setting up or fixing CLI release pipelines.
---

# Go Release Engineering

## Version embedding

```go
// internal/version/version.go
package version

var (
	Version = "dev"
	Commit  = "none"
	Date    = "unknown"
)
```

```bash
go build -ldflags "\
  -X github.com/org/repo/internal/version.Version=${VERSION} \
  -X github.com/org/repo/internal/version.Commit=${COMMIT} \
  -X github.com/org/repo/internal/version.Date=${DATE}" \
  -o dist/tool ./cmd/tool
```

Expose it with a `version` subcommand and in `--version`.

## goreleaser

Minimal `.goreleaser.yaml`:

```yaml
version: 2
project_name: tool

before:
  hooks:
    - go mod tidy
    - go test ./...

builds:
  - id: tool
    main: ./cmd/tool
    binary: tool
    env:
      - CGO_ENABLED=0
    goos: [linux, darwin, windows]
    goarch: [amd64, arm64]
    ldflags:
      - -s -w
      - -X github.com/org/repo/internal/version.Version={{.Version}}
      - -X github.com/org/repo/internal/version.Commit={{.Commit}}
      - -X github.com/org/repo/internal/version.Date={{.Date}}

archives:
  - formats: [tar.gz]
    format_overrides:
      - goos: windows
        formats: [zip]

checksum:
  name_template: checksums.txt

changelog:
  sort: asc
  filters:
    exclude: ["^docs:", "^test:", "^chore:"]

brews:
  - repository:
      owner: org
      name: homebrew-tap
    homepage: https://github.com/org/repo
    description: What the tool does
    license: MIT
    install: |
      bin.install "tool"
```

```bash
goreleaser check
goreleaser build --snapshot --clean
goreleaser release --snapshot --clean   # no publish
goreleaser release --clean              # needs GITHUB_TOKEN
```

## GitHub Actions

```yaml
name: release
on:
  push:
    tags: ["v*"]
permissions:
  contents: write
jobs:
  goreleaser:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-go@v5
        with: { go-version-file: go.mod }
      - uses: goreleaser/goreleaser-action@v6
        with:
          distribution: goreleaser
          version: "~> v2"
          args: release --clean
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          HOMEBREW_TAP_GITHUB_TOKEN: ${{ secrets.HOMEBREW_TAP_GITHUB_TOKEN }}
```

Use `fetch-depth: 0` so the changelog has history.

## Containers

- Multi-stage build; final image `gcr.io/distroless/static` or `scratch` for static binaries.
- Run as non-root (`USER 65532:65532`).
- Pin base images by digest.
- Set `ENTRYPOINT ["/tool"]`; do not use a shell wrapper.
- Add labels (source, revision, version) and a healthcheck only if meaningful.

## Supply chain

- Publish `checksums.txt`; sign with `cosign sign-blob` or goreleaser's signing support.
- Generate an SBOM with `syft` and attach it to the release.
- Use `govulncheck ./...` in CI.
- Enable Dependabot/Renovate for Go modules and Actions.
- Build with `-trimpath` for reproducible paths.

## Semver

- `vMAJOR.MINOR.PATCH`; tags are the source of truth.
- Breaking CLI/API change → major.
- New functionality → minor.
- Fixes/docs → patch.
- Keep a changelog grouped by Added/Changed/Fixed/Removed.

## Pre-release checklist

- [ ] `go test -race ./...` passes
- [ ] `govulncheck ./...` clean or triaged
- [ ] `goreleaser check` passes
- [ ] Snapshot build installs and runs on Linux/macOS/Windows
- [ ] `--version` reports the tag
- [ ] Completion scripts still generate
- [ ] Checksums and signatures published
- [ ] Homebrew formula updated
- [ ] Release notes list breaking changes
