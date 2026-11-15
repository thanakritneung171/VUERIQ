# Testing VUERIQ

## Test layers

| Layer | Location | Runs with | What it covers |
|---|---|---|---|
| UI logic | `src/**/*.test.ts` (Vitest, jsdom) | `pnpm test` | Zoom/pan/rotate/flip maths, pyramid level choice, pan limits, every keyboard shortcut, gallery sorting/filtering/search, file navigation (wrap/clamp), recent files, favorites, rubber-band / range selection maths, swipe thresholds, delete / move / undo store logic |
| Rust unit | `src-tauri/src/**` `#[cfg(test)]` | `cargo test --lib` | Extension classification, sRGB transfer, P3→sRGB, pyramid construction |
| Formats | `src-tauri/tests/media_formats.rs` | `cargo test --test media_formats` | HEIC, HEIF, AVIF, JXL, JPEG/PNG/WebP/GIF/BMP/ICO/TIFF/TGA/QOI, SVG, RAW, EXIF orientation, ICC, alpha, sharp detail, corrupt files, bundled-DLL check |
| File operations | `src-tauri/tests/fileops.rs` | `cargo test --test fileops` | Delete to the real Recycle Bin and restore, missing files, network paths need confirmation, move with name-clash renaming and move back, cross-drive move (C: → D:) keeps size and modified time |
| Duplicates | `src-tauri/tests/duplicates.rs` | `cargo test --test duplicates` | Real photos: exact copies incl. sub-folder, HEIC vs its JPEG conversion, PNG/AVIF/half-size JPEG of one photo, duplicate videos; unrelated photos, a RAW, flat colours and a different video are not matched; non-recursive / exact-only mode; dHash distance (fox PNG↔AVIF 2 bits, fox↔pigeon 24 bits); cancellation |
| Engine | `src-tauri/tests/engine.rs` | `cargo test --test engine` | 96 MP image + tiles, panorama, memory budget/eviction, cache reuse, thumbnail cache, thumbnails for every family, video thumbnails, video playback of 16 container/codec combinations, file association registration (sandboxed registry key) |
| Manual / in-app | DevTools-driven checks (below) | — | Rendering, video overlay, UI responsiveness |

## Test media collection

```
test-media/
├─ downloaded/            ← scripts/fetch-test-media.ps1 (real-world files, not committed)
│  ├─ heic/  libheif example · Nokia HEIF conformance C001/C003/C014/C021 · Nokia CC0 SDR/HDR 45 MP
│  ├─ avif/  AOM Link-U fox (8/10/12-bit, 4:2:0/4:4:4, mono, odd size) · hato · libheif example · fox.png reference
│  └─ raw/   raw.pixls.us (CC0): Canon 600D CR2 · Canon R6 CR3 · Nikon D3300 NEF · Sony A6000 ARW ·
│            Olympus E-M10 ORF · Fujifilm X-T3 RAF · Pentax K-3 DNG · iPhone 12 Pro DNG
└─ generated/             ← cargo run --release --example gen_test_media (not committed)
   ├─ images/ test card in every raster format, EXIF orientation 1–8, ICC Display-P3 JPEG/PNG,
   │          alpha PNG, 16-bit PNG/TIFF, static+animated GIF, SVG, JXL (libjxl), AVIF (libaom),
   │          96 MP JPEG, 20000×2000 panorama, corrupt/truncated/empty/mislabelled files
   └─ videos/ 3 s 640×360 clips encoded by libmpv/FFmpeg: H.264, HEVC, VP8, VP9, AV1 (libaom & SVT),
              MPEG-4, WMV2, MPEG-2 in MP4/MOV/MKV/WebM/AVI/WMV/MPG/MPEG/M4V/3GP/TS/MTS + corrupt.mp4
```

The generated test card has coloured corner markers (red TL, green TR, blue BL, white BR) used
to verify orientation, and a 1-pixel black/white checkerboard band used to verify that 100% zoom
is pixel-exact.

Licences: Nokia HEIF conformance files (Nokia licence, test use), Nokia `cc0/` (CC0),
AOM av1-avif test files (BSD-2-Clause / per-directory licence), raw.pixls.us (CC0).

## Running

