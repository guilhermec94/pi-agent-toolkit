/**
 * Go Lint Tool
 *
 * Runs golangci-lint and returns grouped, compact diagnostics.
 * Supports both golangci-lint v1 (`--out-format=json`) and v2
 * (`--output.json.path=stdout`).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, truncateTail } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const GoLintParams = Type.Object({
	path: Type.Optional(Type.String({ description: "Package pattern (default: ./...)" })),
	directory: Type.Optional(Type.String({ description: "Working directory relative to cwd" })),
	newOnly: Type.Optional(Type.Boolean({ description: "Only report new issues (--new-from-rev=HEAD)" })),
});

interface LintIssue {
	FromLinter?: string;
	Text?: string;
	Severity?: string;
	Pos?: { Filename?: string; Line?: number; Column?: number };
}

interface LintReport {
	Issues?: LintIssue[];
}

function extractJson(text: string): string | undefined {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start >= 0 && end > start) return text.slice(start, end + 1);
	return undefined;
}

function looksLikeJson(text: string): boolean {
	return extractJson(text) !== undefined;
}

function renderIssues(issues: LintIssue[], exitCode: number, rawOutput: string): string {
	if (issues.length === 0) {
		if (exitCode === 0) return "golangci-lint: no issues found.";
		const raw = truncateHead(rawOutput.trim() || "(no output)", {
			maxLines: DEFAULT_MAX_LINES,
			maxBytes: DEFAULT_MAX_BYTES,
		}).content;
		return `golangci-lint exited with code ${exitCode} but reported no parsed issues.\n\n${raw}`;
	}

	const sorted = [...issues].sort((a, b) => {
		const fileA = a.Pos?.Filename ?? "";
		const fileB = b.Pos?.Filename ?? "";
		if (fileA !== fileB) return fileA.localeCompare(fileB);
		return (a.Pos?.Line ?? 0) - (b.Pos?.Line ?? 0);
	});

	const byFile = new Map<string, LintIssue[]>();
	for (const issue of sorted) {
		const file = issue.Pos?.Filename ?? "(unknown)";
		const list = byFile.get(file) ?? [];
		list.push(issue);
		byFile.set(file, list);
	}

	const errors = issues.filter((issue) => issue.Severity === "error").length;
	const warnings = issues.filter((issue) => issue.Severity === "warning").length;
	const lines: string[] = [
		`${issues.length} issue(s) in ${byFile.size} file(s)` +
			`${errors ? `, ${errors} error(s)` : ""}${warnings ? `, ${warnings} warning(s)` : ""}`,
		"",
	];

	let printed = 0;
	const maxIssues = 250;
	for (const [file, fileIssues] of byFile) {
		lines.push(file);
		for (const issue of fileIssues) {
			if (printed >= maxIssues) break;
			const line = issue.Pos?.Line ?? 0;
			const column = issue.Pos?.Column ?? 0;
			const linter = issue.FromLinter ? ` [${issue.FromLinter}]` : "";
			lines.push(`  ${line}:${column}  ${issue.Text ?? "(no message)"}${linter}`);
			printed += 1;
		}
		lines.push("");
		if (printed >= maxIssues) break;
	}

	if (issues.length > printed) {
		lines.push(`... ${issues.length - printed} more issue(s) omitted.`);
	}

	return lines.join("\n");
}

export default function goLint(pi: ExtensionAPI) {
	pi.registerTool({
		name: "go_lint",
		label: "Go Lint",
		description:
			"Run golangci-lint and return grouped diagnostics with file:line:col, linter name, and message. " +
			"Use this instead of raw golangci-lint output. Requires golangci-lint on PATH.",
		promptSnippet: "Run golangci-lint and summarize diagnostics",
		promptGuidelines: [
			"Use go_lint after Go changes rather than invoking golangci-lint via bash.",
			"Fix go_lint findings by category instead of disabling linters, unless the user asks otherwise.",
		],
		parameters: GoLintParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const directory = params.directory ?? ".";
			const packagePattern = params.path ?? "./...";
			const baseArgs = ["run"];
			if (params.newOnly) baseArgs.push("--new-from-rev=HEAD");
			baseArgs.push(packagePattern);

			const v1 = await pi.exec("golangci-lint", [...baseArgs, "--out-format=json"], {
				cwd: ctx.cwd,
				signal,
				timeout: 10 * 60_000,
			});

			let used = v1;
			let jsonText = v1.stdout;

			if (!looksLikeJson(jsonText)) {
				const v2 = await pi.exec("golangci-lint", [...baseArgs, "--output.json.path=stdout"], {
					cwd: ctx.cwd,
					signal,
					timeout: 10 * 60_000,
				});
				if (looksLikeJson(v2.stdout)) {
					used = v2;
					jsonText = v2.stdout;
				}
			}

			const rawOutput = `${used.stdout}\n${used.stderr}`.trim();

			if (!looksLikeJson(jsonText)) {
				const hint =
					used.code !== 0 && !rawOutput
						? "Is golangci-lint installed and on PATH?"
						: "Could not parse golangci-lint JSON output; showing raw output.";
				const raw = truncateTail(rawOutput || "(no output)", {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				}).content;
				throw new Error(`${hint}\n\n${raw}`);
			}

			let report: LintReport;
			try {
				const json = extractJson(jsonText);
				if (!json) throw new Error("no JSON object found");
				report = JSON.parse(json) as LintReport;
			} catch (error) {
				throw new Error(`Could not parse golangci-lint JSON: ${(error as Error).message}\n\n${rawOutput}`);
			}

			const rendered = renderIssues(report.Issues ?? [], used.code, rawOutput);
			const truncated = truncateHead(rendered, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			});
			const text = truncated.truncated
				? `${truncated.content}\n\n[Output truncated to ${truncated.outputLines} of ${truncated.totalLines} lines.]`
				: rendered;

			return {
				content: [{ type: "text" as const, text }],
				details: {
					exitCode: used.code,
					issueCount: report.Issues?.length ?? 0,
					issues:
						report.Issues?.slice(0, 200).map((issue) => ({
							file: issue.Pos?.Filename,
							line: issue.Pos?.Line,
							column: issue.Pos?.Column,
							linter: issue.FromLinter,
							message: issue.Text,
						})) ?? [],
				},
			};
		},
	});
}
