# AGENTS.md - Dotfiles Repository

This is a **dotfiles repository** containing personal configuration files for various development tools. It is NOT a single programming project but a collection of configs organized by tool/application.

## Repository Structure

```
dot-files/
├── ags/              # Aylur's GTK Shell config (TypeScript/GJS/Astal)
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

### AGS / Astal (Aylur's GTK Shell)

The bar, powermenu, and overlays are managed via AGS (Astal/GTK4 version).

**Environment Setup (needed for introspected operations or running manually)**:
```bash
export GI_TYPELIB_PATH="/usr/local/lib/x86_64-linux-gnu/girepository-1.0:$HOME/.local/lib/x86_64-linux-gnu/girepository-1.0"
export LD_LIBRARY_PATH="$HOME/.local/lib/x86_64-linux-gnu:/usr/local/lib/x86_64-linux-gnu"
```

**Common Commands**:
```bash
ags list                                               # List running shell instances
ags quit                                               # Safely terminate the running instance
nohup ags run ~/.config/ags >/dev/null 2>&1 &          # Launch AGS in the background detached
ags bundle ags/.config/ags/app.ts /tmp/bundle          # Bundle & validate TypeScript compilation
```

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
| `ags/.config/ags/app.ts`                   | AGS main entry point and window registry |
| `ags/.config/ags/widget/`                  | Custom GTK4 TSX widgets (bar, wifi, power, etc.) |
| `ags/.config/ags/style.ts`                 | AGS global stylesheet compiler (with wal colors) |

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
7. **Never run `find /` or other whole-filesystem scans** - they hang and get stuck. Always scope searches to known roots (e.g. `/usr/lib`, `/usr/local/lib`, `~/.local/lib`, the repo dir) or use `fd`/`rg` with an explicit path. For typelibs/gir, look directly in the girepository dirs (e.g. `/usr/local/lib/x86_64-linux-gnu/girepository-1.0`).
