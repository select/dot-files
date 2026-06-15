# Sound

An interactive Sound Configuration Widget that slides up from the bottom-right of the screen, directly aligned above the status segment of the bar. It allows full configuration of both playback and capture devices.

![Sound](assets/screenshot.png)

- **Speakers / Output Section** — displays the active output device, has a mute toggle button, and a smooth Gtk.Scale volume slider.
- **Input / Microphone Section** — displays the active input device, has a mute toggle button, and a smooth Gtk.Scale volume slider.
- **Real-time Volume Synchronization** — dynamically reflects system-wide volume adjustments, while employing a GLib monotonic-time gate to ensure buttery smooth manual dragging.
- **Device List Selection** — lists all available PipeWire audio output and input devices with interactive radio buttons to easily swap the default active device.
- **Dismiss on click-outside** — close the panel instantly by clicking anywhere else on the screen or pressing the `Escape` key.

Driven natively by WirePlumber and PipeWire. Colors match the bar and hot-reload from `~/.cache/wal/colors.json`.
