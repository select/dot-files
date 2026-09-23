#!/bin/bash
# Voice Keyboard skill helper script
# Usage: voice-keyboard.sh <install|start|stop|status|restart|logs>

set -e

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="$SKILL_DIR/scripts"
LOG_FILE="/tmp/voice-keyboard.log"
PID_FILE="/tmp/voice-keyboard.pid"

die() {
    echo "ERROR: $*" >&2
    exit 1
}

get_hotkey() {
    local config="$HOME/.config/voice-keyboard/config.ini"
    local key
    key=$(grep -i '^\s*key\s*=' "$config" 2>/dev/null | head -1 | sed 's/.*=\s*//' | tr -d '[:space:]')
    echo "${key:-alt_gr}"
}

is_running() {
    if [ -f "$PID_FILE" ]; then
        local pid
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        else
            rm -f "$PID_FILE"
        fi
    fi
    # Fallback: check by process name
    if pgrep -f "dictate.py" > /dev/null 2>&1; then
        pgrep -f "dictate.py" | head -1 > "$PID_FILE"
        return 0
    fi
    return 1
}

cmd_install() {
    echo "Installing voice keyboard..."
    echo "Scripts directory: $SCRIPTS_DIR"
    echo ""

    if ! command -v uv &> /dev/null; then
        die "uv is not installed. Install it: curl -LsSf https://astral.sh/uv/install.sh | sh"
    fi

    cd "$SCRIPTS_DIR"
    uv sync
    echo ""
    echo "Python dependencies installed. ✓"
    echo ""

    # Setup config
    local config_dir="$HOME/.config/voice-keyboard"
    mkdir -p "$config_dir"
    if [ ! -f "$config_dir/config.ini" ]; then
        cp "$SKILL_DIR/config.example.ini" "$config_dir/config.ini"
        echo "Created config at $config_dir/config.ini ✓"
    else
        echo "Config already exists at $config_dir/config.ini ✓"
    fi

    # Check input group
    echo ""
    if groups | grep -q '\binput\b'; then
        echo "User is in 'input' group. ✓"
    else
        echo "WARNING: Your user is NOT in the 'input' group."
        echo "Run: sudo usermod -aG input \$USER"
        echo "Then log out and back in for keyboard (evdev) access."
    fi

    echo ""
    echo "Installation complete. Run 'voice-keyboard.sh start' to launch."
}

cmd_start() {
    if ! [ -d "$SCRIPTS_DIR/.venv" ]; then
        die "Not installed yet. Run 'voice-keyboard.sh install' first."
    fi

    if is_running; then
        local pid
        pid=$(cat "$PID_FILE")
        local hotkey
        hotkey=$(get_hotkey)
        echo "Voice keyboard is already running (PID: $pid)"
        echo "Hold [${hotkey^^}] to record, release to transcribe and type."
        echo "Log: $LOG_FILE"
        return 0
    fi

    echo "Starting voice keyboard in background..."
    cd "$SCRIPTS_DIR"
    nohup uv run python dictate.py >> "$LOG_FILE" 2>&1 &
    local pid=$!
    echo "$pid" > "$PID_FILE"

    sleep 2
    if kill -0 "$pid" 2>/dev/null; then
        local hotkey
        hotkey=$(get_hotkey)
        echo "Voice keyboard started (PID: $pid)"
        echo "Hold [${hotkey^^}] to record, release to transcribe and type."
        echo "Log: $LOG_FILE"
    else
        rm -f "$PID_FILE"
        echo "Failed to start. Last log output:"
        tail -20 "$LOG_FILE" 2>/dev/null || echo "(no log)"
        exit 1
    fi
}

cmd_stop() {
    if ! is_running; then
        echo "Voice keyboard is not running."
        return 0
    fi

    local pid
    pid=$(cat "$PID_FILE")
    echo "Stopping voice keyboard (PID: $pid)..."
    kill "$pid" 2>/dev/null || true

    # Wait up to 5s for clean exit
    local i=0
    while kill -0 "$pid" 2>/dev/null && [ $i -lt 5 ]; do
        sleep 1
        i=$((i + 1))
    done

    # Force kill if needed
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true

    # Also kill any stray dictate.py processes
    pkill -f "dictate.py" 2>/dev/null || true

    rm -f "$PID_FILE"
    echo "Voice keyboard stopped."
}

cmd_status() {
    if is_running; then
        local pid
        pid=$(cat "$PID_FILE")
        echo "STATUS: running (PID: $pid)"
        echo ""
        echo "Recent log:"
        tail -10 "$LOG_FILE" 2>/dev/null || echo "(no log yet)"
    else
        echo "STATUS: stopped"
    fi
}

cmd_restart() {
    cmd_stop
    sleep 1
    cmd_start
}

cmd_logs() {
    if [ -f "$LOG_FILE" ]; then
        tail -30 "$LOG_FILE"
    else
        echo "No log file at $LOG_FILE"
    fi
}

case "${1:-}" in
    install)  cmd_install ;;
    start)    cmd_start ;;
    stop)     cmd_stop ;;
    status)   cmd_status ;;
    restart)  cmd_restart ;;
    logs)     cmd_logs ;;
    *)
        echo "Usage: $0 <install|start|stop|status|restart|logs>"
        exit 1
        ;;
esac
