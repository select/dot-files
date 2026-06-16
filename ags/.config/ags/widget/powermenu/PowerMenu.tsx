import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState } from "ags"
import { execAsync } from "ags/process"
import Pango from "gi://Pango"

type Action = { icon: string; title: string; desc: string; cmd: string }

const actions: Action[] = [
	{ icon: "󰌾", title: "Lock Screen", desc: "Lock the active session", cmd: "~/.config/hypr/scripts/lock.sh" },
	{ icon: "󰍃", title: "Logout", desc: "Exit Hyprland session", cmd: "hyprctl dispatch exit" },
	{ icon: "󰤄", title: "Suspend", desc: "Put system into low-power sleep", cmd: "systemctl suspend" },
	{ icon: "󰜉", title: "Reboot", desc: "Restart the computer", cmd: "systemctl reboot" },
	{ icon: "󰐥", title: "Shutdown", desc: "Power off the system", cmd: "systemctl poweroff -i" },
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
			marginBottom={50}
			application={app}
			visible={false}
			$={(self) => self.connect("notify::visible", () => setRevealed(self.visible))}
		>
			<Gtk.EventControllerKey
				onKeyPressed={({}, keyval: number) => {
					if (keyval === Gdk.KEY_Escape) close()
				}}
			/>
			<box>
				<Gtk.GestureClick onReleased={() => close()} />
				<revealer
					halign={Gtk.Align.START}
					valign={Gtk.Align.END}
					marginStart={marginStart}
					marginBottom={0}
					revealChild={revealed}
					transitionType={Gtk.RevealerTransitionType.SLIDE_UP}
					transitionDuration={200}
				>
					<box class="powermenu-box" orientation={Gtk.Orientation.VERTICAL}>
						<Gtk.GestureClick
							onReleased={(g) => g.set_state(Gtk.EventSequenceState.CLAIMED)}
						/>

						{/* Header Section */}
						<box class="powermenu-header" valign={Gtk.Align.CENTER}>
							<label class="powermenu-title" halign={Gtk.Align.START} label="Power Menu" />
						</box>

						{/* Actions Section */}
						<box class="powermenu-section last" orientation={Gtk.Orientation.VERTICAL}>
							<box class="powermenu-list" orientation={Gtk.Orientation.VERTICAL}>
								{actions.map((a) => (
									<button
										class="powermenu-btn"
										onClicked={() => run(a.cmd)}
										tooltipText={a.desc}
									>
										<box valign={Gtk.Align.CENTER} hexpand>
											<label
												class="powermenu-btn-icon"
												label={a.icon}
											/>
											<box orientation={Gtk.Orientation.VERTICAL} halign={Gtk.Align.START} hexpand>
												<label
													class="powermenu-btn-title"
													ellipsize={Pango.EllipsizeMode.END}
													maxWidthChars={20}
													halign={Gtk.Align.START}
													label={a.title}
												/>
												<label
													class="powermenu-btn-desc"
													ellipsize={Pango.EllipsizeMode.END}
													maxWidthChars={26}
													halign={Gtk.Align.START}
													label={a.desc}
												/>
											</box>
										</box>
									</button>
								))}
							</box>
						</box>

					</box>
				</revealer>
			</box>
		</window>
	)
}
