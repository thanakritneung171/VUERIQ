# VUERIQ Architecture

VUERIQ is a Tauri 2 desktop application: a Rust core that owns every decoder and the video
engine, and a React/TypeScript UI rendered by WebView2. **No image or video is decoded by
Windows codecs (WIC / Media Foundation) or by the browser engine's codec set** — with one
deliberate exception noted below (animated GIF/WebP/APNG and SVG playback).

```
┌──────────────────────────── VUERIQ.exe (one process) ────────────────────────────┐
│                                                                                  │
│  WebView2 (transparent)                                Rust core                 │
│  ┌──────────────────────────────┐   invoke (JSON)    ┌────────────────────────┐  │
│  │ React UI                     │ ─────────────────▶ │ commands (lib.rs)      │  │
│  │  Sidebar · Gallery · Viewer  │                    │  fsx · exif · assoc    │  │
│  │  TileRenderer (Canvas2D/GPU) │ ◀── vq:// binary ─ │ protocol.rs            │  │
│  │  VideoView (HTML controls)   │   tiles, thumbs    │  ├ ImageStore (pyramid)│  │
│  └──────────────▲───────────────┘                    │  ├ ThumbCache (disk)   │  │
│                 │ events "video-state"               │  └ decode/*            │  │
│  ┌──────────────┴───────────────┐                    │     libheif+libde265   │  │
│  │ libmpv video surface (D3D11) │ ◀── libmpv API ─── │     +dav1d · image-rs  │  │
│  │ child window *behind* WebView│                    │     rawler · jxl-oxide │  │
│  └──────────────────────────────┘                    │     resvg · qcms       │  │
│                                                      └────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## Source layout

| Path | Purpose |
|---|---|
| `src/` | React UI (Vite, Tailwind 4, Zustand) |
| `src/lib/tileRenderer.ts` | GPU tile renderer for still images |
| `src/lib/viewMath.ts` | Pure zoom/pan/rotate/flip maths (unit tested) |
| `src/lib/shortcuts.ts` | Keyboard map (unit tested) |
| `src/lib/selection.ts` | Rubber-band / range selection and swipe-threshold maths (unit tested) |
| `src/views/SwipeView.tsx` | Swipe Sort tool (keep / delete one photo at a time, undo history) |
| `src/store/app.ts` | App state, navigation, recent/favorites, persistence, delete / move / undo |
| `src-tauri/src/decode/` | Native decoders → RGBA8 sRGB, orientation applied |
| `src-tauri/src/imagestore.rs` | Decoded image cache, mip pyramid, tiles, memory budget |
| `src-tauri/src/thumbs.rs` | Thumbnail generation + disk cache |
| `src-tauri/src/video.rs` | Runtime-loaded libmpv binding, player, video thumbnails |
| `src-tauri/src/protocol.rs` | `vq://` custom protocol (binary transfer) |
| `src-tauri/src/color.rs` | ICC (qcms) and CICP/nclx → sRGB |
| `src-tauri/src/assoc.rs` | Per-user file association registration |
| `src-tauri/src/duplicates.rs` | Duplicate finder: size → quick hash → xxh3, plus dHash for similar photos |
| `src-tauri/src/fileops.rs` | Delete to Recycle Bin, restore, move (cross-drive copy fallback) |

## Image pipeline

1. **Probe** (`decode::probe`): the real container is sniffed from magic bytes (a HEIC renamed to
   `.jpg` still opens). Animated GIF/WebP/APNG and SVG are routed to the WebView `<img>` element
   so animation and vector sharpness are preserved; everything else is decoded natively.
2. **Decode** on a blocking worker thread:
   * HEIC/HEIF/AVIF → libheif 1.23 with libde265 (HEVC) and dav1d (AV1) plugins, bundled as DLLs.
     `irot`/`imir`/`clap` transforms are applied by libheif; 10/12-bit content is converted to 8-bit.
   * JPEG/PNG/WebP/GIF/BMP/ICO/TIFF/TGA/QOI/PNM/HDR/EXR → image-rs (zune-jpeg, png, image-webp…).
   * Camera RAW → rawler. If the RAW embeds a camera-rendered JPEG at ≥85% of sensor
     resolution it is used (camera colour rendition); otherwise the sensor data is developed
     (demosaic → WB → colour matrix → sRGB).
   * JPEG XL → jxl-oxide, requesting sRGB output.
3. **Colour**: embedded ICC profiles are converted to sRGB with qcms (perceptual intent,
   parallelised). HEIF/AVIF without ICC but with nclx Display-P3/BT.2020 primaries are converted
   with exact matrices and sRGB transfer LUTs.
4. **Orientation**: EXIF orientation 1–8 is applied to the pixels, so the renderer never needs to.
5. **Pyramid** (`ImageStore`): level 0 is the original; each level halves both sides with SIMD
   Lanczos3 (alpha-aware) until it fits one 1024 px tile. Total overhead ≈ +33%.
