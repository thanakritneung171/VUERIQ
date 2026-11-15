<p align="center"><img src="src-tauri/icons/vueriq.svg" width="96" alt="VUERIQ"></p>

<h1 align="center">VUERIQ</h1>
<p align="center"><b>See Every Detail.</b><br>Premium universal image &amp; video viewer for Windows 10 / 11 (x64)</p>

---

VUERIQ opens the photos and videos people actually have — iPhone **HEIC**, **AVIF**, **JPEG XL**,
camera **RAW**, and every common video format — on a clean Windows installation, **without
installing the Microsoft Store "HEIF Image Extensions" or "HEVC Video Extensions"**. All codecs
ship inside the app.

## Highlights

- **HEIC / HEIF / AVIF** via bundled libheif + libde265 + dav1d — independent of Windows codecs
- **Full-quality rendering**: original pixels at 100%, mip-mapped GPU tiles, high-DPI exact,
  EXIF orientation, ICC / Display-P3 colour management
- **Huge images stay smooth**: 100+ megapixel photos decode in the background and pan instantly
- **Camera RAW**: CR2, CR3, NEF, ARW, DNG, ORF, RAF and more
- **Video**: libmpv engine — H.264, HEVC, VP8, VP9, AV1, MPEG-2/4, WMV in MP4, MOV, MKV, WebM, AVI,
  WMV, MPEG, 3GP, TS/MTS — with frame stepping, speed control and hardware decoding
- **Gallery**: virtualized grid / list, async disk-cached thumbnails, sort, search, filter,
  recent files and favorites, drag &amp; drop
- **Organise files**: select with click / Ctrl / Shift or by dragging a box, then *Move to…* or
  *Delete* (to the Recycle Bin) — every delete and move can be undone (Ctrl+Z)
- **Swipe Sort**: go through a folder one photo at a time — swipe right to keep, left to delete,
  with Undo
- **Find Duplicates**: byte-identical copies of any photo or video, plus similar-looking photos
  (re-saved, resized, HEIC ↔ JPG); auto-select keeps the best copy, delete or move the rest
- **Windows integration**: installer with file associations, portable build, "Open with",
  single instance

See [docs/SUPPORTED_FORMATS.md](docs/SUPPORTED_FORMATS.md) for the verified format matrix.

## Install

