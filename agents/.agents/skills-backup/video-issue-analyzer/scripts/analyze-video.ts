#!/usr/bin/env bun
/**
 * Analyze a video attachment from a Jira issue using pi + Gemini.
 *
 * Usage:
 *   bun analyze-video.ts \
 *     --issue-dir "issues/EN-5298" \
 *     --video "recording.mp4" \
 *     --provider "openrouter" \
 *     --model "google/gemini-2.5-flash" \
 *     --thinking "low"
 */

import { writeFile } from "fs/promises"
import { join, basename } from "path"
import { parseArgs } from "util"
import { existsSync } from "fs"

const ANALYSIS_PROMPT = `You are analyzing a video attachment from a bug/issue report. The video is a screen recording showing a problem or unexpected behavior in a web application.

You will receive:
1. The Jira issue description and metadata (as a markdown file)
2. The video file itself

Your task is to carefully watch the entire video and produce a structured analysis. Do NOT attempt to fix the issue — only document what you observe.

## Output Format

Produce a markdown document with these sections:

### Video Summary
Describe step-by-step what happens in the video. Be specific about UI elements, clicks, navigations, and what appears on screen.

### Bug / Error Observations
List every error, unexpected behavior, broken UI element, or anomaly you spot. Include:
- Error messages (quote them exactly if visible)
- UI glitches or layout issues
- Failed operations or unexpected responses
- Console errors if the dev tools are visible

### Reproduction Steps
Based on what you see in the video, write numbered steps that someone could follow to reproduce the issue. Be specific about:
- Starting URL or page
- Exact clicks and inputs
- Expected vs actual behavior at each step

### Key Moments
Describe the most important frames/moments in the video. For each:
- Approximate timestamp or position (e.g., "at the beginning", "around the middle", "near the end")
- What is visible on screen
- Why this moment is significant

### Environment Clues
Note any visible information about the environment:
- Browser (Chrome, Firefox, Safari, etc.)
- OS indicators
- Screen resolution or viewport size
- URLs visible in the address bar
- User account or role information
- Any version numbers visible

### Suggested Severity
Based on your observations, suggest a severity level:
- **Critical**: Application crash, data loss, security issue
- **High**: Core functionality broken, no workaround
- **Medium**: Feature broken but workaround exists, or non-core feature affected
- **Low**: Cosmetic issue, minor inconvenience

Include a brief justification for your severity assessment.`

async function main() {
	const { values } = parseArgs({
		options: {
			"issue-dir": { type: "string" },
			video: { type: "string", short: "v" },
			provider: { type: "string", short: "p" },
			model: { type: "string", short: "m" },
			thinking: { type: "string", short: "t" },
			help: { type: "boolean", short: "h" },
		},
	})

	if (values.help || !values["issue-dir"] || !values.video) {
		console.log(`
Usage: bun analyze-video.ts --issue-dir <dir> --video <filename> [options]

Arguments:
  --issue-dir      Path to the issue directory (e.g., issues/EN-5298)
  --video, -v      Video filename within the issue directory
  --provider, -p   Pi provider (default: openrouter)
  --model, -m      Pi model (default: google/gemini-2.5-flash)
  --thinking, -t   Thinking level (default: low)
  --help, -h       Show this help message

Examples:
  bun analyze-video.ts --issue-dir "issues/EN-5298" --video "recording.mp4"
  bun analyze-video.ts --issue-dir "issues/EN-5298" --video "recording.mp4" --provider google --model gemini-2.5-pro
`)
		process.exit(values.help ? 0 : 1)
	}

	const issueDir = values["issue-dir"]
	const videoFile = values.video
	const provider = values.provider || "openrouter"
	const model = values.model || "google/gemini-2.5-flash"
	const thinking = values.thinking || "low"

	const videoPath = join(issueDir, videoFile)
	const issueMdPath = join(issueDir, "issue.md")

	if (!existsSync(videoPath)) {
		console.error(`Video file not found: ${videoPath}`)
		process.exit(1)
	}

	if (!existsSync(issueMdPath)) {
		console.error(`Issue markdown not found: ${issueMdPath}`)
		console.error("Run fetch-jira-issue first to download the issue.")
		process.exit(1)
	}

	const issueKey = basename(issueDir)
	const outputFile = join(issueDir, `video-analysis-${videoFile}.md`)

	console.log(`\nAnalyzing video for ${issueKey}...`)
	console.log(`  Video: ${videoPath}`)
	console.log(`  Issue: ${issueMdPath}`)
	console.log(`  Provider: ${provider}`)
	console.log(`  Model: ${model}`)
	console.log(`  Thinking: ${thinking}`)
	console.log(`  Output: ${outputFile}`)
	console.log()

	// Build the pi command
	// We pass the issue markdown and video as @file attachments
	// and provide the analysis prompt as the message
	const piPrompt = `${ANALYSIS_PROMPT}

---

Now analyze the attached video file (\`${videoFile}\`) in the context of the Jira issue description provided.
Produce the full structured analysis as described above.`

	try {
		const atIssue = `@${issueMdPath}`
		const atVideo = `@${videoPath}`
		const proc = Bun.spawn(
			[
				"pi",
				"--provider", provider,
				"--model", model,
				"--thinking", thinking,
				"--no-tools",
				"--no-session",
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"-p",
				atIssue,
				atVideo,
				piPrompt,
			],
			{
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env },
			},
		)

		const result = await new Response(proc.stdout).text()
		const stderr = await new Response(proc.stderr).text()
		const exitCode = await proc.exited

		if (exitCode !== 0) {
			console.error(`pi exited with code ${exitCode}`)
			if (stderr) console.error(stderr)
			process.exit(1)
		}

		// Write the analysis output
		const header = `# Video Analysis: ${issueKey} — ${videoFile}\n\n`
		const content = header + result.trim() + "\n"
		await writeFile(outputFile, content, "utf-8")

		console.log(`\nAnalysis saved to: ${outputFile}`)
		console.log(`\n--- Analysis Preview (first 40 lines) ---\n`)

		const lines = content.split("\n")
		console.log(lines.slice(0, 40).join("\n"))
		if (lines.length > 40) {
			console.log(`\n... (${lines.length - 40} more lines, see full file)`)
		}
	} catch (error) {
		console.error(`\nFailed to run pi analysis:`)
		console.error(error instanceof Error ? error.message : String(error))
		console.error(`\nTroubleshooting:`)
		console.error(`  1. Check that the provider "${provider}" has a valid API key configured`)
		console.error(`  2. Check that the model "${model}" supports video input`)
		console.error(`  3. Try: pi --provider ${provider} --list-models gemini`)
		process.exit(1)
	}
}

main()
