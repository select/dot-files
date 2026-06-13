import app from "ags/gtk4/app"
import { palette } from "./lib/wal"
import { css } from "./style"
import Bar from "./widget/Bar"
import PowerMenu from "./widget/PowerMenu"
import Tray from "./widget/Tray"

app.start({
	main() {
		// apply wal-derived stylesheet, and reapply whenever the palette changes
		palette.subscribe(() => {
			app.reset_css()
			app.apply_css(css(palette.get()), true)
		})
		app.apply_css(css(palette.get()), true)

		for (const monitor of app.get_monitors()) {
			Bar(monitor)
			PowerMenu(monitor)
			Tray(monitor)
		}
	},
})