```powershell
pnpm test
pwsh scripts/fetch-test-media.ps1
cd src-tauri
cargo run --release --example gen_test_media
cargo test -- --test-threads=2
```

The dev test profile builds all decoder crates with `opt-level=3`, so timings are close to
release. (`cargo test --release` also works but re-runs LTO per test binary.)

## Latest results — 2026-11-15, Windows 11 Home 26300, i7-8750H, 32 GB

* **Vitest**: 5 files, **87 / 87 passed**.
* **Rust**: unit 5/5, `media_formats` **16/16**, `engine` **9/9**, `fileops` **5/5**, `duplicates` **4/4** — **39 / 39 passed**.

Selected measurements from the run:

| Item | Result |
|---|---|
| HEIC 1280×854 (libheif example) | 142 ms |
| HEIC grid 1280×720 (Nokia C003) | 72 ms |
| HEIC 8256×5504 10-bit (non-tiled) | ~5.0 s (see known limitations) |
| AVIF vs. reference PNG | MAE 2.02 / 255 |
| ICC Display-P3 (200,100,50) → sRGB | (216, 93, 24) — matches reference maths exactly |
| 96 MP JPEG decode + pyramid | 1.34 s (decode 0.92 s), 5 levels |
| Thumbnail 96 MP JPEG cold / cached | 854 ms / 9 ms |
| RAW develop (24 MP NEF / 26 MP RAF) | 1.5 s / 2.1 s |
| Video: 16 files | all decode ≥1 s, correct codec, 640×360, 3.0 s |

### In-app verification (real VUERIQ window, WebView2 DevTools protocol + PrintWindow)

| Check | Result |
|---|---|
| Home, gallery (32 mixed files), settings, info panel, light theme render correctly | ✔ |
| Gallery thumbnails load asynchronously; corrupt files show a placeholder | ✔ 29 thumbnails, 3 placeholders |
| EXIF orientation 6 displayed upright in the viewer | ✔ |
| 100% zoom on lossless WebP: 1-px checkerboard intact on canvas | ✔ 600/600 alternating pixel pairs |
| Rotate + fit recalculates (800×1200 in 1148×780 → 65%) | ✔ |
| 40 MP panorama: ready in 0.5 s; max UI frame gap while decoding | ✔ 22 ms (no freeze) |
| HEVC MKV plays in the stage with HTML controls overlaid (no Windows HEVC extension) | ✔ |
| libheif/libde265 DLLs loaded from VUERIQ's folder, not System32/WindowsApps | ✔ |

### File operations & Swipe Sort (real window, 15 copied test files, 2026-11-15)

Driven with real mouse/keyboard events over the DevTools protocol; results checked on disk.

| Check | Result |
|---|---|
| Drag a box from the gap before the first thumbnail across 2 rows × 3 columns | ✔ exactly those 6 selected; selection bar "6 items selected" |
| Del → Recycle Bin | ✔ 15 → 9 files on disk; toast "Moved 6 items to the Recycle Bin · Undo" |
| Undo button in the toast | ✔ all 6 restored to the folder (15 on disk) |
| Click, Ctrl+click, Shift+click range, click empty space, Ctrl+A, Esc | ✔ 1→2 selected, range 3–6 → 4, cleared, 15, cleared |
| Move 2 files to another folder, then Ctrl+Z | ✔ 13 + 2 on disk, then all 15 back; favorites follow the move |
| Right-click menu on a selected file | ✔ Open · Add to Favorites · Show in Explorer · Move to… · Delete |
| Viewer: Del on file 3/15 | ✔ file recycled, viewer shows the next file (3/14); Ctrl+Z restores it |
| Swipe Sort: drag right past threshold | ✔ "1 kept", next photo, file untouched |
| Swipe Sort: short drag | ✔ card snaps back, nothing happens |
| Swipe Sort: drag left | ✔ file sent to the Recycle Bin, "1 deleted" |
| Swipe Sort: Ctrl+Z / Backspace / Undo button | ✔ previous card returns; a deleted file is restored from the Recycle Bin |
| Swipe Sort: ← / → keys, leaving the section and coming back, finishing the folder | ✔ session kept; "All done" summary |

### Find Duplicates (real window, 10 files incl. a sub-folder)

