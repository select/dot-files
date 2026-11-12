#!/usr/bin/env python3
"""Minimal screenshot annotator: pen, text, box and ellipse.

Usage: screenshot-annotate.py /path/to/screenshot.png

Enter / Ctrl+S saves over the PNG and copies it to the clipboard; Ctrl+C copies only.
Esc closes (press twice to discard unsaved annotations). Uses system PyGObject, no
third-party packages.
"""
import math
import os
import subprocess
import sys
import tempfile

import cairo
import gi

gi.require_version("Pango", "1.0")
gi.require_version("PangoCairo", "1.0")
from gi.repository import Pango, PangoCairo  # noqa: E402

COLORS = [
	("Red", (0.93, 0.16, 0.18)),
	("Yellow", (1.0, 0.82, 0.1)),
	("Green", (0.2, 0.78, 0.35)),
	("Blue", (0.18, 0.5, 1.0)),
	("White", (1.0, 1.0, 1.0)),
	("Black", (0.05, 0.05, 0.05)),
]
SIZES = [("Thin", 3), ("Medium", 6), ("Thick", 12)]
TOOLS = [("pen", "󰏫", "Pen (P)"), ("rect", "󰆞", "Box (B / R)"), ("ellipse", "󰺡", "Ellipse (E / O)"), ("text", "󰊄", "Text (T)")]


def font_size(width):
	"""Text size in screen pixels for a stroke width."""
	return 12 + width * 2.5


def box(shape, square=False):
	"""Normalized (x, y, w, h); Shift constrains to a square/circle from the anchor."""
	x0, y0, x1, y1 = shape["x0"], shape["y0"], shape["x1"], shape["y1"]
	if square:
		side = max(abs(x1 - x0), abs(y1 - y0))
		x1 = x0 + math.copysign(side, x1 - x0 or 1)
		y1 = y0 + math.copysign(side, y1 - y0 or 1)
	return min(x0, x1), min(y0, y1), abs(x1 - x0), abs(y1 - y0)


def visible(shape):
	if shape["kind"] == "pen":
		return len(shape["points"]) > 0
	if shape["kind"] == "text":
		return bool(shape["text"].strip())
	_, _, w, h = box(shape, shape.get("square", False))
	return w >= 2 and h >= 2


def text_layout(cr, shape):
	layout = PangoCairo.create_layout(cr)
	description = Pango.FontDescription.from_string("Sans Bold")
	description.set_absolute_size(shape["size"] * Pango.SCALE)
	layout.set_font_description(description)
	layout.set_text(shape["text"], -1)
	return layout


def draw_shape(cr, shape):
	"""Draw in image coordinates; widths are already in image pixels."""
	if not visible(shape):
		return
	cr.save()
	cr.set_source_rgb(*shape["color"])
	cr.set_line_width(shape["width"])
	cr.set_line_cap(cairo.LINE_CAP_ROUND)
	cr.set_line_join(cairo.LINE_JOIN_ROUND)
	kind = shape["kind"]
	if kind == "pen":
		points = shape["points"]
		cr.move_to(*points[0])
		if len(points) == 1:
			cr.line_to(points[0][0] + 0.01, points[0][1])
		for point in points[1:]:
			cr.line_to(*point)
		cr.stroke()
	elif kind == "rect":
		cr.rectangle(*box(shape, shape.get("square", False)))
		cr.stroke()
	elif kind == "ellipse":
		x, y, w, h = box(shape, shape.get("square", False))
		cr.save()
		cr.translate(x + w / 2, y + h / 2)
		cr.scale(w / 2, h / 2)
		cr.arc(0, 0, 1, 0, 2 * math.pi)
		cr.restore()  # stroke with an unscaled, uniform pen
		cr.stroke()
	elif kind == "text":
		layout = text_layout(cr, shape)
		cr.move_to(shape["x"], shape["y"])
		PangoCairo.layout_path(cr, layout)
		# Contrasting outline keeps text readable on any background.
		dark = sum(shape["color"]) / 3 > 0.5
		cr.set_source_rgba(0, 0, 0, 0.75) if dark else cr.set_source_rgba(1, 1, 1, 0.8)
		cr.set_line_width(max(2, shape["size"] / 8))
		cr.stroke_preserve()
		cr.set_source_rgb(*shape["color"])
		cr.fill()
	cr.restore()


