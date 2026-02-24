# AGENTS.md - Dotfiles Repository

This is a **dotfiles repository** containing personal configuration files for various development tools. It is NOT a single programming project but a collection of configs organized by tool/application.

## Repository Structure

```
dot-files/
├── awesome/          # AwesomeWM window manager (Lua)
├── git/              # Git configuration
├── mpv/              # MPV media player config
├── opencode/         # OpenCode AI tool configuration (TypeScript/Python)
├── opencode-code/    # Git submodule - OpenCode source (Bun monorepo)
├── tmux/             # Tmux terminal multiplexer
├── zed/              # Zed editor configuration
└── zsh/              # Zsh shell configuration
```

## Build/Lint/Test Commands

### Root Level

No centralized build system - this is a dotfiles collection. Work within specific subdirectories.

### OpenCode Plugins (`opencode/.config/opencode/`)

```bash
bun install                    # Install dependencies
bun run <plugin>.ts            # Run a TypeScript plugin directly
```

### OpenCode Source (`opencode-code/` submodule)

```bash
bun install                    # Install dependencies
bun dev                        # Start dev server for testing
bun turbo typecheck            # Run type checking across packages
./packages/opencode/script/build.ts --single  # Build standalone executable
./script/generate.ts           # Regenerate SDK
```

### Python Plugins (`opencode/.config/opencode/plugin/voice-permissions/`)

```bash
uv sync                        # Install Python dependencies (NEVER use pip)
uv run python <script>.py      # Run Python scripts
```

**IMPORTANT**: `pip` is denied in this repository. Always use `uv` for Python package management.

## Code Style Guidelines

### TypeScript/JavaScript (OpenCode plugins)

**Imports**:

```typescript
import type { Plugin } from "@opencode-ai/plugin"; // Type-only imports
import { something } from "package"; // Named imports preferred
```

**Exports**:

```typescript
export const PluginName: Plugin = async ({ $ }) => { ... }  // Named exports
```

**General Rules** (from opencode-code STYLE_GUIDE.md):

- Prefer `const` over `let` - use ternary for conditional assignment
- Avoid `else` statements - use early returns instead
- Avoid `try`/`catch` where possible - prefer `.catch()` for promises
- Avoid `any` type - use proper TypeScript types
- Prefer single-word variable names where possible
- Avoid unnecessary destructuring - use `obj.a` instead of `const { a } = obj`
- Use Bun APIs when available (e.g., `Bun.file()`, `$` shell)

**Formatting**:

- No semicolons (prettier config: `semi: false`)
- Print width: 120 characters
- Use tabs for indentation

**Error Handling**:

```typescript
// Preferred - silent catch for non-critical operations
try {
  await $`some-command`;
} catch {
  // Silent fail or console.error for debugging
}

// For critical errors
const result = await somePromise.catch(() => null);
if (!result) return;
```

## Package Managers

| Language   | Package Manager | Notes                       |
| ---------- | --------------- | --------------------------- |
| TypeScript | Bun             | Primary JS runtime          |
| Python     | uv              | pip is DENIED               |
| Node.js    | pnpm            | For projects requiring Node |


## Dangerous Operations (Require Confirmation)

The following operations require explicit confirmation:

- `rm -rf`, `rm -r`, recursive deletes
- `git reset --hard`, `git push --force`, `git rebase -i`
- `sudo`, `chmod -R`, `chown -R`
- System package removals (`apt remove`, etc.)

## AI/LLM Configuration

- Primary provider: AWS Bedrock (Claude models)
- MCP servers configured: grep.app, chrome-devtools, context7
- Formatters: Prettier runs on file writes for JS/TS/JSON/MD/YAML/CSS

## Key Files

| File                                       | Purpose                     |
| ------------------------------------------ | --------------------------- |
| `opencode/.config/opencode/opencode.jsonc` | Main OpenCode configuration |
| `opencode/.config/opencode/plugin/*.ts`    | TypeScript plugins          |
| `zsh/.zshrc`                               | Shell configuration         |
| `zsh/.aliases`                             | Shell aliases               |
| `awesome/rc.lua`                           | Window manager config       |

## Working with Submodules

```bash
git submodule update --init --recursive  # Initialize submodules
git submodule update --remote            # Update to latest
```

Submodules:

- `opencode-code/` - OpenCode source code
- `awesome-claude-code-subagents/` - Claude subagent collection

## Tips for AI Agents

1. **Identify the subdirectory** before making changes - different style guides apply
2. **Use parallel tool calls** when operations are independent
3. **Check file extensions** to determine which style guide applies
4. **Never use pip** - always use `uv` for Python
5. **Use Bun** for TypeScript/JavaScript execution
6. **Preserve existing formatting** - tabs for TS, spaces may vary elsewhere

# Beads Workflow Context

> **Context Recovery**: Run `bd prime` after compaction, clear, or new session
> Hooks auto-call this in Claude Code when .beads/ detected

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. pnpm lintfix              (check what changed)
```

## Core Rules

- Track ALL work in beads (no TodoWrite tool, no markdown TODOs)
- Use `bd create` to create issues, not TodoWrite tool
- Git workflow: hooks auto-sync, run `bd sync` at session end
- Session management: check `bd ready` for available work

## Essential Commands

### Finding Work

- `bd ready` - Show issues ready to work (no blockers)
- `bd list --status=open` - All open issues
- `bd list --status=in_progress` - Your active work
- `bd show <id>` - Detailed issue view with dependencies

### Creating & Updating

- `bd create --title="..." --type=task|bug|feature` - New issue
- `bd update <id> --status=in_progress` - Claim work
- `bd update <id> --assignee=username` - Assign to someone
- `bd close <id>` - Mark complete
- `bd close <id1> <id2> ...` - Close multiple issues at once (more efficient)
- `bd close <id> --reason="explanation"` - Close with reason
- **Tip**: When creating multiple issues/tasks/epics, use parallel subagents for efficiency

### Dependencies & Blocking

- `bd dep add <issue> <depends-on>` - Add dependency (issue depends on depends-on)
- `bd blocked` - Show all blocked issues
- `bd show <id>` - See what's blocking/blocked by this issue

### Project Health

- `bd stats` - Project statistics (open/closed/blocked counts)
- `bd doctor` - Check for issues (sync problems, missing hooks)

## Common Workflows

**Starting work:**

```bash
bd ready           # Find available work
bd show <id>       # Review issue details
bd update <id> --status=in_progress  # Claim it
```

**Completing work:**

```bash
bd close <id1> <id2> ...    # Close all completed issues at once
bd sync                     # Push to remote
```

**Creating dependent work:**

```bash
# Run bd create commands in parallel (use subagents for many items)
bd create --title="Implement feature X" --type=feature
bd create --title="Write tests for X" --type=task
bd dep add beads-yyy beads-xxx  # Tests depend on Feature (Feature blocks tests)
```
