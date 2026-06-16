import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState, createBinding, createComputed, For } from "ags"
import AstalBluetooth from "gi://AstalBluetooth"
import Pango from "gi://Pango"

const [revealed, setRevealed] = createState(false)

function close() {
	app.toggle_window("bluetooth")
}

export default function Bluetooth(gdkmonitor: Gdk.Monitor) {
	const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

	// Calculate geometry to align above the right side of the centered bar
	const geo = gdkmonitor.get_geometry()
	const barWidth = Math.round((geo.width || 1920) * 0.36)
	const marginEnd = Math.max(0, Math.round((geo.width - barWidth) / 2))

	const bt = AstalBluetooth.get_default()!
	const devices = createBinding(bt, "devices")
	const isPowered = createBinding(bt, "isPowered")

	// State for tracking discovery state of active adapter
	const [isDiscovering, setIsDiscovering] = createState(false)

	let lastAdapter: any = null
	let discConn = 0

	const syncAdapter = () => {
		if (discConn && lastAdapter) {
			try {
				lastAdapter.disconnect(discConn)
			} catch {
				// Silent catch
			}
			discConn = 0
		}
		
		const ad = bt.adapter
		lastAdapter = ad
		if (!ad) {
			setIsDiscovering(false)
			return
		}
		
		setIsDiscovering(ad.discovering)
		discConn = ad.connect("notify::discovering", () => {
			setIsDiscovering(ad.discovering)
		})
	}

	// Initialize sync
	syncAdapter()
	bt.connect("notify::adapter", syncAdapter)

	// Power toggle helper
	const togglePower = () => {
		bt.toggle()
	}

	// Toggle discovery helper
	const toggleDiscovery = () => {
		const ad = bt.adapter
		if (!ad) return
		if (ad.discovering) {
			ad.stop_discovery()
		} else {
			ad.start_discovery()
		}
	}

	// Get a nice Nerd Font icon for a device category based on d.icon or d.name
	const getDeviceIcon = (d: AstalBluetooth.Device) => {
		const iconName = d.icon?.toLowerCase() || ""
		const name = d.name?.toLowerCase() || ""
		if (iconName.includes("headset") || iconName.includes("headphones") || name.includes("headphone") || name.includes("earbud") || name.includes("pods") || name.includes("xm5")) {
			return "󰋋" // headphones
		}
		if (iconName.includes("keyboard") || name.includes("keyboard")) {
			return "󰌌" // keyboard
		}
		if (iconName.includes("mouse") || name.includes("mouse")) {
			return "󰍽" // mouse
		}
		if (iconName.includes("phone") || name.includes("phone")) {
			return "󰏲" // phone
		}
		if (iconName.includes("audio") || name.includes("sound") || name.includes("speaker") || name.includes("charge")) {
			return "󰓃" // speaker / audio
		}
		return "󰂯" // generic bluetooth
	}

	return (
		<window
			name="bluetooth"
			namespace="bluetooth"
			class="Bluetooth"
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
					// Automatically scan when window becomes visible, if powered on
					if (self.visible && bt.is_powered && bt.adapter) {
						bt.adapter.start_discovery()
					} else if (!self.visible && bt.adapter && bt.adapter.discovering) {
						bt.adapter.stop_discovery()
					}
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
					<box class="bluetooth-box" orientation={Gtk.Orientation.VERTICAL}>
						<Gtk.GestureClick
							onReleased={(g) => g.set_state(Gtk.EventSequenceState.CLAIMED)}
						/>

						{/* Header Section with Title, Power Toggle and Scan Toggle */}
						<box class="bluetooth-header" valign={Gtk.Align.CENTER}>
							<label class="bluetooth-title" halign={Gtk.Align.START} label="Bluetooth" />
							<box hexpand />
							
							{/* Scan / Discovery toggle button */}
							<button
								class={isDiscovering((disc) => disc ? "bluetooth-action-btn active scanning" : "bluetooth-action-btn")}
								tooltipText={isDiscovering((disc) => disc ? "Stop scanning" : "Scan for devices")}
								visible={isPowered}
								onClicked={toggleDiscovery}
							>
								<label label={isDiscovering((disc) => disc ? "󰂰" : "󰂰")} />
							</button>

							{/* Power Toggle Button */}
							<button
								class={isPowered((p) => p ? "bluetooth-power-btn active" : "bluetooth-power-btn")}
								tooltipText={isPowered((p) => p ? "Turn off Bluetooth" : "Turn on Bluetooth")}
								onClicked={togglePower}
							>
								<label label={isPowered((p) => p ? "󰂯" : "󰂲")} />
							</button>
						</box>

						{/* Devices Section */}
						<box class="bluetooth-section last" orientation={Gtk.Orientation.VERTICAL} hexpand>
							{/* State message when Powered Off */}
							<box
								class="bluetooth-disabled-box"
								orientation={Gtk.Orientation.VERTICAL}
								halign={Gtk.Align.CENTER}
								valign={Gtk.Align.CENTER}
								visible={isPowered((p) => !p)}
							>
								<label class="bluetooth-disabled-icon" label="󰂲" />
								<label class="bluetooth-disabled-text" label="Bluetooth is turned off" />
							</box>

							{/* Devices list container when Powered On */}
							<box
								orientation={Gtk.Orientation.VERTICAL}
								visible={isPowered}
								hexpand
							>
								<label
									class="bluetooth-list-subtitle"
									halign={Gtk.Align.START}
									label={isDiscovering((disc) => disc ? "Scanning for devices..." : "Paired & Available Devices")}
								/>
								<scrolledwindow
									class="bluetooth-scrolled"
									propagateNaturalHeight={true}
									maxContentHeight={240}
									hscrollbarPolicy={Gtk.PolicyType.NEVER}
								>
									<box class="bluetooth-device-list" orientation={Gtk.Orientation.VERTICAL} hexpand>
										<box
											halign={Gtk.Align.CENTER}
											valign={Gtk.Align.CENTER}
											marginTop={12}
											marginBottom={12}
											marginStart={12}
											marginEnd={12}
											visible={createBinding(bt, "devices")((devs) => devs.length === 0)}
										>
											<label class="bluetooth-empty-text" label="No devices found" />
										</box>
										<For each={devices}>
											{(d) => {
												const connected = createBinding(d, "connected")
												const connecting = createBinding(d, "connecting")
												const name = createBinding(d, "name")
												const alias = createBinding(d, "alias")
												const battery = createBinding(d, "battery_percentage")

												const btnClass = createComputed(() => {
													if (connected()) return "bluetooth-device-btn connected"
													if (connecting()) return "bluetooth-device-btn connecting"
													return "bluetooth-device-btn"
												})

												const deviceNameText = createComputed(() => {
													return alias() || name() || d.address
												})

												const deviceStatusText = createComputed(() => {
													if (connecting()) return "Connecting..."
													if (connected()) {
														const bat = battery()
														return bat > 0 ? `Connected (${bat}%)` : "Connected"
													}
													return d.paired ? "Paired" : "Available"
												})

												const deviceStateIcon = createComputed(() => {
													if (connecting()) return "󱑊"
													if (connected()) return "󰄲"
													return ""
												})

												return (
													<button
														class={btnClass}
														onClicked={() => {
															if (d.connected) {
																d.disconnect_device(() => {})
															} else {
																d.connect_device(() => {})
															}
														}}
													>
														<box valign={Gtk.Align.CENTER} hexpand>
															<label
																class="bluetooth-device-icon"
																label={getDeviceIcon(d)}
															/>
															<box orientation={Gtk.Orientation.VERTICAL} halign={Gtk.Align.START} hexpand>
																<label
																	class="bluetooth-device-name"
																	ellipsize={Pango.EllipsizeMode.END}
																	maxWidthChars={22}
																	halign={Gtk.Align.START}
																	label={deviceNameText}
																/>
																<label
																	class="bluetooth-device-status"
																	halign={Gtk.Align.START}
																	label={deviceStatusText}
																/>
															</box>
															<box hexpand />
															{/* Connection state icon */}
															<label
																class="bluetooth-device-state-icon"
																label={deviceStateIcon}
															/>
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
