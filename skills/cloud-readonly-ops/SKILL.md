---
name: cloud-readonly-ops
description: Safe read-only AWS, GCP, and Azure CLI workflows for investigation, inventory, and incident triage. Use when inspecting cloud resources, profiles, regions, or logs without mutating infrastructure.
---

# Cloud Read-Only Operations

## Ground rules

- Default to read-only verbs: `describe`, `list`, `get`, `show`, `logs`, `tail`.
- Confirm the account/project and region before any command.
- Use `--dry-run` where supported; it is not available everywhere.
- Never paste credentials into commands; use profiles, SSO, or workload identity.
- Destructive verbs (`delete`, `terminate`, `remove`, `purge`, `rb`, `destroy`) require explicit approval.
- Treat any command that creates, updates, or tags resources as a write.

## Identity and context

```bash
aws sts get-caller-identity
aws configure list
aws configure list-profiles

gcloud config list
gcloud auth list
gcloud projects list

az account show
az account list --output table
```

For AWS SSO: `aws sso login --profile <p>`.

## Region and profile selection

```bash
aws --profile <p> --region <r> <service> <read-verb> ...
AWS_PROFILE=<p> AWS_REGION=<r> aws ...
```

Always pass `--region` explicitly in scripts; do not rely on ambient config.

## Pagination

AWS CLI auto-paginates by default. For manual control:

```bash
aws ec2 describe-instances --no-paginate
aws s3api list-objects-v2 --bucket b --max-items 100 --starting-token <token>
```

GCP:

```bash
gcloud compute instances list --format=json --limit=100
```

Azure:

```bash
az vm list --query '[].{name:name,rg:resourceGroup}' -o table
```

## Useful read-only queries

```bash
# AWS inventory and triage
aws ec2 describe-instances \
  --query 'Reservations[].Instances[].{id:InstanceId,state:State.Name,type:InstanceType,az:Placement.AvailabilityZone}' \
  --output table

aws logs tail /aws/lambda/function --follow --since 30m
aws cloudwatch get-metric-statistics ...
aws s3api get-bucket-encryption --bucket b
aws s3api get-bucket-policy --bucket b
aws iam get-role --role-name r
aws iam list-attached-role-policies --role-name r

# GCP
gcloud compute instances describe <name> --zone <z>
gcloud logging read 'resource.type="gce_instance"' --limit 50 --format json

# Azure
az vm show -g <rg> -n <name>
az monitor activity-log list --resource-id <id> --offset 1h
```

## Safety checks before running anything

1. What account/project and region am I pointed at?
2. Is the verb read-only?
3. Could this command create, delete, or modify anything? (`aws s3 sync` writes.)
4. Is the output going to be huge? Use `--query`, `--limit`, or `--max-items`.
5. Am I about to expose secrets? Redact before sharing.

## High-risk verbs to avoid without approval

- AWS: `delete-*`, `terminate-instances`, `remove-*`, `purge-*`, `rb`, `put-*`, `update-*`, `modify-*`, `create-*`
- GCP: `delete`, `remove`, `update`, `create`
- Azure: `delete`, `update`, `create`
- Kubernetes: `delete`, `drain`, `cordon`, `apply`, `replace`, `patch`, `scale`

## Incident triage order

1. Confirm identity/account and time window.
2. Check recent deployments and config changes (CI, Terraform apply history).
3. Inspect service health metrics and logs.
4. Check dependency health (DB, queue, DNS, certificates).
5. Check quota/throttling and IAM changes.
6. Only then consider remediation; prefer rollback over ad-hoc mutation.

## Output hygiene

- Pipe through `jq` or `--query` to reduce noise.
- Save large outputs to a file and summarize.
- Redact account IDs, emails, tokens, and ARNs when sharing outside the team.
- Keep exact command lines in incident notes for reproducibility.
