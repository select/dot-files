/**
 * Vertex Auth Extension
 *
 * The `vertex` and `vertex-global` providers in models.json resolve their API key
 * via `!gcloud auth application-default print-access-token`. Those Application
 * Default Credentials (ADC) expire and eventually need an interactive re-login,
 * which fails mid-request with:
 *
 *   Failed to resolve API key for provider "vertex-global" from shell command:
 *   gcloud auth application-default print-access-token
 *
 * This extension pre-flights the token whenever a vertex* model becomes active
 * (session start / model switch / prompt submit) and, if it is stale, offers to
 * run `gcloud auth application-default login` (which opens a browser) before any
 * request fails. Also exposes `/vertex-login` for a manual refresh.
 *
 * Debug logging is written to ~/.pi/agent/vertex-auth.log
 */

import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const VERTEX_PREFIX = "vertex";
const PRINT_TOKEN = ["auth", "application-default", "print-access-token"];
const LOGIN = ["auth", "application-default", "login"];
const LOG_FILE = join(homedir(), ".pi", "agent", "vertex-auth.log");

type ExecResult = { stdout: string; stderr: string; code: number; killed?: boolean };

const log = (msg: string, data?: unknown): void => {
	const line = `[${new Date().toISOString()}] ${msg}${data !== undefined ? " " + JSON.stringify(data) : ""}\n`;
	try {
		appendFileSync(LOG_FILE, line);
	} catch {
		// ignore logging failures
	}
};

export default function (pi: ExtensionAPI) {
	log("extension factory loaded");
	let inFlight = false;

	const exec = (args: string[], timeout: number): Promise<ExecResult> =>
		pi
			.exec("gcloud", args, { timeout })
			.then((r) => {
				log("exec resolved", { args, code: (r as ExecResult).code, killed: (r as ExecResult).killed });
				return r as ExecResult;
			})
			.catch((err) => {
				log("exec threw", { args, err: String(err?.message ?? err) });
				return { stdout: "", stderr: String(err?.message ?? err), code: 1 };
			});

	const tokenValid = async (): Promise<boolean> => {
		const r = await exec(PRINT_TOKEN, 15000);
		const valid = r.code === 0 && r.stdout.trim().length > 0;
		log("tokenValid", { valid, code: r.code, stderr: r.stderr.trim().slice(0, 200) });
		return valid;
	};

	const relogin = async (ctx: ExtensionContext): Promise<boolean> => {
		log("relogin start");
		ctx.ui.setStatus("vertex-auth", "gcloud login… (check your browser)");
		// Long timeout: the user has to complete the OAuth consent in the browser.
		const r = await exec(LOGIN, 5 * 60 * 1000);
		ctx.ui.setStatus("vertex-auth", undefined);
		log("relogin done", { code: r.code, stderr: r.stderr.trim().slice(0, 300) });

		if (r.code === 0) {
			ctx.ui.notify("Vertex ADC refreshed ✓", "info");
			return true;
		}
		const detail = (r.stderr || r.stdout).trim().slice(0, 240);
		ctx.ui.notify(`gcloud login failed: ${detail || "unknown error"}`, "error");
		return false;
	};

	const ensureAuth = async (ctx: ExtensionContext, provider: string | undefined, where: string): Promise<void> => {
		log("ensureAuth", { where, provider, hasUI: ctx.hasUI, mode: ctx.mode, inFlight });
		if (!provider?.startsWith(VERTEX_PREFIX)) {
			log("ensureAuth skip: not a vertex provider", { provider });
			return;
		}
		if (!ctx.hasUI) {
			log("ensureAuth skip: not interactive");
			return; // login needs a human + browser
		}
		if (inFlight) {
			log("ensureAuth skip: already inFlight");
			return;
		}

		inFlight = true;
		try {
			if (await tokenValid()) {
				log("ensureAuth: token still valid, nothing to do");
				return;
			}

			log("ensureAuth: prompting user to login");
			const ok = await ctx.ui.confirm(
				"Vertex credentials expired",
				"Run `gcloud auth application-default login` now? This opens a browser.",
			);
			log("ensureAuth: confirm result", { ok });
			if (ok) await relogin(ctx);
		} finally {
			inFlight = false;
		}
	};

	// Primary gate: fires when the user submits a prompt, with the model
	// definitely active. pi awaits this before starting the agent loop, so the
	// login completes before any provider request is attempted.
	pi.on("before_agent_start", async (_event, ctx) => {
		log("event: before_agent_start", { model: ctx.model });
		await ensureAuth(ctx, ctx.model?.provider, "before_agent_start");
	});

	// Best-effort early checks (ctx.model may be unset this early at startup).
	pi.on("session_start", async (_event, ctx) => {
		log("event: session_start", { model: ctx.model });
		await ensureAuth(ctx, ctx.model?.provider, "session_start");
	});

	pi.on("model_select", async (event, ctx) => {
		log("event: model_select", { eventModel: event.model, source: (event as { source?: string }).source });
		await ensureAuth(ctx, event.model?.provider, "model_select");
	});

	pi.registerCommand("vertex-login", {
		description: "Refresh gcloud Application Default Credentials for Vertex providers",
		handler: async (_args, ctx) => {
			log("command: /vertex-login", { hasUI: ctx.hasUI, mode: ctx.mode });
			if (!ctx.hasUI) {
				ctx.ui.notify("Run /vertex-login in interactive mode", "warning");
				return;
			}
			await relogin(ctx);
		},
	});
}
