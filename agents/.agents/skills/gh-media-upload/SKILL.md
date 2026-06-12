---
name: gh-media-upload
description: "If you want to upload images or videos to GitHub (PRs, issues, comments), use this skill. Keywords: upload image, attach screenshot, add image to PR, screenshot to issue, upload video, attach video to PR, attach screencast"
---

# Upload Images & Videos to GitHub PRs/Issues

GitHub has **no public API** for uploading images/videos to issues, PRs, or comments.
This skill uses a bun script that replicates the browser upload flow by reading
your `user_session` cookie from Firefox (snap or standard).

URLs produced are `https://github.com/user-attachments/assets/<uuid>` — the same
format as drag-and-drop uploads in the browser. Assets inherit the repository's
visibility (private repo assets require authentication to view).

## Supported file types

Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico`
Videos: `.mp4`, `.webm`, `.mov`, `.avi`, `.mkv`, `.ogg`

## Prerequisites

- Firefox (snap or standard) with an active GitHub session
- `bun` runtime
- `gh` CLI authenticated (used for repo ID lookup and PR/issue commenting)

## Cookie source

The script reads the `user_session` cookie from Firefox's SQLite cookie DB automatically.
Searched locations (in order):
1. `~/snap/firefox/common/.mozilla/firefox/*/cookies.sqlite` (snap)
2. `~/.mozilla/firefox/*/cookies.sqlite` (standard)

Override with env var: `GH_IMAGE_SESSION=<cookie_value>`

## Workflow

> Execute the following steps in order, top to bottom:

### Step 1: Upload the file

```bash
# Upload only — print markdown
bun {baseDir}/scripts/gh-media-upload.ts /path/to/screenshot.png

# Upload a video
bun {baseDir}/scripts/gh-media-upload.ts /path/to/recording.mp4

# Multiple files
bun {baseDir}/scripts/gh-media-upload.ts img1.png video.mp4

# Explicit repo (when not in a git workspace)
bun {baseDir}/scripts/gh-media-upload.ts screenshot.png --repo owner/repo

# Raw URL only
bun {baseDir}/scripts/gh-media-upload.ts screenshot.png --raw

# JSON output
bun {baseDir}/scripts/gh-media-upload.ts screenshot.png --json
```

### Step 2: Attach to PR/issue

**Upload + comment on PR directly (one command):**

```bash
# With PR number
bun {baseDir}/scripts/gh-media-upload.ts screenshot.png --pr 42

# With caption
bun {baseDir}/scripts/gh-media-upload.ts recording.mp4 --pr 42 -m "Here's the fix"
```

**Upload + comment on issue:**

```bash
bun {baseDir}/scripts/gh-media-upload.ts screenshot.png --issue 10
```

**Update PR description with uploaded URL:**

```bash
# Get the URL
URL=$(bun {baseDir}/scripts/gh-media-upload.ts recording.mp4 --raw)

# For videos, use the raw URL directly in the PR body — GitHub renders
# user-attachments video URLs as embedded players automatically
gh pr edit <PR_NUMBER> --body "... 

${URL}

..."
```

## Options

| Flag              | Description                                                    |
| ----------------- | -------------------------------------------------------------- |
| `--repo owner/repo` | Target repository (auto-detected from git remote if omitted) |
| `--pr <number>`   | Comment on PR with uploaded files                              |
| `--issue <number>` | Comment on issue with uploaded files                          |
| `-m <text>`       | Caption/message to include with PR/issue comment               |
| `-r`, `--raw`     | Print raw URLs only, no markdown                               |
| `--json`          | JSON output: `{"fileName","url","markdown"}`                   |
| `-h`, `--help`    | Show help                                                      |

## Environment variables

| Variable            | Description                                    |
| ------------------- | ---------------------------------------------- |
| `GH_IMAGE_SESSION`  | Override: provide `user_session` cookie value directly |

## Output format

- **Images**: `![name](https://github.com/user-attachments/assets/<uuid>)`
- **Videos**: `<video src="https://github.com/user-attachments/assets/<uuid>" controls title="name"></video>`
- **Raw URL in PR body**: GitHub auto-renders `user-attachments` video URLs as embedded players

## Troubleshooting

### `GitHub session expired. Please log into GitHub in Firefox and try again.`

The Firefox `user_session` cookie is expired. Ask the user to open Firefox, log into GitHub, then retry the upload.

### `uploadToken not found on repo page — do you have write access to <repo>?`

If the session is valid but the token is missing, the user may genuinely lack write access to the repository.

## References

- [drogers0/gh-image](https://github.com/drogers0/gh-image) — Go implementation this script is based on
- [GitHub internal upload flow](https://github.com/drogers0/gh-image/blob/main/documentation/github-image-upload-flow.md) — reverse-engineered upload protocol
