import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { Client, documents, parseSession, validateSessionFile, XerjHttpError, type Config } from "./core.ts"

const VERSION = 1
interface FileState { size: number; mtimeMs: number; ids: string[]; invalidLines: number }
interface Manifest { version: number; index: string; files: Record<string, FileState> }
export interface SyncReport {
	files: number
	changed: number
	deleted: number
	passages: number
	invalidLines: number
	seconds: number
}

export class SyncBusyError extends Error {}
export class SyncBackpressureError extends Error {
	constructor() { super("XERJ is temporarily over its resource budget. History sync is deferred; pending changes are preserved for retry.") }
}

export async function acquireLock(stateDir: string): Promise<() => Promise<void>> {
	await mkdir(stateDir, { recursive: true, mode: 0o700 })
	const lock = join(stateDir, "sync.lock")
	const ownerFile = join(lock, "owner.json")
	try {
		await mkdir(lock, { mode: 0o700 })
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
		const owner = await readFile(ownerFile, "utf8").catch(() => "unknown")
		// Never auto-steal a lock: two reclaimers could remove a new owner's lock.
		throw new SyncBusyError(`History sync is locked (${owner}). If its process died, remove ${ownerFile} and the empty ${lock} directory before retrying.`)
	}
	await writeFile(ownerFile, JSON.stringify({ pid: process.pid }), { mode: 0o600 })
	return async () => { await unlink(ownerFile); await rmdir(lock) }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
	const temporary = `${path}.${randomUUID()}.tmp`
	await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
	await rename(temporary, path)
}

async function sessionFiles(root: string): Promise<string[]> {
	const result: string[] = []
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = join(root, entry.name)
		if (entry.isDirectory()) result.push(...await sessionFiles(path))
		if (entry.isFile() && entry.name.endsWith(".jsonl")) result.push(path)
	}
	return result.sort()
}

export class Indexer {
	constructor(readonly config: Config, readonly client = new Client(config), readonly neural = false,
		readonly retry: { maxRetries?: number; baseDelayMs?: number } = {}) {}

	async ensureIndex(signal?: AbortSignal): Promise<boolean> {
		try {
			await this.client.request(`/${this.config.index}/_mapping`, undefined, { signal })
			return false
		} catch (error) {
			if (!(error instanceof Error) || !error.message.startsWith("XERJ HTTP 404:")) throw error
		}
		const properties: Record<string, unknown> = Object.fromEntries(
			["sessionId", "sessionFile", "project", "entryId", "parentId", "role"].map(key => [key, { type: "keyword" }]))
		Object.assign(properties, { title: { type: "text" }, body: this.neural ? { type: "semantic_text", dimensions: 384 } : { type: "text" },
			line: { type: "integer" }, part: { type: "integer" }, timestamp: { type: "date" } })
		if (this.neural) properties.body_vector = { type: "dense_vector", dims: 384, similarity: "cosine" }
		await this.client.request(`/${this.config.index}`, { mappings: { properties } }, { method: "PUT", signal })
		return true
	}

	async bulk(lines: unknown[], signal?: AbortSignal): Promise<void> {
		if (!lines.length) return
		type Item = { status: number; error?: unknown }
		type Response = { items?: Record<string, Item>[] }
		let pending: unknown[][] = []
		for (let i = 0; i < lines.length; i++) {
			const action = lines[i]
			if (!action || typeof action !== "object") throw new Error("Invalid bulk action")
			if ("delete" in action) pending.push([action])
			else if ("index" in action && i + 1 < lines.length) pending.push([action, lines[++i]])
			else throw new Error("Unsupported or incomplete bulk action")
		}
		for (let attempt = 0; ; attempt++) {
			signal?.throwIfAborted()
			let result: Response | undefined
			let retryAfterMs = 0
			try {
				result = await this.client.request<Response>("/_bulk", pending.flat().map(line => JSON.stringify(line)).join("\n") + "\n", { signal, ndjson: true, timeoutMs: 60_000 })
			} catch (error) {
				if (!(error instanceof XerjHttpError) || ![429, 503].includes(error.status)) throw error
				retryAfterMs = error.retryAfterMs ?? 0
				// Non-2xx bulk bodies may still contain successful items: do not replay those.
				const body = error.body as Response | undefined
				if (body && Array.isArray(body.items) && body.items.length) result = body
			}
			if (result) {
				if (!Array.isArray(result.items) || result.items.length !== pending.length) throw new Error("XERJ returned an incomplete bulk response; pending file retained for recovery")
				const rejected: unknown[][] = []
				for (let i = 0; i < result.items.length; i++) {
					const item = Object.values(result.items[i])[0]
					if (!item || !Number.isInteger(item.status) || item.status < 100 || item.status > 599) throw new Error("XERJ returned an invalid bulk item")
					if ([429, 503].includes(item.status)) { rejected.push(pending[i]); continue }
					// A delete of an already-absent ID is an idempotent success.
					if (item.error || (item.status >= 400 && !(item.status === 404 && "delete" in (pending[i][0] as object)))) {
						throw new Error(`Indexing failed (HTTP ${item.status}): ${(JSON.stringify(item.error) || "request rejected").slice(0, 500)}`)
					}
				}
				pending = rejected
				if (!pending.length) return
			}
			if (attempt >= (this.retry.maxRetries ?? 5)) throw new SyncBackpressureError()
			const backoff = Math.min(8000, (this.retry.baseDelayMs ?? 500) * 2 ** attempt)
			await delay(Math.min(8000, Math.max(backoff, retryAfterMs)), undefined, { signal })
		}
	}