| Package | Use |
|---|---|
| `VUERIQ_1.1.0_x64-setup.exe` | Installer. Per-user (no admin) or all users. Registers file types, Start menu, uninstaller. |
| `VUERIQ_1.1.0_x64-portable.zip` | Unzip anywhere and run `VUERIQ.exe`. Settings stay in `data\` beside the exe. Use *Settings → Windows Integration → Register* to add "Open with". |

Requirements: Windows 10 1809+ or Windows 11, x64, WebView2 Runtime (pre-installed on Windows 11;
the installer fetches it on Windows 10 if missing). The portable build needs WebView2 to be
present already.

**Make VUERIQ the default viewer:** Windows requires the user to choose. After installing (or
registering the portable build) open *Settings → Apps → Default apps → VUERIQ* and pick the file
types, or right-click a file → *Open with → Choose another app → VUERIQ → Always*.

## Keyboard shortcuts

| Key | Images | Videos |
|---|---|---|
| ← / → | Previous / next | Seek −5 / +5 s (Shift: 30 s) |
| PgUp / PgDn, Ctrl+← / → | Previous / next | Previous / next file |
| + / − , wheel | Zoom (at cursor) | — |
| 0 / 1 | Fit / 100% | — |
| Double-click | Toggle fit ↔ 100% | Full screen |
| R / L | Rotate right / left | — |
| H / V | Flip horizontal / vertical | — |
| Space | Next image | Play / pause |
| , / . | — | Previous / next frame |
| [ / ] , Backspace | — | Speed down / up, reset |
| ↑ / ↓ , M | Pan | Volume, mute |
| F / F11, Esc | Full screen, exit / back | |
| I, S, Ctrl+O | Info panel, favorite, open | |
| Del | Delete (Recycle Bin), show next | Delete (Recycle Bin), show next |
| Ctrl+Z | Undo the last delete / move | |

**Gallery:** click to select, Ctrl+click to add/remove, Shift+click for a range, or drag a box
around thumbnails (hold Ctrl/Shift to add to the selection). Ctrl+A selects all, Esc clears,
Del deletes the selection, right-click for *Move to…* / *Delete*. Files on drives without a
Recycle Bin (USB sticks, network shares) are only deleted after an explicit confirmation.

**Swipe Sort** (sidebar → Tools): drag the photo right (or →) to keep it, left (or ←, Del) to send
it to the Recycle Bin; Ctrl+Z, Backspace or the Undo button brings back the previous photo.

**Find Duplicates** (sidebar → Tools): pick a folder (optionally with subfolders) and choose how
strict the similar-photo match is. Results are grouped as *Identical* (same bytes) or *Similar*
(same picture). One file per group is pre-selected to keep — the highest resolution / largest
file, or switch *Auto-select* to keep the oldest or newest. Click a tile to change the choice;
*Select all* / *Unselect all* work for the whole result or per group. Double-click a tile (or its
eye button) to preview it in place: ← / → step through the group, Space toggles keep / remove,
Enter opens the full viewer, Esc returns to the same spot. Deleting every copy of a group asks first.

## Build from source

Prerequisites: Windows 10/11 x64, **Visual Studio 2022+ (or Build Tools) with "Desktop
development with C++"**, Git, Node.js 20+, pnpm 9, Rust stable (MSVC).

```powershell
pnpm install
pwsh scripts/setup-deps.ps1          # builds libheif/libde265/dav1d (vcpkg), downloads libmpv
pnpm tauri dev                       # run in development
pnpm tauri build                     # NSIS installer → src-tauri/target/release/bundle/nsis/
pwsh scripts/make-portable.ps1       # portable zip  → dist-release/
```

`src-tauri/build.rs` copies the four runtime DLLs next to the executable for dev, tests and the
installer.

### Code signing (avoid SmartScreen / antivirus warnings)

Release builds are currently **unsigned**, so Windows SmartScreen shows "Windows protected your
PC" and some antivirus products treat the new, unknown executable with suspicion. To ship it:

1. Get a code-signing certificate: **Azure Trusted Signing** (cheapest, immediate SmartScreen
   reputation for verified organisations/individuals) or an OV/EV certificate from a CA
   (DigiCert, Sectigo, SSL.com…).
2. Configure Tauri to sign every binary it bundles — either a certificate in the Windows store:
   `"bundle": { "windows": { "certificateThumbprint": "<SHA1>", "digestAlgorithm": "sha256",
   "timestampUrl": "http://timestamp.digicert.com" } }`, or any tool via
   `"signCommand": "trusted-signing-cli -e <endpoint> -a <account> -c <profile> %1"`.
   Also sign the DLLs and `VUERIQ.exe` in the portable zip with `signtool sign /fd sha256 /tr <timestamp> /td sha256`.
3. If an antivirus still flags a signed release, submit the files as a false positive
   (Microsoft: <https://www.microsoft.com/wdsi/filesubmission>; other vendors have similar forms).

## Tests

```powershell
pnpm test                                            # UI logic (view maths, shortcuts, navigation)
pwsh scripts/fetch-test-media.ps1                    # real HEIC / AVIF / RAW samples
cd src-tauri
cargo run --release --example gen_test_media         # synthetic images & videos
cargo test --release -- --test-threads=2             # formats, orientation, ICC, video, cache…
```

Details and the latest results: [docs/TESTING.md](docs/TESTING.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Supported formats](docs/SUPPORTED_FORMATS.md)
- [Testing](docs/TESTING.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md) — **read before distributing** (libmpv is a GPL build)

© 2026 VUERIQ
