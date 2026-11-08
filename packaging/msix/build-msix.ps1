<#
.SYNOPSIS
  Builds the Frostbite MSIX package (Microsoft Store or sideloading).

.DESCRIPTION
  1. Builds the release exe with Tauri (no installer bundle).
  2. Stages exe + assets + AppxManifest.xml (from AppxManifest.template.xml).
  3. Indexes scale/targetsize assets into resources.pri (makepri).
  4. Packs the .msix (makeappx).
  5. Optionally signs it (signtool) for local sideload testing.

  For a Store upload, do NOT sign: Partner Center signs the package itself.
  Pass the identity values from Partner Center → Product identity.

.EXAMPLE
  # Store upload (values from Partner Center):
  ./packaging/msix/build-msix.ps1 -IdentityName "12345YourName.Frostbite" `
    -Publisher "CN=ABCDEF12-3456-7890-ABCD-EF1234567890" -PublisherDisplayName "Your Name"

.EXAMPLE
  # Local test install with a self-signed cert (see new-test-cert.ps1):
  ./packaging/msix/build-msix.ps1 -CertificatePath .\frostbite-test.pfx -CertificatePassword (Read-Host -AsSecureString)
#>
[CmdletBinding()]
param(
  [string] $IdentityName = "Frostbite.Dev",
  [string] $Publisher = "CN=FrostbiteDev",
  [string] $PublisherDisplayName = "Frostbite Dev",
  [string] $DisplayName = "Frostbite",
  # 4-part version; the Store requires the last part to be 0. Default: package.json version + ".0".
  [string] $Version,
  [switch] $SkipBuild,
  [string] $CertificatePath,
  [SecureString] $CertificatePassword
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$here = $PSScriptRoot

if (-not $Version) {
  $pkg = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
  $Version = "$($pkg.version).0"
}
if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw "Version must have 4 parts (got '$Version')." }

function Find-SdkTool([string] $name) {
  $kits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  $hit = Get-ChildItem -Path $kits -Filter $name -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.DirectoryName -match '\\x64$' -and $_.Directory.Parent.Name -match '^\d+(\.\d+)+$' } |
    Sort-Object { [version]$_.Directory.Parent.Name } -Descending |
    Select-Object -First 1
  if (-not $hit) { throw "$name not found. Install the Windows 10/11 SDK (Visual Studio Installer → Individual components)." }
  return $hit.FullName
}

$makeappx = Find-SdkTool "makeappx.exe"
$makepri = Find-SdkTool "makepri.exe"

# 1. Build -------------------------------------------------------------------
Push-Location $root
try {
  if (-not $SkipBuild) {
    Write-Host "Building release exe..." -ForegroundColor Cyan
    npm run tauri build -- --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
  }
} finally { Pop-Location }

$exe = Join-Path $root "target\release\frostbite.exe"
if (-not (Test-Path $exe)) { throw "Missing $exe (build first or drop -SkipBuild)." }

# 2. Stage -------------------------------------------------------------------
$work = Join-Path $root "target\msix"
$stage = Join-Path $work "staging"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$exeName = "Frostbite.exe"
Copy-Item $exe (Join-Path $stage $exeName)
Copy-Item (Join-Path $here "Assets") (Join-Path $stage "Assets") -Recurse

function Escape-Xml([string] $s) { [System.Security.SecurityElement]::Escape($s) }
$values = [ordered]@{
  "{{IDENTITY_NAME}}"          = Escape-Xml $IdentityName
  "{{PUBLISHER_DISPLAY_NAME}}" = Escape-Xml $PublisherDisplayName
  "{{PUBLISHER}}"              = Escape-Xml $Publisher
  "{{DISPLAY_NAME}}"           = Escape-Xml $DisplayName
  "{{VERSION}}"                = $Version
  "{{EXE}}"                    = $exeName
}
$manifest = Get-Content (Join-Path $here "AppxManifest.template.xml") -Raw
foreach ($k in $values.Keys) { $manifest = $manifest.Replace($k, $values[$k]) }
if ($manifest -match '\{\{[A-Z_]+\}\}') { throw "Unfilled placeholder in manifest: $($Matches[0])" }
Set-Content -Path (Join-Path $stage "AppxManifest.xml") -Value $manifest -Encoding UTF8

# 3. resources.pri -----------------------------------------------------------
$priConfig = Join-Path $work "priconfig.xml"
& $makepri createconfig /cf $priConfig /dq en-US /pv 10.0.0 /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makepri createconfig failed" }
& $makepri new /pr $stage /cf $priConfig /mn (Join-Path $stage "AppxManifest.xml") /of (Join-Path $stage "resources.pri") /o
if ($LASTEXITCODE -ne 0) { throw "makepri new failed" }

# 4. Pack --------------------------------------------------------------------
$outDir = Join-Path $root "target\release\bundle\msix"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$msix = Join-Path $outDir "Frostbite_$($Version)_x64.msix"
& $makeappx pack /d $stage /p $msix /o
if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed" }

# 5. Sign (sideload testing only) ---------------------------------------------
if ($CertificatePath) {
  $signtool = Find-SdkTool "signtool.exe"
  $plain = if ($CertificatePassword) {
    [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($CertificatePassword))
  } else { "" }
  & $signtool sign /fd SHA256 /f $CertificatePath /p $plain $msix
  if ($LASTEXITCODE -ne 0) { throw "signtool failed (the cert subject must equal -Publisher exactly)" }
}

Write-Host "`nMSIX: $msix" -ForegroundColor Green
if (-not $CertificatePath) { Write-Host "Unsigned: upload to Partner Center as-is (the Store signs it)." }
