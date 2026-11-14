/**
 * Project Footer Extension (Go / Terraform tuned)
 *
 * Replaces the built-in footer with pwd + git branch, token/cost stats,
 * Go version, Terraform workspace (when initialized), and extension statuses.
 *
 * Toggle with /footer. Enabled by default.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

function formatTokens(count: number): string {
	if (count < 1000) return `${count}`;
	if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

function hasTerraformFiles(cwd: string): boolean {
	try {
		return readdirSync(cwd).some((name) => name.endsWith(".tf") || name.endsWith(".tofu"));
	} catch {
		return false;
	}
}

export default function projectFooter(pi: ExtensionAPI) {
	let enabled = true;
	let requestRender: (() => void) | undefined;
	let env = { goVersion: "", tfWorkspace: "" };
	let lastRefresh = 0;

	let tokenCacheKey = -1;
	let tokenCache = { input: 0, output: 0, cost: 0 };

	async function refreshEnv(ctx: ExtensionContext): Promise<void> {
		const now = Date.now();
		if (now - lastRefresh < 5000) return;
		lastRefresh = now;

		const next = { goVersion: "", tfWorkspace: "" };

		if (existsSync(join(ctx.cwd, "go.mod"))) {
			const result = await pi.exec("go", ["version"], { cwd: ctx.cwd, timeout: 3000 });
			const match = `${result.stdout}${result.stderr}`.match(/\bgo(\d+\.\d+(?:\.\d+)?)/);
			if (result.code === 0 && match) next.goVersion = `go${match[1]}`;
		}

		if (hasTerraformFiles(ctx.cwd) && existsSync(join(ctx.cwd, ".terraform"))) {
			const result = await pi.exec("terraform", ["workspace", "show"], {
				cwd: ctx.cwd,
				timeout: 3000,
			});
			if (result.code === 0) next.tfWorkspace = result.stdout.trim();
		}

		if (next.goVersion !== env.goVersion || next.tfWorkspace !== env.tfWorkspace) {
			env = next;
			requestRender?.();
		}
	}

	function installFooter(ctx: ExtensionContext): void {
		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: () => {
					unsubscribe();
					if (requestRender) requestRender = undefined;
				},
				invalidate() {},
				render(width: number): string[] {
					const branch = footerData.getGitBranch();
					const sessionName = ctx.sessionManager.getSessionName();

					let pwd = ctx.cwd;
					const home = process.env.HOME || process.env.USERPROFILE;
					if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;

					const location = [
						pwd,
						branch ? `(${branch})` : "",
						sessionName ? `• ${sessionName}` : "",
					]
						.filter(Boolean)
						.join(" ");

					const entries = ctx.sessionManager.getBranch();
					if (entries.length !== tokenCacheKey) {
						tokenCacheKey = entries.length;
						let input = 0;
						let output = 0;
						let cost = 0;
						for (const entry of entries) {
							if (entry.type === "message" && entry.message.role === "assistant") {
								const message = entry.message as AssistantMessage;
								input += message.usage.input;
								output += message.usage.output;
								cost += message.usage.cost.total;
							}
						}
						tokenCache = { input, output, cost };
					}

					const left = [
						`↑${formatTokens(tokenCache.input)}`,
						`↓${formatTokens(tokenCache.output)}`,
						`$${tokenCache.cost.toFixed(3)}`,
						env.tfWorkspace ? `tf:${env.tfWorkspace}` : "",
						env.goVersion,
					]
						.filter(Boolean)
						.join(" ");

					const right = ctx.model?.id || "no-model";
					const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));

					const lines = [
						truncateToWidth(theme.fg("dim", location), width),
						truncateToWidth(theme.fg("dim", left) + " ".repeat(gap) + theme.fg("dim", right), width),
					];

					const statuses = footerData.getExtensionStatuses();
					if (statuses.size > 0) {
						const statusLine = [...statuses.entries()]
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, text]) => text.replace(/[\r\n\t]+/g, " ").trim())
							.join(" ");
						lines.push(truncateToWidth(statusLine, width));
					}

					return lines;
				},
			};
		});
	}

	pi.registerCommand("footer", {
		description: "Toggle the project footer",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (enabled) {
				await refreshEnv(ctx);
				installFooter(ctx);
				ctx.ui.notify("Footer enabled", "info");
			} else {
				ctx.ui.setFooter(undefined);
				requestRender = undefined;
				ctx.ui.notify("Footer disabled", "info");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (enabled && ctx.hasUI) {
			installFooter(ctx);
			await refreshEnv(ctx);
		}
	});

	pi.on("turn_start", async (_event, ctx) => {
		if (enabled) await refreshEnv(ctx);
	});

	pi.on("session_shutdown", async () => {
		requestRender = undefined;
	});
}
