import { describe, expect, test } from "bun:test"
import { listMachines, parseMachines, plain, toggleMachine, type Run } from "./machines"

const saved = [
	{ id: "opaque-a", label: "Devbox", target: "devbox", session: "default", enabled: true },
	{ id: "opaque-b", label: "Select", target: "select", session: "default", enabled: false },
]

describe("machine menu", () => {
	test("reads enabled and disabled profiles, ignoring extra CLI fields", async () => {
		const calls: string[][] = []
		const run: Run = async (args) => {
			calls.push(args)
			return JSON.stringify(saved.map((machine) => ({ ...machine, selected: false })))
		}
		expect(await listMachines(run)).toEqual(saved)
		expect(calls).toEqual([["machine", "list", "--json"]])
	})

	test.each([
		["opaque-a", "disable"],
		["opaque-b", "enable"],
	])("toggles %s by ID using fresh state", async (id, action) => {
		const calls: string[][] = []
		const run: Run = async (args) => {
			calls.push(args)
			return args[1] === "list" ? JSON.stringify(saved) : ""
		}
		await toggleMachine(run, id)
		expect(calls).toEqual([["machine", "list", "--json"], ["machine", action, id]])
	})

	test("does not mutate when a machine was removed", async () => {
		const calls: string[][] = []
		const run: Run = async (args) => {
			calls.push(args)
			return "[]"
		}
		await expect(toggleMachine(run, "gone")).rejects.toThrow("removed")
		expect(calls).toEqual([["machine", "list", "--json"]])
	})

	test("never retries a failed mutation", async () => {
		const calls: string[][] = []
		const run: Run = async (args) => {
			calls.push(args)
			if (args[1] === "list") return JSON.stringify(saved)
			throw new Error("failed")
		}
		await expect(toggleMachine(run, "opaque-b")).rejects.toThrow("failed")
		expect(calls).toHaveLength(2)
	})

	test.each([
		"{}",
		"null",
		"[null]",
		JSON.stringify([{ ...saved[0], enabled: "yes" }]),
		JSON.stringify([{ ...saved[0], id: "" }]),
		JSON.stringify([saved[0], saved[0]]),
	])("rejects malformed or duplicate profiles: %s", (value) => {
		expect(() => parseMachines(value)).toThrow()
	})

	test("empty list is valid", () => {
		expect(parseMachines("[]")).toEqual([])
	})

	test("labels and errors cannot inject terminal control sequences", () => {
		expect(plain("\x1b[31mSelect\x1b[0m\n\x07")).toBe("Select  ")
	})
})
