use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Activation record persisted after a successful activation. The signed
/// machine file (`machine.lic`) is what actually grants access; the key and
/// ids here exist to talk to the Keygen API again (refresh, deactivate).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StoredLicense {
    pub key: String,
    pub license_id: String,
    pub machine_id: String,
    pub activated_at: String,
}

const LICENSE_FILE: &str = "license.json";
const CERTIFICATE_FILE: &str = "machine.lic";

/// Directory holding all licensing state, e.g.
/// `~/.local/share/consulting.getcmmc.app/license/`.
pub fn license_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("license");
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir)
}

pub fn read_license(dir: &Path) -> Option<StoredLicense> {
    let raw = fs::read_to_string(dir.join(LICENSE_FILE)).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn write_license(dir: &Path, license: &StoredLicense) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(license).map_err(|err| err.to_string())?;
    fs::write(dir.join(LICENSE_FILE), raw).map_err(|err| err.to_string())
}

pub fn read_certificate(dir: &Path) -> Option<String> {
    fs::read_to_string(dir.join(CERTIFICATE_FILE)).ok()
}

pub fn write_certificate(dir: &Path, certificate: &str) -> Result<(), String> {
    fs::write(dir.join(CERTIFICATE_FILE), certificate).map_err(|err| err.to_string())
}

/// Remove the activation record and certificate (deactivation).
pub fn delete_license(dir: &Path) {
    let _ = fs::remove_file(dir.join(LICENSE_FILE));
    let _ = fs::remove_file(dir.join(CERTIFICATE_FILE));
}
