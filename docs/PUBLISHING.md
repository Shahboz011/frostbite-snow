# Publishing: what you have to do by hand

The repo builds both packages. These steps need your accounts, decisions or a
Windows machine, so they can't be scripted from here. Microsoft changes
Partner Center screens and fees from time to time; check the current wording
as you go.

## 0. Before anything: the name

"Frostbite" is an Electronic Arts trademark. Choose an original name, check it
in the Store and with a basic trademark search, and use it from step 2 on.
Places to change it: `productName` in `src-tauri/tauri.conf.json`, the
`-DisplayName` you pass to `build-msix.ps1`, `STORE_LISTING.md`, and the
README. The settings folder follows `identifier` in `tauri.conf.json`; change
that only before your first public release.

## 1. Test both packages on Windows

```powershell
npm install
```

```powershell
npm run build:nsis
```

The installer is written to `target\release\bundle\nsis\`. Install it, try the
tray menu, toggle "Launch at startup", sign out and back in, then uninstall.

MSIX sideload test (needs the Windows SDK, installed through Visual Studio
Installer → Individual components → Windows 11 SDK):

```powershell
$pw = Read-Host -AsSecureString
```

```powershell
./packaging/msix/new-test-cert.ps1 -Password $pw
```

Trust the test certificate once, in an **elevated** PowerShell:

```powershell
Import-PfxCertificate -FilePath .\frostbite-test.pfx -CertStoreLocation Cert:\LocalMachine\TrustedPeople -Password $pw
```

```powershell
./packaging/msix/build-msix.ps1 -CertificatePath .\frostbite-test.pfx -CertificatePassword $pw
```

Double-click `target\release\bundle\msix\Frostbite_<version>_x64.msix` to
install. Check that "Launch at startup" shows up under Settings → Apps →
Startup, and that it survives a sign-out. You can also run the Windows App
Certification Kit (installed with the SDK) against the .msix to catch
problems before submitting.

## 2. Partner Center account

1. Go to <https://partner.microsoft.com/dashboard> → Apps and games, and
   enroll as an **individual** or a **company**. Microsoft dropped the fee for
   individual developers in 2024. Company accounts pay a one-time fee and go
   through business verification, which can take a few days.
2. Fill in the payout and tax profiles only if you plan to charge for the app.

## 3. Reserve the name

Apps and games → **New product** → **MSIX or PWA app** → enter the final
name. A reservation lasts about three months without a submission.

## 4. Copy the package identity

Product → Product management → **Product identity**. Copy these three values
into the build:

```powershell
./packaging/msix/build-msix.ps1 `
  -IdentityName "<Package/Identity/Name>" `
  -Publisher "<Package/Identity/Publisher, the CN=… string>" `
  -PublisherDisplayName "<Package/Properties/PublisherDisplayName>" `
  -DisplayName "<your final name>"
```

Leave the Store build **unsigned**; Partner Center signs it. Bump `version` in
`package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` for
every new submission. The Store requires each version to be higher, with the
4th part `.0`.

## 5. Privacy policy URL

Host the policy text from `STORE_LISTING.md` at a public URL (GitHub Pages
works). Fill in the date and your contact details.

## 6. Create the submission

- **Pricing and availability**: free (or a price), markets, visibility.
- **Properties**: category *Personalization*, privacy policy URL, support
  contact. System requirements: tick keyboard and mouse; no special hardware.
- **Age ratings**: complete the IARC questionnaire (see `STORE_LISTING.md`).
- **Packages**: upload the `.msix` from step 4.
- **Store listings**: description, features, search terms, screenshots and
  logos from `STORE_LISTING.md`.
- **Submission options → Restricted capabilities**: explain `runFullTrust`.
  The paragraph in "Notes for certification" in `STORE_LISTING.md` covers it;
  paste it into the certification notes too.

Submit. Certification usually takes from a few hours to a few days. If the
desktop-icon reading gets flagged, see the fallback described under
"Desktop icons (M5)" in the README.

## 7. Direct download (NSIS) and SmartScreen

An unsigned `.exe` triggers SmartScreen's "Windows protected your PC" warning,
and antivirus heuristics are harsher on unsigned apps. For the download build:

- Get a code-signing certificate. Options: Azure Trusted Signing (cheapest,
  needs identity validation), or an OV/EV certificate from a CA.
- Configure it in `src-tauri/tauri.conf.json` → `bundle.windows`, using
  `certificateThumbprint` + `timestampUrl`, or `signCommand` for Azure Trusted
  Signing.
- Host the installer on HTTPS and publish its SHA-256 checksum.

The Store build doesn't need any of this; the Store signs it.

## 8. WebView2

Windows 11 and up-to-date Windows 10 include the WebView2 runtime. The NSIS
installer downloads it silently if it's missing. The Store package assumes
it's present (Windows 10 1809+ with current updates). On a machine without it,
the app shows nothing.
