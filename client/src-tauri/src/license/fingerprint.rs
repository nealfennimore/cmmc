use sha2::{Digest, Sha256};
use std::path::Path;

// Hashing the OS machine id with the app identifier means we never send the
// raw GUID off-device, and the fingerprint can't be correlated with other
// vendors' Keygen fingerprints for the same machine.
const SALT: &str = "consulting.getcmmc.app";

/// Stable per-device fingerprint sent to Keygen during activation and checked
/// against the machine file on every launch.
pub fn fingerprint(license_dir: &Path) -> Result<String, String> {
    #[cfg(debug_assertions)]
    if let Ok(value) = std::env::var("CMMC_FINGERPRINT_OVERRIDE") {
        if !value.is_empty() {
            return Ok(value);
        }
    }

    let uid = machine_uid::get()
        .map(|uid| uid.trim().to_string())
        .ok()
        .filter(|uid| !uid.is_empty())
        .map_or_else(|| fallback_device_id(license_dir), Ok)?;

    Ok(hex::encode(Sha256::digest(format!("{uid}:{SALT}"))))
}

// Some environments (containers, stripped-down Linux installs) have no
// /etc/machine-id. Mint a random-ish id once and reuse it from disk so the
// fingerprint stays stable across launches.
fn fallback_device_id(license_dir: &Path) -> Result<String, String> {
    let path = license_dir.join("device_id");
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let existing = existing.trim().to_string();
        if !existing.is_empty() {
            return Ok(existing);
        }
    }

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_nanos();
    let seed = format!("{nanos}:{}:{SALT}", std::process::id());
    let id = hex::encode(Sha256::digest(seed));
    std::fs::write(&path, &id).map_err(|err| err.to_string())?;
    Ok(id)
}
