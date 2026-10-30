// Display power management.
// Controls HDMI/screen output on Raspberry Pi and other Linux systems,
// supporting Wayland (cage, labwc, wayfire via wlr-randr and wlopm),
// VideoCore (vcgencmd), X11 (xset dpms), sysfs backlights, and HDMI-CEC.

import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

function getWaylandEnv() {
  const env = { ...process.env, LANG: 'C', LC_ALL: 'C' };
  if (!env.XDG_RUNTIME_DIR && typeof process.getuid === 'function') {
    const dir = `/run/user/${process.getuid()}`;
    if (fs.existsSync(dir)) env.XDG_RUNTIME_DIR = dir;
  }
  if (!env.WAYLAND_DISPLAY && env.XDG_RUNTIME_DIR) {
    for (const name of ['wayland-0', 'wayland-1', 'wayland-2']) {
      if (fs.existsSync(path.join(env.XDG_RUNTIME_DIR, name))) {
        env.WAYLAND_DISPLAY = name;
        break;
      }
    }
  }
  return env;
}

function has(cmd) {
  return (process.env.PATH || '').split(':').some((dir) => {
    try { fs.accessSync(path.join(dir, cmd), fs.constants.X_OK); return true; } catch { return false; }
  });
}

async function runCmd(cmd, args = [], options = {}) {
  try {
    return await execFileAsync(cmd, args, { timeout: 3000, ...options });
  } catch {
    return null;
  }
}

async function runShell(cmd, options = {}) {
  try {
    return await execAsync(cmd, { timeout: 3000, ...options });
  } catch {
    return null;
  }
}

export async function applyHardwarePower(targetOn) {
  const env = getWaylandEnv();
  const opts = { env, timeout: 3000 };

  if (!targetOn) {
    // 1. Wayland outputs via wlr-randr
    if (has('wlr-randr')) {
      const wlr = await runCmd('wlr-randr', [], opts);
      if (wlr?.stdout) {
        const outputs = [...wlr.stdout.matchAll(/^([A-Za-z0-9-]+)\s+/gm)].map((m) => m[1]);
        for (const out of outputs) {
          await runCmd('wlr-randr', ['--output', out, '--off'], opts);
        }
      }
    }

    // 2. Wayland DPMS via wlopm
    if (has('wlopm')) {
      await runShell('wlopm --off "*"', opts);
    }

    // 3. VideoCore on Raspberry Pi (Pi 3/4 legacy/firmware)
    if (has('vcgencmd')) {
      await runCmd('vcgencmd', ['display_power', '0'], opts);
    }

    // 4. X11 DPMS
    if (has('xset')) {
      await runCmd('xset', ['-display', ':0', 'dpms', 'force', 'off'], opts);
      if (process.env.DISPLAY) await runCmd('xset', ['dpms', 'force', 'off'], opts);
    }

    // 5. Backlight (e.g. Raspberry Pi official touchscreens / DSI)
    try {
      if (fs.existsSync('/sys/class/backlight')) {
        for (const dir of fs.readdirSync('/sys/class/backlight')) {
          const bl = path.join('/sys/class/backlight', dir, 'bl_power');
          if (fs.existsSync(bl)) {
            try { fs.writeFileSync(bl, '1'); } catch {}
          }
        }
      }
    } catch {}
    if (has('brightnessctl')) {
      await runCmd('brightnessctl', ['set', '0%'], opts);
    }

    // 6. HDMI-CEC standby for connected monitors/TVs
    if (has('cec-client')) {
      await runShell('echo "standby 0" | cec-client -s -d 1', opts);
    }
  } else {
    // Turn back on
    // 1. Wayland outputs via wlr-randr
    if (has('wlr-randr')) {
      const wlr = await runCmd('wlr-randr', [], opts);
      if (wlr?.stdout) {
        const outputs = [...wlr.stdout.matchAll(/^([A-Za-z0-9-]+)\s+/gm)].map((m) => m[1]);
        for (const out of outputs) {
          await runCmd('wlr-randr', ['--output', out, '--on'], opts);
        }
      }
    }

    // 2. Wayland DPMS via wlopm
    if (has('wlopm')) {
      await runShell('wlopm --on "*"', opts);
    }

    // 3. VideoCore on Raspberry Pi
    if (has('vcgencmd')) {
      await runCmd('vcgencmd', ['display_power', '1'], opts);
    }

    // 4. X11 DPMS
    if (has('xset')) {
      await runCmd('xset', ['-display', ':0', 'dpms', 'force', 'on'], opts);
      await runCmd('xset', ['-display', ':0', 's', 'reset'], opts);
      if (process.env.DISPLAY) {
        await runCmd('xset', ['dpms', 'force', 'on'], opts);
        await runCmd('xset', ['s', 'reset'], opts);
      }
    }

    // 5. Backlight
    try {
      if (fs.existsSync('/sys/class/backlight')) {
        for (const dir of fs.readdirSync('/sys/class/backlight')) {
          const bl = path.join('/sys/class/backlight', dir, 'bl_power');
          if (fs.existsSync(bl)) {
            try { fs.writeFileSync(bl, '0'); } catch {}
          }
        }
      }
    } catch {}
    if (has('brightnessctl')) {
      await runCmd('brightnessctl', ['set', '100%'], opts);
    }

    // 6. HDMI-CEC on
    if (has('cec-client')) {
      await runShell('echo "on 0" | cec-client -s -d 1', opts);
    }
  }
}

export function createDisplayPower({ onChange } = {}) {
  let on = true;

  async function set(targetOn) {
    on = Boolean(targetOn);
    onChange?.(on);
    await applyHardwarePower(on);
    return on;
  }

  async function toggle() {
    return set(!on);
  }

  return {
    get on() { return on; },
    get state() { return { on }; },
    set,
    toggle,
  };
}
