import { expect, test } from "bun:test"
import { createVertexAnthropicFetch } from "../vertex-auth"

const model = {
	id: "claude-opus-5-5",
	baseUrl: "https://aiplatform.googleapis.com/v1/projects/apheris/locations/global/publishers/anthropic",
}

test("adapts Messages to Vertex while preserving bearer auth, tools, thinking and streaming response", async () => {
	const response = new Response("event: message_stop\ndata: {}\n\n")
	const abort = new AbortController()
	let signal: AbortSignal | undefined
	const adapter = createVertexAnthropicFetch(model, (async (input, init) => {
		expect(String(input)).toBe(`${model.baseUrl}/models/claude-opus-5-5:streamRawPredict`)
		const headers = new Headers(init?.headers)
		expect(headers.get("Authorization")).toBe("Bearer fake-token")
		expect(headers.has("x-api-key")).toBe(false)
		expect(headers.has("anthropic-version")).toBe(false)
		const body = JSON.parse(String(init?.body))
		expect(body.model).toBeUndefined()
		expect(body.betas).toBeUndefined()
		expect(body.anthropic_version).toBe("vertex-2023-10-16")
		expect(body.stream).toBe(true)
		expect(body.thinking).toEqual({ type: "adaptive" })
		expect(body.tools[0].name).toBe("echo")
		expect(body.messages[0].content).toBe("héllo 🌍")
		expect(init?.redirect).toBe("error")
		signal = init?.signal ?? undefined
		return response
	}) as typeof fetch)
	const result = await adapter(`${model.baseUrl}/v1/messages`, {
		method: "POST",
		headers: { Authorization: "Bearer fake-token", "x-api-key": "fake-token", "anthropic-version": "2023-06-01" },
		body: JSON.stringify({ model: model.id, betas: [], stream: true, thinking: { type: "adaptive" }, tools: [{ name: "echo" }], messages: [{ role: "user", content: "héllo 🌍" }] }),
		signal: abort.signal,
	})
	expect(result).toBe(response)
	abort.abort()
	expect(signal?.aborted).toBe(true)
})

test("supports SDK Request inputs and keeps error responses intact", async () => {
	const response = new Response('{"error":{"code":429}}', { status: 429 })
	const adapter = createVertexAnthropicFetch(model, (async (_input, init) => {
		expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fake-token")
		expect(JSON.parse(String(init?.body)).max_tokens).toBe(16)
		return response
	}) as typeof fetch)
	const result = await adapter(new Request(`${model.baseUrl}/v1/messages`, {
		method: "POST", headers: { Authorization: "Bearer fake-token" }, body: JSON.stringify({ max_tokens: 16 }),
	}))
	expect(result).toBe(response)
	expect(result.status).toBe(429)
})

test("rejects unexpected destinations without sending credentials", () => {
	for (const baseUrl of ["https://example.com", model.baseUrl + "?redirect=example.com", model.baseUrl.replace("https:", "http:")]) {
		expect(() => createVertexAnthropicFetch({ ...model, baseUrl })).toThrow("Expected a Google Vertex")
	}
})

test("rejects non-POST and malformed payloads without network requests", async () => {
	const adapter = createVertexAnthropicFetch(model, (async () => { throw new Error("must not send") }) as typeof fetch)
	await expect(adapter(`${model.baseUrl}/v1/messages`)).rejects.toThrow("POST")
	await expect(adapter(`${model.baseUrl}/v1/messages`, { method: "POST", body: "not-json" })).rejects.toThrow()
})
