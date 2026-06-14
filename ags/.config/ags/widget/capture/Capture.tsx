import app from "ags/gtk4/app";
import { Astal, Gtk, Gdk } from "ags/gtk4";
import { createState } from "ags";
import { execAsync } from "ags/process";
import GLib from "gi://GLib";

const HOME = GLib.get_home_dir();
const SCRIPT = `${HOME}/.config/hypr/scripts/capture.sh`;

type Mode = "region" | "screen" | "window";
type Kind = "screenshot" | "video";

const modes: { id: Mode; icon: string; label: string }[] = [
	{ id: "region", icon: "󰩬", label: "Selection" },
	{ id: "screen", icon: "󰍹", label: "Screen" },
	{ id: "window", icon: "󱂬", label: "Window" },
];

const [mode, setMode] = createState<Mode>("region");
const [kind, setKind] = createState<Kind>("screenshot");
const [recording, setRecording] = createState(false);

function close() {
	app.get_window("capture")?.set_visible(false);
}

function refreshRecording() {
	execAsync([
		"bash",
		"-c",
		"pgrep -f '[g]pu-screen-recorder' > /dev/null && echo yes || echo no",
	])
		.then((out) => setRecording(out.trim() === "yes"))
		.catch(() => setRecording(false));
}

function capture() {
	const k = kind.get();
	const m = mode.get();
	close();
	execAsync([SCRIPT, k, m]).catch((err) => console.error(err));
}

function stop() {
	close();
	execAsync([SCRIPT, "stop"]).catch((err) => console.error(err));
}

export default function Capture(gdkmonitor: Gdk.Monitor) {
	const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor;

	return (
		<window
			name="capture"
			namespace="capture"
			class="Capture"
			gdkmonitor={gdkmonitor}
			anchor={TOP | BOTTOM | LEFT | RIGHT}
			exclusivity={Astal.Exclusivity.IGNORE}
			keymode={Astal.Keymode.ON_DEMAND}
			layer={Astal.Layer.OVERLAY}
			application={app}
			visible={false}
			$={(self) =>
				self.connect("notify::visible", () => {
					if (!self.visible) return;
					refreshRecording();
				})
			}
		>
			<Gtk.EventControllerKey
				onKeyPressed={({}, keyval: number) => {
					if (keyval === Gdk.KEY_Escape) close();
				}}
			/>
			{/* full-screen catcher: click outside the panel to close (on release so
			    inner buttons claim the sequence first — see PowerMenu) */}
			<box>
				<Gtk.GestureClick onReleased={() => close()} />
				<box
					class="capture-panel"
					orientation={Gtk.Orientation.VERTICAL}
					hexpand
					vexpand
					halign={Gtk.Align.CENTER}
					valign={Gtk.Align.CENTER}
				>
					<Gtk.GestureClick
						onReleased={(g) => g.set_state(Gtk.EventSequenceState.CLAIMED)}
					/>

					{/* mode cards */}
					<box class="capture-modes" homogeneous spacing={12}>
						{modes.map((mo) => (
							<button
								class={mode((m) =>
									m === mo.id ? "capture-mode active" : "capture-mode",
								)}
								onClicked={() => setMode(mo.id)}
							>
								<box
									orientation={Gtk.Orientation.VERTICAL}
									spacing={10}
									hexpand
									halign={Gtk.Align.CENTER}
								>
									<label class="capture-mode-icon" label={mo.icon} />
									<label
										class="capture-mode-label"
										halign={Gtk.Align.CENTER}
										label={mo.label}
									/>
								</box>
							</button>
						))}
					</box>

					{/* bottom bar: kind toggle | shutter | spacer — homogeneous keeps the shutter dead-centered */}
					<box class="capture-bottom" homogeneous>
						<box halign={Gtk.Align.START} valign={Gtk.Align.CENTER}>
							<box class="capture-kind" valign={Gtk.Align.CENTER}>
								<button
									class={kind((k) =>
										k === "screenshot"
											? "capture-kind-btn active"
											: "capture-kind-btn",
									)}
									tooltipText="Screenshot"
									onClicked={() => setKind("screenshot")}
								>
									<label label="󰄄" />
								</button>
								<button
									class={kind((k) =>
										k === "video"
											? "capture-kind-btn active"
											: "capture-kind-btn",
									)}
									tooltipText="Screen record"
									onClicked={() => setKind("video")}
								>
									<label label="󰕧" />
								</button>
							</box>
						</box>

						<box halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
							<button
								class={recording((r) =>
									r ? "capture-shutter recording" : "capture-shutter",
								)}
								tooltipText="Capture"
								widthRequest={56}
								heightRequest={56}
								onClicked={() =>
									recording.get() && kind.get() === "video" ? stop() : capture()
								}
							>
								<box
									class="capture-shutter-inner"
									halign={Gtk.Align.CENTER}
									valign={Gtk.Align.CENTER}
									widthRequest={41}
									heightRequest={41}
								/>
							</button>
						</box>

						{/* empty third cell balances the kind toggle */}
						<box />
					</box>
				</box>
			</box>
		</window>
	);
}
