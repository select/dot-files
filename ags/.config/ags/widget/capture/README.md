# Capture

A centered overlay for screenshots and screen recordings. Toggle with **`Print`**.

![Capture](assets/screenshot.png)

- **Mode cards** — Selection (region), Screen, or Window
- **Kind toggle** — screenshot (󰄄) or video (󰕧)
- **Shutter** — captures the current mode/kind; while recording it turns red and
  acts as a stop button

`Esc` or a click outside the panel closes it. The actual work is done by
`~/.config/hypr/scripts/capture.sh <kind> <mode>` (and `capture.sh stop`).
