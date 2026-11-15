# VUERIQ — Third-Party Notices

VUERIQ bundles the following open-source components. Their licences apply to those components
only. Full licence texts are available at the linked project pages; Rust crate licences can be
listed with `cargo license` in `src-tauri/`.

## Native libraries shipped as separate DLLs

| Component | Version | Licence | File |
|---|---|---|---|
| [libheif](https://github.com/strukturag/libheif) | 1.23.7 | LGPL-3.0 (library), MIT (examples) | `heif.dll` |
| [libde265](https://github.com/strukturag/libde265) | 1.1.3 | LGPL-3.0 | `libde265.dll` |
| [dav1d](https://code.videolan.org/videolan/dav1d) | 1.5.x | BSD-2-Clause | `dav1d.dll` |
| [mpv / libmpv](https://mpv.io) (shinchiro mpv-winbuild-cmake build 20261111) | git bcde6b93 | GPL-2.0-or-later (this build includes GPL components such as x264/x265) | `libmpv-2.dll` |
| [FFmpeg](https://ffmpeg.org) (statically linked inside libmpv-2.dll) | 8.x | GPL (as configured in the build) | `libmpv-2.dll` |

**LGPL compliance.** libheif and libde265 are dynamically linked. You may replace `heif.dll` and
`libde265.dll` with your own compatible builds. Source code for these libraries is available
from the project pages above; the exact build recipe is `scripts/setup-deps.ps1`
(vcpkg port `libheif[core,libde265,dav1d]`).

**GPL notice for the video engine.** The bundled `libmpv-2.dll` is a GPL build. Distributing
VUERIQ with this DLL means the combined work must be distributed in compliance with the GPL, or
`libmpv-2.dll` must be replaced with an LGPL build of mpv (`-Dgpl=false`) linked against an LGPL
FFmpeg. **Review this before commercial distribution.** Source: https://github.com/mpv-player/mpv
and https://github.com/shinchiro/mpv-winbuild-cmake.

**Patents.** HEVC (H.265), H.264 and other codecs may be covered by patents in some
jurisdictions. Decoding software is distributed without patent licences; distributors are
responsible for determining whether licences are required in their markets.

## Rust crates (statically linked)

| Crate | Licence |
|---|---|
| tauri, tauri-plugin-dialog, tauri-plugin-single-instance | MIT OR Apache-2.0 |
| image, jpeg-decoder, png, image-webp, gif, tiff, qoi, exr | MIT OR Apache-2.0 |
| zune-jpeg | MIT OR Apache-2.0 OR Zlib |
| libheif-rs, libheif-sys | MIT |
| rawler | LGPL-2.1 |
| jxl-oxide | MIT OR Apache-2.0 |
| resvg, usvg, tiny-skia | Apache-2.0 OR MIT |
| qcms | MIT |
| kamadak-exif | BSD-2-Clause |
| fast_image_resize | MIT OR Apache-2.0 |
| libloading | ISC |
| winreg | MIT |
| windows-sys | MIT OR Apache-2.0 |
| serde, serde_json, thiserror, parking_lot, rayon, crossbeam-channel, percent-encoding, dirs, log | MIT OR Apache-2.0 |
| xxhash-rust | BSL-1.0 |

> rawler is LGPL-2.1. Because Rust crates are statically linked, LGPL obligations for rawler
> include allowing relinking: the complete VUERIQ source and build instructions (README.md)
> satisfy this when distributed together; otherwise provide object files on request.

## JavaScript packages (bundled into the UI)

| Package | Licence |
|---|---|
| react, react-dom | MIT |
| @tauri-apps/api, @tauri-apps/plugin-dialog | MIT OR Apache-2.0 |
| zustand | MIT |
| @tanstack/react-virtual | MIT |
| lucide-react | ISC |
| tailwindcss | MIT |

## Runtime

Microsoft Edge WebView2 Runtime (installed by Windows or by the VUERIQ installer bootstrapper) is
licensed by Microsoft under its own terms.
