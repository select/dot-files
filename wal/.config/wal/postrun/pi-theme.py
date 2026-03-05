#!/usr/bin/env python3
"""Pywal post-run hook: generate pi-theme.json with computed color variants."""

import json
import os

COLORS_FILE = os.path.expanduser("~/.cache/wal/colors.json")
THEME_FILE = os.path.expanduser("~/.pi/agent/themes/pywal.json")


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def rgb_to_hex(r, g, b):
    return f"#{int(r):02x}{int(g):02x}{int(b):02x}"


def blend(color, target, factor):
    """Blend color toward target by factor (0=color, 1=target)."""
    r1, g1, b1 = hex_to_rgb(color)
    r2, g2, b2 = hex_to_rgb(target)
    return rgb_to_hex(
        r1 + (r2 - r1) * factor,
        g1 + (g2 - g1) * factor,
        b1 + (b2 - b1) * factor,
    )


def lighten(color, amount):
    """Lighten a color by blending toward white."""
    return blend(color, "#ffffff", amount)


def darken(color, amount):
    """Darken a color by blending toward black."""
    return blend(color, "#000000", amount)


def main():
    with open(COLORS_FILE) as f:
        wal = json.load(f)

    bg = wal["special"]["background"]
    fg = wal["special"]["foreground"]
    colors = wal["colors"]

    # Generate background variants by slightly tinting bg with accent colors
    # bg_light: slightly lighter than bg (for selected items)
    # bg_subtle: barely visible lift from bg (for message/tool boxes)
    # bg_success: bg tinted with green (color2)
    # bg_error: bg tinted with red (color1)
    bg_light = lighten(bg, 0.12)
    bg_subtle = lighten(bg, 0.06)
    bg_success = blend(bg, colors["color2"], 0.08)
    bg_error = blend(bg, colors["color1"], 0.08)
    bg_pending = blend(bg, colors["color4"], 0.06)
    bg_custom = blend(bg, colors["color5"], 0.06)
    bg_user = lighten(bg, 0.04)

    theme = {
        "$schema": "https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json",
        "name": "pywal",
        "vars": {
            "bg": bg,
            "fg": fg,
            "bgLight": bg_light,
            "bgSubtle": bg_subtle,
            "bgSuccess": bg_success,
            "bgError": bg_error,
            "bgPending": bg_pending,
            "bgCustom": bg_custom,
            "bgUser": bg_user,
            "c1": colors["color1"],
            "c2": colors["color2"],
            "c3": colors["color3"],
            "c4": colors["color4"],
            "c5": colors["color5"],
            "c6": colors["color6"],
            "c7": colors["color7"],
            "c8": colors["color8"],
        },
        "colors": {
            "accent": "c4",
            "border": "c2",
            "borderAccent": "c4",
            "borderMuted": "c8",
            "success": "c2",
            "error": "c1",
            "warning": "c3",
            "muted": "c8",
            "dim": "c8",
            "text": "",
            "thinkingText": "c8",
            "selectedBg": "bgLight",
            "userMessageBg": "bgUser",
            "userMessageText": "",
            "customMessageBg": "bgCustom",
            "customMessageText": "",
            "customMessageLabel": "c5",
            "toolPendingBg": "bgPending",
            "toolSuccessBg": "bgSuccess",
            "toolErrorBg": "bgError",
            "toolTitle": "c4",
            "toolOutput": "c7",
            "mdHeading": "c3",
            "mdLink": "c4",
            "mdLinkUrl": "c8",
            "mdCode": "c6",
            "mdCodeBlock": "c2",
            "mdCodeBlockBorder": "c8",
            "mdQuote": "c8",
            "mdQuoteBorder": "c8",
            "mdHr": "c8",
            "mdListBullet": "c4",
            "toolDiffAdded": "c2",
            "toolDiffRemoved": "c1",
            "toolDiffContext": "c8",
            "syntaxComment": "c8",
            "syntaxKeyword": "c4",
            "syntaxFunction": "c3",
            "syntaxVariable": "c6",
            "syntaxString": "c2",
            "syntaxNumber": "c5",
            "syntaxType": "c4",
            "syntaxOperator": "c7",
            "syntaxPunctuation": "c8",
            "thinkingOff": "c8",
            "thinkingMinimal": "c8",
            "thinkingLow": "c2",
            "thinkingMedium": "c4",
            "thinkingHigh": "c5",
            "thinkingXhigh": "c1",
            "bashMode": "c3",
        },
    }

    with open(THEME_FILE, "w") as f:
        json.dump(theme, f, indent="\t")

    print(f"pi-theme.json generated: {THEME_FILE}")


if __name__ == "__main__":
    main()
