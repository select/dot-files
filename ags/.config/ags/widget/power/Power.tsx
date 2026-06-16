import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState, createBinding, createComputed, For } from "ags"
import { execAsync } from "ags/process"
import { createPoll } from "ags/time"
import AstalBattery from "gi://AstalBattery"
import Pango from "gi://Pango"

const [revealed, setRevealed] = createState(false)

function close() {
	app.toggle_window("power")
}

type Profile = { id: string; label: string; desc: string; icon: string }

const profiles: Profile[] = [
	{ id: "power-saver", label: "Power Saver", desc: "Reduce performance, maximize battery life", icon: "󰾆" },
	{ id: "balanced", label: "Balanced", desc: "Standard performance and power saving", icon: "󰾅" },
	{ id: "performance", label: "Performance", desc: "High performance, higher power usage", icon: "󰓅" },
]

function getDeviceIcon(d: AstalBattery.Device, percentage: number, charging: boolean) {
	if (d.device_type === AstalBattery.Type.BATTERY) {
		if (charging) return "󰂄"
		const levels = ["󰁺", "󰁻", "󰁼", "󰁽", "󰁾", "󰁿", "󰂀", "󰂁", "󰂂", "󰁹"]
		return levels[Math.min(9, Math.floor(percentage * 10))]
	}
	if (d.device_type === AstalBattery.Type.MOUSE) {
		return "󰍽"
	}
	if (d.device_type === AstalBattery.Type.KEYBOARD) {
		return "󰌌"
	}
	if (d.device_type === AstalBattery.Type.HEADSET || d.device_type === AstalBattery.Type.HEADPHONES) {
		return "󰋋"
	}
	if (d.device_type === AstalBattery.Type.PHONE) {
		return "󰏲"
	}
	if (d.device_type === AstalBattery.Type.GAMING_INPUT) {
		return "󰊴"
	}
	return "󰂄"
}

function DeviceRow({ d }: { d: AstalBattery.Device }) {
	const pct = createBinding(d, "percentage")
	const charging = createBinding(d, "charging")
	const state = createBinding(d, "state")
	const model = createBinding(d, "model")
	const vendor = createBinding(d, "vendor")

	const name = createComputed(() => {
		if (d.device_type === AstalBattery.Type.BATTERY) {
			return "Laptop Battery"
		}
		return model() || vendor() || "Unknown Device"
	})

	const percentageText = createComputed(() => {
		return `${Math.round(pct() * 100)}%`
	})

	const statusText = createComputed(() => {
		if (charging()) {
			if (state() === AstalBattery.State.FULLY_CHARGED) {
				return "Fully Charged"
			}
			return "Charging"
		}
		return "On Battery"
	})

	const iconGlyph = createComputed(() => {
		return getDeviceIcon(d, pct(), charging())
	})

	return (
		<box class="power-device-row" orientation={Gtk.Orientation.VERTICAL}>
			<box orientation={Gtk.Orientation.HORIZONTAL} valign={Gtk.Align.CENTER}>
				<label class="power-device-icon" label={iconGlyph} />
				<box orientation={Gtk.Orientation.VERTICAL} halign={Gtk.Align.START} hexpand>
					<label class="power-device-name" label={name} halign={Gtk.Align.START} />
					<label class="power-device-status" label={statusText} halign={Gtk.Align.START} />
				</box>
				<label class="power-device-percentage" label={percentageText} />
			</box>
			<levelbar
				class="power-device-bar"
				valign={Gtk.Align.CENTER}
				value={pct}
				marginTop={6}
			/>
		</box>
	)
}

