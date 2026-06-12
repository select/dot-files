---------------------
---- KEYBINDINGS ----
---------------------
-- See https://wiki.hypr.land/Configuring/Basics/Binds/

local mainMod     = "SUPER"
local terminal    = "kitty"
local fileManager = "nautilus"
local menu        = "wofi --show drun --allow-images -W 30% -p Run -D key_expand=Tab"

local function mod(extra)
    if extra and extra ~= "" then
        return mainMod .. " + " .. extra .. " + "
    end
    return mainMod .. " + "
end

-- pypr expose
hl.bind(mod() .. "B", hl.dsp.exec_cmd("~/.local/bin/pypr expose"))
-- Style the "exposed" special workspace
hl.workspace_rule({
    workspace   = "special:exposed",
    gaps_out    = 60,
    gaps_in     = 30,
    border_size = 5,
    no_shadow   = true,
})

hl.bind(mod() .. "Z",        hl.dsp.exec_cmd("~/.local/bin/pypr zoom ++0.5"))
hl.bind(mod("SHIFT") .. "Z", hl.dsp.exec_cmd("~/.local/bin/pypr zoom"))

-- Core binds
hl.bind(mod() .. "Return",      hl.dsp.exec_cmd(terminal))
hl.bind(mod() .. "C",           hl.dsp.window.close())
hl.bind(mod() .. "Q",           hl.dsp.window.close())
hl.bind(mod("SHIFT") .. "P",    hl.dsp.exec_cmd("~/.config/hypr/scripts/wofi_power.sh"))
hl.bind(mod("SHIFT") .. "F",    hl.dsp.window.float({ action = "toggle" }))
hl.bind(mod("SHIFT") .. "F",    hl.dsp.window.pin())
hl.bind(mod() .. "E",           hl.dsp.exec_cmd(fileManager))
hl.bind(mod() .. "space",       hl.dsp.exec_cmd(menu))
hl.bind(mod() .. "F",           hl.dsp.exec_cmd("nix run nixpkgs#nwg-drawer"))
hl.bind(mod() .. "J",           hl.dsp.layout("togglesplit"))
hl.bind(mod("SHIFT") .. "B",    hl.dsp.exec_cmd("~/.config/hypr/scripts/waybar.sh"))
hl.bind(mod("SHIFT") .. "A",    hl.dsp.exec_cmd("~/.config/hypr/scripts/toggle_animations.sh"))
hl.bind(mod("SHIFT") .. "W",    hl.dsp.exec_cmd("~/.config/hypr/scripts/wallpaper.sh random"))
hl.bind(mod("SHIFT") .. "E",    hl.dsp.exec_cmd("~/.config/hypr/scripts/wofi-emoji"))
hl.bind(mod("SHIFT") .. "M",    hl.dsp.exec_cmd("~/.config/hypr/scripts/mpv-float.sh"))
hl.bind(mod("SHIFT") .. "D",    hl.dsp.exec_cmd("~/.config/hypr/scripts/laptop-display.sh toggle")) -- enable/disable laptop screen
hl.bind(mod("SHIFT") .. "J",    hl.dsp.exec_cmd("~/.config/hypr/scripts/position-floating.sh t"))
hl.bind(mod("SHIFT") .. "L",    hl.dsp.exec_cmd("~/.config/hypr/scripts/position-floating.sh r"))
hl.bind(mod("SHIFT") .. "K",    hl.dsp.exec_cmd("~/.config/hypr/scripts/position-floating.sh b"))
hl.bind(mod("SHIFT") .. "H",    hl.dsp.exec_cmd("~/.config/hypr/scripts/position-floating.sh l"))
hl.bind(mod("SHIFT") .. "T",    hl.dsp.exec_cmd("~/.local/bin/hyprshot -m window"))
hl.bind(mod("SHIFT") .. "R",    hl.dsp.exec_cmd("~/.local/bin/hyprshot -m region"))
hl.bind(mod("SHIFT") .. "N",    hl.dsp.exec_cmd("swaync-client -t -sw"))
hl.bind(mod() .. "Escape",      hl.dsp.exec_cmd("~/.config/hypr/scripts/lock.sh"))
hl.bind(mod("ALT") .. "BackSpace", hl.dsp.exec_cmd("hyprctl switchxkblayout at-translated-set-2-keyboard next"))
hl.bind(mod() .. "V",           hl.dsp.exec_cmd("cliphist list | wofi -dmenu | cliphist decode | wl-copy"))