| Check | Result |
|---|---|
| Scan with subfolders + similar (Normal) | ✔ 0.2 s; 3 groups: 3 identical HEICs (one in `sub`), 2 identical MP4s, similar fox PNG + 2 AVIFs; pigeon and town photos not grouped |
| Auto-select | ✔ keeps one per group (largest / highest resolution), "Delete 5 · 895 KB" |
| Delete → Recycle Bin, then Undo | ✔ 10 → 5 files on disk, view shows "No duplicates found"; Undo restores all 5 and the 3 groups reappear |
| Select every copy of a group, Delete | ✔ "Delete every copy?" confirmation; Cancel leaves the files untouched |

### HEIC without Windows extensions

VUERIQ never calls WIC or Media Foundation for decoding. The test machine has the Microsoft
*HEIF Image Extension* installed but **not** the *HEVC Video Extension* — which Windows itself
requires to decode HEIC — so Windows could not decode these HEIC files natively, while VUERIQ
does. `heic_libheif_is_bundled_dll` additionally asserts that `heif.dll` and `libde265.dll` are
loaded from VUERIQ's own directory. A Windows Sandbox run was not possible on this Windows Home
machine; for a clean-OS check run the portable build in Windows Sandbox or a fresh VM.

### Packaging (release build, 2026-11-15)

| Check | Result |
|---|---|
| `pnpm tauri build` → `VUERIQ_1.0.0_x64-setup.exe` | ✔ 39.4 MB; contents verified with 7-Zip: `vueriq.exe`, `heif.dll`, `libde265.dll`, `dav1d.dll`, `libmpv-2.dll`, `plugins\heif-dav1d.dll`, `LICENSE.txt`, `THIRD_PARTY_NOTICES.md` |
| `scripts/make-portable.ps1` → `VUERIQ_1.0.0_x64-portable.zip` | ✔ 53.8 MB |
| v1.1.0: `pnpm tauri build` → `VUERIQ_1.1.0_x64-setup.exe`, portable zip | ✔ 39.5 MB / 54.0 MB; exe file version 1.1.0; portable extracted to a fresh folder starts and writes `data` |
| v1.1.1 (duplicate preview, select all): installer + portable zip | ✔ 39.5 MB / 54.0 MB; exe file version 1.1.1; zip contents checked; UI verified in the dev build via CDP |
| Portable extracted to a fresh folder, launched with a 10-bit AVIF as argument ("Open with") | ✔ opens in the viewer within its folder (6 / 8), renders correctly |
| Portable mode stores data beside the exe | ✔ `data\config`, `data\cache` created |
| Second launch with a HEIC while running (double-click from Explorer) | ✔ single process; existing window switches to the HEIC |
| Silent install `VUERIQ_1.0.0_x64-setup.exe /S` (run from an elevated shell → per-machine) | ✔ exit 0 in 12 s; `C:\Program Files\VUERIQ` contains `vueriq.exe`, the 4 DLLs, `plugins\heif-dav1d.dll`, licences, `uninstall.exe`; Start-menu and desktop shortcuts; entry in *Apps & features* |
| File associations written by the installer | ✔ 21 ProgIDs under `HKLM\Software\Classes` (e.g. `.heic` → `HEIF Image`, open command `"C:\Program Files\VUERIQ\vueriq.exe" "%1"`, icon from the exe); the previous default (e.g. `jpegfile`, `WMP11.AssocFile.MP4`) saved as `<ProgID>_backup`. A per-user *UserChoice* (e.g. VLC for .mp4) is left untouched, as Windows requires |
| Installed app launched with a HEIC | ✔ window opens; `heif.dll`, `libde265.dll`, `dav1d.dll`, `plugins\heif-dav1d.dll` loaded from `C:\Program Files\VUERIQ` |
| Silent uninstall `uninstall.exe /S` | ✔ exit 0; install folder, shortcuts, uninstall entry and the VUERIQ ProgIDs removed; `.jpg`/`.mp4` defaults restored to `jpegfile` / `WMP11.AssocFile.MP4`. Cosmetic leftovers from Tauri's NSIS template: the empty `<ProgID>_backup` values and an empty default value on extensions that previously had none (no effect on Explorer) |
| Code signing | ✖ binaries are unsigned (`Get-AuthenticodeSignature` → NotSigned); SmartScreen will warn until a certificate is configured — see README "Code signing" |
