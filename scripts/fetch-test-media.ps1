# Downloads real-world sample files used by the format test-suite into test-media/downloaded/.
# All sources are public reference/conformance collections; see test-media/README.md for licences.
#   pwsh scripts/fetch-test-media.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root "test-media\downloaded"
New-Item -ItemType Directory -Force $dest | Out-Null

$files = [ordered]@{
  # HEIC / HEIF (HEVC) — libheif examples, Nokia HEIF conformance & CC0 content
  "heic/libheif-example.heic"       = "https://github.com/strukturag/libheif/raw/master/examples/example.heic"
  "heic/nokia-C001-single.heic"      = "https://github.com/nokiatech/heif/raw/gh-pages/content/conformance/C001.heic"
  "heic/nokia-C003-grid.heic"        = "https://github.com/nokiatech/heif/raw/gh-pages/content/conformance/C003.heic"
  "heic/nokia-C014.heic"             = "https://github.com/nokiatech/heif/raw/gh-pages/content/conformance/C014.heic"
  "heic/nokia-C021.heic"             = "https://github.com/nokiatech/heif/raw/gh-pages/content/conformance/C021.heic"
  "heic/nokia-3B-HEIC-SDR.heic"      = "https://github.com/nokiatech/heif/raw/gh-pages/content/cc0/3B_HEIC_SDR.heic"
  "heic/nokia-3A-HEIC-HDR.heic"      = "https://github.com/nokiatech/heif/raw/gh-pages/content/cc0/3A_HEIC_HDR.heic"
  # AVIF (AV1) — AOM reference test files
  "avif/libheif-example.avif"        = "https://github.com/strukturag/libheif/raw/master/examples/example.avif"
  "avif/fox.8bpc.yuv420.avif"        = "https://github.com/AOMediaCodec/av1-avif/raw/master/testFiles/Link-U/fox.profile0.8bpc.yuv420.avif"
  "avif/fox.10bpc.yuv420.avif"       = "https://github.com/AOMediaCodec/av1-avif/raw/master/testFiles/Link-U/fox.profile0.10bpc.yuv420.avif"
  "avif/fox.12bpc.yuv444.avif"       = "https://github.com/AOMediaCodec/av1-avif/raw/master/testFiles/Link-U/fox.profile2.12bpc.yuv444.avif"
  "avif/fox.8bpc.monochrome.avif"    = "https://github.com/AOMediaCodec/av1-avif/raw/master/testFiles/Link-U/fox.profile0.8bpc.yuv420.monochrome.avif"
  "avif/fox.odd-size.avif"           = "https://github.com/AOMediaCodec/av1-avif/raw/master/testFiles/Link-U/fox.profile0.8bpc.yuv420.odd-width.odd-height.avif"
  "avif/hato.10bpc.avif"             = "https://github.com/AOMediaCodec/av1-avif/raw/master/testFiles/Link-U/hato.profile0.10bpc.yuv420.no-cdef.no-restoration.avif"
  "avif/reference-fox.png"           = "https://github.com/AOMediaCodec/av1-avif/raw/master/testFiles/Link-U/fox.png"
  # Camera RAW — raw.pixls.us (CC0)
  "raw/canon-600d.CR2"               = "https://raw.pixls.us/data/Canon/EOS%20600D/_MG_2587.CR2"
  "raw/canon-r6-craw.CR3"            = "https://raw.pixls.us/data/Canon/EOS%20R6/Canon_EOS_R6_CRAW_ISO_100_crop_nodual.CR3"
  "raw/nikon-d3300.NEF"              = "https://raw.pixls.us/data/Nikon/D3300/DSC_0028.NEF"
  "raw/sony-a6000.ARW"               = "https://raw.pixls.us/data/Sony/ILCE-6000/DSC01542.ARW"
  "raw/olympus-em10.ORF"             = "https://raw.pixls.us/data/Olympus/E-M10/P3180165.ORF"
  "raw/fujifilm-xt3.RAF"             = "https://raw.pixls.us/data/Fujifilm/X-T3/AFXT2720.RAF"
  "raw/pentax-k3.DNG"                = "https://raw.pixls.us/data/Pentax/K-3/IMGP6916.DNG"
  "raw/iphone12pro.DNG"              = "https://raw.pixls.us/data/Apple/iPhone%2012%20Pro/IMG_1361.DNG"
}

foreach ($k in $files.Keys) {
  $out = Join-Path $dest $k
  if (Test-Path $out) { Write-Host "  ok    $k"; continue }
  New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
  Write-Host "  fetch $k"
  try {
    Invoke-WebRequest -Uri $files[$k] -OutFile $out -UseBasicParsing
  } catch {
    Write-Warning "failed: $k ($($_.Exception.Message))"
    if (Test-Path $out) { Remove-Item $out }
  }
}
Write-Host "Done. Files in $dest"
