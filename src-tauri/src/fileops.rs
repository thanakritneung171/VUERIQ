//! File operations: delete to the Recycle Bin (with restore for undo) and move.
//!
//! Every operation reports a per-file result so the UI can tell exactly what happened.
//! Deleting never silently destroys data: on volumes without a Recycle Bin (removable and network
//! drives) the call fails with `needsPermanent` unless the caller explicitly allows it.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpResult {
    /// Path the operation was applied to.
    pub path: String,
    /// New location (moves / restores).
    pub to: Option<String>,
    pub ok: bool,
    /// True when the file went to the Recycle Bin (restorable).
    pub recycled: bool,
    /// The file is on a drive without a Recycle Bin and was left untouched.
    pub needs_permanent: bool,
    pub error: Option<String>,
}

impl OpResult {
    fn ok(path: &Path, to: Option<&Path>, recycled: bool) -> Self {
        Self { path: s(path), to: to.map(s), ok: true, recycled, needs_permanent: false, error: None }
    }
    fn err(path: &Path, e: impl ToString) -> Self {
        Self { path: s(path), to: None, ok: false, recycled: false, needs_permanent: false, error: Some(e.to_string()) }
    }
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn io_message(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::NotFound => "The file no longer exists.".into(),
        std::io::ErrorKind::PermissionDenied => "Access denied — the file may be read-only or in use.".into(),
        _ => match e.raw_os_error() {
            Some(32) | Some(33) => "The file is in use by another program.".into(),
            Some(112) => "There is not enough space on the destination drive.".into(),
            _ => e.to_string(),
        },
    }
}

/// Whether deleting `path` can go to the Recycle Bin (local fixed disk).
#[cfg(windows)]
pub fn has_recycle_bin(path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Component;
    use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;
    const DRIVE_FIXED: u32 = 3;
    let root = match path.components().next() {
        Some(Component::Prefix(p)) => match p.kind() {
            std::path::Prefix::Disk(l) | std::path::Prefix::VerbatimDisk(l) => format!("{}:\\", l as char),
            _ => return false, // UNC / network share
        },
        _ => return false,
    };
    let wide: Vec<u16> = std::ffi::OsStr::new(&root).encode_wide().chain(Some(0)).collect();
    unsafe { GetDriveTypeW(wide.as_ptr()) == DRIVE_FIXED }
}
#[cfg(not(windows))]
pub fn has_recycle_bin(_: &Path) -> bool {
    true
}

/// Delete files. Files on Recycle-Bin volumes are recycled; others need `allow_permanent`.
pub fn delete_files(paths: &[PathBuf], allow_permanent: bool) -> Vec<OpResult> {
    paths
        .iter()
        .map(|p| {
            if !p.is_file() {
                return OpResult::err(p, "The file no longer exists.");
            }
            if has_recycle_bin(p) {
                match trash::delete(p) {
                    Ok(()) if !p.exists() => OpResult::ok(p, None, true),
                    Ok(()) => OpResult::err(p, "Windows did not move the file to the Recycle Bin."),
                    Err(e) => OpResult::err(p, format!("Could not move to the Recycle Bin: {e}")),
                }
            } else if allow_permanent {
                match std::fs::remove_file(p) {
                    Ok(()) => OpResult::ok(p, None, false),
                    Err(e) => OpResult::err(p, io_message(&e)),
                }
            } else {
                OpResult {
                    needs_permanent: true,
                    ..OpResult::err(p, "This drive has no Recycle Bin; the file would be deleted permanently.")
                }
            }
        })
        .collect()
}

/// Restore files previously recycled from the given original paths (most recent deletion wins).
pub fn restore_files(paths: &[PathBuf]) -> Vec<OpResult> {
    let items = match trash::os_limited::list() {
        Ok(i) => i,
        Err(e) => return paths.iter().map(|p| OpResult::err(p, format!("Could not read the Recycle Bin: {e}"))).collect(),
    };
    paths
        .iter()
        .map(|p| {
            let want = s(p).to_lowercase();
            let found = items
                .iter()
                .filter(|it| s(&it.original_path()).to_lowercase() == want)
                .max_by_key(|it| it.time_deleted);
            let Some(item) = found else {
                return OpResult::err(p, "The file is no longer in the Recycle Bin.");
            };
            if p.exists() {
                return OpResult::err(p, "A file with the same name already exists.");
            }
            match trash::os_limited::restore_all([item.clone()]) {
                Ok(()) if p.exists() => OpResult::ok(p, Some(p), false),
                Ok(()) => OpResult::err(p, "Windows did not restore the file."),
                Err(e) => OpResult::err(p, format!("Could not restore: {e}")),
            }
        })
        .collect()
}

/// `dest/name`, or `dest/name (2).ext`, `(3)`… when taken.
pub fn unique_target(dest: &Path, name: &std::ffi::OsStr) -> PathBuf {
    let first = dest.join(name);
    if !first.exists() {
        return first;
    }
    let p = Path::new(name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..)
        .map(|i| dest.join(format!("{stem} ({i}){ext}")))
        .find(|c| !c.exists())
        .unwrap()
}

/// Move one file to an exact target that must not exist. Falls back to copy + delete across drives.
pub fn move_file(from: &Path, to: &Path) -> OpResult {
    if !from.is_file() {
        return OpResult::err(from, "The file no longer exists.");
    }
    if to.exists() {
        return OpResult::err(from, "A file with the same name already exists at the destination.");
    }
    match std::fs::rename(from, to) {
        Ok(()) => OpResult::ok(from, Some(to), false),
        // ERROR_NOT_SAME_DEVICE
        Err(e) if e.raw_os_error() == Some(17) => {
            if let Err(e) = std::fs::copy(from, to) {
                let _ = std::fs::remove_file(to);
                return OpResult::err(from, io_message(&e));
            }
            // Keep the modified time so sorting by date still works after the move.
            if let Ok(t) = std::fs::metadata(from).and_then(|m| m.modified()) {
                if let Ok(f) = std::fs::File::options().write(true).open(to) {
                    let _ = f.set_modified(t);
                }
            }
            match std::fs::remove_file(from) {
                Ok(()) => OpResult::ok(from, Some(to), false),
                Err(e) => {
                    let _ = std::fs::remove_file(to);
                    OpResult::err(from, io_message(&e))
                }
            }
        }
        Err(e) => OpResult::err(from, io_message(&e)),
    }
}

/// Move files into `dest`, renaming on name clashes.
pub fn move_files(paths: &[PathBuf], dest: &Path) -> Vec<OpResult> {
    if !dest.is_dir() {
        return paths.iter().map(|p| OpResult::err(p, "The destination folder does not exist.")).collect();
    }
    paths
        .iter()
        .map(|p| {
            if p.parent().is_some_and(|d| same_path(d, dest)) {
                return OpResult::err(p, "The file is already in this folder.");
            }
            let Some(name) = p.file_name() else { return OpResult::err(p, "Invalid file name.") };
            move_file(p, &unique_target(dest, name))
        })
        .collect()
}

fn same_path(a: &Path, b: &Path) -> bool {
    let canon = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    s(&canon(a)).to_lowercase() == s(&canon(b)).to_lowercase()
}
