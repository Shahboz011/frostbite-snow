# Frostbite (working name)

Snow falls over your Windows desktop while you work, piles up on windows, the
taskbar and desktop icons, and lets you roll a snowman.

Tauri 2 (Rust) + TypeScript, rendered with WebGL2 on a transparent,
click-through, always-on-top overlay that spans every monitor.

## Status

| Milestone | What | State |
|---|---|---|
| M1 | Transparent click-through overlay, falling snow on all monitors | ✅ code complete, needs a Windows run-through |
| M2 | Window + taskbar detection, piles, snow falling off moving windows | ✅ code complete, needs a Windows run-through |
| M3 | Tray menu, settings, autostart, fullscreen pause, battery mode | ✅ code complete, needs a Windows run-through |
| M4 | Snowman building / knocking over / snowballs | ✅ code complete, needs a Windows run-through |
| M5 | Desktop icon detection | ✅ code complete, needs a Windows run-through |
| M6 | MSIX (Store) + NSIS packaging | ⏳ |

## Layout

```
crates/frostbite-platform/   OS layer behind the `Platform` trait
  src/lib.rs                 trait + shared types (Rect, MonitorInfo, NativeHandle)
  src/windows/mod.rs         Win32 backend: monitors, cursor, overlay styles
  src/windows/surfaces.rs    EnumWindows + DWM frame bounds, taskbars
  src/windows/system.rs      fullscreen, lock screen, power, autostart, show/hide
  src/windows/icons.rs       desktop icon rects from explorer's list view
  src/stub.rs                non-Windows dev stub (macOS backend goes here later)
src-tauri/                   Tauri app
  src/overlay.rs             overlay window setup, bounds, click-through toggling
  src/poll.rs                30 Hz cursor/hit-testing, 10–30 Hz surfaces, 2 s housekeeping
  src/layout.rs              virtual-screen layout (unit tested)
  src/commands.rs            IPC: boot, set_hit_regions
  src/settings.rs            settings JSON (unit tested)
  src/tray.rs                tray icon + menu
src/                         frontend
  bridge.ts                  Tauri IPC, with a browser mock for visual tuning
  loop.ts                    rAF loop: FPS cap, stops entirely when idle
  snow/pool.ts               struct-of-arrays particle pool, no per-frame allocation
  snow/sim.ts                gravity, gusty wind, sway, depth, cursor repulsion
  snow/ledges.ts             height maps on window tops + ground, landing, slopes, shedding
  snow/piles.ts              settled snow on a cached 2D canvas, redrawn only where it changed
  snow/yard.ts               snowballs, stacking, snowmen, knocking over, throwing
  snow/yardRender.ts         draws balls, snowmen and thrown snowballs (own canvas)
  snow/renderer.ts           WebGL2 point sprites for flakes and clumps (Canvas2D fallback)
```

### Coordinate model

Rust sends the frontend everything in **overlay-relative physical pixels**. The
overlay's origin is the top-left of the virtual screen (which can be negative
on multi-monitor setups). The canvas backing store is sized in physical pixels,
so mixed-DPI setups need no per-monitor math in the renderer. Flakes take
their monitor's DPI scale at spawn, so they look the same size on a 100% and a
150% display.

### Overlay details

- `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`, no `WS_EX_APPWINDOW`: not in the
  taskbar or Alt-Tab, and it never steals focus. These are re-applied after
  every click-through toggle, because the toolkit rewrites extended styles.
- Excluded from Aero Peek, so snow stays visible over "show desktop" peeking.
- Topmost is re-asserted every 2 s, so the snow stays above the taskbar after
  you click it.
- The overlay is **1 px shorter** than the virtual screen. A topmost window that
  exactly covers a monitor gets treated by the shell as a fullscreen app (the
  taskbar drops behind it and Focus Assist kicks in).
- The cursor is polled at 30 Hz in Rust. Events go to the frontend only when it
  moves. Click-through switches off only while the cursor is over a region the
  frontend registered with `set_hit_regions` (used from M4 on).

### Surfaces and piles (M2)

- **Detection.** `EnumWindows` (z-order, top first) plus
  `DWMWA_EXTENDED_FRAME_BOUNDS`, which gives visible bounds without the
  invisible resize border. Skipped: invisible, minimized and cloaked windows
  (other virtual desktops, suspended UWP apps), tool, click-through and
  never-activate windows (game and recorder HUDs), shell windows, anything
  under 60×30 px, and the overlay itself. Taskbars come from
  `SHAppBarMessage(ABM_GETTASKBARPOS)` plus every `Shell_SecondaryTrayWnd`.
