# Prompt stash

Vendored from [@nicknisi/pi-stash](https://github.com/nicknisi/pi-extensions/tree/main/packages/stash),
commit `d6c0542e639db2c8e0f18c6bd4658de9738aaa4e`. `index.ts` is copied unchanged; see `LICENSE` for the upstream MIT license.
No npm installation or runtime dependencies are needed.

- **Ctrl+S with text:** push the draft onto the stash stack and clear the editor.
- **Ctrl+S with an empty editor:** restore the most recent draft.
- Sending another message automatically restores the most recent draft into an empty editor when the agent starts. Restoration never submits the draft.
- A widget above the editor previews the latest stash and the number of additional drafts.

Text only: cursor position and attachments are not archived. The stack is in memory and is lost on reload/restart.

## Setup

Symlink this directory into `~/.pi/agent/extensions/prompt-stash` and run `/reload`.
Merge these entries into `~/.pi/agent/keybindings.json` to free Ctrl+S:

```json
{
  "app.models.save": ["ctrl+shift+v"],
  "app.thinking.save": ["ctrl+shift+v"],
  "app.session.toggleSort": ["ctrl+shift+r"]
}
```

Shifted-control shortcuts require a terminal that reports them distinctly.

## Tests

```sh
bun test ./pi/.pi/agent/extensions/prompt-stash/tests/stash.test.ts
```
