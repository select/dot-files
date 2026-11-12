"""GTK smoke test under Xvfb: builds the real editor, draws via its handlers, saves.

Run: xvfb-run -a env GDK_BACKEND=x11 /usr/bin/python3 -B hyprland/.config/hypr/scripts/smoke_screenshot_annotate.py
"""
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

import cairo
import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
from gi.repository import Gdk, GLib, Gtk  # noqa: E402

spec = importlib.util.spec_from_file_location("annotate", Path(__file__).with_name("screenshot-annotate.py"))
annotate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(annotate)
copied = []
annotate.copy = copied.append
result = {"ok": False, "error": None}


class Gesture:
	def __init__(self, x, y, shift=False):
		self.start, self.shift = (x, y), shift

	def get_start_point(self):
		return True, *self.start

	def get_current_event_state(self):
		return Gdk.ModifierType.SHIFT_MASK if self.shift else 0

	def set_state(self, _state):
		pass


def press(window, name, ctrl=False):
	state = Gdk.ModifierType.CONTROL_MASK if ctrl else 0
	return window.key(None, Gdk.keyval_from_name(name), 0, state)


def drag(window, start, end, shift=False):
	gesture = Gesture(*start, shift=shift)
	window.begin(gesture, *start)
	window.update(gesture, (end[0] - start[0]) / 2, (end[1] - start[1]) / 2)
	window.end(gesture, end[0] - start[0], end[1] - start[1])


def drive():
	try:
		window = next(w for w in Gtk.Window.list_toplevels() if hasattr(w, "shapes"))
		if window.area.get_width() < 50:
			return True  # wait for allocation / first draw
		sx, sy = window.to_screen(0, 0)
		at = lambda x, y: (sx + x * window.scale, sy + y * window.scale)
		drag(window, at(10, 10), at(60, 50))  # pen (default tool)
		press(window, "r"); drag(window, at(80, 10), at(140, 60))
		press(window, "e"); drag(window, at(160, 10), at(220, 40), shift=True)
		press(window, "t"); window.begin(Gesture(*at(20, 90)), *at(20, 90))
		assert window.entry.get_parent() is not None, "text entry shown"
		assert press(window, "p") is False, "shortcuts disabled while typing"
		window.entry.set_text("Hello")
		window.entry.emit("activate")
		assert [s["kind"] for s in window.shapes] == ["pen", "rect", "ellipse", "text"], window.shapes
		assert window.shapes[2]["square"] is True
		press(window, "z", ctrl=True)
		assert len(window.shapes) == 3
		press(window, "y", ctrl=True)
		assert len(window.shapes) == 4
		press(window, "Escape")
		assert window.discard, "first Esc only warns when dirty"
		press(window, "Return")
		result["ok"] = True
	except Exception as error:  # report, then stop the loop
		import traceback
		result["error"] = traceback.format_exc()
		window.get_application().quit()
	return False


with tempfile.TemporaryDirectory() as directory:
	path = os.path.join(directory, "shot.png")
	image = cairo.ImageSurface(cairo.FORMAT_ARGB32, 240, 140)
	cr = cairo.Context(image)
	cr.set_source_rgb(1, 1, 1)
	cr.paint()
	image.write_to_png(path)
	GLib.timeout_add(200, drive)
	GLib.timeout_add_seconds(20, lambda: (result.update(error=result["error"] or "timeout"), [w.close() for w in Gtk.Window.list_toplevels()], Gtk.Application.get_default() and Gtk.Application.get_default().quit()))
	sys.argv = [sys.argv[0], path]
	code = annotate.run(path)
	assert result["ok"], result["error"]
	assert copied == [path], copied
	saved = cairo.ImageSurface.create_from_png(path)
	saved.flush()
	data, stride = saved.get_data(), saved.get_stride()
	reds = sum(1 for y in range(140) for x in range(240)
		if data[y * stride + x * 4 + 2] > 200 and data[y * stride + x * 4 + 1] < 80)
	assert reds > 200, f"annotations not saved ({reds} red pixels)"
	assert os.listdir(directory) == ["shot.png"]
	print(f"PASS: GTK editor drew pen/box/circle/text, undo/redo, Esc guard, saved ({reds} red px), copied; exit {code}")
