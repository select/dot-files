#!/usr/bin/env bash
# Build & install AGS v3 (Astal libraries + AGS CLI) from source on Ubuntu.
#
# AGS is not packaged for Ubuntu, so everything is built from source.
# Uses sudo for apt and for `meson install` (installs to /usr/local).
#
# Usage:  bash install.sh
set -euo pipefail

WORK="${HOME}/.cache/ags-build"
TYPELIB_DIR="/usr/local/lib/x86_64-linux-gnu/girepository-1.0"

# --- 1. system dependencies (apt) ---
echo "==> installing build dependencies (sudo)"
sudo apt update
sudo apt install -y \
	meson valac valadoc ninja-build npm \
	gobject-introspection libgirepository1.0-dev libgirepository-2.0-dev \
	libgtk-4-dev libgtk4-layer-shell-dev \
	libnm-dev libwireplumber-0.5-dev libjson-glib-dev libgdk-pixbuf-2.0-dev

mkdir -p "$WORK"
cd "$WORK"

clone() {
	local repo="$1" dir="$2"
	if [ -d "$dir/.git" ]; then
		echo ">> updating $dir"; git -C "$dir" pull --ff-only
	else
		echo ">> cloning $dir"; git clone --depth 1 "$repo" "$dir"
	fi
}

build_lib() {
	local path="$1"
	echo "==> building $path"
	( cd "$path"
		rm -rf build
		meson setup build
		sudo meson install -C build )
}

# --- 2. Astal libraries ---
clone https://github.com/aylur/astal.git astal

# core (order matters: io first, then gtk4)
build_lib astal/lib/astal/io
build_lib astal/lib/astal/gtk4

# service libraries used by the bar
build_lib astal/lib/hyprland
build_lib astal/lib/wireplumber
build_lib astal/lib/bluetooth
build_lib astal/lib/network
build_lib astal/lib/quarrel # required by notifd
build_lib astal/lib/notifd
build_lib astal/lib/battery

sudo ldconfig

# --- 2b. System tray (AstalTray) ---
# AstalTray needs `appmenu-glib-translator`, which Ubuntu doesn't package.
# We build both it and AstalTray into ~/.local (NO sudo, user-local prefix)
# so they don't pollute /usr/local.
LOCAL_PREFIX="${HOME}/.local"
LOCAL_LIBDIR="lib/x86_64-linux-gnu"
export PKG_CONFIG_PATH="${LOCAL_PREFIX}/${LOCAL_LIBDIR}/pkgconfig:${PKG_CONFIG_PATH:-}"
export LD_LIBRARY_PATH="${LOCAL_PREFIX}/${LOCAL_LIBDIR}:${LD_LIBRARY_PATH:-}"
export XDG_DATA_DIRS="${LOCAL_PREFIX}/share:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"

build_lib_local() {
	local path="$1"
	echo "==> building $path -> ${LOCAL_PREFIX}"
	( cd "$path"
		rm -rf build
		meson setup build --prefix="$LOCAL_PREFIX" --libdir="$LOCAL_LIBDIR" -Dwerror=false
		meson install -C build )
}

clone https://github.com/rilian-la-te/vala-panel-appmenu.git vala-panel-appmenu
build_lib_local vala-panel-appmenu/subprojects/appmenu-glib-translator
build_lib_local astal/lib/tray

# --- 3. AGS CLI ---
clone https://github.com/aylur/ags.git ags
( cd ags
	npm install
	rm -rf build
	meson setup build
	sudo meson install -C build )

echo
echo "Done. AGS version: $(ags --version 2>/dev/null || echo '??')"
echo
echo "NOTE: typelibs install under /usr/local (most libs) and ~/.local (AstalTray)."
echo "GJS needs both on GI_TYPELIB_PATH plus ~/.local on LD_LIBRARY_PATH:"
echo "  export GI_TYPELIB_PATH=$TYPELIB_DIR:\$HOME/.local/lib/x86_64-linux-gnu/girepository-1.0"
echo "  export LD_LIBRARY_PATH=\$HOME/.local/lib/x86_64-linux-gnu:/usr/local/lib/x86_64-linux-gnu"
echo "(already configured in zsh/.zshrc and hyprland/.config/hypr/hyprland.lua)"
echo
echo "Run the bar with:  ags run ~/.config/ags"
