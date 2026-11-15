//! `vq://` custom protocol (served to WebView2 as http://vq.localhost/...):
//!   /thumb/{size}?p=<path>&m=<mtime>   cached thumbnail (JPEG/PNG)
//!   /tile/{id}/{level}/{tx}/{ty}        raw RGBA8 tile of a decoded image
//!   /file?p=<path>                      original bytes of a supported image (animated GIF/WebP, SVG)
//!
//! Binary transfer avoids base64/JSON overhead entirely. All work runs off the main thread.

use crate::formats::{self, Engine};
use crate::AppState;
use percent_encoding::percent_decode_str;
use std::path::PathBuf;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, UriSchemeResponder};

fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key).then(|| percent_decode_str(&v.replace('+', "%20")).decode_utf8_lossy().into_owned())
    })
}

fn respond(responder: UriSchemeResponder, status: StatusCode, mime: &str, body: Vec<u8>, cache: bool) {
    let res = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, if cache { "max-age=31536000, immutable" } else { "no-store" })
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()));
    responder.respond(res);
}

fn error(responder: UriSchemeResponder, status: StatusCode, msg: impl ToString) {
    respond(responder, status, "text/plain; charset=utf-8", msg.to_string().into_bytes(), false);
}

pub fn handle(app: AppHandle, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let uri = request.uri().clone();
    let path = uri.path().trim_start_matches('/').to_string();
    let query = uri.query().unwrap_or("").to_string();
    let state = app.state::<AppState>();
    let parts: Vec<&str> = path.split('/').collect();

    match parts.first().copied() {
        Some("thumb") => {
            let size: u32 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(256);
            let Some(p) = query_param(&query, "p") else { return error(responder, StatusCode::BAD_REQUEST, "missing p") };
            let thumbs = state.thumbs.clone();
            state.thumbs.spawn(move || match thumbs.get(&PathBuf::from(&p), size) {
                Ok(t) => respond(responder, StatusCode::OK, t.mime, t.bytes, true),
                Err(e) => error(responder, StatusCode::UNPROCESSABLE_ENTITY, e),
            });
        }
        Some("tile") => {
            let nums: Vec<u64> = parts[1..].iter().filter_map(|s| s.parse().ok()).collect();
            if nums.len() != 4 {
                return error(responder, StatusCode::BAD_REQUEST, "bad tile path");
            }
            let store = state.store.clone();
            // Tiles are a memcpy; a blocking thread keeps the async runtime free.
            tauri::async_runtime::spawn_blocking(move || match store.tile(nums[0], nums[1] as usize, nums[2] as u32, nums[3] as u32) {
                Ok(bytes) => respond(responder, StatusCode::OK, "application/octet-stream", bytes, false),
                Err(e) => error(responder, StatusCode::NOT_FOUND, e),
            });
        }
        Some("file") => {
            let Some(p) = query_param(&query, "p") else { return error(responder, StatusCode::BAD_REQUEST, "missing p") };
            let pb = PathBuf::from(&p);
            // Only media files may be served — never arbitrary paths.
            let mime = match (formats::engine_for(&pb), formats::ext_of(&pb).as_str()) {
                (Some(Engine::Svg), _) => "image/svg+xml",
                (Some(Engine::Standard), "gif") => "image/gif",
                (Some(Engine::Standard), "webp") => "image/webp",
                (Some(Engine::Standard), "png" | "apng") => "image/png",
                _ => return error(responder, StatusCode::FORBIDDEN, "not a servable media type"),
            };
            tauri::async_runtime::spawn_blocking(move || match std::fs::read(&pb) {
                Ok(bytes) => respond(responder, StatusCode::OK, mime, bytes, false),
                Err(e) => error(responder, StatusCode::NOT_FOUND, e),
            });
        }
        _ => error(responder, StatusCode::NOT_FOUND, "unknown route"),
    }
}