-- Move focus
hl.bind(mod() .. "left",  hl.dsp.focus({ direction = "l" }))
hl.bind(mod() .. "right", hl.dsp.focus({ direction = "r" }))
hl.bind(mod() .. "up",    hl.dsp.focus({ direction = "u" }))
hl.bind(mod() .. "down",  hl.dsp.focus({ direction = "d" }))

hl.bind(mod() .. "T", hl.dsp.window.float({ action = "toggle" }))
hl.bind(mod() .. "P", hl.dsp.window.pseudo())
hl.bind(mod() .. "X", hl.dsp.window.fullscreen({ mode = "fullscreen", action = "toggle" }))

-- Resize active window
hl.bind(mod("CTRL") .. "right", hl.dsp.window.resize({ x = 100,  y = 0,   relative = true }))
hl.bind(mod("CTRL") .. "left",  hl.dsp.window.resize({ x = -100, y = 0,   relative = true }))
hl.bind(mod("CTRL") .. "down",  hl.dsp.window.resize({ x = 0,    y = 100, relative = true }))
hl.bind(mod("CTRL") .. "up",    hl.dsp.window.resize({ x = 0,    y = -100, relative = true }))

-- Move window in a direction
hl.bind(mod("SHIFT") .. "left",  hl.dsp.window.move({ direction = "l" }))
hl.bind(mod("SHIFT") .. "right", hl.dsp.window.move({ direction = "r" }))
hl.bind(mod("SHIFT") .. "up",    hl.dsp.window.move({ direction = "u" }))
hl.bind(mod("SHIFT") .. "down",  hl.dsp.window.move({ direction = "d" }))

-- Switch / move-to workspaces
for i = 1, 10 do
    local key = i % 10 -- 10 -> key "0"
    hl.bind(mod() .. key,        hl.dsp.focus({ workspace = i }))
    hl.bind(mod("SHIFT") .. key, hl.dsp.window.move({ workspace = i, follow = false }))
end

hl.bind(mod("ALT") .. "right", hl.dsp.focus({ workspace = "+1" }))
hl.bind(mod("ALT") .. "left",  hl.dsp.focus({ workspace = "-1" }))
hl.bind(mod("ALT + SHIFT") .. "right", hl.dsp.window.move({ workspace = "+1", follow = true }))
hl.bind(mod("ALT + SHIFT") .. "left",  hl.dsp.window.move({ workspace = "-1", follow = true }))

-- Special workspace (scratchpad)
hl.bind(mod() .. "S",        hl.dsp.workspace.toggle_special("magic"))
hl.bind(mod("SHIFT") .. "S", hl.dsp.window.move({ workspace = "special:magic" }))

-- Scroll through workspaces
hl.bind(mod() .. "mouse_down", hl.dsp.focus({ workspace = "e+1" }))
hl.bind(mod() .. "mouse_up",   hl.dsp.focus({ workspace = "e-1" }))

-- Move/resize with mouse
hl.bind(mod() .. "mouse:272",      hl.dsp.window.drag(),   { mouse = true })
hl.bind(mod() .. "mouse:273",      hl.dsp.window.resize(), { mouse = true })
hl.bind(mod("SHIFT") .. "mouse:273", hl.dsp.window.resize(), { mouse = true })

-- Function / media keys
hl.bind("XF86MonBrightnessUp",   hl.dsp.exec_cmd("brightnessctl -q s +10%"))
hl.bind("XF86MonBrightnessDown", hl.dsp.exec_cmd("brightnessctl -q s 10%-"))
hl.bind("XF86AudioRaiseVolume",  hl.dsp.exec_cmd("wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%+ --limit 1.3"))
hl.bind("XF86AudioLowerVolume",  hl.dsp.exec_cmd("wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%-"))
hl.bind("XF86AudioMute",         hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"))
hl.bind("XF86AudioPlay",         hl.dsp.exec_cmd("playerctl play-pause"))
hl.bind("XF86AudioPause",        hl.dsp.exec_cmd("playerctl pause"))
hl.bind("XF86AudioNext",         hl.dsp.exec_cmd("playerctl next"))
hl.bind("XF86AudioPrev",         hl.dsp.exec_cmd("playerctl previous"))
hl.bind("XF86AudioMicMute",      hl.dsp.exec_cmd("pactl set-source-mute @DEFAULT_SOURCE@ toggle"))
hl.bind("XF86Calculator",        hl.dsp.exec_cmd("~/.config/ml4w/settings/calculator.sh"))
hl.bind("XF86Tools",             hl.dsp.exec_cmd("alacritty --class dotfiles-floating -e ~/.config/ml4w/apps/ML4W_Dotfiles_Settings-x86_64.AppImage"))
