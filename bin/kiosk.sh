#!/usr/bin/env bash
# Opens the Panel display full-screen. Started at login (desktop) or by
# panel-kiosk.service (Raspberry Pi OS Lite). Relaunches the browser if it exits.

ENV_FILE="${PANEL_DATA:-$HOME/.panel}/panel.env"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
PORT="${PORT:-80}"
URL="${PANEL_DISPLAY_URL:-http://localhost:$PORT/display}"
PROFILE="${PANEL_DATA:-$HOME/.panel}/browser"

# Only one copy, even if several autostart mechanisms fire.
exec 9>"/tmp/panel-kiosk-$(id -u).lock"
flock -n 9 || exit 0

BROWSER="$(command -v chromium || command -v chromium-browser || true)"
if [ -z "$BROWSER" ]; then
  echo "Panel: Chromium isn't installed (sudo apt install chromium)" >&2
  exit 1
fi

# Wait for the server (it starts in parallel at boot).
for _ in $(seq 1 90); do
  curl -fs "http://localhost:$PORT/health" >/dev/null 2>&1 && break
  sleep 1
done

# Hide the mouse pointer on X11 if unclutter is around; on Wayland the
# display page hides it with CSS.
command -v unclutter >/dev/null 2>&1 && [ -n "${DISPLAY:-}" ] && unclutter -idle 0.5 -root &

mkdir -p "$PROFILE"
while true; do
  # Stop Chromium offering to "restore pages" after a power cut.
  PREFS="$PROFILE/Default/Preferences"
  if [ -f "$PREFS" ]; then
    sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$PREFS"
  fi

  "$BROWSER" \
    --kiosk --app="$URL" \
    --user-data-dir="$PROFILE" \
    --noerrdialogs --disable-infobars --no-first-run --no-default-browser-check \
    --deny-permission-prompts --disable-notifications \
    --disable-session-crashed-bubble --disable-features=Translate,TranslateUI,InfiniteSessionRestore \
    --overscroll-history-navigation=0 --disable-pinch \
    --check-for-update-interval=31536000 \
    --password-store=basic \
    --ozone-platform-hint=auto \
    --start-fullscreen \
    >/dev/null 2>&1

  sleep 2
done
