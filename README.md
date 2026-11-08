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
| M3 | Tray menu, settings, autostart, fullscreen pause, battery mode | ⏳ |
| M4 | Snowman building / knocking over / snowballs | ⏳ |
| M5 | Desktop icon detection | ⏳ |
| M6 | MSIX (Store) + NSIS packaging | ⏳ |

## Layout

```
crates/frostbite-platform/   OS layer behind the `Platform` trait
  src/lib.rs                 trait + shared types (Rect, MonitorInfo, NativeHandle)
  src/windows/mod.rs         Win32 backend: monitors, cursor, overlay styles
  src/windows/surfaces.rs    EnumWindows + DWM frame bounds, taskbars
  src/stub.rs                non-Windows dev stub (macOS backend goes here later)
src-tauri/                   Tauri app
  src/overlay.rs             overlay window setup, bounds, click-through toggling
  src/poll.rs                30 Hz cursor/hit-testing, 10–30 Hz surfaces, 2 s housekeeping
  src/layout.rs              virtual-screen layout (unit tested)
  src/commands.rs            IPC: boot, set_hit_regions
src/                         frontend
  bridge.ts                  Tauri IPC, with a browser mock for visual tuning
  loop.ts                    rAF loop: FPS cap, stops entirely when idle
  snow/pool.ts               struct-of-arrays particle pool, no per-frame allocation
  snow/sim.ts                gravity, gusty wind, sway, depth, cursor repulsion
  snow/ledges.ts             height maps on window tops + ground, landing, slopes, shedding
  snow/piles.ts              settled snow on a cached 2D canvas, redrawn only where it changed
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
in a release build, set `FROSTBITE_DEBUG=1`. M3 adds a tray icon; until then,
quit with `Ctrl+C` in the terminal (or end `frostbite.exe` in Task Manager).

### Tuning visuals in a browser (any OS)

```bash
npm run dev
```

Open <http://localhost:1420/?intensity=blizzard&wind=0.4&monitors=2>. The page
fakes a monitor layout (`monitors=2` gives two monitors of different heights
and DPI), a taskbar, and `windows=N` (default 3) fake windows. Drag a title
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
