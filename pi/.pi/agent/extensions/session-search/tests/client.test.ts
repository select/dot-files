import { strict as assert } from "node:assert"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { Client, type Config } from "../core.ts"

test("HTTP deadlines abort both stalled headers and a stalled JSON response body", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-history-client-"))
	const server = createServer((request, response) => {
		if (request.url === "/body") {
			response.writeHead(200, { "Content-Type": "application/json" })
			response.write('{"unfinished":')
		}
		// /headers sends nothing; /body never finishes its JSON payload.
	})
	try {
		await writeFile(join(root, "key"), "test-key")
		await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
		const address = server.address()
		assert.ok(address && typeof address === "object")
		const config: Config = { url: `http://127.0.0.1:${address.port}`, index: "pi-history-text-test",
			semanticIndex: "pi-history-neural-test", sourceDir: root, stateDir: root, semanticStateDir: root, apiKeyFile: join(root, "key") }
		const client = new Client(config)
		for (const path of ["/headers", "/body"]) {
			const started = performance.now()
			await assert.rejects(client.request(path, undefined, { timeoutMs: 100 }), error =>
				error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))
			assert.ok(performance.now() - started < 2000, "HTTP response must not outlive its deadline")
		}
		const reason = new Error("cancel before reading credentials")
		await assert.rejects(new Client({ ...config, apiKeyFile: join(root, "missing-key") }).request("/headers", undefined,
			{ signal: AbortSignal.abort(reason) }), error => error === reason)
	} finally {
		server.closeAllConnections()
		await new Promise<void>(resolve => server.close(() => resolve()))
		await rm(root, { recursive: true, force: true })
	}
})
