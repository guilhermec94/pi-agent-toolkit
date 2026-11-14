---
name: plan-first
description: Plan before writing code, and present the design in the actual technology — Go interfaces, function signatures, structs, and error types; Terraform/Terragrunt resources, modules, and variables; Dockerfile stages and base images — never abstract pseudocode. Use when designing or implementing new functionality. Never write files until the user approves the plan.
---

# Plan-First

Design first, in the language of the stack, then implement. The point of the plan is
not to sketch boxes — it is to *pin down the concrete constructs*: which types exist,
which functions have which signatures, which Terraform resources get created, which
Docker stages run. That is the thinking that matters, and it only survives if the plan
is written at the level of real code, not prose.

## Core rule

Do **not** write, edit, or create files until the user has explicitly approved the
plan. Present the plan in the conversation and wait. Approvals look like "go",
"approved", or "lgtm".

Present the design in the actual technology. Below is what that means per stack.

## Go — the plan is types and signatures

Before writing any Go, state:

- **Package layout** — `cmd/<binary>/main.go`, `internal/...`, `pkg/...`. Which package
  owns which responsibility.
- **Exported interfaces** — the seams of the system:

  ```go
  type Store interface {
      GetUser(ctx context.Context, id string) (User, error)
      PutUser(ctx context.Context, u User) error
  }
  ```

- **Key function signatures** — including context, error returns, and where `io.Writer`
  goes (for testability):

  ```go
  func Run(args []string, stdout, stderr io.Writer) int
  func (s *server) handleCreate(w http.ResponseWriter, r *http.Request)
  ```

- **Data model** — structs and their fields, not "we'll have a user type":

  ```go
  type User struct {
      ID        string
      Email     string
      CreatedAt time.Time
  }
  ```

- **Error strategy** — sentinel errors vs typed errors, where wrapping happens,
  `errors.Is`/`errors.As` usage. Name the sentinels (`var ErrNotFound = errors.New(...)`).
- **Concurrency** — `context.Context` propagation, `golang.org/x/sync/errgroup` vs
  plain `WaitGroup`, goroutine ownership, channels if any.
- **Dependency choices** — stdlib `net/http` vs `chi` vs `gin`; `flag` vs `cobra` vs
  `kong`. State *why*, and follow whatever the repo already uses (see `go-conventions`).

A Go plan that says "add a function to fetch users" without the signature is not a
plan — it is a wish. Show the signature.

## Terraform / Terragrunt — the plan is resources and modules

Before writing any IaC, state:

- **Root modules and module boundaries** — which modules exist, what they own.
- **Resources** — concrete blocks, not "we'll add a database":

  ```hcl
  resource "aws_db_instance" "main" {
    identifier     = var.name
    engine         = "postgres"
    instance_class = var.instance_class
    allocated_storage = 20
  }
  ```

- **Variables / outputs** — names and types, and which are sensitive:

  ```hcl
  variable "instance_class" {
    type    = string
    default = "db.t3.micro"
  }
  ```

- **Backend and state** — where state lives, workspaces, locking. Flag anything that
  would force a resource **replace** or a state move.
- **Terragrunt layout** — per-environment directory structure, `terragrunt.hcl`
  inheritance, `inputs`, `dependency` blocks.
- **Provider versions and constraints** — pin them.

Review against `terraform-module` for structure and `terraform-change-review` for
replacement/drift semantics before presenting.

## Docker — the plan is stages and layers

Before writing any Dockerfile, state:

- **Multi-stage build** — which stages, what each produces, and the final image:

  ```dockerfile
  FROM golang:1.24 AS build
  WORKDIR /src
  COPY go.mod go.sum ./
  RUN go mod download
  COPY . .
  RUN CGO_ENABLED=0 go build -o /out/app ./cmd/app

  FROM gcr.io/distroless/static-debian12:nonroot
  COPY --from=build /out/app /app
  ENTRYPOINT ["/app"]
  ```

- **Base image choice** — `alpine` vs `distroless` vs `scratch`, and why.
- **Layer ordering** — dependency manifests copied before source, so layers cache.
- **Security** — run as non-root, no secrets baked in, `docker build --build-arg` for
  anything environment-specific.
- **Runtime contract** — exposed ports, signals (does the Go binary handle SIGTERM?),
  healthcheck if the orchestrator needs one.

## The approval gate

1. Explore/read first. Understand what exists.
2. Present the plan as above — types and signatures, resources and modules, or stages
   and layers. Keep it concrete enough that an engineer who knows the stack can spot a
   mistake in the *design*, not just in the prose.
3. Stop. Do not write anything. Wait for explicit approval.

When the user approves and you implement, flag anywhere you deviate from the plan and
why. The plan is a contract; deviations are decisions the user should know about.

To control how much the agent writes versus you, use the `code-mode` skill:
`/skill:code-mode <scaffold|half|full>`.
