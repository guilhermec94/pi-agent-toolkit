---
name: terraform-module
description: Terraform/OpenTofu module structure, variables, outputs, providers, backends, workspaces, and environments. Use when creating or refactoring modules, wiring environments, or fixing provider and lockfile issues.
---

# Terraform Modules

## Layout

```
modules/<name>/
  versions.tf      # terraform + provider requirements
  variables.tf     # typed inputs, validation, sensitive flags
  main.tf          # resources
  outputs.tf       # minimal, documented outputs
  README.md        # usage + inputs/outputs table
  tests/           # terraform test / terratest
environments/<env>/
  backend.tf or backend config
  main.tf          # module calls
  terraform.tfvars
  providers.tf
```

Root modules live under `environments/` or `live/`; reusable modules under `modules/`.

## versions.tf

```hcl
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}
```

- Pin the Terraform minor version range, not an exact patch.
- Commit `.terraform.lock.hcl` and update it intentionally (`terraform providers lock -platform=linux_amd64 -platform=darwin_arm64`).
- No provider configuration inside reusable modules; providers are configured by the root.

## Variables

```hcl
variable "name" {
  description = "Name prefix for resources."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.name))
    error_message = "name must be lowercase alphanumeric with hyphens."
  }
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}

variable "db_password" {
  description = "Database password."
  type        = string
  sensitive   = true
}
```

- Always set `description` and `type`.
- Mark secrets `sensitive = true`; never put secrets in defaults or `terraform.tfvars` committed to git.
- Use `nullable = false` for required-but-defaulted values.
- Prefer objects over many parallel scalar variables.
- Validate enums with `contains([...], var.x)`.

## Resources

- Use `for_each` with stable keys, not `count`, for resources that may reorder.
- Use `locals` for computed names and tags.
- `prevent_destroy` only for genuinely irreplaceable resources (stateful DBs, buckets with data).
- `ignore_changes` only with a comment explaining why.
- No hardcoded account IDs, regions, AMIs, or credentials. Use data sources or variables.
- Tag consistently: `Environment`, `Owner`, `ManagedBy`, `CostCenter` when the org requires it.

## Outputs

```hcl
output "arn" {
  description = "ARN of the created resource."
  value       = aws_foo.this.arn
}
```

- Export only what consumers need.
- Mark sensitive outputs `sensitive = true`.
- Avoid outputting entire resource objects.

## Backends and environments

```hcl
terraform {
  backend "s3" {
    bucket         = "org-tfstate"
    key            = "service/env/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "tfstate-lock"
    encrypt        = true
  }
}
```

- Use partial backend config + `-backend-config=env/backend.hcl` for per-environment values.
- Never commit `*.tfstate`, `*.tfstate.backup`, `.terraform/`, or `crash.log`.
- Prefer one state per service/environment; avoid a single global state.
- Use separate accounts/projects for prod where possible.
- Use `terraform workspace` only for lightweight parallel environments; not for prod vs non-prod isolation.

## Composition

- Modules should be small enough to reason about, but not one-resource wrappers.
- Pass explicit inputs; avoid hidden coupling via data sources when a variable is clearer.
- Use `moved` blocks when renaming resources/modules.
- Use `import` blocks (Terraform 1.5+) for brownfield adoption instead of manual state surgery.

## Verification

```bash
terraform fmt -recursive -check
terraform init -backend=false
terraform validate
terraform test            # if tests/ exists, Terraform 1.6+
tflint --recursive
trivy config .
terraform plan            # with real backend/credentials
```

Never run `apply` or state mutations as part of module development unless explicitly asked.
