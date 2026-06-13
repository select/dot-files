import app from "ags/gtk4/app";
import { Astal, Gtk, Gdk } from "ags/gtk4";
import { createBinding, For } from "ags";

import AstalTray from "gi://AstalTray";

// A single StatusNotifierItem. Left-click activates the app; the popover
// exposes the app's own menu (Quit/Exit/etc) so apps like Zoom can be closed.
function TrayItem({ item }: { item: AstalTray.TrayItem }) {
	const gicon = createBinding(item, "gicon");
	const tooltip = createBinding(item, "tooltipMarkup");
	return (
		<menubutton
			class="tray-item"
			tooltipMarkup={tooltip}
			$={(self: Gtk.MenuButton) => {
				const sync = () => {
					self.set_menu_model(item.menuModel);
					self.insert_action_group("dbusmenu", item.actionGroup);
				};
				sync();
				item.connect("notify::menu-model", sync);
				item.connect("notify::action-group", sync);
			}}
		>
			<image gicon={gicon} pixelSize={16} />
		</menubutton>
	);
}

export default function Tray(gdkmonitor: Gdk.Monitor) {
	const { BOTTOM, RIGHT } = Astal.WindowAnchor;
	const tray = AstalTray.get_default();
	const items = createBinding(tray, "items");

	return (
		<window
			visible={items((a) => a.length > 0)}
			name="tray"
			namespace="ags-tray"
			class="Tray"
			gdkmonitor={gdkmonitor}
			anchor={BOTTOM | RIGHT}
			exclusivity={Astal.Exclusivity.IGNORE}
			layer={Astal.Layer.TOP}
			marginBottom={6}
			marginEnd={12}
			application={app}
		>
			<box class="tray-inner">
				<For each={items}>{(item) => <TrayItem item={item} />}</For>
			</box>
		</window>
	);
}
