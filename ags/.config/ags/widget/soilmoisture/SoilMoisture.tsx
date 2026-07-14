import app from "ags/gtk4/app";
import { Astal, Gtk, Gdk } from "ags/gtk4";
import { createState } from "ags";
import { execAsync } from "ags/process";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import { palette } from "../../lib/wal";

interface DataPoint {
	time: Date;
	value: number;
}

interface SoilSensor {
	entityId: string;
	name: string;
}

// ── ENVIRONMENT / CONFIG LOAD ──────────────────────────────────────────────
// Load variables from private env config file outside the repo to avoid committing any PII.
// The sensor list itself (which HA entities map to which plant) is kept in the
// same private config, since sensor names/locations are not tracked in any repo.
function loadPrivateConfig() {
	const home = GLib.get_home_dir();
	const configPath = `${home}/.config/deckblaster.env`;
	const conf: Record<string, string> = {};

	try {
		const [, content] = GLib.file_get_contents(configPath);
		const lines = content.toString().split("\n");
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;

			const clean = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
			const eqIndex = clean.indexOf("=");
			if (eqIndex === -1) continue;

			const key = clean.slice(0, eqIndex).trim();
			let val = clean.slice(eqIndex + 1).trim();

			if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
			if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);

			conf[key] = val;
		}
	} catch {
		// Silent fallback if file doesn't exist
	}

	return {
		HA_URL: GLib.getenv("HA_URL") || conf["HA_URL"] || "",
		HA_TOKEN: GLib.getenv("HA_TOKEN") || conf["HA_TOKEN"] || "",
		HA_SOIL_SENSORS: GLib.getenv("HA_SOIL_SENSORS") || conf["HA_SOIL_SENSORS"] || "",
		HA_SOIL_TITLE: GLib.getenv("HA_SOIL_TITLE") || conf["HA_SOIL_TITLE"] || "Soil Moisture",
	};
}

const config = loadPrivateConfig();

// Path to the private env file (kept outside the repo so no PII is committed).
const CONFIG_FILE = `${GLib.get_home_dir()}/.config/deckblaster.env`;

// ── SENSOR LIST ──────────────────────────────────────────────────────────────
// Format: "entity_id:Label,entity_id:Label,..." — lives entirely in the
// private config, never hardcoded / committed to the repo.
function parseSensorList(raw: string): SoilSensor[] {
	if (!raw) return [];
	return raw
		.split(",")
		.map((chunk) => chunk.trim())
		.filter(Boolean)
		.map((chunk) => {
			const idx = chunk.indexOf(":");
			if (idx === -1) return { entityId: chunk, name: chunk };
			return { entityId: chunk.slice(0, idx).trim(), name: chunk.slice(idx + 1).trim() };
		});
}

const sensors = parseSensorList(config.HA_SOIL_SENSORS);

interface MissingItem {
	key: string;
	hint: string;
}

function missingConfig(): MissingItem[] {
	const items: MissingItem[] = [];
	if (!config.HA_URL) {
		items.push({
			key: "HA_URL",
			hint: "Home Assistant base URL, e.g. http://homeassistant.local:8123",
		});
	}
	if (!config.HA_TOKEN) {
		items.push({
			key: "HA_TOKEN",
			hint: "Long-lived access token (HA → Settings → People → you → Long-Lived Access Tokens)",
		});
	}
	if (!sensors.length) {
		items.push({
			key: "HA_SOIL_SENSORS",
			hint: 'Comma separated "entity_id:Label" pairs, e.g. sensor.plant1_moisture:Nila,sensor.plant2_moisture:Arbeitszimmer',
		});
	}
	return items;
}

const missing = missingConfig();

// Badge/curve colors, one per sensor slot, pulled from the wal palette so the
// widget stays in sync with the rest of the desktop theme.
const SLOT_COLORS = [3, 5, 2, 4, 1, 0];

// ── CACHING FUNCTIONS ────────────────────────────────────────────────────────
const CACHE_PATH = `${GLib.get_user_cache_dir()}/ags-soil-cache.json`;

interface CachePayload {
	history: Array<Array<{ time: string; value: number }>>;
}

function readLocalCache(): DataPoint[][] | null {
	try {
		const file = Gio.File.new_for_path(CACHE_PATH);
		const [, content] = file.load_contents(null);
		const parsed = JSON.parse(new TextDecoder("utf-8").decode(content)) as CachePayload;

		return parsed.history.map((series) => series.map((p) => ({ time: new Date(p.time), value: p.value })));
	} catch {
		return null;
	}
}

