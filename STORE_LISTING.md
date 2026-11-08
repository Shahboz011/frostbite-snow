# Store listing: Frostbite (working name)

> ⚠️ **Pick a final name before reserving it.** "Frostbite" is a well-known
> Electronic Arts trademark (their game engine), and the Store is likely to
> refuse it or ask for proof of rights. Some original directions to check for
> availability yourself: *Desk Drift*, *Snowsill*, *Windowsill Snow*,
> *Flurry Desk*. Replace "Frostbite" throughout this file and pass
> `-DisplayName` to `build-msix.ps1`.

## Product name

Frostbite

## Short description (≤ 100 characters)

Snow falls on your desktop, piles up on your windows, and lets you build a snowman.

## Description

Let it snow, right on your desktop.

Frostbite turns your Windows desktop into a quiet winter scene while you work.
Snowflakes drift down over everything on screen, settle on top of your open
windows, gather on your taskbar and desktop icons, and pile up into soft drifts
along the bottom of every monitor.

Move a window slowly and its snow rides along. Shake it, and the snow tumbles
off. Close it, and the snow falls to the ground below.

Rest your mouse on a snowdrift, then drag to roll a snowball that grows as it
picks up snow. Stack three and you've got a snowman, complete with coal eyes,
a carrot nose and twig arms. Click him to knock him over. If you're feeling
brave, turn on snowball fights and he'll lob the occasional snowball at your
cursor.

Snow never gets in your way. Clicks pass straight through to your apps, the
snow hides itself when you watch a fullscreen video or play a game, and it
pauses while your screen is locked. On battery it automatically slows down to
save power.

Features:
• Light, normal or blizzard snowfall, with adjustable wind
• Snow piles on windows, the taskbar and desktop icons
• Icicles along the taskbar
• Build, stack and knock over snowmen; optional snowball fights
• Works across multiple monitors with different scaling
• Pauses for fullscreen apps, games and the lock screen
• Battery-friendly: 30 fps on battery, near-zero CPU when idle
• Optional launch at startup
• Everything controlled from the tray icon
• No account, no ads, no data collection

## Features list (Partner Center "Product features", up to 20)

- Realistic snowfall over your whole desktop
- Snow piles up on windows, the taskbar and desktop icons
- Snow follows slowly moved windows and falls off fast ones
- Roll snowballs and build snowmen
- Knock snowmen over; optional snowball fights
- Light, normal and blizzard intensities
- Adjustable wind
- Icicles on the taskbar
- Multi-monitor and mixed-DPI support
- Click-through: never blocks your apps
- Auto-pauses for fullscreen apps, games and the lock screen
- Battery saver mode
- Launch at startup (optional)
- No data collection

## Category

Personalization (alternative: Entertainment)

## Search terms (up to 7)

1. snow
2. desktop snow
3. winter
4. snowman
5. christmas
6. snowfall
7. desktop decoration

## Screenshots checklist

Desktop screenshots: PNG, at least 1366×768 (1920×1080 recommended), 1 to 10
images, landscape. Take them on a clean desktop with a pleasant wallpaper and
the debug overlay **off** (release build, `FROSTBITE_DEBUG` unset).

- [ ] 1. Hero: normal snowfall over a tidy desktop, snow piled on two windows and the taskbar
- [ ] 2. Blizzard with strong wind
- [ ] 3. Finished snowman beside the taskbar (with a visible drift)
- [ ] 4. Rolling a snowball (mid-drag, groove visible in the drift)
- [ ] 5. A window being flicked, with its snow falling off
- [ ] 6. Snow caps on desktop icons
- [ ] 7. Tray menu open, showing the settings
- [ ] 8. Multi-monitor setup (optional)
- [ ] Captions (optional, ≤ 200 chars each), e.g. "Snow settles on your windows and drifts along the taskbar."
- [ ] Store logos: 1:1 (300×300) and 2:3 poster art (720×1080 and 1440×2160). Make these from `app-icon.svg` once the final name and icon are settled.
- [ ] Optional: a 16:9 hero image (1920×1080) for featuring

## Privacy policy

Host this at a stable public URL (e.g. GitHub Pages) and enter it in Partner
Center → Properties → Privacy policy URL.

> **Privacy Policy for Frostbite**
>
> *Last updated: [DATE]*
>
> Frostbite does not collect, store, transmit or share any personal
> information or usage data.
>
> - Frostbite has no accounts, analytics, telemetry, advertising or crash
>   reporting, and makes no network connections.
> - To draw snow on your screen, Frostbite reads the positions and sizes of
>   open windows, the taskbar and desktop icons, plus the mouse cursor
>   position. This happens only in memory on your device, is used only to
>   draw the snow, and is never saved or sent anywhere. Frostbite does not
>   read window contents, titles, file names or anything you type.
> - Your preferences (snow intensity, wind, toggles) are saved in a settings
>   file on your device and never leave it. Uninstalling Frostbite removes them.
>
> If this policy ever changes, the updated version will be posted at this
> address with a new date.
>
> Contact: [YOUR EMAIL OR SUPPORT URL]

## Notes for certification (Partner Center → Submission options)

> Frostbite is a desktop decoration. It runs a transparent, click-through,
> always-on-top overlay window that draws falling snow over the desktop, and
> is controlled entirely from its notification-area (tray) icon. There is no
> main window.
>
> To test: launch the app, and snow starts falling. Right-click the tray icon
> for settings. Rest the mouse on the snow along the bottom of the screen for
> half a second, then drag sideways to roll a snowball. Click a snowball to
> knock it over.
>
> - **runFullTrust**: this is a Win32 (Tauri/WebView2) desktop app packaged as
>   MSIX. It needs full trust to create the overlay window and read window,
>   taskbar and desktop-icon geometry with standard Win32 APIs
>   (EnumWindows, DwmGetWindowAttribute, SHAppBarMessage).
> - **Desktop icons**: to place snow on desktop icons, the app reads icon
>   positions from the desktop list view (LVM_GETITEMPOSITION /
>   LVM_GETITEMRECT, with one small buffer in explorer.exe). It only reads
>   geometry and never changes the desktop. Users can turn this off
>   ("Snow on desktop icons").
> - **Startup**: uses the manifest `windows.startupTask`, disabled by default.
>   It's only enabled when the user picks "Launch at startup" in the tray menu.
> - No network access, no data collection.

## Age rating (IARC questionnaire)

No violence (the snowball throwing is cartoonish, at the mouse cursor), no user
interaction or sharing, no purchases, no location, no personal data. Expect
**3+ / Everyone**.
