#!/usr/bin/env bash
# Panel installer for Raspberry Pi OS (Bookworm or newer) and other Debian systems.
#
#   curl -fsSL https://raw.githubusercontent.com/Aryanwadhera/panel/main/install.sh | bash
#
# Options (environment variables):
#   PANEL_DIR=~/panel       where the code lives
#   PANEL_PORT=80           web port (falls back to 8080 if 80 is taken)
#   PANEL_KIOSK=auto        auto | yes | no : open the display full-screen on boot
#   PANEL_KIOSK_MODE=kiosk  kiosk (nothing else on screen) | desktop (inside the Pi desktop)
#   PANEL_AUDIO=yes         yes | no : speakers, Bluetooth audio and AirPlay
#   PANEL_HOSTNAME=panel    rename the Pi so it's reachable at http://panel.local
#   PANEL_BRANCH=main
set -euo pipefail

REPO="${PANEL_REPO:-https://github.com/Aryanwadhera/panel.git}"
BRANCH="${PANEL_BRANCH:-main}"
DIR="${PANEL_DIR:-$HOME/panel}"
DATA="${PANEL_DATA:-$HOME/.panel}"
PORT="${PANEL_PORT:-80}"
KIOSK="${PANEL_KIOSK:-auto}"
AUDIO="${PANEL_AUDIO:-yes}"
WANT_HOSTNAME="${PANEL_HOSTNAME:-}"
USER_NAME="$(id -un)"
USER_UID="$(id -u)"

