//! Folder listing and well-known places.

use crate::error::{AppError, AppResult};
use crate::formats::{self, MediaKind};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub ext: String,
    pub kind: MediaKind,
    pub size: u64,
    pub modified: u64,
}

#[derive(Serialize)]
pub struct DirEntry {
    pub path: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct FolderListing {
    pub path: String,
    pub parent: Option<String>,
    pub dirs: Vec<DirEntry>,
    pub files: Vec<FileEntry>,
}

#[derive(Serialize)]
pub struct Place {
    pub id: String,
    pub label: String,
    pub path: String,
}

#[derive(Serialize)]
pub struct Places {
    pub home: Vec<Place>,
    pub drives: Vec<Place>,
}

#[cfg(windows)]
pub(crate) fn is_hidden(md: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;
    const SYSTEM: u32 = 0x4;
    md.file_attributes() & (HIDDEN | SYSTEM) != 0
}
#[cfg(not(windows))]
pub(crate) fn is_hidden(_: &std::fs::Metadata) -> bool {
    false
}

pub fn list_folder(path: &Path) -> AppResult<FolderListing> {
    let path = if path.as_os_str().is_empty() { PathBuf::from("C:\\") } else { path.to_path_buf() };
    let meta = std::fs::metadata(&path)?;
    if !meta.is_dir() {
        return Err(AppError::other("This location is not a folder."));
    }
    let mut dirs = vec![];
    let mut files = vec![];
    for entry in std::fs::read_dir(&path)? {
        let Ok(entry) = entry else { continue };
        let Ok(md) = entry.metadata() else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_hidden(&md) || name.starts_with('.') || name.starts_with('$') {
            continue;
        }
        let p = entry.path();
        if md.is_dir() {
            dirs.push(DirEntry { path: p.to_string_lossy().into(), name });
        } else if let Some(kind) = formats::kind_for(&p) {
            files.push(FileEntry {
                path: p.to_string_lossy().into(),
                ext: formats::ext_of(&p),
                name,
                kind,
                size: md.len(),
                modified: md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0),
            });
        }
    }
    dirs.sort_by_key(|d| d.name.to_lowercase());
    Ok(FolderListing {
        parent: path.parent().map(|p| p.to_string_lossy().into_owned()),
        path: path.to_string_lossy().into(),
        dirs,
        files,
    })
}

pub fn places() -> Places {
    let mut home = vec![];
    let mut add = |id: &str, label: &str, p: Option<PathBuf>| {
        if let Some(p) = p.filter(|p| p.is_dir()) {
            home.push(Place { id: id.into(), label: label.into(), path: p.to_string_lossy().into() });
        }
    };
    add("pictures", "Pictures", dirs::picture_dir());
    add("videos", "Videos", dirs::video_dir());
    add("desktop", "Desktop", dirs::desktop_dir());
    add("downloads", "Downloads", dirs::download_dir());
    add("documents", "Documents", dirs::document_dir());

    let mut drives = vec![];
    #[cfg(windows)]
    for letter in b'A'..=b'Z' {
        let root = format!("{}:\\", letter as char);
        if Path::new(&root).exists() {
            drives.push(Place { id: format!("drive-{}", letter as char), label: format!("Drive ({}:)", letter as char), path: root });
        }
    }
    Places { home, drives }
}

#[derive(Serialize)]
pub struct OpenTarget {
    pub folder: String,
    pub file: Option<String>,
}

pub fn resolve_open_target(path: &Path) -> AppResult<OpenTarget> {
    let md = std::fs::metadata(path)?;
    if md.is_dir() {
        return Ok(OpenTarget { folder: path.to_string_lossy().into(), file: None });
    }
    let folder = path.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(OpenTarget { folder, file: Some(path.to_string_lossy().into()) })
}
