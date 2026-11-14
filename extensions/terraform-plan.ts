/**
 * Terraform Plan Tool
 *
 * Runs `terraform plan -out`, parses the plan JSON, and returns a compact
 * summary instead of dumping the full plan into the context. Apply only
 * works with a plan produced earlier in this session (per directory) and
 * requires interactive confirmation.
 *
 * Tools:
 *   terraform_plan action=plan      create a plan and summarize it
 *   terraform_plan action=apply     apply the last plan for this directory
 *   terraform_plan action=validate  run terraform validate
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, truncateTail } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const TerraformPlanParams = Type.Object({
	action: StringEnum(["plan", "apply", "validate"] as const),
	directory: Type.Optional(Type.String({ description: "Terraform directory relative to cwd (default: cwd)" })),
	destroy: Type.Optional(Type.Boolean({ description: "Create a destroy plan (plan action only)" })),
	varFile: Type.Optional(Type.String({ description: "Path to a .tfvars file (plan action only)" })),
	targets: Type.Optional(
		Type.Array(Type.String(), { description: "Resource addresses to target (plan action only)" }),
	),
	replace: Type.Optional(
		Type.Array(Type.String(), { description: "Resource addresses to force replacement (plan action only)" }),
	),
});

interface ResourceChange {
	address?: string;
	module_address?: string;
	mode?: string;
	type?: string;
	name?: string;
	change?: {
		actions?: string[];
		replace_paths?: Array<Array<string | number>> | null;
	};
}

interface PlanJson {
	terraform_version?: string;
	resource_changes?: ResourceChange[];
	output_changes?: Record<string, { actions?: string[] }>;
}

interface StoredPlan {
	planFile: string;
	tempDir: string;
	summary: string;
	counts: ChangeCounts;
	directory: string;
}

interface ChangeCounts {
	create: number;
	update: number;
	delete: number;
	replace: number;
	read: number;
	noop: number;
}

function classify(actions: string[] | undefined): keyof ChangeCounts {
	const list = actions ?? ["no-op"];
	if (list.length === 2 && list.includes("delete") && list.includes("create")) return "replace";
	if (list.length === 1) {
		switch (list[0]) {
			case "create":
				return "create";
			case "update":
				return "update";
			case "delete":
				return "delete";
			case "read":
				return "read";
			default:
				return "noop";
		}
	}
	return "noop";
}

const SYMBOL: Record<keyof ChangeCounts, string> = {
	create: "+",
	update: "~",
	delete: "-",
	replace: "+/-",
	read: "r",
	noop: "=",
};

function addressOf(change: ResourceChange): string {
	return change.address ?? change.module_address ?? "(unknown)";
}

function replaceReason(change: ResourceChange): string {
	const paths = change.change?.replace_paths;
	if (!paths || paths.length === 0) return "provider requested replacement";
	const attributes = paths.slice(0, 4).map((path) => path.join("."));
	const suffix = paths.length > 4 ? `, +${paths.length - 4} more` : "";
	return `replace_paths: ${attributes.join(", ")}${suffix}`;
}

function summarizePlan(plan: PlanJson, planFile: string, maxChanges: number): { summary: string; counts: ChangeCounts } {
	const counts: ChangeCounts = { create: 0, update: 0, delete: 0, replace: 0, read: 0, noop: 0 };
	const lines: string[] = [];
	const changes = plan.resource_changes ?? [];

	for (const change of changes) {
		const kind = classify(change.change?.actions);
		counts[kind] += 1;
		if (kind === "noop") continue;

		let line = `  ${SYMBOL[kind]} ${addressOf(change)}`;
		if (kind === "replace") line += `  (${replaceReason(change)})`;
		lines.push(line);
	}

	const outputChanges = Object.entries(plan.output_changes ?? {}).filter(([, value]) => {
		const actions = value.actions ?? [];
		return actions.length > 0 && !(actions.length === 1 && actions[0] === "no-op");
	});

	const header =
		`Terraform ${plan.terraform_version ?? ""} plan: ` +
		`${counts.create} to add, ${counts.update} to change, ${counts.delete} to destroy, ${counts.replace} to replace` +
		`${counts.read > 0 ? `, ${counts.read} to read` : ""}.`;

	const visible = lines.slice(0, maxChanges);
	const omitted = lines.length - visible.length;

	const parts = [header, `Plan file: ${planFile}`, ""];
	if (lines.length > 0) {
		parts.push(...visible);
		if (omitted > 0) parts.push(`  ... ${omitted} more resource change(s) omitted`);
	} else {
		parts.push("No resource changes.");
	}

	if (outputChanges.length > 0) {
		parts.push("", "Output changes:");
		for (const [name, value] of outputChanges.slice(0, 20)) {
			parts.push(`  ~ ${name} (${(value.actions ?? []).join("+")})`);
		}
	}

	return { summary: parts.join("\n"), counts };
}

function terraformMissing(result: { stdout: string; stderr: string; code: number }): boolean {
	if (result.code === 0) return false;
	const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
	return text.includes("enoent") || text.includes("not found") || (!text.trim() && result.code === 1);
}

export default function terraformPlan(pi: ExtensionAPI) {
	const plans = new Map<string, StoredPlan>();

	async function cleanup(stored: StoredPlan): Promise<void> {
		await rm(stored.tempDir, { recursive: true, force: true }).catch(() => {});
	}

	async function runPlan(
		directory: string,
		params: { destroy?: boolean; varFile?: string; targets?: string[]; replace?: string[] },
		signal: AbortSignal | undefined,
	): Promise<StoredPlan> {
		const tempDir = await mkdtemp(join(tmpdir(), "pi-tf-plan-"));
		const planFile = join(tempDir, "tfplan");

		const args = ["plan", "-input=false", "-no-color", `-out=${planFile}`];
		if (params.destroy) args.push("-destroy");
		if (params.varFile) args.push(`-var-file=${resolve(directory, params.varFile)}`);
		for (const target of params.targets ?? []) args.push(`-target=${target}`);
		for (const address of params.replace ?? []) args.push(`-replace=${address}`);

		const plan = await pi.exec("terraform", args, { cwd: directory, signal, timeout: 20 * 60_000 });
		if (plan.code !== 0) {
			await rm(tempDir, { recursive: true, force: true }).catch(() => {});
			const detail = truncateTail(`${plan.stdout}\n${plan.stderr}`.trim(), {
				maxLines: 120,
				maxBytes: DEFAULT_MAX_BYTES,
			}).content;
			const hint = terraformMissing(plan)
				? "Is terraform installed and on PATH?"
				: "Hint: run `terraform init` if the backend or providers are not initialized.";
			throw new Error(`terraform plan failed (exit ${plan.code}).\n${hint}\n\n${detail}`);
		}

		const show = await pi.exec("terraform", ["show", "-json", planFile], {
			cwd: directory,
			signal,
			timeout: 5 * 60_000,
		});
		if (show.code !== 0) {
			await rm(tempDir, { recursive: true, force: true }).catch(() => {});
			throw new Error(`terraform show failed (exit ${show.code}).\n${truncateTail(show.stderr, { maxLines: 80, maxBytes: DEFAULT_MAX_BYTES }).content}`);
		}

		let parsed: PlanJson;
		try {
			parsed = JSON.parse(show.stdout) as PlanJson;
		} catch (error) {
			await rm(tempDir, { recursive: true, force: true }).catch(() => {});
			throw new Error(`Could not parse terraform plan JSON: ${(error as Error).message}`);
		}

		const { summary, counts } = summarizePlan(parsed, planFile, 100);
		return { planFile, tempDir, summary, counts, directory };
	}

	pi.registerTool({
		name: "terraform_plan",
		label: "Terraform Plan",
		description:
			"Run, summarize, and apply Terraform plans. action=plan runs `terraform plan -out` and returns a compact " +
			"summary (add/change/destroy/replace counts plus changed resource addresses). action=apply applies the last " +
			"plan created in this session for the directory, after confirmation. action=validate runs `terraform validate`. " +
			"Prefer this over raw `terraform plan` because raw plan output is long and noisy.",
		promptSnippet: "Run, summarize, validate, or apply a Terraform plan",
		promptGuidelines: [
			"Use terraform_plan with action=plan to inspect infrastructure changes instead of running `terraform plan` via bash.",
			"Use terraform_plan with action=apply only after presenting the plan summary to the user and receiving approval.",
			"Never bypass terraform_plan to run `terraform apply` directly unless the user explicitly asks for raw CLI usage.",
		],
		parameters: TerraformPlanParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const directory = resolve(ctx.cwd, params.directory ?? ".");
			const key = directory;

			if (params.action === "validate") {
				const result = await pi.exec("terraform", ["validate", "-no-color"], {
					cwd: directory,
					signal,
					timeout: 5 * 60_000,
				});
				const output = truncateTail(`${result.stdout}\n${result.stderr}`.trim() || "(no output)", {
					maxLines: 120,
					maxBytes: DEFAULT_MAX_BYTES,
				}).content;

				if (result.code !== 0) {
					throw new Error(`terraform validate failed (exit ${result.code}).\n${output}`);
				}
				return {
					content: [{ type: "text" as const, text: `terraform validate: OK\n${output}` }],
					details: { directory, action: "validate" },
				};
			}

			if (params.action === "apply") {
				const stored = plans.get(key);
				if (!stored) {
					throw new Error(
						`No saved plan for ${directory}. Run terraform_plan with action=plan first; apply only uses a plan created in this session.`,
					);
				}

				if (!ctx.hasUI) {
					throw new Error(
						"Refusing to apply Terraform in non-interactive mode. Run the reviewed plan manually or apply through CI.",
					);
				}

				const choice = await ctx.ui.select(
					`Apply this Terraform plan?\n\n${stored.summary}`,
					["Yes, apply it", "No, cancel"],
				);
				if (choice !== "Yes, apply it") {
					return {
						content: [{ type: "text" as const, text: "Apply cancelled by user. The plan file is still available." }],
						details: { directory, action: "apply", applied: false, counts: stored.counts },
					};
				}

				const result = await pi.exec("terraform", ["apply", "-input=false", "-no-color", stored.planFile], {
					cwd: directory,
					signal,
					timeout: 30 * 60_000,
				});

				const output = truncateTail(`${result.stdout}\n${result.stderr}`.trim(), {
					maxLines: 200,
					maxBytes: DEFAULT_MAX_BYTES,
				}).content;

				if (result.code !== 0) {
					throw new Error(`terraform apply failed (exit ${result.code}).\n${output}`);
				}

				plans.delete(key);
				await cleanup(stored);

				return {
					content: [
						{
							type: "text" as const,
							text: `Terraform apply completed.\n\nApplied: ${stored.counts.create} add, ${stored.counts.update} change, ${stored.counts.delete} destroy, ${stored.counts.replace} replace.\n\n${output}`,
						},
					],
					details: { directory, action: "apply", applied: true, counts: stored.counts },
				};
			}

			const previous = plans.get(key);
			if (previous) await cleanup(previous);

			const stored = await runPlan(directory, params, signal);
			plans.set(key, stored);

			return {
				content: [{ type: "text" as const, text: stored.summary }],
				details: {
					directory,
					action: "plan",
					counts: stored.counts,
					planFile: stored.planFile,
				},
			};
		},
	});

	pi.on("session_shutdown", async () => {
		for (const stored of plans.values()) await cleanup(stored);
		plans.clear();
	});
}
