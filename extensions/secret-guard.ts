/**
 * Secret Guard Extension
 *
 * Keeps secrets out of the conversation context — and therefore out of the LLM
 * provider and the session files on disk.
 *
 * Layers:
 *   1. Blocks `bash` commands that inline a secret value (TOKEN=sk-...,
 *      --password=hunter2, Authorization: Bearer <literal>, https://user:pw@).
 *      The agent is told to reference an environment variable instead.
 *   2. Redacts known secret values and common secret patterns from every tool
 *      result before it is stored or sent to the model.
 *   3. Redacts known secret values from the message list before each model call
 *      (final safety net for anything that slipped through).
 *
 * Known secrets are loaded from ~/.pi/agent/secrets.env:
 *
 *   # comment
 *   GITHUB_TOKEN=ghp_...
 *   DATABASE_URL=postgres://user:hunter2@host/db
 *
 * Any value 8+ characters long is redacted wherever it appears. Run /secrets to
 * see the current state and reload the file.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SECRETS_FILE = join(homedir(), ".pi", "agent", "secrets.env");

// Patterns redacted from tool output.
const REDACT_PATTERNS: Array<[string, RegExp]> = [
	["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g],
	["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/g],
	["github-token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
	["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
	["stripe-key", /\bs[ck]_(?:live|test)_[0-9a-zA-Z]{16,}\b/g],
	["api-key", /\bsk-[A-Za-z0-9]{20,}\b/g],
	["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
	["basic-auth-url", /\bhttps?:\/\/[^/\s:@]+:[^@\s]+@/g],
	["auth-header", /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]{20,}/g],
];

// Patterns that indicate a secret is being INLINED in a command (blocked).
const INLINE_PATTERNS: Array<[string, RegExp]> = [
	["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
	["basic-auth-url", /\bhttps?:\/\/[^/\s:@]+:[^@\s]+@/],
	["curl-basic-auth", /(?:^|\s)(?:-u|--user)\s+[^\s:@]+:[^\s@]+/],
	["authorization-header", /\bAuthorization\s*[:=]\s*(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]{20,}/i],
	["secret-assignment", /\b(?:PASSWORD|PASSWD|SECRET|TOKEN|API[_-]?KEY|ACCESS[_-]?KEY|SECRET[_-]?KEY|PRIVATE[_-]?KEY)\s*=\s*["']?[A-Za-z0-9+/_!@#$%^&*.-]{8,}/i],
	["password-flag", /(?:^|\s)--password(?:=|\s+)[^\s'"$][^\s]*/i],
];

let knownSecrets: string[] = [];

function loadSecrets(): void {
	knownSecrets = [];
	if (!existsSync(SECRETS_FILE)) return;
	try {
		for (const line of readFileSync(SECRETS_FILE, "utf-8").split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eq = trimmed.indexOf("=");
			const raw = eq >= 0 ? trimmed.slice(eq + 1).trim() : trimmed;
			const value = raw.replace(/^["']|["']$/g, "");
			if (value.length >= 8) knownSecrets.push(value);
		}
	} catch {
		// unreadable file — ignore
	}
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactText(text: string): { text: string; count: number } {
	let out = text;
	let count = 0;
	for (const value of knownSecrets) {
		out = out.replace(new RegExp(escapeRegex(value), "g"), () => {
			count++;
			return "[REDACTED]";
		});
	}
	for (const [label, re] of REDACT_PATTERNS) {
		out = out.replace(re, () => {
			count++;
			return `[REDACTED:${label}]`;
		});
	}
	return { text: out, count };
}

function findInlineSecret(command: string): string | undefined {
	for (const value of knownSecrets) {
		if (command.includes(value)) return "known secret value";
	}
	for (const [label, re] of INLINE_PATTERNS) {
		if (re.test(command)) return label;
	}
	return undefined;
}

function scrub(value: unknown): unknown {
	if (typeof value === "string") {
		if (value.length > 10_000) return value; // skip large blobs (base64, etc.)
		let s = value;
		for (const secret of knownSecrets) {
			if (s.includes(secret)) s = s.split(secret).join("[REDACTED]");
		}
		return s;
	}
	if (Array.isArray(value)) return value.map(scrub);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = scrub(v);
		return out;
	}
	return value;
}

export default function secretGuard(pi: ExtensionAPI): void {
	loadSecrets();

	pi.on("session_start", async () => {
		loadSecrets();
	});

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return undefined;
		const found = findInlineSecret(event.input.command);
		if (!found) return undefined;
		return {
			block: true,
			reason:
				`Secret Guard: this command inlines a secret (${found}). ` +
				"Reference an environment variable ($VAR) or read it from a secrets file instead — never put the value in the command.",
		};
	});

	pi.on("tool_result", async (event, ctx) => {
		let count = 0;
		const content = (event.content ?? []).map((block: Record<string, unknown>) => {
			if (block && block.type === "text" && typeof block.text === "string") {
				const r = redactText(block.text as string);
				count += r.count;
				return { ...block, text: r.text };
			}
			return block;
		});
		if (count > 0) {
			if (ctx.hasUI) ctx.ui.notify(`Secret Guard: redacted ${count} secret(s) from ${event.toolName} output`, "warning");
			return { content };
		}
		return undefined;
	});

	pi.on("context", async (event) => {
		if (knownSecrets.length === 0) return undefined;
		return { messages: scrub(event.messages) };
	});

	pi.registerCommand("secrets", {
		description: "Show Secret Guard status and reload the secrets file",
		handler: async (_args, ctx) => {
			loadSecrets();
			const file = existsSync(SECRETS_FILE) ? SECRETS_FILE : "(missing — create ~/.pi/agent/secrets.env)";
			ctx.ui.notify(`Secret Guard: ${knownSecrets.length} known secret(s). File: ${file}`, "info");
		},
	});
}
