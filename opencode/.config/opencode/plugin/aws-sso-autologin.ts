import type { Plugin } from "@opencode-ai/plugin"

// TODO: set this to your AWS SSO profile name (or set AWS_PROFILE env var)
const AWS_PROFILE = process.env.AWS_PROFILE ?? process.env.AWS_DEFAULT_PROFILE ?? ""

// TODO: adjust to match your SSO session expiry (in seconds)
const LOGIN_INTERVAL_SECONDS = 60 * 20 // 20 minutes

const COMMAND_NAME = "aws"

const loginCommand = AWS_PROFILE ? `${COMMAND_NAME} sso login --profile ${AWS_PROFILE}` : `${COMMAND_NAME} sso login`

// Start at 0 to guarantee a login on the first aws command
let lastLoginTimestamp = 0

const isLoginStale = (last: number, now: number, staleSeconds: number) => {
	return (now - last) / 1000 >= staleSeconds
}

export const AwsSsoAutoLogin: Plugin = async ({ $ }) => {
	return {
		"tool.execute.before": async (input, output) => {
			if (input.tool !== "bash") return

			const isAwsCommand = output.args.command?.startsWith(COMMAND_NAME)
			if (!isAwsCommand) return

			const now = Date.now()
			if (!isLoginStale(lastLoginTimestamp, now, LOGIN_INTERVAL_SECONDS)) return

			const profile = AWS_PROFILE ? ` (profile: ${AWS_PROFILE})` : ""
			console.log(`[aws-sso-autologin] Refreshing AWS SSO login${profile}...`)
			await $`${loginCommand}`

			lastLoginTimestamp = now
		},
	}
}