6. **Tiles**: the renderer requests `vq://tile/{id}/{level}/{tx}/{ty}` — raw RGBA with a 1-px
   overlap border (seamless bilinear filtering). No PNG/JPEG re-encoding, no base64.

### Renderer (`TileRenderer`)

* Canvas sized in **device pixels** (`devicePixelContentBoxSize`), so "100%" means one image pixel
  per physical screen pixel on high-DPI displays.
* Level choice: the coarsest level whose resolution is still ≥ the displayed size — the image is
  always *down*-sampled, never up-sampled from a reduced level. At ≥100% level 0 is used.
* Integer-snapped tile edges + rotation by multiples of 90° keep 100% zoom pixel-exact.
* ≥200% zoom uses nearest-neighbour (configurable) to show real pixels instead of blur.
* The smallest level is always resident → instant first paint and fallback while panning.
* Tile bitmaps live in an LRU (384 MB) and are `close()`d on eviction or image change.

### Memory management

* `ImageStore` keeps decoded pyramids under a configurable budget (default 1.5 GB).
  Images on screen are *pinned*; prefetched neighbours and history are evicted LRU-first.
* The maximum single image size is derived from the budget (default ≈ 268 MP); larger
  images produce a clear "too large" error instead of an allocation failure.
* Decoder panics are caught (`catch_unwind`) and become "file is damaged" errors.

## Thumbnails

Separate from full-resolution rendering. Generated on a dedicated rayon pool (cores−2, max 6),
size-bucketed (192/320/480 px), stored as JPEG (PNG when transparent) under
`%LOCALAPPDATA%\com.vueriq.viewer\cache\thumbs` keyed by xxh3(path, mtime, size, bucket).
Fast paths: DCT-domain scaled JPEG decode, embedded HEIF thumbnail items, embedded RAW previews,
mpv single-frame extraction for video. The gallery is virtualized, so only visible cells request
thumbnails.

## Video engine

`libmpv-2.dll` (FFmpeg-based, shinchiro build) is loaded at runtime with `libloading`, so the
app still runs if it is missing. A single player instance renders with `vo=gpu-next`/D3D11 into
the main window (`wid`). The window and WebView are transparent; mpv's child window is pushed to
the bottom of the z-order so the HTML UI stays on top, and the video stage `<div>` is
transparent. The stage rectangle is sent to mpv as `video-margin-ratio-*`, so the picture is
placed exactly inside it and the HTML controls overlay it. Property changes are observed
(`time-pos`, `pause`, `duration`, …) and pushed to the UI as `video-state` events (≤15 Hz for
position updates).

## Windows integration

* **Single instance**: double-clicking another file forwards argv to the running window.
* **Installer** (NSIS): registers `fileAssociations` from `tauri.conf.json`, Start-menu entry,
  uninstaller; per-user or per-machine install.
* **Portable**: the same exe plus DLLs and a `portable` marker file; data goes to `.\data\`.
  Settings → *Register* writes per-user ProgIDs, `OpenWithProgids`, Capabilities and
  `RegisteredApplications` under HKCU, then opens Windows *Default apps*.

## File operations

* **Delete** uses the Windows shell (`trash` crate → `IFileOperation` with *recycle on delete*),
  so files land in the normal Recycle Bin. Only local fixed disks are sent there; on removable
  and network drives (`GetDriveTypeW` ≠ `DRIVE_FIXED`) the backend refuses with
  `needsPermanent` and the UI asks before deleting permanently.
* **Undo of a delete** finds the item in the Recycle Bin by original path (most recent
  deletion) and restores it with the shell. **Undo of a move** moves each file back to its
  exact original path.
* **Move** renames within a drive; across drives it copies, preserves the modified time, then
  deletes the source (rolling back the copy on failure). Name clashes become `name (2).ext`.
* Every call returns a per-file result; the UI updates the open folder, viewer, favorites and
  recent lists from those results and offers *Undo* in a toast (stack of 30, Ctrl+Z).

## Duplicate finder

* **Exact**: files are bucketed by size; buckets with 2+ files get a quick xxh3 over size + first
  and last 64 KiB, and only remaining collisions are hashed in full (128-bit xxh3). Runs in
  parallel (rayon); works for every image and video format.
* **Similar** (images): each picture is decoded at thumbnail size (orientation applied, colour
  managed), reduced to 9×8 grey and turned into a 64-bit difference hash. Images are sorted by
  aspect ratio and compared only with neighbours within ±6 %; pairs with a Hamming distance ≤ 5 /
  8 / 12 (Strict / Normal / Loose) are joined with union-find. Near-flat images (σ < 4) are
  skipped for similarity so blank frames don't match each other. Hashes are cached in memory by
  path + size + mtime, so "Scan again" is fast.
* Progress is streamed as `dup-progress` events (throttled to ~12/s); `cancel_duplicates` stops
  every phase promptly. Deleting and moving reuse the Recycle-Bin file operations and Undo.

## Security

* Strict CSP; the `vq://file` route only serves media extensions, never arbitrary paths.
* Video commands/properties are allow-listed in `video.rs`.
* No network access is required at runtime.
