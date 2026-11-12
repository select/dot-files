import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value)

// Pi 1.0.4 recognizes thinkingLevel only for Gemini 3 and Gemma 4.
// Gemini 4 Argon rejects thinkingBudget, including the default -1.
export function fixThinking(payload: unknown, level: string): unknown {
	if (!isRecord(payload) || payload.model !== "gemini-4-argon") return
	if (!isRecord(payload.config) || !isRecord(payload.config.thinkingConfig)) return
	const thinking = payload.config.thinkingConfig
	if (thinking.thinkingLevel !== undefined) return
	const { thinkingBudget: budget, ...rest } = thinking
	const mapped = level === "medium" ? "MEDIUM" : ["high", "xhigh", "max"].includes(level) ? "HIGH" : "LOW"
	return {
		...payload,
		config: {
			...payload.config,
			thinkingConfig: { ...rest, thinkingLevel: budget === 0 ? "LOW" : mapped },
		},
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", (event) => fixThinking(event.payload, pi.getThinkingLevel()))
}
