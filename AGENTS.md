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
