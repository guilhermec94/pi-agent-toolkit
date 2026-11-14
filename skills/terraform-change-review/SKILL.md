---
name: terraform-change-review
description: Review Terraform plans and changes for safety, including replacements, drift, state moves/imports, and zero-downtime concerns. Use before applying infrastructure changes or when interpreting plan output.
---

# Terraform Change Review

## Get a compact plan first

Prefer the `terraform_plan` pi tool. Otherwise:

```bash
terraform plan -input=false -out=tfplan
terraform show -json tfplan > plan.json
```

Summarize without dumping the whole plan:

```bash
jq -r '[.resource_changes[]?.change.actions | join("+")] | group_by(.) | map({action: .[0], count: length})' plan.json
jq -r '.resource_changes[]? | select(.change.actions != ["no-op"]) | "\(.change.actions|join("+")) \(.address)"' plan.json
```

## Action semantics

| Actions | Meaning |
|---|---|
| `["no-op"]` | no change |
| `["create"]` | new resource |
| `["update"]` | in-place update |
| `["delete"]` | destroy |
| `["delete","create"]` | replace, destroy first (downtime) |
| `["create","delete"]` | replace, create first (needs unique names) |
| `["read"]` | data source refresh |

`replace_paths` explains why a replacement happens. Read it before approving.

## Risk tiers

**High risk — require explicit human approval**
- Replace/destroy of databases, queues, buckets with data, persistent disks, KMS keys.
- IAM policy, role trust, security group ingress, public exposure changes.
- DNS/load balancer/certificate replacements.
- VPC, subnet, route table, NAT, peering changes.
- State backend, workspace, or provider changes.
- Anything that deletes more than it creates.

**Medium risk**
- Autoscaling, instance type, storage size, retention changes.
- New resources with cost impact.
- Changes to `count`/`for_each` keys that re-address existing resources.

**Low risk**
- Tag-only updates, descriptions, outputs, no-op refreshes.

## Drift and refresh

```bash
terraform plan -refresh-only     # inspect drift without changing managed resources
terraform apply -refresh-only    # accept reality into state
```

- Drift on critical resources needs a root-cause fix, not just a refresh.
- Avoid `-refresh=false` unless you understand why.

## State safety

```bash
terraform state list
terraform state show <address>
```

- Prefer `moved` blocks over `terraform state mv`.
- Prefer `import` blocks over `terraform state import`.
- Never run state commands without a remote backend and lock.
- If manual surgery is unavoidable: back up state first, use `-dry-run` where available, and have a rollback plan.

## Plan noise reduction

- `-target` is for emergencies, not routine changes. Targeted applies leave state partially updated.
- Avoid `-var` overrides that diverge from CI.
- Use saved plan files so the applied plan is exactly the reviewed one.
- Compare plan counts across environments.

## Zero-downtime review

- Replacements: is `create_before_destroy` applicable? Are names unique?
- Database changes: is the engine/parameter change in-place or replacement?
- Load balancers: are target groups draining correctly? Are health checks preserved?
- DNS: TTL lowered before cutover?
- Autoscaling: will new instances pass health checks with the new config?

## Approval checklist

- [ ] Plan was generated from the intended commit and variables
- [ ] No unexpected replacements or destroys
- [ ] No secrets or plaintext credentials in plan output
- [ ] State backend and workspace are correct (prod vs non-prod)
- [ ] Blast radius and rollback path understood
- [ ] Cost impact reviewed for large changes
- [ ] Apply happens through the approved pipeline or a reviewed saved plan
