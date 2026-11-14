/**
 * Go Test Tool
 *
 * Runs `go test -json`, parses the event stream, and returns compact results:
 * per-package status, failing tests with their output, and coverage.
 * Raw `go test` output is noisy; this keeps the context small.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const GoTestParams = Type.Object({
	packages: Type.Optional(
		Type.String({ description: "Package pattern(s), space-separated (default: ./...)" }),
	),
	run: Type.Optional(Type.String({ description: "Regex for test names (-run)" })),
	race: Type.Optional(Type.Boolean({ description: "Enable the race detector" })),
	cover: Type.Optional(Type.Boolean({ description: "Enable coverage" })),
	short: Type.Optional(Type.Boolean({ description: "Run in short mode" })),
	tags: Type.Optional(Type.String({ description: "Build tags (-tags)" })),
	timeout: Type.Optional(Type.String({ description: "Go test timeout, e.g. 120s (default: 120s)" })),
	count: Type.Optional(Type.Number({ description: "Run each test N times (-count)" })),
	verbose: Type.Optional(Type.Boolean({ description: "Pass -v (JSON output is already verbose)" })),
	directory: Type.Optional(Type.String({ description: "Working directory relative to cwd" })),
});

interface TestEvent {
	Action?: string;
	Package?: string;
	ImportPath?: string;
	Test?: string;
	Elapsed?: number;
	Output?: string;
}

interface TestResult {
	name: string;
	status: "pass" | "fail" | "skip" | "unknown";
	elapsed: number;
	output: string[];
}

interface PackageResult {
	name: string;
	status: "pass" | "fail" | "skip" | "unknown";
	elapsed: number;
	output: string[];
	tests: Map<string, TestResult>;
	coverage?: string;
}

function ensurePackage(map: Map<string, PackageResult>, name: string): PackageResult {
	let pkg = map.get(name);
	if (!pkg) {
		pkg = { name, status: "unknown", elapsed: 0, output: [], tests: new Map(), coverage: undefined };
		map.set(name, pkg);
	}
	return pkg;
}

function appendOutput(target: string[], text: string | undefined): void {
	if (!text) return;
	for (const line of text.split("\n")) {
		if (line.length > 0) target.push(line);
	}
}

function parseCoverage(lines: string[]): string | undefined {
	for (const line of lines) {
		const match = line.match(/coverage:\s*([\d.]+% of statements)/);
		if (match) return match[1];
	}
	return undefined;
}

function buildReport(packages: Map<string, PackageResult>, elapsedMs: number, rawLines: string[], exitCode: number): string {
	const sorted = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
	const failedPackages = sorted.filter((pkg) => pkg.status === "fail");
	const failedTests = sorted.flatMap((pkg) =>
		[...pkg.tests.values()]
			.filter((test) => test.status === "fail")
			.map((test) => ({ pkg: pkg.name, test })),
	);
	const passedTests = sorted.reduce(
		(count, pkg) => count + [...pkg.tests.values()].filter((test) => test.status === "pass").length,
		0,
	);
	const skippedTests = sorted.reduce(
		(count, pkg) => count + [...pkg.tests.values()].filter((test) => test.status === "skip").length,
		0,
	);

	const lines: string[] = [];
	const overall = failedPackages.length === 0 && exitCode === 0 ? "PASS" : "FAIL";
	const duration = elapsedMs >= 1000 ? `${(elapsedMs / 1000).toFixed(1)}s` : `${elapsedMs}ms`;
	lines.push(
		`${overall}: ${passedTests} test(s) passed, ${failedTests.length} failed, ${skippedTests} skipped, ` +
			`${sorted.length} package(s) in ${duration}`,
	);

	if (failedTests.length === 0 && failedPackages.length === 0) {
		for (const pkg of sorted) {
			const coverage = pkg.coverage ? `  coverage ${pkg.coverage}` : "";
			lines.push(`  ok  ${pkg.name}${coverage}`);
		}
		if (rawLines.length > 0) {
			lines.push("", "Raw output:");
			lines.push(...rawLines.slice(-40));
		}
		return lines.join("\n");
	}

	if (failedTests.length > 0) {
		lines.push("", "Failing tests:");
		for (const { pkg, test } of failedTests) {
			lines.push(`--- FAIL: ${test.name} (${test.elapsed.toFixed(2)}s) [${pkg}]`);
			const output = test.output.slice(-40);
			for (const line of output) lines.push(`    ${line}`);
			lines.push("");
		}
	}

	for (const pkg of failedPackages) {
		const packageFailures = [...pkg.tests.values()].filter((test) => test.status === "fail");
		const relevant = packageFailures.length > 0 ? pkg.output.filter((line) => /^(FAIL|panic:|# )/.test(line)) : pkg.output;
		if (relevant.length > 0) {
			lines.push(`--- FAIL package: ${pkg.name}`);
			for (const line of relevant.slice(-60)) lines.push(`    ${line}`);
			lines.push("");
		}
	}

	lines.push("Packages:");
	for (const pkg of sorted) {
		const coverage = pkg.coverage ? `  coverage ${pkg.coverage}` : "";
		const status = pkg.status === "pass" ? "ok  " : pkg.status === "skip" ? "skip" : "FAIL";
		lines.push(`  ${status} ${pkg.name}${coverage}`);
	}

	const failedNames = new Set(failedPackages.map((pkg) => pkg.name));
	const skipped = sorted.filter((pkg) => !failedNames.has(pkg.name) && pkg.status === "skip");
	if (skipped.length > 0) {
		lines.push("", `Skipped packages: ${skipped.map((pkg) => pkg.name).join(", ")}`);
	}

	if (packages.size === 0 && rawLines.length > 0) {
		lines.push("", "Raw output:");
		lines.push(...rawLines.slice(-80));
	}

	return lines.join("\n");
}

export default function goTest(pi: ExtensionAPI) {
	pi.registerTool({
		name: "go_test",
		label: "Go Test",
		description:
			"Run `go test -json` and return a compact summary: package status, failing tests with trimmed output, " +
			"and coverage. Use this instead of raw `go test` when you need to understand failures quickly.",
		promptSnippet: "Run Go tests and summarize failures and coverage",
		promptGuidelines: [
			"Use go_test instead of bash `go test` to get compact failure output.",
			"Use go_test with race=true for concurrency-related changes.",
		],
		parameters: GoTestParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const directory = params.directory ?? ".";
			const packages = (params.packages ?? "./...")
				.split(/\s+/)
				.map((value) => value.trim())
				.filter(Boolean);

			const args = ["test", "-json"];
			if (params.run) args.push(`-run=${params.run}`);
			if (params.race) args.push("-race");
			if (params.cover) args.push("-cover");
			if (params.short) args.push("-short");
			if (params.verbose) args.push("-v");
			if (params.tags) args.push(`-tags=${params.tags}`);
			if (params.count) args.push(`-count=${params.count}`);
			args.push(`-timeout=${params.timeout ?? "120s"}`);
			args.push(...packages);

			const startedAt = Date.now();
			const result = await pi.exec("go", args, {
				cwd: ctx.cwd,
				signal,
				timeout: 20 * 60_000,
			});
			const elapsedMs = Date.now() - startedAt;

			const packagesMap = new Map<string, PackageResult>();
			const rawLines: string[] = [];

			for (const line of result.stdout.split("\n")) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				if (!trimmed.startsWith("{")) {
					rawLines.push(trimmed);
					continue;
				}

				let event: TestEvent;
				try {
					event = JSON.parse(trimmed) as TestEvent;
				} catch {
					rawLines.push(trimmed);
					continue;
				}

				const packageName = event.Package ?? event.ImportPath ?? "(unknown)";
				const pkg = ensurePackage(packagesMap, packageName);

				switch (event.Action) {
					case "output": {
						if (event.Test) {
							let test = pkg.tests.get(event.Test);
							if (!test) {
								test = { name: event.Test, status: "unknown", elapsed: 0, output: [] };
								pkg.tests.set(event.Test, test);
							}
							appendOutput(test.output, event.Output);
						} else {
							appendOutput(pkg.output, event.Output);
						}
						break;
					}
					case "pass":
					case "fail":
					case "skip": {
						if (event.Test) {
							let test = pkg.tests.get(event.Test);
							if (!test) {
								test = { name: event.Test, status: "unknown", elapsed: 0, output: [] };
								pkg.tests.set(event.Test, test);
							}
							test.status = event.Action;
							test.elapsed = event.Elapsed ?? 0;
						} else {
							pkg.status = event.Action;
							pkg.elapsed = event.Elapsed ?? 0;
							pkg.coverage = parseCoverage(pkg.output) ?? pkg.coverage;
						}
						break;
					}
					case "build-fail": {
						pkg.status = "fail";
						break;
					}
					case "build-output": {
						appendOutput(pkg.output, event.Output);
						break;
					}
					default:
						break;
				}
			}

			const stderr = result.stderr.trim();
			if (stderr) {
				rawLines.push(...stderr.split("\n").filter(Boolean));
			}

			const report = buildReport(packagesMap, elapsedMs, rawLines, result.code);
			const truncated = truncateHead(report, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			});

			let text = truncated.content;
			if (truncated.truncated) {
				text += `\n\n[Output truncated to ${truncated.outputLines} of ${truncated.totalLines} lines. Run a narrower -run pattern or read the package output directly.]`;
			}

			const details = {
				exitCode: result.code,
				elapsedMs,
				packages: [...packagesMap.values()].map((pkg) => ({
					name: pkg.name,
					status: pkg.status,
					elapsed: pkg.elapsed,
					coverage: pkg.coverage,
					failedTests: [...pkg.tests.values()]
						.filter((test) => test.status === "fail")
						.map((test) => test.name),
				})),
			};

			if (result.code !== 0) {
				// Return normally so the model sees the structured report; the
				// failure is evident from the summary. Throw only for setup errors.
				if (packagesMap.size === 0) {
					throw new Error(`go test failed to run (exit ${result.code}).\n${text}`);
				}
			}

			return {
				content: [{ type: "text" as const, text }],
				details,
			};
		},
	});
}
