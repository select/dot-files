# Conversation image viewer

Pi extension + Herdr TUI plugin. Opens an image from the current conversation
branch in a temporary zoomed **terminal-area** overlay, leaving the conversation
and its layout intact. Does not fullscreen the desktop window.

## Use

- `/images`: choose an image, newest messages first.
- `/images latest`: immediately open the most recent image.
- `/images 3`: open image 3 from that same list.
- **Esc**, **Q**, or **Ctrl+C**: close and return.
- **R**: redraw. Resizing the terminal refits the image.

Supports attached user images and image blocks in tool results (including
codemode results), assistant messages and custom messages. Uses current-branch
session entries, including images from before compaction. It does not scan
abandoned branches, follow Markdown URLs, or fetch anything from the network.
PNG, JPEG, GIF (first frame), WebP and BMP are supported.

## Install

Requires Herdr TUI 0.9.5+, Bun, and kitty's `kitten` utility, plus a terminal
setup in which Herdr can already display inline images.

From this dotfiles repository:

```sh
ln -s "$PWD/pi/.pi/agent/extensions/image-viewer" ~/.pi/agent/extensions/image-viewer
herdr plugin link "$PWD/herdr/.config/herdr/plugins/pi-images"
```

Then run **/reload** in Pi. No Herdr restart is needed.
If a symlink already exists, do not overwrite it; inspect it first.

The extension uses Herdr’s `zoomed` placement to explicitly target its calling
pane. Unlike `overlay`, this placement accepts `--target-pane`; closing the
viewer removes the temporary pane. Images are written
to an owner-only temporary directory and file; the viewer deletes them when it
exits. A failed launch is cleaned up by Pi. A hard kill or machine crash may
leave a `pi-images-*` directory in the system temp directory; these are not
automatically scanned or deleted. Viewers close on normal termination signals.
The viewer opens the image bytes stored in the session, which may have been
resized by Pi; it cannot recover an unavailable original.

## Limitation: clicking existing inline images

This version implements the command/picker workflow, **not direct clicking on
Pi's built-in inline images**. No core monkey-patches are installed. A proper
image-click hook in Pi's built-in renderer is still needed for that workflow.
The same materialization and Herdr viewer can be reused by that future hook.

## Tests

```sh
bun test ./pi/.pi/agent/extensions/image-viewer/core.test.ts
uv run --no-project python herdr/.config/herdr/plugins/pi-images/viewer-smoke.py
```

The PTY smoke test uses the real `kitten icat` renderer and checks image output,
resize, Q/Esc/signal dismissal, private-file cleanup, and refusal of arbitrary paths.
