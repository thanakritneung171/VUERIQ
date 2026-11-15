//! Real file-system tests for delete (Recycle Bin) / restore / move.
//! The recycle test sends a small uniquely-named temp file to the user's Recycle Bin and restores it.

use std::fs;
use std::path::PathBuf;
use vueriq_lib::fileops;

fn tmp_on_c() -> tempfile::TempDir {
    tempfile::Builder::new().prefix("vueriq-fileops-").tempdir().unwrap()
}

/// A temp dir on the project drive (D: here) for the cross-volume move.
fn tmp_on_project_drive() -> tempfile::TempDir {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target").join("fileops-test");
    fs::create_dir_all(&base).unwrap();
    tempfile::Builder::new().prefix("x-").tempdir_in(base).unwrap()
}

#[test]
fn delete_goes_to_recycle_bin_and_restores() {
    let dir = tmp_on_c();
    let name = format!("vueriq-undo-{}.jpg", std::process::id());
    let f = dir.path().join(&name);
    fs::write(&f, b"vueriq recycle test").unwrap();
    assert!(fileops::has_recycle_bin(&f), "temp dir should be on a fixed disk");

    let r = fileops::delete_files(std::slice::from_ref(&f), false);
    assert!(r[0].ok && r[0].recycled, "{:?}", r[0]);
    assert!(!f.exists());

    let r = fileops::restore_files(std::slice::from_ref(&f));
    assert!(r[0].ok, "{:?}", r[0]);
    assert_eq!(fs::read(&f).unwrap(), b"vueriq recycle test");

    // Restoring again: nothing left in the bin for that path.
    fs::remove_file(&f).unwrap();
    let r = fileops::restore_files(std::slice::from_ref(&f));
    assert!(!r[0].ok);
}

#[test]
fn delete_missing_file_reports_error() {
    let dir = tmp_on_c();
    let r = fileops::delete_files(&[dir.path().join("nope.png")], false);
    assert!(!r[0].ok && r[0].error.is_some());
}

#[test]
fn network_paths_need_permanent_confirmation() {
    assert!(!fileops::has_recycle_bin(std::path::Path::new(r"\\server\share\a.jpg")));
}

#[test]
fn move_renames_on_clash_and_moves_back() {
    let src = tmp_on_c();
    let dst = tmp_on_c();
    let a = src.path().join("photo.jpg");
    fs::write(&a, b"A").unwrap();
    fs::write(dst.path().join("photo.jpg"), b"existing").unwrap();

    let r = fileops::move_files(std::slice::from_ref(&a), dst.path());
    assert!(r[0].ok, "{:?}", r[0]);
    let to = PathBuf::from(r[0].to.clone().unwrap());
    assert_eq!(to.file_name().unwrap(), "photo (2).jpg");
    assert_eq!(fs::read(&to).unwrap(), b"A");
    assert_eq!(fs::read(dst.path().join("photo.jpg")).unwrap(), b"existing");
    assert!(!a.exists());

    // Undo
    let r = fileops::move_file(&to, &a);
    assert!(r.ok, "{r:?}");
    assert!(a.exists() && !to.exists());

    // Moving into its own folder is refused.
    let r = fileops::move_files(std::slice::from_ref(&a), src.path());
    assert!(!r[0].ok);
}

#[test]
fn move_across_drives_copies_and_keeps_mtime() {
    let src = tmp_on_c();
    let dst = tmp_on_project_drive();
    let a = src.path().join("clip.mp4");
    fs::write(&a, vec![7u8; 300_000]).unwrap();
    let old = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000);
    fs::File::options().write(true).open(&a).unwrap().set_modified(old).unwrap();

    let r = fileops::move_files(std::slice::from_ref(&a), dst.path());
    assert!(r[0].ok, "{:?}", r[0]);
    let to = PathBuf::from(r[0].to.clone().unwrap());
    assert!(!a.exists());
    assert_eq!(fs::metadata(&to).unwrap().len(), 300_000);
    assert_eq!(fs::metadata(&to).unwrap().modified().unwrap(), old);
}