def render(image, shapes):
	surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, image.get_width(), image.get_height())
	cr = cairo.Context(surface)
	cr.set_source_surface(image, 0, 0)
	cr.paint()
	for shape in shapes:
		draw_shape(cr, shape)
	surface.flush()
	return surface


def save(path, image, shapes):
	"""Atomically replace the PNG, preserving its permissions."""
	directory = os.path.dirname(os.path.abspath(path))
	mode = os.stat(path).st_mode & 0o777 if os.path.exists(path) else 0o644
	descriptor, temporary = tempfile.mkstemp(prefix=".annotate-", suffix=".png", dir=directory)
	os.close(descriptor)
	try:
		render(image, shapes).write_to_png(temporary)
		os.chmod(temporary, mode)
		os.replace(temporary, path)
	except BaseException:
		if os.path.exists(temporary):
			os.unlink(temporary)
		raise


def copy(path):
	with open(path, "rb") as data:
		subprocess.run(["wl-copy", "--type", "image/png"], stdin=data, check=True, timeout=10)


def run(path):
	gi.require_version("Gtk", "4.0")
	gi.require_version("Gdk", "4.0")
	from gi.repository import Gdk, Gio, Gtk

	image = cairo.ImageSurface.create_from_png(path)

	class Editor(Gtk.ApplicationWindow):
		def __init__(self, app):
			super().__init__(application=app, title="Annotate screenshot")
			self.shapes, self.redo = [], []
			self.current = None
			self.tool, self.color, self.width = "pen", COLORS[0][1], SIZES[1][1]
			self.dirty = False
			self.discard = False
			self.entry_shape = None
			self.scale, self.offset = 1.0, (0.0, 0.0)

			root = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
			root.add_css_class("annotate")
			self.set_child(root)
			root.append(self.toolbar(Gtk))

			self.area = Gtk.DrawingArea(hexpand=True, vexpand=True)
			self.area.set_draw_func(self.draw)
			# The text-entry layer covers the canvas, so gestures live on their shared
			# parent; events on the empty layer bubble up, the entry claims its own clicks.
			self.fixed = Gtk.Fixed()
			overlay = Gtk.Overlay()
			overlay.set_child(self.area)
			overlay.add_overlay(self.fixed)
			overlay.set_cursor(Gdk.Cursor.new_from_name("crosshair"))
			drag = Gtk.GestureDrag()
			drag.connect("drag-begin", self.begin)
			drag.connect("drag-update", self.update)
			drag.connect("drag-end", self.end)
			overlay.add_controller(drag)
			root.append(overlay)
			self.entry = Gtk.Entry(placeholder_text="Type, then Enter")
			self.entry.set_cursor(Gdk.Cursor.new_from_name("text"))
			self.entry.connect("activate", lambda *_: self.commit_text())

			keys = Gtk.EventControllerKey(propagation_phase=Gtk.PropagationPhase.CAPTURE)
			keys.connect("key-pressed", self.key)
			self.add_controller(keys)
			self.status.set_label(f"{image.get_width()}×{image.get_height()} · Enter saves + copies · Esc closes")

		def toolbar(self, Gtk):
			bar = Gtk.Box(spacing=6, margin_top=8, margin_bottom=8, margin_start=10, margin_end=10)
			self.tool_buttons = {}
			group = None
			for tool, icon, tip in TOOLS:
				button = Gtk.ToggleButton(label=icon, tooltip_text=tip, active=tool == self.tool)
				button.set_group(group)
				group = group or button
				button.connect("toggled", lambda b, t=tool: b.get_active() and self.set_tool(t))
				self.tool_buttons[tool] = button
				bar.append(button)
			bar.append(Gtk.Separator(orientation=Gtk.Orientation.VERTICAL))
			self.color_buttons = []
			group = None
			for index, (name, rgb) in enumerate(COLORS):
				button = Gtk.ToggleButton(tooltip_text=f"{name} ({index + 1})", active=index == 0)
				swatch = Gtk.DrawingArea(content_width=16, content_height=16)
				swatch.set_draw_func(lambda _a, cr, w, h, c=rgb: (cr.set_source_rgb(*c), cr.arc(w / 2, h / 2, 7, 0, 7), cr.fill()))
				button.set_child(swatch)
				button.set_group(group)
				group = group or button
				button.connect("toggled", lambda b, c=rgb: b.get_active() and setattr(self, "color", c))
				self.color_buttons.append(button)
				bar.append(button)
			bar.append(Gtk.Separator(orientation=Gtk.Orientation.VERTICAL))
			self.size_buttons = []
			group = None
			for index, (name, width) in enumerate(SIZES):
				button = Gtk.ToggleButton(label=name[0], tooltip_text=f"{name} ([ / ])", active=width == self.width)
				button.set_group(group)
				group = group or button
				button.connect("toggled", lambda b, w=width: b.get_active() and setattr(self, "width", w))
				self.size_buttons.append(button)
				bar.append(button)
			bar.append(Gtk.Separator(orientation=Gtk.Orientation.VERTICAL))
			for label, tip, action in [("󰕌", "Undo (Ctrl+Z)", self.undo), ("󰑎", "Redo (Ctrl+Shift+Z)", self.redo_last)]:
				button = Gtk.Button(label=label, tooltip_text=tip)
				button.connect("clicked", lambda *_a, f=action: f())
				bar.append(button)
			self.status = Gtk.Label(hexpand=True, xalign=0.5)
			self.status.add_css_class("dim-label")
			bar.append(self.status)
			for label, tip, action, css in [
				("Copy", "Copy to clipboard (Ctrl+C)", lambda: self.finish(close=False), None),
				("Cancel", "Close (Esc)", self.cancel, None),
				("Save", "Save + copy (Enter / Ctrl+S)", lambda: self.finish(close=True), "suggested-action"),
			]:
				button = Gtk.Button(label=label, tooltip_text=tip)
				if css:
					button.add_css_class(css)
				button.connect("clicked", lambda *_a, f=action: f())
				bar.append(button)
			return bar

		# Geometry: shapes are stored in image pixels.
		def to_image(self, x, y):
			return ((x - self.offset[0]) / self.scale, (y - self.offset[1]) / self.scale)

		def to_screen(self, x, y):
			return (x * self.scale + self.offset[0], y * self.scale + self.offset[1])

		def draw(self, _area, cr, width, height):
			pad = 16
			iw, ih = image.get_width(), image.get_height()
			self.scale = max(0.01, min((width - pad * 2) / iw, (height - pad * 2) / ih, 1.0))
			self.offset = ((width - iw * self.scale) / 2, (height - ih * self.scale) / 2)
			cr.set_source_rgb(0.12, 0.12, 0.13)
			cr.paint()
			cr.translate(*self.offset)
			cr.scale(self.scale, self.scale)
			cr.set_source_surface(image, 0, 0)
			cr.get_source().set_filter(cairo.FILTER_GOOD)
			cr.paint()
			for shape in self.shapes + ([self.current] if self.current else []):
				draw_shape(cr, shape)

		def set_tool(self, tool):
			self.commit_text()
			self.tool = tool

		def pick(self, buttons, index):
			buttons[max(0, min(len(buttons) - 1, index))].set_active(True)

		def shift(self, gesture):
			return bool(gesture.get_current_event_state() & Gdk.ModifierType.SHIFT_MASK)

		def begin(self, gesture, x, y):
			self.commit_text()
			ix, iy = self.to_image(x, y)
			width = self.width / self.scale  # constant on-screen thickness
			if self.tool == "text":
				gesture.set_state(Gtk.EventSequenceState.CLAIMED)
				self.start_text(x, y, ix, iy)
				return
			if self.tool == "pen":
				self.current = {"kind": "pen", "color": self.color, "width": width, "points": [(ix, iy)]}
			else:
				self.current = {"kind": self.tool, "color": self.color, "width": width,
					"x0": ix, "y0": iy, "x1": ix, "y1": iy, "square": self.shift(gesture)}
			self.area.queue_draw()

		def update(self, gesture, dx, dy):
			if not self.current:
				return
			ok, x, y = gesture.get_start_point()
			ix, iy = self.to_image(x + dx, y + dy)
			if self.current["kind"] == "pen":
				last = self.current["points"][-1]
				if math.hypot(ix - last[0], iy - last[1]) * self.scale >= 1:
					self.current["points"].append((ix, iy))
			else:
				self.current.update(x1=ix, y1=iy, square=self.shift(gesture))
			self.area.queue_draw()

		def end(self, gesture, dx, dy):
			if not self.current:
				return
			self.update(gesture, dx, dy)
			if visible(self.current):
				self.add(self.current)
			self.current = None
			self.area.queue_draw()

		def add(self, shape):
			self.shapes.append(shape)
			self.redo.clear()
			self.dirty, self.discard = True, False

		def start_text(self, x, y, ix, iy):
			size = font_size(self.width)
			self.entry_shape = {"kind": "text", "color": self.color, "size": size / self.scale,
				"width": 0, "x": ix, "y": iy - size * 0.6 / self.scale, "text": ""}
			self.entry.set_text("")
			if self.entry.get_parent() is None:
				self.fixed.put(self.entry, x, max(0, y - 18))
			else:
				self.fixed.move(self.entry, x, max(0, y - 18))
			self.entry.grab_focus()

		def commit_text(self, cancel=False):
			shape, self.entry_shape = self.entry_shape, None
			if shape is None:
				return False
			text = self.entry.get_text()
			if self.entry.get_parent() is not None:
				self.fixed.remove(self.entry)
			if not cancel and text.strip():
				shape["text"] = text
				self.add(shape)
			self.area.queue_draw()
			return False

		def undo(self):
			self.commit_text()
			if self.shapes:
				self.redo.append(self.shapes.pop())
				self.dirty, self.discard = True, False
				self.area.queue_draw()

		def redo_last(self):
			if self.redo:
				self.shapes.append(self.redo.pop())
				self.dirty, self.discard = True, False
				self.area.queue_draw()

		def finish(self, close):
			self.commit_text()
			try:
				if self.dirty:
					save(path, image, self.shapes)
					self.dirty = False
				copy(path)
			except Exception as error:  # Keep the editor open; nothing is lost.
				self.status.set_label(f"Save/copy failed: {error}")
				return
			if close:
				self.get_application().quit()
				return
			self.status.set_label("Copied to clipboard")

		def cancel(self):
			if self.dirty and not self.discard:
				self.discard = True
				self.status.set_label("Unsaved annotations — press Esc again to discard, Enter to save")
				return
			self.get_application().quit()

		def key(self, _controller, keyval, _code, state):
			ctrl = bool(state & Gdk.ModifierType.CONTROL_MASK)
			shift = bool(state & Gdk.ModifierType.SHIFT_MASK)
			name = (Gdk.keyval_name(keyval) or "").lower()
			if self.entry_shape is not None:
				if name == "escape":
					self.commit_text(cancel=True)
					return True
				return False  # The entry owns text input, including Enter.
			if ctrl and name == "z":
				self.redo_last() if shift else self.undo()
			elif ctrl and name == "y":
				self.redo_last()
			elif ctrl and name == "s":
				self.finish(close=True)
			elif ctrl and name == "c":
				self.finish(close=False)
			elif ctrl:
				return False
			elif name in ("return", "kp_enter"):
				self.finish(close=True)
			elif name == "escape":
				self.cancel()
			elif name in ("p", "b", "r", "e", "o", "t"):
				tool = {"p": "pen", "b": "rect", "r": "rect", "e": "ellipse", "o": "ellipse", "t": "text"}[name]
				self.tool_buttons[tool].set_active(True)
			elif name in [str(i) for i in range(1, len(COLORS) + 1)]:
				self.pick(self.color_buttons, int(name) - 1)
			elif name in ("bracketleft", "bracketright"):
				current = [w for _n, w in SIZES].index(self.width)
				self.pick(self.size_buttons, current + (1 if name == "bracketright" else -1))
			else:
				return False
			return True

	# Non-unique: a second screenshot must open its own editor, not activate the first.
	app = Gtk.Application(application_id="dev.dotfiles.ScreenshotAnnotate", flags=Gio.ApplicationFlags.NON_UNIQUE)

	def activate(application):
		css = Gtk.CssProvider()
		css.load_from_string(".annotate { background: #1f1f21; } .annotate button { min-width: 30px; }")
		Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
		window = Editor(application)
		# Floating size/position come from the Hyprland window rule for this app id.
		window.set_default_size(1400, 900)
		window.present()

	app.connect("activate", activate)
	return app.run([sys.argv[0]])


if __name__ == "__main__":
	if len(sys.argv) != 2 or not sys.argv[1].lower().endswith(".png") or not os.path.isfile(sys.argv[1]):
		print(__doc__.strip(), file=sys.stderr)
		sys.exit(2)
	sys.exit(run(sys.argv[1]))