export default function Power(gdkmonitor: Gdk.Monitor) {
	const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

	// Calculate geometry to align above the right side of the centered bar
	const geo = gdkmonitor.get_geometry()
	const barWidth = Math.round((geo.width || 1920) * 0.36)
	const marginEnd = Math.max(0, Math.round((geo.width - barWidth) / 2))

	const upower = new AstalBattery.UPower()
	const devices = createBinding(upower, "devices")

	const batteryDevices = createComputed(() => {
		devices()
		const devs = upower.get_devices() || []
		return devs.filter((d) => {
			return d.is_battery && d.device_type !== AstalBattery.Type.LINE_POWER
		})
	})

	const [activeProfile, setActiveProfile] = createState("balanced")

	// Get initial profile
	execAsync(["powerprofilesctl", "get"])
		.then((p) => setActiveProfile(p.trim()))
		.catch(() => {})

	// Poll profile state
	const profilePoll = createPoll("balanced", 3000, () =>
		execAsync(["powerprofilesctl", "get"])
			.then((p) => {
				const prof = p.trim()
				setActiveProfile(prof)
				return prof
			})
			.catch(() => "balanced")
	)

	const switchProfile = (id: string) => {
		setActiveProfile(id)
		execAsync(["powerprofilesctl", "set", id]).catch((err) =>
			console.error("Error setting power profile:", err)
		)
	}

	return (
		<window
			name="power"
			namespace="power"
			class="Power"
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
					halign={Gtk.Align.END}
					valign={Gtk.Align.END}
					marginEnd={marginEnd}
					marginBottom={0}
					revealChild={revealed}
					transitionType={Gtk.RevealerTransitionType.SLIDE_UP}
					transitionDuration={200}
				>
					<box class="power-box" orientation={Gtk.Orientation.VERTICAL}>
						<Gtk.GestureClick
							onReleased={(g) => g.set_state(Gtk.EventSequenceState.CLAIMED)}
						/>

						{/* Keep the poll active */}
						<label visible={false} label={profilePoll} />

						{/* Header Section */}
						<box class="power-header" valign={Gtk.Align.CENTER}>
							<label class="power-title" halign={Gtk.Align.START} label="Power Settings" />
						</box>

						{/* Devices Section */}
						<box class="power-section" orientation={Gtk.Orientation.VERTICAL}>
							<label class="power-list-subtitle" halign={Gtk.Align.START} label="Devices" />
							<scrolledwindow
								class="power-scrolled"
								propagateNaturalHeight={true}
								maxContentHeight={180}
								hscrollbarPolicy={Gtk.PolicyType.NEVER}
							>
								<box class="power-device-list" orientation={Gtk.Orientation.VERTICAL}>
									<For each={batteryDevices}>
										{(d) => <DeviceRow d={d} />}
									</For>
								</box>
							</scrolledwindow>
						</box>

						{/* Profiles Section */}
						<box class="power-section last" orientation={Gtk.Orientation.VERTICAL}>
							<label class="power-list-subtitle" halign={Gtk.Align.START} label="Power Profiles" />
							<box class="power-profiles-list" orientation={Gtk.Orientation.VERTICAL}>
								{profiles.map((p) => {
									const btnClass = activeProfile((active) =>
										active === p.id ? "power-profile-btn active" : "power-profile-btn"
									)
									return (
										<button
											class={btnClass}
											onClicked={() => switchProfile(p.id)}
											tooltipText={p.desc}
										>
											<box valign={Gtk.Align.CENTER} hexpand>
												<label class="power-profile-icon" label={p.icon} />
												<box orientation={Gtk.Orientation.VERTICAL} halign={Gtk.Align.START} hexpand>
													<label
														class="power-profile-title"
														ellipsize={Pango.EllipsizeMode.END}
														maxWidthChars={20}
														halign={Gtk.Align.START}
														label={p.label}
													/>
													<label
														class="power-profile-desc"
														ellipsize={Pango.EllipsizeMode.END}
														maxWidthChars={28}
														halign={Gtk.Align.START}
														label={p.desc}
													/>
												</box>
											</box>
										</button>
									)
								})}
							</box>
						</box>

					</box>
				</revealer>
			</box>
		</window>
	)
}
