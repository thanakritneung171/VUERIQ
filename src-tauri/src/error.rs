//! Structured, user-presentable errors. Every command returns `AppResult<T>` so a single bad file can
//! never crash the app — the frontend receives `{ kind, message, detail }` and shows a recovery UI.

use serde::Serialize;
use std::io;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    NotFound,
    PermissionDenied,
    UnsupportedFormat,
    UnsupportedCodec,
    Corrupt,
    OutOfMemory,
    Io,
    EngineUnavailable,
    Other,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into(), detail: None }
    }
    pub fn with_detail(mut self, detail: impl ToString) -> Self {
        let d = detail.to_string();
        if !d.is_empty() {
            self.detail = Some(d);
        }
        self
    }
    pub fn unsupported(ext: &str) -> Self {
        Self::new(
            ErrorKind::UnsupportedFormat,
            format!(
                "VUERIQ can't open .{} files. See “Supported formats” in the documentation for the full list.",
                ext.to_ascii_lowercase()
            ),
        )
    }
    pub fn corrupt(detail: impl ToString) -> Self {
        Self::new(
            ErrorKind::Corrupt,
            "The file could not be decoded. It may be incomplete, damaged, or use an unsupported variant of the format.",
        )
        .with_detail(detail)
    }
    pub fn too_large(w: u64, h: u64) -> Self {
        Self::new(
            ErrorKind::OutOfMemory,
            format!(
                "This image is {w} × {h} pixels ({:.0} MP), which exceeds what can be decoded in memory. Try increasing the memory limit in Settings.",
                (w * h) as f64 / 1e6
            ),
        )
    }
    pub fn other(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Other, message)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)?;
        if let Some(d) = &self.detail {
            write!(f, " ({d})")?;
        }
        Ok(())
    }
}

impl std::error::Error for AppError {}

impl From<io::Error> for AppError {
    fn from(e: io::Error) -> Self {
        match e.kind() {
            io::ErrorKind::NotFound => {
                AppError::new(ErrorKind::NotFound, "The file no longer exists. It may have been moved, renamed or deleted.")
            }
            io::ErrorKind::PermissionDenied => AppError::new(
                ErrorKind::PermissionDenied,
                "Windows denied access to this file. Check its permissions or whether another program has it locked.",
            ),
            io::ErrorKind::OutOfMemory => AppError::new(ErrorKind::OutOfMemory, "Not enough memory to open this file."),
            _ => AppError::new(ErrorKind::Io, "The file could not be read.").with_detail(e),
        }
    }
}

impl From<image::ImageError> for AppError {
    fn from(e: image::ImageError) -> Self {
        use image::ImageError as E;
        match e {
            E::IoError(io) => io.into(),
            E::Unsupported(u) => AppError::new(ErrorKind::UnsupportedFormat, "This variant of the image format is not supported.").with_detail(u),
            E::Limits(l) => AppError::new(ErrorKind::OutOfMemory, "The image is too large to decode with the current memory limit.").with_detail(l),
            other => AppError::corrupt(other),
        }
    }
}
