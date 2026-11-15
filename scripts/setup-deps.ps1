# Prepares the native runtime dependencies VUERIQ bundles:
#   * libheif + libde265 (HEVC) + dav1d (AV1) — built with vcpkg as DLLs (LGPL-friendly dynamic linking)
#   * libmpv-2.dll                             — video engine (shinchiro mpv-winbuild-cmake)
# Requirements: Visual Studio 2022+/Build Tools with "Desktop development with C++", git.
#   pwsh scripts/setup-deps.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$vendor = Join-Path $root "vendor"
New-Item -ItemType Directory -Force $vendor | Out-Null

# ── vcpkg / libheif ──
$vcpkg = Join-Path $vendor "vcpkg"
if (-not (Test-Path (Join-Path $vcpkg "vcpkg.exe"))) {
  if (-not (Test-Path $vcpkg)) { git clone --depth 50 https://github.com/microsoft/vcpkg.git $vcpkg }
  & (Join-Path $vcpkg "bootstrap-vcpkg.bat") -disableMetrics
}
# 'hevc' (x265 encoder, GPL) is deliberately excluded: VUERIQ only decodes.
& (Join-Path $vcpkg "vcpkg.exe") install "libheif[core,libde265,dav1d]:x64-windows" --clean-after-build
if ($LASTEXITCODE -ne 0) { throw "vcpkg install failed" }

# ── libmpv ──
$mpvDir = Join-Path $vendor "mpv"
if (-not (Test-Path (Join-Path $mpvDir "libmpv-2.dll"))) {
  New-Item -ItemType Directory -Force $mpvDir | Out-Null
  $rel = Invoke-RestMethod "https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest"
  # Baseline x86-64 build (not -v3) so VUERIQ runs on every x64 CPU.
  $asset = $rel.assets | Where-Object { $_.name -match '^mpv-dev-x86_64-\d+-git-.*\.7z$' } | Select-Object -First 1
  if (-not $asset) { throw "libmpv dev asset not found in latest release" }
  $archive = Join-Path $mpvDir "mpv-dev.7z"
  Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size/1MB)) MB)"
  Invoke-WebRequest $asset.browser_download_url -OutFile $archive -UseBasicParsing
  Push-Location $mpvDir
  & "$env:SystemRoot\System32\tar.exe" -xf $archive   # Windows 11 bsdtar reads 7z
  Pop-Location
  Remove-Item $archive
}
Write-Host "Native dependencies ready:"
Get-ChildItem (Join-Path $vcpkg "installed\x64-windows\bin\*.dll"), (Join-Path $mpvDir "libmpv-2.dll") | ForEach-Object { "  {0,-16} {1,8:N0} KB" -f $_.Name, ($_.Length / 1KB) }
