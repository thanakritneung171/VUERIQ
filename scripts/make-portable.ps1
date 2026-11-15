# Builds the portable distribution from an existing release build:
#   pnpm tauri build   (or: cargo build --release in src-tauri after `pnpm build`)
#   pwsh scripts/make-portable.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$rel = Join-Path $root "src-tauri\target\release"
$version = (Get-Content (Join-Path $root "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json).version
$name = "VUERIQ_${version}_x64-portable"
$out = Join-Path $root "dist-release\$name"

if (-not (Test-Path (Join-Path $rel "vueriq.exe"))) { throw "Release build not found. Run 'pnpm tauri build' first." }
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $out | Out-Null

Copy-Item (Join-Path $rel "vueriq.exe") (Join-Path $out "VUERIQ.exe")
foreach ($dll in "heif.dll", "libde265.dll", "dav1d.dll", "libmpv-2.dll") {
  $src = Join-Path $root "src-tauri\lib\$dll"
  if (-not (Test-Path $src)) { throw "Missing $dll — run scripts/setup-deps.ps1" }
  Copy-Item $src $out
}
Copy-Item (Join-Path $root "THIRD_PARTY_NOTICES.md"), (Join-Path $root "LICENSE.txt") $out
# Marker: keep settings & caches in .\data next to the exe instead of %APPDATA%.
Set-Content -Path (Join-Path $out "portable") -Value "VUERIQ portable mode: settings and caches are stored in the 'data' folder next to VUERIQ.exe." -Encoding utf8
@"
VUERIQ $version — Portable
See Every Detail.

Run VUERIQ.exe. No installation required.
Settings and thumbnail cache are stored in the 'data' folder next to the executable.

Requires the Microsoft Edge WebView2 Runtime (built into Windows 11; on Windows 10 install it
from https://developer.microsoft.com/microsoft-edge/webview2/ if VUERIQ does not start).

To use 'Open with VUERIQ' and set VUERIQ as the default viewer:
Settings (in VUERIQ) -> Windows Integration -> Register, then choose VUERIQ in
Windows Settings -> Apps -> Default apps.
"@ | Set-Content -Path (Join-Path $out "README.txt") -Encoding utf8

$zip = Join-Path $root "dist-release\$name.zip"
Remove-Item $zip -ErrorAction SilentlyContinue
Compress-Archive -Path "$out\*" -DestinationPath $zip -CompressionLevel Optimal
Write-Host ("Portable build: {0} ({1:N1} MB)" -f $zip, ((Get-Item $zip).Length / 1MB))