- **Polling.** About 10 Hz, and every 33 ms for one second after anything
  changes, so a pile riding a moving window keeps up. Data is sent only when it
  changes.
- **Ledges.** Each catching edge gets a height map with one column per ~2 px
  (scaled for DPI). The ground on each monitor is the top of a bottom taskbar,
  or the screen bottom. A window top within 6 px of its monitor's top
  (maximized) doesn't catch snow. Otherwise snow would pile up off-screen and
  nothing would fall over maximized apps.
- **Occlusion.** A column only shows and collects snow where no higher window
  covers the edge. A higher window just above an edge caps the pile height
  under it.
- **Depth.** Near (big) flakes fall in front of windows and settle only on the
  ground. Mid and far flakes settle on a given window top 65% of the time.
  Without this, every window would cast a snow shadow and the windows below it
  would stay bare.
- **Shape.** Angle-of-repose relaxation slopes the piles at window ends. Snow
  pushed past an end slides off as a clump. Each ledge has a smooth, uneven
  height cap, so full piles look like drifts rather than a slab.
- **Moving windows.** Tracked by HWND. Below ~420 px/s (×DPI) the pile rides
  along. Faster moves, resizes, closing, minimizing and maximizing turn the
  pile into falling clumps that land on whatever is below.

### Tray, settings and power (M3)

- **Tray icon.** Left-click toggles snow. Right-click opens the menu: Snow,
  Intensity, Wind, Snow on windows / taskbar / desktop icons, Snowman,
  Icicles, Snowball fights, Launch at startup, Shake off all snow, Quit.
  - Tray menus can't hold a real slider, so **Wind** is a 7-step submenu
    (← Strong … Calm … Strong →).
- **Settings file.** `%APPDATA%\app.frostbite.desktop\settings.json`, written
  atomically (temp file + rename). Missing or unknown fields fall back to
  defaults, so the file stays compatible as settings are added.
- **Snow off.** Falling flakes finish, the piles melt in about 4 s, and then
  the render loop stops completely.
- **Pause.** The overlay hides (`SW_HIDE`, never activated) and Rust stops
  polling windows and the cursor while:
  - a fullscreen app, game or presentation is running. This is detected two
    ways: `SHQueryUserNotificationState` reports busy, D3D fullscreen or
    presentation mode, or the foreground window covers its whole monitor
    (borderless games, F11 browsers).
  - the screen is locked (or the UAC secure desktop is showing), detected
    because the input desktop can't be opened.
- **Frame rate.** Capped at 30 fps on battery or battery saver, and for
  *light* snow (slow flakes look identical at 30 fps, and it halves the
  compositor work). Everything else runs at 60.
- **Launch at startup.** Writes `HKCU\…\CurrentVersion\Run\Frostbite` with
  `--autostart`. The registry, not the JSON file, is the source of truth. The
  MSIX build will use a `windows.startupTask` instead (M6).
- **Single instance.** Launching a second copy just turns snow back on in the
  running one.
- **Icicles.** Hang from the top edge of a bottom taskbar and grow as snow
  piles above them.

### Snowman (M4)

- **Rolling a ball.** Rest the cursor on a thick part of the ground pile for
  0.3 s. A dashed ring and a grab cursor show it's ready. Then press and drag
  sideways: a snowball forms and grows as it rolls, taking snow from the pile
  and leaving a groove.
  - Why the 0.3 s rest: the ground pile overlaps the bottom edge of maximized
    apps (status bars). Without it, every click there would be swallowed. A
    quick click still passes straight through.
- **Carrying and stacking.** Drag a loose ball, or the top ball of a stack, to
  carry it. Drop it onto a bigger ball to stack it. Three stacked balls become
  a snowman: coal eyes and smile, buttons, twig arms, and a carrot nose that
  turns toward the cursor.
- **Knocking over.** Click a snowman or ball without dragging. It tips over
  and bursts into clumps, which settle back into the piles.
- **Snowball fights** (tray toggle). Every 7–16 s a finished snowman swings an
  arm and lobs a snowball in an arc at the cursor. It splats into snow.
- **Mouse handling.** The frontend registers hit regions with Rust: one per
  snowman or ball, plus the armed pile. While dragging it sets `capture`, so
  the overlay keeps the mouse even if the cursor leaves those regions.
  Everywhere else stays click-through.
