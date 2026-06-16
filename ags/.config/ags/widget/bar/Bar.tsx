import app from "ags/gtk4/app";
import { Astal, Gtk, Gdk } from "ags/gtk4";
import { createBinding, createComputed, createState, For } from "ags";
import { createPoll } from "ags/time";
import { execAsync } from "ags/process";

import AstalHyprland from "gi://AstalHyprland";
import AstalWp from "gi://AstalWp";
import AstalNetwork from "gi://AstalNetwork";
import AstalBluetooth from "gi://AstalBluetooth";
import AstalBattery from "gi://AstalBattery";
import AstalNotifd from "gi://AstalNotifd";

// --- left: power trigger + workspace switcher ---
function Logo() {
	return (
		<button
			class="logo"
			tooltipText="Power menu"
			onClicked={() => app.toggle_window("powermenu")}
		>
			<label label="󰚌" />
		</button>
	);
}

function Workspaces() {
	const hypr = AstalHyprland.get_default();
	const focused = createBinding(
		hypr,
		"focusedWorkspace",
	)((ws) => (ws ? ws.id : 1));
	const ids = [1, 2, 3, 4, 5];

	return (
		<box class="workspaces" valign={Gtk.Align.CENTER}>
			{ids.map((id) => (
				<button
					class={focused((f) => (f === id ? "ws active" : "ws"))}
					valign={Gtk.Align.CENTER}
					onClicked={() =>
						execAsync([
							"hyprctl",
							"dispatch",
							`hl.dsp.focus({workspace=${id}})`,
						]).catch((e) => console.error(e))
					}
				/>
			))}
		</box>
	);
}

// --- center: clock ---
function Clock() {
	const time = createPoll("", 1000, () => {
		const d = new Date();
		return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
	});
	const date = createPoll("", 60000, () =>
		new Date().toLocaleDateString("de-DE", {
			weekday: "long",
			year: "numeric",
			month: "numeric",
			day: "numeric",
		}),
	);
	return (
		<button
			class="clock"
			tooltipText={date}
			onClicked={() => execAsync(["gnome-calendar"]).catch(() => {})}
		>
			<label label={time} />
		</button>
	);
}

// --- right: status icons ---
function Mic() {
	const wp = AstalWp.get_default()!;
	const mic = wp.defaultMicrophone;
	const recording = createBinding(wp.audio, "recorders")((r) => r.length > 0);
	const muted = createBinding(mic, "mute");
	const glyph = muted((m) => (m ? "󰍭" : "󰍬"));
	const cls = recording((r) => (r ? "icon-mic recording" : "icon-mic"));
	const tip = recording((r) =>
		r ? "Recording — click to mute" : "Toggle microphone",
	);
	return (
		<button
			class={cls}
			valign={Gtk.Align.CENTER}
			tooltipText={tip}
			onClicked={() => (mic.mute = !mic.mute)}
		>
			<label label={glyph} />
		</button>
	);
}

function Volume() {
	const wp = AstalWp.get_default()!;
	const speaker = wp.defaultSpeaker;
	const mute = createBinding(speaker, "mute");
	const volume = createBinding(speaker, "volume");
	const glyph = createComputed(() => {
		if (mute() || volume() <= 0) return "󰖁";
		if (volume() < 0.34) return "󰕿";
		if (volume() < 0.67) return "󰖀";
		return "󰕾";
	});
	return (
		<button
			class="icon-volume"
			valign={Gtk.Align.CENTER}
			tooltipText="Sound settings"
			onClicked={() => app.toggle_window("sound")}
		>
			<label label={glyph} />
		</button>
	);
}

function Bluetooth() {
	const bt = AstalBluetooth.get_default();
	const powered = createBinding(bt, "isPowered");
	const connected = createBinding(bt, "isConnected");
	const glyph = createComputed(() => {
		if (!powered()) return "󰂲";
		if (connected()) return "󰂴";
		return "󰂯";
	});
	return (
		<button
			class="icon-bluetooth"
			valign={Gtk.Align.CENTER}
			tooltipText="Bluetooth settings"
			onClicked={() => app.toggle_window("bluetooth")}
		>
			<label label={glyph} />
		</button>
	);
}

function Wifi() {
	const network = AstalNetwork.get_default();
	const wifi = network.wifi;
	const glyph = wifi
		? createBinding(
				wifi,
				"strength",
			)((s) => {
				if (s < 0) return "󰤭";
				if (s < 25) return "󰤟";
				if (s < 50) return "󰤢";
				if (s < 75) return "󰤥";
				return "󰤨";
			})
		: createPoll("󰤨", 100000, () => "󰤨");
	return (
		<button
			class="icon-wifi"
			valign={Gtk.Align.CENTER}
			tooltipText="Wi-Fi settings"
			onClicked={() => app.toggle_window("wifi")}
		>
			<label label={glyph} />
		</button>
	);
}

