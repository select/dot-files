"""Headless tests for screenshot-annotate.py (system Python: needs PyGObject + pycairo).

Run: /usr/bin/python3 hyprland/.config/hypr/scripts/test_screenshot_annotate.py
"""
import importlib.util
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import cairo

spec = importlib.util.spec_from_file_location("annotate", Path(__file__).with_name("screenshot-annotate.py"))
annotate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(annotate)
RED = (1.0, 0.0, 0.0)


def blank(width=100, height=80):
	image = cairo.ImageSurface(cairo.FORMAT_ARGB32, width, height)
	cr = cairo.Context(image)
	cr.set_source_rgb(1, 1, 1)
	cr.paint()
	return image


def pixel(surface, x, y):
	surface.flush()
	data = surface.get_data()
	offset = y * surface.get_stride() + x * 4
	b, g, r, a = data[offset:offset + 4]
	return r, g, b, a


def red(value):
	r, g, b, _ = value
	return r > 200 and g < 80 and b < 80


class Geometry(unittest.TestCase):
	def test_box_normalizes_reverse_drags(self):
		self.assertEqual(annotate.box({"x0": 50, "y0": 40, "x1": 10, "y1": 20}), (10, 20, 40, 20))

	def test_shift_constrains_square_in_drag_direction(self):
		self.assertEqual(annotate.box({"x0": 50, "y0": 40, "x1": 10, "y1": 30}, square=True), (10, 0, 40, 40))

	def test_visibility_rejects_clicks_and_empty_text(self):
		self.assertFalse(annotate.visible({"kind": "rect", "x0": 1, "y0": 1, "x1": 2, "y1": 9}))
		self.assertFalse(annotate.visible({"kind": "text", "text": "  "}))
		self.assertTrue(annotate.visible({"kind": "pen", "points": [(1, 1)]}))


class Rendering(unittest.TestCase):
	def test_shapes_render_at_full_resolution_without_mutating_source(self):
		image = blank()
		shapes = [
			{"kind": "rect", "color": RED, "width": 4, "x0": 10, "y0": 10, "x1": 50, "y1": 40},
			{"kind": "ellipse", "color": RED, "width": 4, "x0": 60, "y0": 10, "x1": 90, "y1": 70},
			{"kind": "pen", "color": RED, "width": 6, "points": [(10, 70), (40, 70)]},
		]
		result = annotate.render(image, shapes)
		self.assertEqual((result.get_width(), result.get_height()), (100, 80))
		self.assertTrue(red(pixel(result, 10, 25)), "box edge")
		self.assertFalse(red(pixel(result, 30, 25)), "box is not filled")
		self.assertTrue(red(pixel(result, 60, 40)), "ellipse left edge")
		self.assertFalse(red(pixel(result, 75, 40)), "ellipse is not filled")
		self.assertTrue(red(pixel(result, 25, 70)), "pen stroke")
		self.assertEqual(pixel(image, 10, 25)[:3], (255, 255, 255))

	def test_text_renders_with_color(self):
		result = annotate.render(blank(200, 80), [{"kind": "text", "color": RED, "size": 40, "width": 0, "x": 10, "y": 10, "text": "HELLO"}])
		self.assertTrue(any(red(pixel(result, x, y)) for x in range(10, 190, 2) for y in range(10, 60, 2)))


class Saving(unittest.TestCase):
	def test_atomic_save_preserves_mode_and_leaves_no_temporary_files(self):
		with tempfile.TemporaryDirectory() as directory:
			path = os.path.join(directory, "shot.png")
			blank().write_to_png(path)
			os.chmod(path, 0o640)
			annotate.save(path, blank(), [{"kind": "rect", "color": RED, "width": 4, "x0": 10, "y0": 10, "x1": 50, "y1": 40}])
			self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o640)
			self.assertEqual(os.listdir(directory), ["shot.png"])
			self.assertTrue(red(pixel(cairo.ImageSurface.create_from_png(path), 10, 25)))

	def test_failed_save_keeps_original_and_cleans_temporary_file(self):
		with tempfile.TemporaryDirectory() as directory:
			path = os.path.join(directory, "shot.png")
			blank().write_to_png(path)
			original = Path(path).read_bytes()
			with mock.patch.object(annotate, "render", side_effect=RuntimeError("disk full")):
				with self.assertRaises(RuntimeError):
					annotate.save(path, blank(), [])
			self.assertEqual(Path(path).read_bytes(), original)
			self.assertEqual(os.listdir(directory), ["shot.png"])

	def test_copy_sends_png_to_wl_copy(self):
		with tempfile.NamedTemporaryFile(suffix=".png") as file, mock.patch.object(annotate.subprocess, "run") as run:
			annotate.copy(file.name)
			self.assertEqual(run.call_args.args[0], ["wl-copy", "--type", "image/png"])
			self.assertTrue(run.call_args.kwargs["check"])


if __name__ == "__main__":
	unittest.main()
