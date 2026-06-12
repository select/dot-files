---
name: video-issue-analyzer
description: "Analyze video attachments from Jira issue reports using Gemini vision. Use this skill when: analyze video, video issue, video bug report, reproduce from video, video analysis, screen recording analysis, video attachment"
---

# Purpose

Fetch a Jira issue, download its video attachments, and launch a non-interactive pi instance with a video-capable model (Gemini) to analyze the video alongside the issue description. Produces a structured summary with observations, reproduction steps, and key screenshots extracted from the video.

## Variables

- **JIRA_URL**: Jira instance URL (from environment)
- **JIRA_USERNAME**: Jira username/email (from environment)
- **JIRA_API_TOKEN**: Jira API token (from environment)
- **Config file**: `{baseDir}/config.json` — configures provider, model, and thinking level
- **Output directory**: `issues/[issueKey]/`

## Config

The `{baseDir}/config.json` file controls which pi provider/model to use:

```json
{
  "provider": "openrouter",
  "model": "google/gemini-2.5-flash",
  "thinking": "low"
}
```

Supported config keys:
- `provider` — pi provider name (e.g., `openrouter`, `google`)
- `model` — model ID (must support video/image input, e.g., Gemini models)
- `thinking` — thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`

## Instructions

When analyzing a video from a Jira issue, you need:

**Required:**
- **Issue identifier**: One of:
  - Issue key: `EN-5298`, `FR-123`
  - Full URL: `https://apheris.atlassian.net/browse/EN-5298`

## Workflow

> Execute the following steps in order, top to bottom:

1. **Determine Issue Identifier**

   **IF** user provides explicit issue identifier (key or URL):
   - Extract issue key from URL or use directly if already in key format
   - Validate format matches `[A-Z]+-\d+` pattern
   - Proceed to step 2

   **ELSE IF** user says "current issue", "this branch", "this ticket", or similar:
   - Get current branch name using `git branch --show-current`
   - Extract issue key from branch name (pattern: `[A-Z]+-\d+`)
   - If no match found, ask user to provide issue identifier explicitly
   - Proceed to step 2

   **ELSE**:
   - Ask user to provide issue identifier

2. **Fetch the Jira Issue**

   Use the fetch-jira-issue skill's script to download the issue and all attachments:

   ```bash
   bun {fetchJiraSkillDir}/scripts/fetch-issue.ts --issue "<ISSUE_KEY>"
   ```

   Where `{fetchJiraSkillDir}` is the path to the `fetch-jira-issue` skill directory (a sibling of this skill's directory).

3. **Identify Video Attachments**

   Check the `issues/<ISSUE_KEY>/` directory for video files:

   ```bash
   find issues/<ISSUE_KEY>/ -type f \( -iname "*.mp4" -o -iname "*.webm" -o -iname "*.mov" -o -iname "*.avi" -o -iname "*.mkv" \)
   ```

   **IF** no video files found:
   - Report to user: "No video attachments found for this issue. The issue has been fetched to `issues/<ISSUE_KEY>/issue.md` — you can review it manually."
   - **STOP** here.

   **IF** video files found:
   - List the videos found
   - Proceed to step 4

4. **Run Video Analysis with pi + Gemini**

   Read the config file to get provider/model settings:

   ```bash
   cat {baseDir}/config.json
   ```

   For **each** video file found, run the analysis script:

   ```bash
   bun {baseDir}/scripts/analyze-video.ts \
     --issue-dir "issues/<ISSUE_KEY>" \
     --video "<VIDEO_FILENAME>" \
     --provider "<PROVIDER>" \
     --model "<MODEL>" \
     --thinking "<THINKING>"
   ```

   This script:
   - Reads `issue.md` from the issue directory
   - Launches `pi --print` with the video file and issue context as `@file` attachments
   - Asks Gemini to analyze the video and produce a structured report
   - Saves the output to `issues/<ISSUE_KEY>/video-analysis-<VIDEO_FILENAME>.md`

5. **Report Results**

   - Show the path to the generated analysis file(s)
   - Display a brief summary of what was found
   - Read and present the analysis content to the user

## Script Reference

### `scripts/analyze-video.ts`

Launches a non-interactive pi instance with Gemini to analyze a video file.

**Arguments:**
- `--issue-dir` — path to the issue directory (e.g., `issues/EN-5298`)
- `--video` — video filename within the issue directory
- `--provider` — pi provider (from config.json)
- `--model` — pi model (from config.json)
- `--thinking` — thinking level (from config.json)

## Output Format

The generated analysis markdown includes:

1. **Header**: Issue key and video filename
2. **Video Summary**: What happens in the video, step by step
3. **Bug/Error Observations**: Any errors, unexpected behavior, or UI issues spotted
4. **Reproduction Steps**: Numbered steps to reproduce what was shown in the video
5. **Key Moments / Screenshots**: Descriptions of important frames (timestamps if visible)
6. **Environment Clues**: Browser, OS, resolution, or other context visible in the video
7. **Suggested Severity**: Based on what was observed

### Directory Structure

```
issues/
└── EN-5298/
    ├── issue.md                              # Fetched issue (from fetch-jira-issue)
    ├── recording.mp4                         # Downloaded video attachment
    ├── screenshot.png                        # Other attachments
    └── video-analysis-recording.mp4.md       # Generated analysis
```

## Cookbook

### Basic Usage

- IF: User provides a Jira issue key or URL
- THEN: Fetch issue, find videos, analyze with Gemini
- EXAMPLES:
  - User: "analyze the video in EN-5298"
  - User: "analyze video from https://apheris.atlassian.net/browse/EN-5298"
  - User: "check the screen recording in this ticket EN-5298"

### Current Branch

- IF: User refers to current branch
- THEN: Extract issue key from branch name
- EXAMPLES:
  - User: "analyze the video for this issue"
  - Agent: Run `git branch --show-current`, extract `EN-5298` → proceed

### Multiple Videos

- IF: Issue has multiple video attachments
- THEN: Analyze each one separately, producing one analysis file per video
- EXAMPLES:
  - User: "analyze all videos in EN-5298"
  - Agent: Runs analyze-video.ts once per video file

### Custom Model

- IF: User wants to use a different model
- THEN: Edit `{baseDir}/config.json` before running, or note they can change it
- EXAMPLES:
  - User: "analyze the video in EN-5298 using gemini-2.5-pro"
  - Agent: Update config or pass override, then proceed