function Messages() {
	const notifd = AstalNotifd.get_default();
	const count = createBinding(notifd, "notifications")((n) => n.length);
	return (
		<button
			class="icon-messages"
			valign={Gtk.Align.CENTER}
			tooltipText="Toggle notification center"
			onClicked={() =>
				execAsync(["swaync-client", "-t", "-sw"]).catch(() => {})
			}
		>
			<box halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
				<label label={count((c) => (c > 0 ? "󱅫" : "󰂚"))} />
				<label
					class="badge"
					visible={count((c) => c > 0)}
					label={count((c) => `${c}`)}
				/>
			</box>
		</button>
	);
}

function Battery() {
	const bat = AstalBattery.get_default();
	const pct = createBinding(bat, "percentage");
	// NB: AstalBattery.charging is true whenever on AC (incl. FULLY_CHARGED),
	// so it falsely showed the charging bolt at 100%. Key off state instead.
	const state = createBinding(bat, "state");
	const glyph = createComputed(() => {
		if (state() === AstalBattery.State.CHARGING) return "󰂄";
		const levels = ["󰁺", "󰁻", "󰁼", "󰁽", "󰁾", "󰁿", "󰂀", "󰂁", "󰂂", "󰁹"];
		return levels[Math.min(9, Math.floor(pct() * 10))];
	});
	const label = createComputed(() => {
		const p = `${Math.round(pct() * 100)}%`;
		if (state() === AstalBattery.State.CHARGING) return `${p} — charging`;
		if (state() === AstalBattery.State.FULLY_CHARGED)
			return `${p} — full (on AC)`;
		return `${p} — on battery`;
	});
	return (
		<button
			class="icon-battery"
			valign={Gtk.Align.CENTER}
			tooltipText={label}
			visible={createBinding(bat, "isPresent")}
			onClicked={() => app.toggle_window("power")}
		>
			<label label={glyph} />
		</button>
	);
}

// --- keyboard layout indicator ---
function shortLayout(s: string): string {
	const l = s.toLowerCase();
	if (l.includes("german") || l.includes("deutsch") || l.includes("(de"))
		return "DE";
	if (l.includes("english") || l.includes("(us")) return "EN";
	const paren = s.match(/\(([^)]+)\)/);
	return (paren ? paren[1] : s).slice(0, 2).toUpperCase();
}

function Keyboard() {
	const hypr = AstalHyprland.get_default();
	const [layout, setLayout] = createState("");
	hypr.connect("keyboard-layout", (_h, _kb, lay: string) =>
		setLayout(shortLayout(lay)),
	);
	// initial value
	execAsync(["bash", "-c", "hyprctl devices -j"])
		.then((out) => {
			const kbs = JSON.parse(out).keyboards ?? [];
			const main = kbs.find((k: any) => k.main) ?? kbs[0];
			if (main?.active_keymap) setLayout(shortLayout(main.active_keymap));
		})
		.catch(() => {});
	return (
		<button
			class="icon-keyboard"
			valign={Gtk.Align.CENTER}
			tooltipText="Switch keyboard layout"
			onClicked={() =>
				execAsync(["bash", "-c", "hyprctl switchxkblayout current next"]).catch(
					() => {},
				)
			}
		>
			<label class="kbd-label" label={layout} />
		</button>
	);
}

// --- recording indicator: red dot, visible only while recording, click to stop ---
function Recorder() {
	const recording = createPoll(false, 2000, () =>
		execAsync([
			"bash",
			"-c",
			"pgrep -f '[g]pu-screen-recorder' > /dev/null && echo 1 || echo 0",
		])
			.then((o) => o.trim() === "1")
			.catch(() => false),
	);
	return (
		<button
			class="icon-recorder"
			valign={Gtk.Align.CENTER}
			visible={recording}
			tooltipText="Recording — click to stop"
			onClicked={() =>
				execAsync([
					"bash",
					"-c",
					"pkill -SIGINT -f '[g]pu-screen-recorder'; notify-send -i media-record 'Recording stopped' 'Saved to ~/Videos/Screencasts'",
				]).catch(() => {})
			}
		>
			<label label="●" />
		</button>
	);
}

export default function Bar(gdkmonitor: Gdk.Monitor) {
	const { BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor;
	const width = Math.round((gdkmonitor.get_geometry().width || 1920) * 0.36);

	return (
		<window
			visible
			name="bar"
			namespace="ags-bar"
			class="Bar"
			gdkmonitor={gdkmonitor}
			anchor={BOTTOM | LEFT | RIGHT}
			exclusivity={Astal.Exclusivity.EXCLUSIVE}
			layer={Astal.Layer.TOP}
			marginBottom={4}
			application={app}
		>
			<box halign={Gtk.Align.CENTER}>
				<centerbox class="bar-inner" widthRequest={width}>
					<box $type="start" class="boxes">
						<box class="segment left">
							<Logo />
							<Workspaces />
						</box>
					</box>

					<box $type="center">
						<Clock />
					</box>

					<box $type="end" class="boxes">
						<box class="segment status">
							<Recorder />
							<Keyboard />
							<Mic />
							<Volume />
							<Bluetooth />
							<Wifi />
							<Messages />
							<Battery />
						</box>
					</box>
				</centerbox>
			</box>
		</window>
	);
}
