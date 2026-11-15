use std::path::{Path, PathBuf};

/// Native runtime DLLs that must sit next to VUERIQ.exe:
///  * heif.dll, libde265.dll, dav1d.dll — HEIC/HEIF/AVIF (built by scripts/setup-deps.ps1 via vcpkg)
///  * libmpv-2.dll                    — video engine (downloaded by scripts/setup-deps.ps1)
/// They are copied into `src-tauri/lib/` (bundled by tauri.conf.json) and into the cargo target
/// directory so `tauri dev` and `cargo test` work too.
fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let root = manifest.parent().unwrap().to_path_buf();
    let vcpkg_bin = std::env::var("VCPKG_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| root.join("vendor").join("vcpkg"))
        .join("installed")
        .join("x64-windows")
        .join("bin");
    let mpv = root.join("vendor").join("mpv").join("libmpv-2.dll");

    let lib_dir = manifest.join("lib");
    let _ = std::fs::create_dir_all(&lib_dir);

    // target/<profile>/ (three levels above OUT_DIR/build/<pkg>/out)
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let profile_dir = out_dir.ancestors().nth(3).map(Path::to_path_buf);

    let copy = |src: &Path| {
        if !src.exists() {
            println!("cargo:warning=missing runtime dependency {} — run scripts/setup-deps.ps1", src.display());
            return;
        }
        println!("cargo:rerun-if-changed={}", src.display());
        let name = src.file_name().unwrap();
        for dst_dir in [Some(lib_dir.clone()), profile_dir.clone(), profile_dir.as_ref().map(|p| p.join("deps"))].into_iter().flatten() {
            let dst = dst_dir.join(name);
            let stale = match (std::fs::metadata(src), std::fs::metadata(&dst)) {
                (Ok(a), Ok(b)) => a.len() != b.len() || a.modified().ok() > b.modified().ok(),
                _ => true,
            };
            if stale {
                let _ = std::fs::copy(src, &dst);
            }
        }
    };
    for dll in ["heif.dll", "libde265.dll", "dav1d.dll"] {
        copy(&vcpkg_bin.join(dll));
    }
    copy(&mpv);


    tauri_build::build()
}