bold=$'\e[1m'; dim=$'\e[2m'; green=$'\e[32m'; yellow=$'\e[33m'; red=$'\e[31m'; reset=$'\e[0m'
step() { printf '\n%s→ %s%s\n' "$bold" "$1" "$reset"; }
info() { printf '  %s%s%s\n' "$dim" "$1" "$reset"; }
warn() { printf '  %s! %s%s\n' "$yellow" "$1" "$reset"; }
die()  { printf '\n%s✗ %s%s\n' "$red" "$1" "$reset" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# Read answers from the terminal even when this script is piped into bash.
ask() {
  local prompt="$1" default="$2" reply=""
  if [ -r /dev/tty ] && [ -w /dev/tty ]; then
    printf '%s' "$prompt" > /dev/tty
    read -r reply < /dev/tty || true
  fi
  printf '%s' "${reply:-$default}"
}

cat <<'EOF'

  ┌─────────┐
  │ ▀▀▀▀▀▀▀ │   Panel
  └─────────┘   A calm dashboard for your Raspberry Pi

EOF

[ "$(id -u)" -eq 0 ] && die "Run this as your normal user (not root or sudo). It will ask for your password when needed."
have apt-get || die "This installer needs a Debian-based OS such as Raspberry Pi OS."
have sudo || die "sudo is required."
sudo -v || die "Couldn't get sudo access."

# ------------------------------------------------------------------ packages
step "Installing system packages"
sudo apt-get update -qq
PKGS=(git curl ca-certificates avahi-daemon)
apt-cache show fonts-inter >/dev/null 2>&1 && PKGS+=(fonts-inter)
apt-cache show wlr-randr >/dev/null 2>&1 && PKGS+=(wlr-randr)
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${PKGS[@]}" >/dev/null
info "git, curl, avahi (for panel.local), Inter font"

# ------------------------------------------------------------------ node
node_major() { have node && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if [ "$(node_major)" -lt 18 ]; then
  step "Installing Node.js"
  candidate="$(apt-cache policy nodejs 2>/dev/null | awk '/Candidate:/ {print $2}' | sed -E 's/^[0-9]+://; s/\..*//')"
  if [ -n "$candidate" ] && [ "$candidate" != "(none)" ] && [ "$candidate" -ge 18 ] 2>/dev/null; then
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs npm >/dev/null
  else
    arch="$(uname -m)"
    [ "$arch" = "armv6l" ] && die "This Pi (ARMv6, e.g. Pi Zero / Pi 1) isn't supported by current Node.js. Use a Pi Zero 2, 3, 4 or 5."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
  fi
fi
have npm || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq npm >/dev/null
info "Node $(node -v)"

# ------------------------------------------------------------------ code
step "Getting Panel"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --quiet origin "$BRANCH"
  git -C "$DIR" checkout --quiet "$BRANCH"
  git -C "$DIR" pull --ff-only --quiet
  info "Updated $DIR"
else
  [ -e "$DIR" ] && die "$DIR exists but isn't a Panel checkout. Move it or set PANEL_DIR."
  git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" "$DIR"
  info "Cloned into $DIR"
fi
(cd "$DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null)
chmod +x "$DIR/bin/panel" "$DIR/bin/kiosk.sh"
sudo ln -sf "$DIR/bin/panel" /usr/local/bin/panel
info "Installed the 'panel' command"

# ------------------------------------------------------------------ port
port_busy() { (ss -ltnH "sport = :$1" 2>/dev/null || true) | grep -q .; }
if [ "$PORT" = "80" ] && port_busy 80 && ! systemctl is-active --quiet panel 2>/dev/null; then
  warn "Port 80 is in use, so Panel will use 8080."
  PORT=8080
fi
mkdir -p "$DATA" && chmod 700 "$DATA"
cat > "$DATA/panel.env" <<EOF
PORT=$PORT
PANEL_DATA=$DATA
EOF

# ------------------------------------------------------------------ sound
if [ "$AUDIO" != "no" ]; then
  step "Setting up sound, Bluetooth and AirPlay"
  # PipeWire is the Pi's sound system (preinstalled on the Desktop edition);
  # BlueZ handles Bluetooth speakers; shairport-sync is the AirPlay receiver.
  want=(pipewire pipewire-pulse pipewire-alsa wireplumber libspa-0.2-bluetooth pulseaudio-utils bluez alsa-utils rtkit iw shairport-sync)
  pkgs=()
  for p in "${want[@]}"; do apt-cache show "$p" >/dev/null 2>&1 && pkgs+=("$p"); done
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${pkgs[@]}" >/dev/null
  have shairport-sync || warn "shairport-sync isn't available for this OS, so AirPlay won't work."

  # Panel runs its own AirPlay receiver, named after your panel, so the
  # system-wide one that the package starts must not run as well.
  sudo systemctl disable --now shairport-sync >/dev/null 2>&1 || true

  # Start your sound server at boot, even when nobody has logged in.
  sudo loginctl enable-linger "$USER_NAME"
  sudo systemctl --global enable pipewire.socket pipewire-pulse.socket wireplumber.service >/dev/null 2>&1 || true
  for g in audio bluetooth; do getent group "$g" >/dev/null && sudo usermod -aG "$g" "$USER_NAME"; done
  have rfkill && sudo rfkill unblock bluetooth || true
  sudo systemctl enable --now bluetooth >/dev/null 2>&1 || true

  # WirePlumber normally turns on Bluetooth audio only for someone logged in
  # at the screen. A panel is headless, so keep it on all the time.
  mkdir -p "$HOME/.config/wireplumber/bluetooth.lua.d" "$HOME/.config/wireplumber/wireplumber.conf.d"
  # Plain SBC is the lightest codec on the shared Wi-Fi/Bluetooth radio, and
  # leaving out the call profiles stops speakers dropping to phone quality.
  cat > "$HOME/.config/wireplumber/bluetooth.lua.d/80-panel.lua" <<'WPEOF'
bluez_monitor.properties["with-logind"] = false
bluez_monitor.properties["bluez5.roles"] = "[ a2dp_sink a2dp_source ]"
bluez_monitor.properties["bluez5.codecs"] = "[ sbc ]"
WPEOF
  cat > "$HOME/.config/wireplumber/wireplumber.conf.d/80-panel.conf" <<'WPEOF'
wireplumber.profiles = {
  main = {
    monitor.bluez.seat-monitoring = disabled
  }
}
monitor.bluez.properties = {
  bluez5.roles = [ a2dp_sink a2dp_source ]
  bluez5.codecs = [ sbc ]
}
WPEOF

  # A panel plays music, not live audio, so trade latency for steady playback.
  mkdir -p "$HOME/.config/pipewire/pipewire.conf.d" "$HOME/.config/pipewire/pipewire-pulse.conf.d"
  cat > "$HOME/.config/pipewire/pipewire.conf.d/80-panel.conf" <<'PWEOF'
context.properties = {
  default.clock.quantum = 2048
  default.clock.min-quantum = 1024
  default.clock.max-quantum = 8192
}
PWEOF
  cat > "$HOME/.config/pipewire/pipewire-pulse.conf.d/80-panel.conf" <<'PWEOF'
pulse.properties = {
  pulse.min.req = 1024/48000
  pulse.min.quantum = 1024/48000
}
PWEOF
  XDG_RUNTIME_DIR="/run/user/$USER_UID" systemctl --user restart pipewire pipewire-pulse wireplumber >/dev/null 2>&1 || true

  # Wi-Fi power saving makes AirPlay's stream arrive in bursts.
  if [ -d /etc/NetworkManager/conf.d ]; then
    printf '[connection]\nwifi.powersave = 2\n' | sudo tee /etc/NetworkManager/conf.d/80-panel-wifi.conf >/dev/null
  fi
  have iw && sudo iw dev wlan0 set power_save off >/dev/null 2>&1 || true
  info "PipeWire, Bluetooth audio and AirPlay ready"
fi

# ------------------------------------------------------------------ service
step "Starting Panel as a service"
sudo tee /etc/systemd/system/panel.service >/dev/null <<EOF
[Unit]
Description=Panel dashboard
After=network-online.target user@$USER_UID.service bluetooth.service
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$DIR
EnvironmentFile=$DATA/panel.env
Environment=NODE_ENV=production
# Lets Panel reach your user's sound server (PipeWire) for speakers and AirPlay.
Environment=XDG_RUNTIME_DIR=/run/user/$USER_UID
ExecStart=$(command -v node) $DIR/server/index.js
Restart=always
RestartSec=2
# Lets Panel use port 80 without running as root.
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --quiet panel
sudo systemctl restart panel

for _ in $(seq 1 30); do
  curl -fs "http://localhost:$PORT/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fs "http://localhost:$PORT/health" >/dev/null 2>&1 || die "Panel didn't start. See: journalctl -u panel -n 50"
info "Running on port $PORT"

# ------------------------------------------------------------------ hostname
current_host="$(hostname)"
if [ -z "$WANT_HOSTNAME" ] && [ "$current_host" = "raspberrypi" ]; then
  answer="$(ask "  Rename this Pi to 'panel' so you can open http://panel.local? [Y/n] " y)"
  case "$answer" in [Nn]*) ;; *) WANT_HOSTNAME=panel ;; esac
fi
if [ -n "$WANT_HOSTNAME" ] && [ "$WANT_HOSTNAME" != "$current_host" ]; then
  step "Renaming this device to $WANT_HOSTNAME"
  if have raspi-config; then
    sudo raspi-config nonint do_hostname "$WANT_HOSTNAME"
  else
    sudo hostnamectl set-hostname "$WANT_HOSTNAME"
    sudo sed -i "s/127.0.1.1.*/127.0.1.1\t$WANT_HOSTNAME/" /etc/hosts
  fi
  sudo systemctl restart avahi-daemon || true
  current_host="$WANT_HOSTNAME"
fi

# ------------------------------------------------------------------ kiosk
# The display runs in cage: a bare session that shows one app and nothing
# else. No taskbar, no Bluetooth "Connected" pop-ups, no update notices or
# keyring prompts can ever cover the panel, and there's nothing anyone
# would need a mouse to dismiss. `panel desktop` brings the normal desktop
# back when you need it.

remove_desktop_autostart() {
  # Older versions of this installer started the display inside the desktop.
  local line="$DIR/bin/kiosk.sh"
  for f in "$HOME/.config/labwc/autostart" "$HOME/.config/wayfire.ini" "$HOME/.config/lxsession/LXDE-pi/autostart"; do
    [ -f "$f" ] && sed -i "\#$line#d" "$f"
  done
  return 0
}

setup_desktop_autostart() {
  # Only with PANEL_KIOSK_MODE=desktop: run inside the desktop instead.
  # Desktop pop-ups can then appear over the panel.
  local line="$DIR/bin/kiosk.sh"
  mkdir -p "$HOME/.config/labwc"
  touch "$HOME/.config/labwc/autostart"
  grep -qF "$line" "$HOME/.config/labwc/autostart" || echo "$line &" >> "$HOME/.config/labwc/autostart"
  if have wayfire; then
    local ini="$HOME/.config/wayfire.ini"
    touch "$ini"
    if ! grep -qF "$line" "$ini"; then
      if grep -q '^\[autostart\]' "$ini"; then sed -i "/^\[autostart\]/a panel = $line" "$ini"
      else printf '\n[autostart]\npanel = %s\n' "$line" >> "$ini"; fi
    fi
  fi
  if [ -d /etc/xdg/lxsession/LXDE-pi ]; then
    local lx="$HOME/.config/lxsession/LXDE-pi/autostart"
    mkdir -p "$(dirname "$lx")"
    [ -f "$lx" ] || cp /etc/xdg/lxsession/LXDE-pi/autostart "$lx" 2>/dev/null || touch "$lx"
    grep -qF "$line" "$lx" || echo "@$line" >> "$lx"
  fi
  sudo systemctl disable --quiet panel-kiosk 2>/dev/null || true
  have raspi-config && sudo raspi-config nonint do_boot_behaviour B4 || true
}

setup_cage_kiosk() {
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq cage >/dev/null
  sudo tee /etc/systemd/system/panel-kiosk.service >/dev/null <<EOF
[Unit]
Description=Panel display (kiosk)
After=panel.service systemd-user-sessions.service plymouth-quit-wait.service systemd-logind.service
Wants=panel.service
Conflicts=getty@tty1.service

[Service]
User=$USER_NAME
PAMName=login
TTYPath=/dev/tty1
StandardInput=tty
StandardOutput=journal
UtmpIdentifier=tty1
UtmpMode=user
Environment=XDG_SESSION_TYPE=wayland
ExecStart=/usr/bin/cage -s -- $DIR/bin/kiosk.sh
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  # Boot to the kiosk, not the desktop. The desktop stays installed:
  # `panel desktop` starts it on demand.
  have raspi-config && sudo raspi-config nonint do_boot_behaviour B1 >/dev/null 2>&1 || true
  sudo systemctl set-default multi-user.target >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable --quiet panel-kiosk
}

KIOSK_MODE="${PANEL_KIOSK_MODE:-kiosk}"

if [ "$KIOSK" != "no" ]; then
  has_desktop=no
  { have labwc || have wayfire || have startlxde-pi || [ -d /etc/xdg/lxsession/LXDE-pi ]; } && has_desktop=yes
  if [ "$KIOSK" = "auto" ] && [ "$has_desktop" = "no" ] && [ -z "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ] && ! have raspi-config; then
    warn "This doesn't look like a Pi with a screen, so skipping the full-screen display."
    warn "Open http://localhost:$PORT/display in a browser, or rerun with PANEL_KIOSK=yes."
  else
    step "Setting up the full-screen display"
    if ! have chromium && ! have chromium-browser; then
      if apt-cache show chromium >/dev/null 2>&1; then
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq chromium >/dev/null
      else
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq chromium-browser >/dev/null
      fi
    fi
    if [ "$KIOSK_MODE" = "desktop" ]; then
      setup_desktop_autostart
      info "Opens when the desktop starts (desktop pop-ups can appear over it)"
    else
      remove_desktop_autostart
      setup_cage_kiosk
      info "Opens full-screen on boot, with nothing else on the screen"
      [ "$has_desktop" = "yes" ] && info "Need the desktop? Run: panel desktop"
    fi
    # Keep the screen awake.
    have raspi-config && sudo raspi-config nonint do_blanking 1 >/dev/null 2>&1 || true
  fi
fi

# ------------------------------------------------------------------ done
ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
suffix=""; [ "$PORT" != "80" ] && suffix=":$PORT"

cat <<EOF

${green}${bold}✓ Panel is installed.${reset}

  Finish setup from your phone or laptop (same Wi‑Fi):

    ${bold}http://$current_host.local$suffix${reset}
    ${dim}or http://$ip$suffix${reset}

  The panel's screen shows a code to connect with.

  ${dim}panel status · panel logs · panel update · panel pair · panel help${reset}

EOF

if [ "$KIOSK" != "no" ]; then
  answer="$(ask "  Reboot now to start the display? [Y/n] " y)"
  case "$answer" in [Nn]*) echo "  Reboot whenever you're ready: sudo reboot" ;; *) sudo reboot ;; esac
fi