- **Limits.** At most 9 balls at once. Turning off Snowman, snow, or snow on
  the taskbar bursts any snowmen.

### Desktop icons (M5)

- **Finding the icons.** The desktop is explorer's `SysListView32` under
  `Progman\SHELLDLL_DefView`, or under a `WorkerW` after wallpaper changes;
  both are checked. List-view messages that return data need a buffer inside
  explorer, so one 16-byte block is allocated there with `VirtualAllocEx` and
  results are read back with `ReadProcessMemory`.
- **Minimal writes.** Each refresh makes **one** cross-process write: the
  `LVIR_ICON` selector for item 0's icon rect. All icons on the desktop share
  one size and offset, so every other icon only needs `LVM_GETITEMPOSITION`,
  which only reads.
- **Cost.** Refreshed about once a second (every 100 ms while things are
  moving), only while *Snow on desktop icons* is on, with a 50 ms timeout per
  message. At most 400 icons.
- **Failure handling.** If explorer restarts, the reader reconnects. If
  anything fails (access denied, no list view, hidden icons), icons are simply
  skipped and everything else keeps working.
- **Behaviour.** Icon tops collect a small cap (up to 7 px × DPI). Icons sit
  behind every window, so a window covering an icon hides and stops its snow.
  Dragging an icon shakes its snow off.
- ⚠️ **Antivirus and Store risk.** `VirtualAllocEx` + `WriteProcessMemory`
  into `explorer.exe` looks like code injection to heuristics. Keeping it to a
  single 16-byte write and doing nothing while icon snow is off reduces this
  but can't rule it out. If Defender or Store certification flags it, the
  fallback is the documented shell API (`IShellWindows` → `IFolderView2`):
  item positions plus icon size, with no writes into another process. It's
  slightly less exact.

## Prerequisites (Windows)

- Windows 10 1809+ or Windows 11, x64
- [Rust](https://rustup.rs) stable (MSVC toolchain)
- Visual Studio 2022 Build Tools with the "Desktop development with C++" workload
- Node.js 20+
- WebView2 runtime (preinstalled on Windows 11 and on up-to-date Windows 10)

## Run

```bash
npm install
```

```bash
npm run tauri dev
```

Debug builds show an FPS / flake-count box in the top-left corner. To get it
in a release build, set `FROSTBITE_DEBUG=1`. Use the tray icon to change
settings or quit.

### Tuning visuals in a browser (any OS)

```bash
npm run dev
```

Open <http://localhost:1420/?intensity=blizzard&wind=0.4&monitors=2>. The page
fakes a monitor layout (`monitors=2` gives two monitors of different heights
and DPI), a taskbar, `windows=N` (default 3) fake windows and `icons=N`
(default 6) draggable fake desktop icons. Keys stand in
for the tray: `S` snow, `1`/`2`/`3` intensity, `←`/`→` wind, `W` windows, `T`
taskbar, `O` desktop icons, `I` icicles, `N` snowman, `F` snowball fights, `X` shake off, `P`
pause (fullscreen), `B` battery. Snowman building works with the real mouse. Drag a title
bar slowly to carry the snow along, flick it to shake the snow off, click to
raise, use × to close, and double-click the background to add a window. The
real mouse drives flake repulsion. In the console, `__frostbite` exposes the
simulation, renderers and loop.

## Build

```bash
npm run tauri build
```

The NSIS installer is written to `target/release/bundle/nsis/`. MSIX packaging
for the Microsoft Store arrives in M6.

## Checks

```bash
npm run typecheck
```

```bash
cargo test -p frostbite
```

From macOS or Linux you can type-check the Windows backend:

```bash
rustup target add x86_64-pc-windows-msvc && cargo check -p frostbite-platform --target x86_64-pc-windows-msvc
```

## Icon

`app-icon.svg` is a placeholder. Regenerate every size with `npm run icons`.

## Performance notes

Measured in Chromium:

| | per frame |
|---|---|
| Simulation, ~2,000 flakes (normal), with landing | ~0.1 ms |
| Simulation at the 16,000-flake cap, with landing | ~1.0 ms |
| Flake draw submission (WebGL2) | ~0.04 ms |
| Pile redraw, every ledge | ~0.03 ms |
| Pile redraw, nothing changed | 0 (skipped) |

Piles redraw at most 20 times a second, and only in the regions that changed.
The rAF loop stops completely when snow is off and nothing is moving.
