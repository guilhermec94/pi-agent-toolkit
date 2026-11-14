---
name: terraform-policy
description: Terraform testing and policy checks with terraform test, tflint, trivy, checkov, conftest/OPA, and infracost. Use when adding infrastructure validation to CI or triaging policy, security, and cost findings.
---

# Terraform Testing and Policy

## Layer the checks

Fast to slow, cheapest first:

1. `terraform fmt -check -recursive`
2. `terraform validate`
3. `tflint --recursive`
4. `terraform test` (native, Terraform 1.6+)
5. `trivy config .` / `checkov -d .` (security and misconfiguration)
6. `conftest test` (org policy)
7. `infracost diff` (cost, on pull requests)
8. `terraform plan` against a real or ephemeral environment

Fail the pipeline on 1–3. Treat 4–6 as required but allow documented suppressions. Cost is advisory unless the org says otherwise.

## Native tests

```hcl
# tests/default.tftest.hcl
mock_provider "aws" {}

run "plan_defaults" {
  command = plan

  variables {
    name = "example"
  }

  assert {
    condition     = aws_s3_bucket.this.bucket == "example"
    error_message = "bucket name should match the input"
  }
}
```

```bash
terraform init
terraform test
terraform test -filter=tests/default.tftest.hcl -verbose
```

- Use `mock_provider` for unit tests without credentials.
- Use real providers + ephemeral infrastructure only for integration tests.
- Assert on plan values where possible; apply only when necessary.

## tflint

```hcl
# .tflint.hcl
plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "aws" {
  enabled = true
  version = "0.32.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}
```

```bash
tflint --init
tflint --recursive --format compact
```

## Trivy

```bash
trivy config --severity HIGH,CRITICAL .
trivy config --format json --output trivy.json .
```

Coverage: Terraform, Kubernetes, Dockerfiles, Helm, CloudFormation. Suppress only with a linked justification.

## Checkov

```bash
checkov -d . --compact
checkov -d . --framework terraform --output sarif --output-file checkov.sarif
```

Use `#checkov:skip=CKV_AWS_XX:reason` inline for accepted risks.

## Conftest / OPA

```bash
conftest test plan.json --policy policy/
```

```rego
package terraform.deny

deny[msg] {
  resource := input.resource_changes[_]
  resource.type == "aws_s3_bucket"
  not resource.change.after.server_side_encryption_configuration
  msg := sprintf("S3 bucket %s must enable encryption", [resource.address])
}
```

## Infracost

```bash
infracost auth login
infracost breakdown --path . --format json --out-file infracost.json
infracost diff --path . --compare-to infracost-base.json
```

Post the diff on PRs; flag large percentage or absolute increases.

## CI example

```yaml
- run: terraform fmt -check -recursive
- run: terraform init -backend=false
- run: terraform validate
- run: tflint --init && tflint --recursive --format compact
- run: terraform test
- run: trivy config --severity HIGH,CRITICAL --exit-code 1 .
- run: checkov -d . --compact
```

## Triage guidance

- Fix high/critical findings first; group by root cause, not by file.
- Do not blanket-suppress a rule across the repo.
- Every suppression needs: rule ID, reason, owner, and review date.
- Distinguish true positives from rules that do not apply (e.g. intentionally public bucket).
- Prefer provider-native secure defaults over post-hoc policy patches.
