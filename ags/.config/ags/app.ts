import app from "ags/gtk4/app"
import { Gdk, Gtk } from "ags/gtk4"
import { palette } from "./lib/wal"
import { css } from "./style"
import Bar from "./widget/bar/Bar"
import PowerMenu from "./widget/powermenu/PowerMenu"
import Tray from "./widget/tray/Tray"
import Wallpaper from "./widget/wallpaper/Wallpaper"
import Capture from "./widget/capture/Capture"
import Osd from "./widget/osd/Osd"
import Media from "./widget/media/Media"
import Sound from "./widget/sound/Sound"
import Bluetooth from "./widget/bluetooth/Bluetooth"
import Wifi from "./widget/wifi/Wifi"
import Power from "./widget/power/Power"
import HyprlandSettings from "./widget/hyprland/HyprlandSettings"
import Temperature from "./widget/temperature/Temperature"

app.start({
	main() {
		// apply wal-derived stylesheet, and reapply whenever the palette changes
		palette.subscribe(() => {
			app.reset_css()
			app.apply_css(css(palette.get()), true)
		})
		app.apply_css(css(palette.get()), true)

		// React to monitors being hotplugged / enabled / disabled at runtime.
		// Booting docked sometimes brings DP-2 up *after* ags has started, and
		// disabling eDP-1 afterwards used to leave the bar stuck on the laptop
		// panel or gone entirely. Build bars on demand and tear them down when
		// their monitor disappears.
		const built = new Map<Gdk.Monitor, Gtk.Window[]>()

		const sync = () => {
			const monitors = app.get_monitors()

			for (const monitor of monitors) {
				if (built.has(monitor)) continue
				built.set(monitor, [
					Bar(monitor),
					PowerMenu(monitor),
					Tray(monitor),
					Wallpaper(monitor),
					Capture(monitor),
					Osd(monitor),
					Media(monitor),
					Sound(monitor),
					Bluetooth(monitor),
					Wifi(monitor),
					Power(monitor),
					HyprlandSettings(monitor),
					Temperature(monitor),
				])
			}

			for (const [monitor, windows] of built) {
				if (monitors.includes(monitor)) continue
				for (const w of windows) w.destroy()
				built.delete(monitor)
			}
		}

		sync()

		const display = Gdk.Display.get_default()
		display?.get_monitors().connect("items-changed", sync)
	},
})