function writeLocalCache(history: DataPoint[][]) {
	try {
		const file = Gio.File.new_for_path(CACHE_PATH);
		const payload: CachePayload = {
			history: history.map((series) => series.map((p) => ({ time: p.time.toISOString(), value: p.value }))),
		};
		file.replace_contents(
			new TextEncoder().encode(JSON.stringify(payload)),
			null,
			false,
			Gio.FileCreateFlags.REPLACE_DESTINATION,
			null,
		);
	} catch (e) {
		console.error("Error writing soil moisture cache:", e);
	}
}

// ── STATE PARSING ────────────────────────────────────────────────────────────
function parseHistory(jsonText: string): DataPoint[][] | null {
	try {
		const data = JSON.parse(jsonText);
		if (!Array.isArray(data)) return null;

		const byEntity = new Map<string, DataPoint[]>();

		for (const entityArray of data) {
			if (!Array.isArray(entityArray) || entityArray.length === 0) continue;
			const first = entityArray[0];
			const entityId = first.entity_id;
			const list: DataPoint[] = [];

			for (const point of entityArray) {
				const val = parseFloat(point.state);
				if (isNaN(val)) continue;
				list.push({ time: new Date(point.last_updated), value: val });
			}

			list.sort((a, b) => a.time.getTime() - b.time.getTime());
			byEntity.set(entityId, list);
		}

		return sensors.map((s) => byEntity.get(s.entityId) ?? []);
	} catch (e) {
		console.error("Error parsing soil moisture history:", e);
		return null;
	}
}

