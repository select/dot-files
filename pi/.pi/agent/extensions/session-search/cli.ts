import { Client, formatResults, indexCoverage, loadConfig, search, type SearchMode } from "./core.ts"
import { Indexer } from "./indexer.ts"

const config = await loadConfig()
const client = new Client(config)
const [command, ...args] = process.argv.slice(2)
const abort = new AbortController()
process.once("SIGINT", () => abort.abort())
process.once("SIGTERM", () => abort.abort())

try {
	if (command === "sync" || command === "sync-neural") {
		const neural = command === "sync-neural"
		const target = neural ? { ...config, index: config.semanticIndex, stateDir: config.semanticStateDir } : config
		console.log(JSON.stringify(await new Indexer(target, new Client(target), neural).sync({ signal: abort.signal,
			progress: message => console.error(message) }), null, 2))
	} else if (command === "search") {
		const modes = ["keyword", "semantic", "hybrid"]
		const mode = modes.includes(args[0]) ? args.shift() as SearchMode : "hybrid"
		console.log(formatResults(await search(client, { query: args.join(" "), mode }, abort.signal)))
	} else if (command === "status") {
		console.log(JSON.stringify(await indexCoverage(client)))
	} else {
		throw new Error("Usage: bun cli.ts sync | sync-neural | status | search [keyword|semantic|hybrid] <query>")
	}
} catch (error) {
	console.error(String(error))
	process.exitCode = 1
}