	async remove(ids: string[], signal?: AbortSignal): Promise<void> {
		for (let start = 0; start < ids.length; start += 200) {
			await this.bulk(ids.slice(start, start + 200).map(id => ({ delete: { _index: this.config.index, _id: id } })), signal)
		}
	}

	async sync(options: { file?: string; signal?: AbortSignal; progress?: (message: string) => void } = {}): Promise<SyncReport> {
		const release = await acquireLock(this.config.stateDir)
		const started = performance.now()
		try {
			const manifestFile = join(this.config.stateDir, "manifest.json")
			const saved = await readFile(manifestFile, "utf8").catch((e: NodeJS.ErrnoException) => {
				if (e.code !== "ENOENT") throw e
				return "null"
			})
			let manifest = JSON.parse(saved) as Manifest | null
			const fresh = await this.ensureIndex(options.signal)
			if (fresh || !manifest) manifest = { version: VERSION, index: this.config.index, files: {} }
			if (manifest.version !== VERSION || manifest.index !== this.config.index) throw new Error("Index schema changed: configure a new pi-history-* index and a new stateDir")
			const journalFile = join(this.config.stateDir, "journal.jsonl")
			const pendingFile = join(this.config.stateDir, "pending.json")
			const journal = await readFile(journalFile, "utf8").catch((e: NodeJS.ErrnoException) => {
				if (e.code !== "ENOENT") throw e
				return ""
			})
			if (!fresh) for (const line of journal.split("\n").filter(Boolean)) {
				const entry = JSON.parse(line) as { path: string; state: FileState | null }
				if (entry.state) manifest.files[entry.path] = entry.state
				if (!entry.state) delete manifest.files[entry.path]
			}
			const pending = await readFile(pendingFile, "utf8").then(text => JSON.parse(text) as { path: string; ids: string[] }).catch((e: NodeJS.ErrnoException) => {
				if (e.code !== "ENOENT") throw e
				return undefined
			})
			if (pending) {
				await this.remove(pending.ids, options.signal)
				delete manifest.files[pending.path]
				await appendFile(journalFile, JSON.stringify({ path: pending.path, state: null }) + "\n", { mode: 0o600 })
				await unlink(pendingFile)
			}
			const paths = options.file ? [await validateSessionFile(this.config, options.file)] : await sessionFiles(resolve(this.config.sourceDir))
			const report: SyncReport = { files: paths.length, changed: 0, deleted: 0, passages: 0, invalidLines: 0, seconds: 0 }
			let processed = 0
			for (const path of paths) {
				options.signal?.throwIfAborted()
				const info = await stat(path)
				const old = manifest.files[path]
				if (old && old.size === info.size && old.mtimeMs === info.mtimeMs) {
					processed++
					continue
				}
				const parsed = await parseSession(path, options.signal)
				// Longer passages cause XERJ to persist chunk vectors and disable HNSW globally.
				const docs = documents(parsed, this.neural ? 512 : 1000)
				const ids = docs.map(doc => doc.id)
				// Recovery can remove every partially written ID before retrying this file.
				await atomicWrite(pendingFile, { path, ids: [...new Set([...(old?.ids || []), ...ids])] })
				// Small batches bound neural inference memory and cancellation latency.
				const batchSize = this.neural ? 4 : 32
				for (let start = 0; start < docs.length; start += batchSize) {
					await this.bulk(docs.slice(start, start + batchSize).flatMap(doc => [
						{ index: { _index: this.config.index, _id: doc.id } }, doc.source,
					]), options.signal)
				}
				const current = new Set(ids)
				await this.remove((old?.ids || []).filter(id => !current.has(id)), options.signal)
				manifest.files[path] = { size: info.size, mtimeMs: info.mtimeMs, ids, invalidLines: parsed.invalidLines }
				await appendFile(journalFile, JSON.stringify({ path, state: manifest.files[path] }) + "\n", { mode: 0o600 })
				await unlink(pendingFile)
				report.changed++
				processed++
				options.progress?.(`${processed}/${paths.length} sessions checked; ${report.changed} updated`)
			}
			if (!options.file) {
				const current = new Set(paths)
				for (const path of Object.keys(manifest.files)) {
					if (current.has(path)) continue
					await this.remove(manifest.files[path].ids, options.signal)
					await appendFile(journalFile, JSON.stringify({ path, state: null }) + "\n", { mode: 0o600 })
					delete manifest.files[path]
					report.deleted++
				}
			}
			if (report.changed || report.deleted) await this.client.request(`/${this.config.index}/_refresh`, {}, { signal: options.signal })
			await atomicWrite(manifestFile, manifest)
			await writeFile(journalFile, "", { mode: 0o600 })
			for (const state of Object.values(manifest.files)) {
				report.passages += state.ids.length
				report.invalidLines += state.invalidLines
			}
			report.files = Object.keys(manifest.files).length
			report.seconds = Math.round((performance.now() - started) / 10) / 100
			return report
		} finally {
			await release()
		}
	}
}