function getRgb(hexColor: string) {
	const h = hexColor.replace("#", "");
	const r = parseInt(h.slice(0, 2), 16) / 255;
	const g = parseInt(h.slice(2, 4), 16) / 255;
	const b = parseInt(h.slice(4, 6), 16) / 255;
	return { r, g, b };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ── WIDGET COMPONENT ─────────────────────────────────────────────────────────
export default function SoilMoisture(gdkmonitor: Gdk.Monitor) {
	const { RIGHT, TOP } = Astal.WindowAnchor;

	const [currentValues, setCurrentValues] = createState<string[]>(sensors.map(() => "..."));
	const [history, setHistory] = createState<DataPoint[][]>(sensors.map(() => []));

	let drawingArea: Gtk.DrawingArea;

	// 1. Try to load instantly from cache on startup
	const cached = readLocalCache();
	if (cached && cached.length === sensors.length) {
		setHistory(cached);
		setCurrentValues(cached.map((series) => (series.length > 0 ? series[series.length - 1].value.toFixed(0) : "...")));
	}

	// 2. Async fetch in background
	async function updateData() {
		if (!config.HA_TOKEN || !config.HA_URL || !sensors.length) return;

		const weekAgo = new Date(Date.now() - WEEK_MS).toISOString();
		const now = new Date().toISOString();
		const entityFilter = sensors.map((s) => s.entityId).join(",");
		try {
			const stdout = await execAsync([
				"curl",
				"-s",
				"-H",
				`Authorization: Bearer ${config.HA_TOKEN}`,
				// HA defaults end_time to start_time + 1 day when omitted, so a
				// week-long start would silently only return the first day.
				`${config.HA_URL}/api/history/period/${weekAgo}?filter_entity_id=${entityFilter}&end_time=${now}`,
			]);

			const parsed = parseHistory(stdout);
			if (parsed) {
				setHistory(parsed);
				setCurrentValues(parsed.map((series) => (series.length > 0 ? series[series.length - 1].value.toFixed(0) : "...")));

				// Redraw vector area
				drawingArea?.queue_draw();

				// Save successful fetch to local cache for instant load next time
				writeLocalCache(parsed);
			}
		} catch (err) {
			console.error("Error fetching HA soil moisture:", err);
		}
	}

	// Fetch current data in the background
	updateData();

	// Poll for updates in the background
	const intervalId = setInterval(updateData, 5 * 60 * 1000);

	const drawGraph = (area: Gtk.DrawingArea, cr: any, width: number, height: number) => {
		const series = history.get();

		// Clean transparent canvas
		cr.setSourceRGBA(0, 0, 0, 0);
		cr.paint();

		const now = Date.now();
		const xMin = now - WEEK_MS;
		const xMax = now;

		let yMin = 0;
		let yMax = 100;

		const allVals = series.flat().map((p) => p.value);
		if (allVals.length > 0) {
			yMin = Math.max(0, Math.min(...allVals) - 8);
			yMax = Math.min(100, Math.max(...allVals) + 8);
		}

		if (yMax - yMin < 10) {
			yMax = Math.min(100, yMin + 10);
		}

		const mapX = (time: Date) => {
			const t = time.getTime();
			const pct = (t - xMin) / (xMax - xMin);
			return pct * width;
		};

		const mapY = (val: number) => {
			const pct = (val - yMin) / (yMax - yMin);
			return (1 - pct) * height;
		};

		// 1. Draw horizontal grid lines (much more subtle)
		cr.setLineWidth(1);
		cr.setSourceRGBA(1, 1, 1, 0.04);

		const gridLines = 2;
		for (let i = 0; i <= gridLines; i++) {
			const val = yMin + (i / gridLines) * (yMax - yMin);
			const y = mapY(val);
			cr.moveTo(0, y);
			cr.lineTo(width, y);
			cr.stroke();

			// Text value labels (much more subtle)
			cr.setSourceRGBA(1, 1, 1, 0.16);
			cr.setFontSize(8.5);
			cr.moveTo(4, y - 4);
			cr.showText(`${val.toFixed(0)}%`);
		}

		// 2. Plot curves
		const drawCurve = (points: DataPoint[], hexColor: string) => {
			if (points.length === 0) return;
			const rgb = getRgb(hexColor);
			cr.setSourceRGBA(rgb.r, rgb.g, rgb.b, 0.95);
			cr.setLineWidth(2.2);

			let first = true;
			for (const p of points) {
				const x = mapX(p.time);
				const y = mapY(p.value);
				if (first) {
					cr.moveTo(x, y);
					first = false;
				} else {
					cr.lineTo(x, y);
				}
			}
			cr.stroke();
		};

		series.forEach((points, i) => {
			drawCurve(points, palette.get().color[SLOT_COLORS[i % SLOT_COLORS.length]]);
		});
	};

	return (
		<window
			visible={false}
			name="soilmoisture"
			namespace="ags-soilmoisture"
			class="SoilMoisture"
			gdkmonitor={gdkmonitor}
			anchor={RIGHT | TOP}
			exclusivity={Astal.Exclusivity.NORMAL}
			layer={Astal.Layer.BACKGROUND}
			marginTop={280}
			marginRight={24}
			application={app}
			$={(self) => {
				self.layer = Astal.Layer.BACKGROUND;
				self.set_visible(true);
				self.connect("destroy", () => clearInterval(intervalId));
			}}
		>
			<box class="soil-container" orientation={Gtk.Orientation.VERTICAL} widthRequest={320} hexpand={false} halign={Gtk.Align.START}>
				<centerbox hexpand={false}>
					<box $type="start">
						<label class="soil-title" label={config.HA_SOIL_TITLE} />
					</box>
					<box $type="center" />
					<box class="soil-end-badges" $type="end" spacing={4} hexpand={false} visible={!missing.length}>
						{sensors.map((s, i) => (
							<label
								class={`soil-badge soil-badge-${i % SLOT_COLORS.length}`}
								label={currentValues((vs) => `󰖌  ${vs[i] ?? "..."}%`)}
								tooltipText={s.name}
							/>
						))}
					</box>
				</centerbox>

				{missing.length > 0 ? (
					<box class="soil-error" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
						<label
							class="soil-error-title"
							halign={Gtk.Align.START}
							label="Soil moisture widget not configured"
						/>
						<label
							class="soil-error-hint"
							halign={Gtk.Align.START}
							wrap
							label={`Add the following keys to ${CONFIG_FILE} (or export them as environment variables), then restart AGS:`}
						/>
						{missing.map((m) => (
							<box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
								<label class="soil-error-key" halign={Gtk.Align.START} label={m.key} />
								<label
									class="soil-error-desc"
									halign={Gtk.Align.START}
									wrap
									label={`↳ ${m.hint}`}
								/>
							</box>
						))}
					</box>
				) : (
					<box orientation={Gtk.Orientation.VERTICAL}>
						<Gtk.DrawingArea
							class="soil-drawing-area"
							heightRequest={160}
							$={(self) => {
								drawingArea = self;
								self.set_draw_func(drawGraph);
							}}
						/>

						<centerbox>
							<box $type="start">
								<label class="soil-footer-label" label="7d ago" />
							</box>
							<box $type="center" />
							<box $type="end">
								<label class="soil-footer-label" label="Now" />
							</box>
						</centerbox>
					</box>
				)}
			</box>
		</window>
	);
}
