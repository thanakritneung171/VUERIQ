//! Per-user file association registration ("Open with VUERIQ" + Default Apps capabilities).
//!
//! The NSIS installer registers associations itself (tauri.conf.json → bundle.fileAssociations).
//! This module covers the portable build and lets users (un)register from Settings without admin
//! rights. Windows 10/11 never allow an app to silently become the default handler; we register
//! capabilities and then open Settings → Default apps so the user can choose VUERIQ.

use crate::error::{AppError, AppResult};
use crate::formats::{HEIF_EXTS, JXL_EXTS, RAW_EXTS, STANDARD_EXTS, SVG_EXTS, VIDEO_EXTS};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssociationStatus {
    pub registered: bool,
    pub exe_path: String,
    pub portable: bool,
}

/// Registry prefix under HKCU. Production uses "Software"; tests use a sandbox key.
pub const PROD_PREFIX: &str = "Software";
pub const PROGID_IMAGE: &str = "VUERIQ.Image";
pub const PROGID_VIDEO: &str = "VUERIQ.Video";

pub fn all_exts() -> impl Iterator<Item = (&'static str, bool)> {
    STANDARD_EXTS
        .iter()
        .chain(HEIF_EXTS)
        .chain(JXL_EXTS)
        .chain(SVG_EXTS)
        .chain(RAW_EXTS)
        .map(|e| (*e, false))
        .chain(VIDEO_EXTS.iter().map(|e| (*e, true)))
}

pub fn exe_path() -> String {
    std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
}

pub fn is_portable() -> bool {
    // Installed builds have an NSIS uninstaller next to the executable.
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| !d.join("uninstall.exe").exists()))
        .unwrap_or(true)
}

#[cfg(windows)]
mod imp {
    use super::*;
    use winreg::enums::*;
    use winreg::RegKey;

