/**
 * Infra Guard Extension
 *
 * Confirms high-risk infrastructure, cloud, kubernetes, and git commands
 * before the bash tool runs them. Everything is allowed once the user
 * explicitly approves; in non-interactive mode risky commands are blocked.
 *
 * Commands are split into shell segments so a safe command cannot smuggle a
 * dangerous one (e.g. `terraform plan && terraform apply`).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

interface Rule {
	label: string;
	pattern: RegExp;
}

// Commands that mutate or destroy infrastructure / state.
const DANGEROUS_RULES: Rule[] = [
	// Terraform / OpenTofu
	{ label: "terraform apply", pattern: /\b(terraform|tofu)\b[^;&|]*\sapply\b/i },
	{ label: "terraform destroy", pattern: /\b(terraform|tofu)\b[^;&|]*\sdestroy\b/i },
	{
		label: "terraform state mutation",
		pattern: /\b(terraform|tofu)\s+state\s+(rm|mv|push|replace-provider)\b/i,
	},
	{ label: "terraform import", pattern: /\b(terraform|tofu)\s+import\b/i },
	{ label: "terraform init / force-unlock", pattern: /\b(terraform|tofu)\s+(init|force-unlock)\b/i },
	// Other IaC
	{ label: "pulumi destroy/up", pattern: /\bpulumi\s+(destroy|up)\b/i },
	{ label: "serverless remove", pattern: /\bserverless\s+remove\b/i },
	{ label: "sam delete", pattern: /\bsam\s+delete\b/i },
	{ label: "cdk deploy/destroy", pattern: /\bcdk\s+(deploy|destroy)\b/i },
	// Kubernetes
	{ label: "kubectl delete/replace/drain", pattern: /\bkubectl\b[^;&|]*\s(delete|replace|drain|cordon)\b/i },
	{ label: "helm uninstall/delete", pattern: /\bhelm\s+(uninstall|delete)\b/i },
	{ label: "helm rollback", pattern: /\bhelm\s+rollback\b/i },
	// Cloud CLIs
	{
		label: "aws destructive command",
		pattern: /\baws\b[^;&|]*\s(delete|terminate|remove|purge|rb|disable)\b/i,
	},
	{ label: "gcloud destructive command", pattern: /\bgcloud\b[^;&|]*\s(delete|remove)\b/i },
	{ label: "az destructive command", pattern: /\baz\b[^;&|]*\sdelete\b/i },
	// Docker
	{ label: "docker destructive command", pattern: /\bdocker\b[^;&|]*\s(rm|rmi|prune|kill)\b/i },
	// Git
	{ label: "git force push", pattern: /\bgit\s+push\b[^;&|]*(--force|--force-with-lease|\s-f\b)/i },
	{ label: "git reset --hard", pattern: /\bgit\s+reset\s+--hard\b/i },
	{ label: "git clean -f", pattern: /\bgit\s+clean\b[^;&|]*\s-[a-zA-Z]*f/i },
	{ label: "git branch force delete", pattern: /\bgit\s+branch\s+-D\b/i },
	// Local destructive operations
	{ label: "recursive rm", pattern: /\brm\s+(-[^\s]+\s+)*-[a-zA-Z]*r/i },
	{ label: "find -delete", pattern: /\bfind\b[^;&|]*\s-delete\b/i },
	{ label: "sudo", pattern: /\bsudo\b/i },
	{ label: "chmod/chown 777", pattern: /\b(chmod|chown)\b.*\b777\b/i },
	{ label: "go clean -modcache", pattern: /\bgo\s+clean\b[^;&|]*-modcache\b/i },
	{ label: "go mod tidy", pattern: /\bgo\s+mod\s+tidy\b/i },
];

// Read-only or explicitly dry-run invocations should not prompt.
const SAFE_OVERRIDES: Rule[] = [
	{ label: "help", pattern: /(^|\s)(--help|-h)\b/ },
	{ label: "dry run", pattern: /\b(--dry-run|--dryrun|--check)\b/i },
	{ label: "terraform plan", pattern: /\b(terraform|tofu)\b[^;&|]*\splan\b/i },
	{ label: "kubectl diff", pattern: /\bkubectl\s+diff\b/i },
];

function splitSegments(command: string): string[] {
	return command
		.split(/&&|\|\||;|\n|\|/)
		.map((segment) => segment.trim())
		.filter(Boolean);
}

function matchRule(segment: string, rules: Rule[]): Rule | undefined {
	return rules.find((rule) => rule.pattern.test(segment));
}

function summarize(command: string): string {
	const oneLine = command.replace(/\s+/g, " ").trim();
	return oneLine.length > 160 ? `${oneLine.slice(0, 157)}...` : oneLine;
}

export default function infraGuard(pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return undefined;

		const command = event.input.command;
		const segments = splitSegments(command);
		if (segments.length === 0) return undefined;

		const dangerous = new Map<string, Rule>();
		for (const segment of segments) {
			if (matchRule(segment, SAFE_OVERRIDES)) continue;
			const rule = matchRule(segment, DANGEROUS_RULES);
			if (rule) dangerous.set(rule.label, rule);
		}

		if (dangerous.size === 0) return undefined;

		const labels = [...dangerous.keys()].join(", ");

		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `Blocked risky command (${labels}) in non-interactive mode.`,
			};
		}

		ctx.ui.notify(`⚠️  ${labels}`, "warning");

		const choice = await ctx.ui.select(
			`Allow this command?\n\n[${labels}]\n${summarize(command)}`,
			["Yes, run it once", "No, block it"],
		);

		if (choice !== "Yes, run it once") {
			return { block: true, reason: `Blocked by user (${labels}).` };
		}

		return undefined;
	});
}
