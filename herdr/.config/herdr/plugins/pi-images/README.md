# Pi image overlay

Companion plugin for the Pi extension at
`pi/.pi/agent/extensions/image-viewer/` in this repository.

Link this directory with `herdr plugin link /absolute/path/to/pi-images`,
reload Pi, then use `/images` or `/images latest`.

Requires Bun and kitty's `kitten icat`. The plugin opens a temporary zoomed
terminal overlay and removes its private image file when dismissed with Esc/Q.
It intentionally has no general-purpose file-opening action or URL handler.
See the extension README for installation, tests and limitations.