    fn notify_shell() {
        use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED as i32, SHCNF_IDLIST, std::ptr::null(), std::ptr::null()) };
    }

    fn e(err: std::io::Error) -> AppError {
        AppError::other("Could not update the Windows registry.").with_detail(err)
    }

    pub fn status() -> AssociationStatus {
        status_at(PROD_PREFIX, &exe_path())
    }

    fn registered_in(root: &RegKey, prefix: &str, exe: &str) -> bool {
        root.open_subkey(format!(r"{prefix}\RegisteredApplications"))
            .and_then(|k| k.get_value::<String, _>("VUERIQ"))
            .is_ok()
            && root
                .open_subkey(format!(r"{prefix}\Classes\{PROGID_IMAGE}\shell\open\command"))
                .and_then(|k| k.get_value::<String, _>(""))
                .map(|v| v.to_lowercase().contains(&exe.to_lowercase()))
                .unwrap_or(false)
    }

    pub fn status_at(prefix: &str, exe: &str) -> AssociationStatus {
        let registered = registered_in(&RegKey::predef(HKEY_CURRENT_USER), prefix, exe)
            || (prefix == PROD_PREFIX && registered_in(&RegKey::predef(HKEY_LOCAL_MACHINE), prefix, exe));
        AssociationStatus { registered, exe_path: exe.to_string(), portable: is_portable() }
    }

    pub fn register() -> AppResult<()> {
        register_at(PROD_PREFIX, &exe_path())?;
        notify_shell();
        Ok(())
    }

    /// Installer entry point: an all-users install (exe under Program Files, run elevated) registers
    /// in HKLM so every account gets "Open with VUERIQ"; otherwise HKCU.
    pub fn register_for_install() -> AppResult<()> {
        let exe = exe_path();
        let pf = std::env::var("ProgramFiles").unwrap_or_default().to_lowercase();
        if !pf.is_empty() && exe.to_lowercase().starts_with(&pf) && register_in(&RegKey::predef(HKEY_LOCAL_MACHINE), PROD_PREFIX, &exe).is_ok() {
            notify_shell();
            return Ok(());
        }
        register()
    }

    pub fn register_at(prefix: &str, exe: &str) -> AppResult<()> {
        register_in(&RegKey::predef(HKEY_CURRENT_USER), prefix, exe)
    }

    fn register_in(hkcu: &RegKey, prefix: &str, exe: &str) -> AppResult<()> {
        let caps_key = format!(r"{prefix}\VUERIQ\Capabilities");
        let classes = hkcu.create_subkey(format!(r"{prefix}\Classes")).map_err(e)?.0;
        let cmd = format!("\"{exe}\" \"%1\"");
        let icon = format!("\"{exe}\",0");

        for (progid, desc) in [(PROGID_IMAGE, "VUERIQ Image"), (PROGID_VIDEO, "VUERIQ Video")] {
            let (k, _) = classes.create_subkey(progid).map_err(e)?;
            k.set_value("", &desc).map_err(e)?;
            k.set_value("FriendlyTypeName", &desc).map_err(e)?;
            k.create_subkey("DefaultIcon").map_err(e)?.0.set_value("", &icon).map_err(e)?;
            k.create_subkey(r"shell\open").map_err(e)?.0.set_value("FriendlyAppName", &"VUERIQ").map_err(e)?;
            k.create_subkey(r"shell\open\command").map_err(e)?.0.set_value("", &cmd).map_err(e)?;
        }

        // Application registration (for "Open with")
        let (app, _) = classes.create_subkey(r"Applications\VUERIQ.exe").map_err(e)?;
        app.set_value("FriendlyAppName", &"VUERIQ").map_err(e)?;
        app.create_subkey(r"shell\open\command").map_err(e)?.0.set_value("", &cmd).map_err(e)?;
        let (supported, _) = app.create_subkey("SupportedTypes").map_err(e)?;

        // Capabilities (for Settings → Default apps)
        let (root, _) = hkcu.create_subkey(format!(r"{prefix}\VUERIQ")).map_err(e)?;
        root.set_value("InstallPath", &exe).map_err(e)?;
        let (caps, _) = hkcu.create_subkey(&caps_key).map_err(e)?;
        caps.set_value("ApplicationName", &"VUERIQ").map_err(e)?;
        caps.set_value("ApplicationDescription", &"VUERIQ — Premium universal image & video viewer. See Every Detail.").map_err(e)?;
        caps.set_value("ApplicationIcon", &icon).map_err(e)?;
        let (fa, _) = caps.create_subkey("FileAssociations").map_err(e)?;

        for (ext, video) in all_exts() {
            let dot = format!(".{ext}");
            let progid = if video { PROGID_VIDEO } else { PROGID_IMAGE };
            fa.set_value(&dot, &progid).map_err(e)?;
            supported.set_value(&dot, &"").map_err(e)?;
            let (k, _) = classes.create_subkey(format!(r"{dot}\OpenWithProgids")).map_err(e)?;
            k.set_value(progid, &"").map_err(e)?;
        }
        hkcu.create_subkey(format!(r"{prefix}\RegisteredApplications"))
            .map_err(e)?
            .0
            .set_value("VUERIQ", &caps_key)
            .map_err(e)?;
        Ok(())
    }

    pub fn unregister() -> AppResult<()> {
        unregister_at(PROD_PREFIX)?;
        notify_shell();
        Ok(())
    }

    /// Uninstaller entry point: remove the per-user and (when permitted) the all-users entries.
    pub fn unregister_for_install() {
        let _ = unregister_in(&RegKey::predef(HKEY_CURRENT_USER), PROD_PREFIX);
        let _ = unregister_in(&RegKey::predef(HKEY_LOCAL_MACHINE), PROD_PREFIX);
        notify_shell();
    }

    pub fn unregister_at(prefix: &str) -> AppResult<()> {
        unregister_in(&RegKey::predef(HKEY_CURRENT_USER), prefix)
    }

    fn unregister_in(hkcu: &RegKey, prefix: &str) -> AppResult<()> {
        if let Ok(classes) = hkcu.open_subkey_with_flags(format!(r"{prefix}\Classes"), KEY_ALL_ACCESS) {
            let _ = classes.delete_subkey_all(PROGID_IMAGE);
            let _ = classes.delete_subkey_all(PROGID_VIDEO);
            let _ = classes.delete_subkey_all(r"Applications\VUERIQ.exe");
            for (ext, video) in all_exts() {
                if let Ok(k) = classes.open_subkey_with_flags(format!(r".{ext}\OpenWithProgids"), KEY_ALL_ACCESS) {
                    let _ = k.delete_value(if video { PROGID_VIDEO } else { PROGID_IMAGE });
                }
            }
        }
        if let Ok(k) = hkcu.open_subkey_with_flags(format!(r"{prefix}\RegisteredApplications"), KEY_ALL_ACCESS) {
            let _ = k.delete_value("VUERIQ");
        }
        let _ = hkcu.delete_subkey_all(format!(r"{prefix}\VUERIQ"));
        Ok(())
    }
}

#[cfg(windows)]
pub use imp::{register, register_at, register_for_install, status, status_at, unregister, unregister_at, unregister_for_install};

#[cfg(not(windows))]
pub fn status() -> AssociationStatus {
    AssociationStatus { registered: false, exe_path: exe_path(), portable: true }
}
#[cfg(not(windows))]
pub fn register() -> AppResult<()> {
    Err(AppError::other("File associations are only supported on Windows."))
}
#[cfg(not(windows))]
pub fn unregister() -> AppResult<()> {
    Ok(())
}
#[cfg(not(windows))]
pub fn register_for_install() -> AppResult<()> {
    register()
}
#[cfg(not(windows))]
pub fn unregister_for_install() {}
