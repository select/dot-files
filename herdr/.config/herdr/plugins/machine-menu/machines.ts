export interface Machine {
	id: string
	label: string
	target: string
	session: string
	enabled: boolean
}

export type Run = (args: string[]) => Promise<string>

export function parseMachines(output: string): Machine[] {
	const value: unknown = JSON.parse(output)
	if (!Array.isArray(value)) throw new Error("Expected a saved-machine list")
	const ids = new Set<string>()
	return value.map((item: unknown) => {
		if (typeof item !== "object" || item === null) throw new Error("Invalid saved machine")
		const machine = item as Record<string, unknown>
		if (
			typeof machine.id !== "string" || !machine.id ||
			typeof machine.label !== "string" ||
			typeof machine.target !== "string" ||
			typeof machine.session !== "string" ||
			typeof machine.enabled !== "boolean" || ids.has(machine.id)
		) throw new Error("Invalid or duplicate saved machine")
		ids.add(machine.id)
		return {
			id: machine.id,
			label: machine.label,
			target: machine.target,
			session: machine.session,
			enabled: machine.enabled,
		}
	})
}

export async function listMachines(run: Run): Promise<Machine[]> {
	return parseMachines(await run(["machine", "list", "--json"]))
}

// Read fresh state before changing anything. Use opaque IDs, never display labels.
// A failed mutation is not retried: the caller must refresh before another action.
export async function toggleMachine(run: Run, id: string): Promise<string> {
	const machines = await listMachines(run)
	const machine = machines.find((item) => item.id === id)
	if (!machine) throw new Error("Machine was removed. Press R to refresh.")
	const action = machine.enabled ? "disable" : "enable"
	await run(["machine", action, machine.id])
	return `${machine.label}: ${action === "enable" ? "enabled" : "disabled"}`
}

// Machine labels and command errors are untrusted terminal text.
export function plain(text: string): string {
	return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
}
