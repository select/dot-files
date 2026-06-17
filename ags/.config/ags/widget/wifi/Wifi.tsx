import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState, createBinding, createComputed, For } from "ags"
import AstalNetwork from "gi://AstalNetwork"
import Pango from "gi://Pango"

const [revealed, setRevealed] = createState(false)

function close() {
	app.toggle_window("wifi")
}

export default function Wifi(gdkmonitor: Gdk.Monitor) {
	const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

	// Calculate geometry to align above the right side of the centered bar
	const geo = gdkmonitor.get_geometry()
	const barWidth = Math.round((geo.width || 1920) * 0.36)
	const marginEnd = Math.max(0, Math.round((geo.width - barWidth) / 2))

	const network = AstalNetwork.get_default()!
	const wifi = network.wifi!

	const isEnabled = createBinding(wifi, "enabled")
	const activeAp = createBinding(wifi, "activeAccessPoint")
	const isScanning = createBinding(wifi, "scanning")

	// Computed binding for sorted, deduplicated Access Points
	// Re-runs whenever the "accessPoints" property changes
	const accessPointsList = createBinding(wifi, "accessPoints")
	const sortedAPs = createComputed(() => {
		// Read the binding to establish dependency
		accessPointsList()
		
		const aps = wifi.get_access_points() || []
		const map = new Map<string, any>()
		for (const ap of aps) {
			if (!ap.ssid) continue
			const existing = map.get(ap.ssid)
			if (!existing || ap.strength > existing.strength) {
				map.set(ap.ssid, ap)
			}
		}
		return Array.from(map.values()).sort((a, b) => {
			// If one of them is the active AP, sort it to the top!
			const active = wifi.active_access_point
			if (active) {
				if (a.bssid === active.bssid) return -1
				if (b.bssid === active.bssid) return 1
			}
			return b.strength - a.strength
		})
	})

	// Power toggle helper - safe to call
	const togglePower = () => {
		wifi.enabled = !wifi.enabled
	}

	// Scan trigger helper
	const triggerScan = () => {
		if (wifi.enabled) {
			wifi.scan()
		}
	}

	// Helper for Wi-Fi strength glyphs
	const getWifiGlyph = (strength: number) => {
		if (strength < 25) return "󰤟"
		if (strength < 50) return "󰤢"
		if (strength < 75) return "󰤥"
		return "󰤨"
	}

	return (
		<window
			name="wifi"
			namespace="wifi"
			class="Wifi"
			gdkmonitor={gdkmonitor}
			anchor={TOP | BOTTOM | LEFT | RIGHT}
			exclusivity={Astal.Exclusivity.IGNORE}
			keymode={Astal.Keymode.ON_DEMAND}
			layer={Astal.Layer.OVERLAY}
			marginBottom={50}
			application={app}
			visible={false}
			$={(self) => {
				self.connect("notify::visible", () => {
					setRevealed(self.visible)
				})
			}}
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
					<box class="wifi-box" orientation={Gtk.Orientation.VERTICAL}>
						<Gtk.GestureClick
							onReleased={(g) => g.set_state(Gtk.EventSequenceState.CLAIMED)}
						/>

						{/* Header Section with Title, Power Toggle and Scan Toggle */}
						<box class="wifi-header" valign={Gtk.Align.CENTER}>
							<label class="wifi-title" halign={Gtk.Align.START} label="Wi-Fi" />
							<box hexpand />
							
							{/* Scan / Refresh networks button */}
							<button
								class={isScanning((scan) => scan ? "wifi-action-btn active scanning" : "wifi-action-btn")}
								tooltipText={isScanning((scan) => scan ? "Scanning for networks..." : "Scan for networks")}
								visible={isEnabled}
								onClicked={triggerScan}
							>
								<label label={isScanning((scan) => scan ? "󰑐" : "󰑐")} />
							</button>

							{/* Power Toggle Button */}
							<button
								class={isEnabled((e) => e ? "wifi-power-btn active" : "wifi-power-btn")}
								tooltipText={isEnabled((e) => e ? "Turn off Wi-Fi" : "Turn on Wi-Fi")}
								onClicked={togglePower}
							>
								<label label={isEnabled((e) => e ? "󰤨" : "󰤭")} />
							</button>
						</box>

						{/* Networks Section */}
						<box class="wifi-section last" orientation={Gtk.Orientation.VERTICAL} hexpand>
							{/* State message when Powered Off */}
							<box
								class="wifi-disabled-box"
								orientation={Gtk.Orientation.VERTICAL}
								halign={Gtk.Align.CENTER}
								valign={Gtk.Align.CENTER}
								visible={isEnabled((e) => !e)}
							>
								<label class="wifi-disabled-icon" label="󰤭" />
								<label class="wifi-disabled-text" label="Wi-Fi is turned off" />
							</box>

							{/* Networks list container when Powered On */}
							<box
								orientation={Gtk.Orientation.VERTICAL}
								visible={isEnabled}
								hexpand
							>
								<label
									class="wifi-list-subtitle"
									halign={Gtk.Align.START}
									label={isScanning((scan) => scan ? "Scanning for networks..." : "Available Networks")}
								/>
								<scrolledwindow
									class="wifi-scrolled"
									propagateNaturalHeight={true}
									maxContentHeight={240}
									hscrollbarPolicy={Gtk.PolicyType.NEVER}
								>
									<box class="wifi-network-list" orientation={Gtk.Orientation.VERTICAL} hexpand>
										<box
											halign={Gtk.Align.CENTER}
											valign={Gtk.Align.CENTER}
											marginTop={12}
											marginBottom={12}
											marginStart={12}
											marginEnd={12}
											visible={createComputed(() => sortedAPs().length === 0)}
										>
											<label class="wifi-empty-text" label="No networks found" />
										</box>
										<For each={sortedAPs}>
											{(ap) => {
												const ssid = ap.ssid || ""
												const strength = ap.strength || 0
												const isLocked = ap.requires_password

												const isActive = createComputed(() => {
													const act = activeAp()
													return act && act.bssid === ap.bssid
												})

												const btnClass = createComputed(() => {
													return isActive() ? "wifi-network-btn active" : "wifi-network-btn"
												})

												const statusText = createComputed(() => {
													return isActive() ? "Connected" : `${strength}% Signal`
												})

												return (
													<button
														class={btnClass}
														onClicked={() => {
															if (isActive()) {
																// Connected already
															} else {
																ap.activate(null, () => {})
															}
														}}
													>
														<box valign={Gtk.Align.CENTER} hexpand>
															<label
																class="wifi-network-icon"
																label={getWifiGlyph(strength)}
															/>
															<box orientation={Gtk.Orientation.VERTICAL} halign={Gtk.Align.START} hexpand>
																<label
																	class="wifi-network-name"
																	ellipsize={Pango.EllipsizeMode.END}
																	maxWidthChars={22}
																	halign={Gtk.Align.START}
																	label={ssid}
																/>
																<label
																	class="wifi-network-status"
																	halign={Gtk.Align.START}
																	label={statusText}
																/>
															</box>
															<box hexpand />
															{/* Lock / Connected state icons */}
															<box spacing={6} valign={Gtk.Align.CENTER}>
																{isLocked && (
																	<label class="wifi-network-lock-icon" label="󰌾" />
																)}
																<label
																	class="wifi-network-state-icon"
																	label={isActive((act) => act ? "󰄲" : "")}
																/>
															</box>
														</box>
													</button>
												)
											}}
										</For>
									</box>
								</scrolledwindow>
							</box>
						</box>

					</box>
				</revealer>
			</box>
		</window>
	)
}
