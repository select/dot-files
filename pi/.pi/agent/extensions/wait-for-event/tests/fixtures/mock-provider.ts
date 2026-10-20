// Local-only integration fixture: no model API/network calls.
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerProvider("wait-event-test", {
		baseUrl: "http://unused.invalid",
		apiKey: "local-test-only",
		api: "wait-event-test-api",
		models: [{ id: "mock", name: "Mock", reasoning: false, input: ["text"],
			contextWindow: 100_000, maxTokens: 1000,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
		streamSimple(model) {
			const stream = createAssistantMessageEventStream();
			const message: AssistantMessage = {
				role: "assistant", api: model.api, provider: model.provider, model: model.id,
				timestamp: Date.now(), stopReason: "stop", content: [{ type: "text", text: "Local fixture finished" }],
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			};
			queueMicrotask(() => {
				stream.push({ type: "start", partial: { ...message, stopReason: "pending", content: [] } });
				stream.push({ type: "done", reason: "stop", message });
				stream.end(message);
			});
			return stream;
		},
	});
	// Deliberately reproduce a resource that keeps Pi alive after the run settles.
	pi.on("session_start", () => { setInterval(() => {}, 1000); });
	pi.on("session_shutdown", async () => { await new Promise(() => {}); });
}
