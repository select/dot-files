import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState } from "ags"
import { execAsync } from "ags/process"

type Action = { icon: string; tooltip: string; cmd: string }

const actions: Action[] = [
	{ icon: "󰌾", tooltip: "Lock", cmd: "~/.config/hypr/scripts/lock.sh" },
	{ icon: "󰍃", tooltip: "Logout", cmd: "hyprctl dispatch exit" },
	{ icon: "󰤄", tooltip: "Suspend", cmd: "systemctl suspend" },
	{ icon: "󰜉", tooltip: "Reboot", cmd: "systemctl reboot" },
	{ icon: "󰐥", tooltip: "Shutdown", cmd: "systemctl poweroff -i" },
]

const [revealed, setRevealed] = createState(false)

function close() {
	app.toggle_window("powermenu")
}

function run(cmd: string) {
	close()
	execAsync(["bash", "-c", cmd]).catch((err) => console.error(err))
}

export default function PowerMenu(gdkmonitor: Gdk.Monitor) {
	const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

	// align the popup above the skull trigger (left edge of the centered bar)
	const geo = gdkmonitor.get_geometry()
	const barWidth = Math.round((geo.width || 1920) * 0.36)
	const marginStart = Math.max(0, Math.round((geo.width - barWidth) / 2))

	return (
		<window
			name="powermenu"
			namespace="powermenu"
			class="PowerMenu"
			gdkmonitor={gdkmonitor}
			anchor={TOP | BOTTOM | LEFT | RIGHT}
			exclusivity={Astal.Exclusivity.IGNORE}
			keymode={Astal.Keymode.ON_DEMAND}
			layer={Astal.Layer.OVERLAY}
			application={app}
			visible={false}
			$={(self) => self.connect("notify::visible", () => setRevealed(self.visible))}
		>
			<Gtk.EventControllerKey
				onKeyPressed={({}, keyval: number) => {
					if (keyval === Gdk.KEY_Escape) close()
				}}
			/>
			{/* full-screen catcher: clicking outside the menu (incl. the icon area) closes it.
			    Trigger on release (not press) so a button's own click gesture claims the
			    sequence first and still fires before this ancestor catcher runs. */}
			<box>
				<Gtk.GestureClick onReleased={() => close()} />
				<revealer
					halign={Gtk.Align.START}
					valign={Gtk.Align.END}
					marginStart={marginStart}
					marginBottom={50}
					revealChild={revealed}
					transitionType={Gtk.RevealerTransitionType.SLIDE_UP}
					transitionDuration={200}
				>
					<box class="powermenu-box">
						{/* claim on release so clicking the box padding doesn't close the
						    menu, without cancelling the buttons' press gesture */}
						<Gtk.GestureClick
							onReleased={(g) => g.set_state(Gtk.EventSequenceState.CLAIMED)}
						/>
						{actions.map((a) => (
							<button tooltipText={a.tooltip} onClicked={() => run(a.cmd)}>
								<label label={a.icon} />
							</button>
						))}
					</box>
				</revealer>
			</box>
		</window>
	)
}
