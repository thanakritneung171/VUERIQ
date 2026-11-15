# Supported Formats

Every entry marked **Verified** is exercised by the automated test suite against real files
(`src-tauri/tests/media_formats.rs`, `src-tauri/tests/engine.rs`). Sample sources are listed
in [TESTING.md](TESTING.md). Last full run: 2026-11-15, Windows 11 x64 — all 30 Rust tests and
62 UI tests passing.

No format depends on Windows codec extensions (Microsoft Store HEIF/HEVC/AV1/WebP/RAW extensions)
or on WebView2's built-in codecs. The only WebView-rendered content is the *playback* of animated
GIF/WebP/APNG and the vector rendering of SVG (both from the original bytes; static frames and
thumbnails are still decoded natively).

## Images

| Format | Extensions | Engine | Status | Verified with |
|---|---|---|---|---|
| JPEG | .jpg .jpeg .jpe .jfif | image-rs (zune-jpeg); jpeg-decoder for scaled thumbnails | **Verified** | Generated test card, 8 EXIF orientations, ICC Display-P3, 96 MP and 20000×2000 panoramas, truncated file |
| PNG / APNG | .png .apng | image-rs | **Verified** | 8-bit RGBA with alpha gradient, 16-bit, ICC Display-P3 |
| WebP | .webp | image-rs (image-webp) | **Verified** | Lossless test card (pixel-exact 1-px detail) |
| GIF | .gif | image-rs; animation played by WebView | **Verified** | Static and 12-frame animated GIF |
| BMP | .bmp .dib | image-rs | **Verified** | 24-bit test card |
| ICO / CUR | .ico .cur | image-rs | **Verified** | 256×256 icon |
| TIFF | .tif .tiff | image-rs | **Verified** | 8-bit and 16-bit RGB |
| SVG | .svg | WebView (vector display), resvg (thumbnails) | **Verified** | Gradient/path/text SVG |
| **HEIC / HEIF** | .heic .heif .hif | libheif 1.23.7 + libde265 1.1.3 | **Verified** | libheif example, Nokia conformance C001/C003 (grid)/C014/C021, Nokia CC0 8256×5504 SDR and HDR (PQ) photos |
| **AVIF** | .avif | libheif + dav1d (AV1) | **Verified** | AOM Link-U 8/10/12-bit, 4:2:0/4:4:4, monochrome, odd dimensions; libheif example; libaom-encoded still. Pixel error vs. reference PNG: MAE 2.0 |
| JPEG XL | .jxl | jxl-oxide 0.12 | **Verified** | Lossy and lossless files from the libjxl reference encoder |
| TGA, QOI | .tga .qoi | image-rs | **Verified** | Test card |
| PNM, Radiance HDR, OpenEXR | .pnm .pbm .pgm .ppm .hdr .exr | image-rs | Supported by decoder, *not yet covered by sample tests* | — |

### Camera RAW (rawler 0.8)

| Format | Camera tested | Status | Result |
|---|---|---|---|
| CR2 | Canon EOS 600D | **Verified** | 5184×3456, developed |
| CR3 | Canon EOS R6 (C-RAW, crop) | **Verified** | 3408×2272, developed |
| NEF | Nikon D3300 | **Verified** | 6000×4000, developed |
| ARW | Sony α6000 (ILCE-6000) | **Verified** | 6000×4000, developed |
| DNG | Pentax K-3, Apple iPhone 12 Pro | **Verified** | 6016×4000, 3024×4032 |
| ORF | Olympus E-M10 | **Verified** | 4608×3456, developed |
| RAF | Fujifilm X-T3 | **Verified** | 6240×4160, developed |
| RW2, PEF, SRW, NRW, ERF, 3FR, IIQ, MRW, KDC, DCR, MOS, SRF, SR2 | — | Accepted; *not sample-tested* | Unsupported camera models show "This RAW file comes from a camera model … that isn't supported yet." |

## Rendering features (verified)

| Feature | Test |
|---|---|
| EXIF orientation 1–8 (full decode and thumbnails) | `exif_orientation_all_eight` |
| ICC profile → sRGB | `icc_profile_is_applied` (Display P3 → sRGB matches the reference maths exactly) |
| HEIF/AVIF nclx primaries (Display P3, BT.2020) → sRGB | `color::tests` |
| Alpha transparency | `png_alpha_is_preserved` |
| Pixel-exact 100% zoom | `sharp_detail_survives_decode` + in-app canvas check (600/600 alternating 1-px pairs) |
| Large images (96 MP, 20000×2000) | `large_image_builds_pyramid_and_serves_tiles`, `panorama_tiles_cover_extreme_aspect` |
| Corrupt / empty / mislabelled files never crash | `corrupt_and_bogus_files_fail_gracefully` |

## Video (libmpv / FFmpeg)

All files below are played headlessly by the test suite until ≥1 s of media time has been
decoded, and the reported codec, resolution (640×360) and duration (3 s) are checked.

| Container | Extension | Video codec tested | Audio | Status |
|---|---|---|---|---|
| MP4 | .mp4 | H.264, **H.265/HEVC**, AV1 (SVT-AV1) | AAC | **Verified** |
| QuickTime | .mov | H.264 | AAC | **Verified** |
| Matroska | .mkv | **HEVC**, AV1 (libaom) | Opus | **Verified** |
| WebM | .webm | VP9, VP8 | Opus, Vorbis | **Verified** |
| AVI | .avi | MPEG-4 Part 2 | MP3 | **Verified** |
| Windows Media | .wmv | WMV2 (Windows Media Video 8) | WMA v2 | **Verified** |
| MPEG-PS | .mpeg .mpg | MPEG-2 | MP2 | **Verified** |
| MPEG-4 | .m4v | H.264 | AAC | **Verified** |
| 3GPP | .3gp | H.264 | AAC | **Verified** |
| MPEG-TS | .ts | H.264 | AAC | **Verified** |
| AVCHD | .mts | H.264 | AC-3 | **Verified** |
| Others | .m2ts .flv .ogv .vob .asf .f4v .divx .qt .3g2 .mpe .m2v | various | | Accepted by FFmpeg; *not sample-tested* |

HEVC playback works without Microsoft's "HEVC Video Extensions" (not installed on the test
machine). Hardware decoding (`hwdec=auto-safe`, D3D11VA) is used when available and falls back
to software.

## Known limitations

* Very large **non-tiled** HEVC images (e.g. the 45 MP Nokia sample, a single 8256×5504 HEVC
  frame) decode in ~5–6 s because libde265 decodes a single frame mostly on one thread. Typical
  phone HEICs (512×512 tile grids) decode in parallel and open in well under a second.
* HDR (PQ/HLG) HEIF/AVIF is shown tone-clipped as SDR; there is no HDR display output yet.
* Images are rendered at 8 bits per channel (10/12/16-bit sources are converted).
* Multi-image HEIF (bursts/collections) shows the primary image; animated JXL shows the first frame.
* RAW files are developed with rawler's default pipeline when no full-size embedded preview
  exists; colour rendition may differ from the camera maker's software.
