// Test-only fixture, explicitly loaded by the live Herdr integration tests.
// Inspired by wait-for-event's mock provider and agent_settled supervision.
import { appendFileSync } from "node:fs";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerFlag("worktree-test-events", { type: "string", description: "Test-only lifecycle log" });
  function record(type: string, data = {}) {
    const path = pi.getFlag("worktree-test-events");
    if (typeof path === "string") appendFileSync(path, JSON.stringify({ type, ...data }) + "\n", { mode: 0o600 });
  }
  // Deliberately keep initialization busy after Herdr's early session_start hook.
  pi.on("session_start", async () => { await new Promise((resolve) => setTimeout(resolve, 1000)); });
  pi.on("before_agent_start", (event) => { record("started", { prompt: event.prompt }); });
  pi.on("agent_settled", () => { record("settled"); });
  pi.registerProvider("worktree-tab-test", {
    baseUrl: "http://unused.invalid",
    apiKey: "local-test-only",
    api: "worktree-tab-test-api",
    models: [{ id: "mock", name: "Worktree mock", reasoning: false, input: ["text"],
      contextWindow: 100_000, maxTokens: 1000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model) {
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: "assistant", api: model.api, provider: model.provider, model: model.id,
        timestamp: Date.now(), stopReason: "stop", content: [{ type: "text", text: "WORKTREE_CONTINUATION_OK" }],
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
}
