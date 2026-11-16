//! Video engine: libmpv (bundled, FFmpeg-based — H.264, HEVC, VP8/9, AV1, MPEG-2, VC-1, …),
//! loaded at runtime so the image viewer keeps working even if the DLL is missing.
//!
//! mpv renders into the main window (`wid`) *behind* the transparent WebView. The frontend reports
//! the stage rectangle as `video-margin-ratio-*` so the picture sits exactly inside it, and HTML
//! controls are composited on top.

mod mpv;
mod player;
mod tools;

pub use player::{EngineInfo, Player, VideoState};
pub use tools::{encode_test_clip, encode_test_clip_with, probe_playback, thumbnail};
