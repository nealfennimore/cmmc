// Keygen.sh licensing for the desktop build. Activation happens online once;
// afterwards every launch verifies the signed machine file offline, so the
// app keeps its offline-first promise. The webview only ever sees the
// LicenseInfo summary — the key, certificate, fingerprint and clock logic all
// stay on the Rust side.

pub mod api;
pub mod config;
pub mod fingerprint;
pub mod sig;
pub mod store;
pub mod verify;

use serde::Serialize;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LicenseInfo {
    /// "disabled" | "unlicensed" | "licensed" | "stale" | "licenseExpired"
    /// | "invalid"
    pub state: String,
    /// For an activated trial license, days until it expires.
    pub trial_days_remaining: Option<i64>,
    /// True when the activated license is a Keygen trial license
    /// (`metadata.trial == true`).
    pub license_is_trial: bool,
    pub key_masked: Option<String>,
    pub machine_file_expiry: Option<String>,
    pub license_expiry: Option<String>,
    pub activated_at: Option<String>,
    /// "online" (key activation) or "offline" (machine-file import); None
    /// for activation records that predate this field.
    pub activation_method: Option<String>,
    /// This device's fingerprint (a salted hash, not sensitive). Shown in the
    /// UI so air-gapped machines can be registered out-of-band; None only
    /// while licensing is disabled.
    pub fingerprint: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LicenseError {
    /// INVALID_KEY | EXPIRED | SUSPENDED | MACHINE_LIMIT | NETWORK
    /// | NOT_ACTIVATED | API_ERROR | SIGNATURE | IO
    /// | WRONG_MACHINE | FILE_STALE | MALFORMED (file imports)
    pub code: String,
    pub message: String,
}

impl LicenseError {
    pub(crate) fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub(crate) fn io(message: impl Into<String>) -> Self {
        Self::new("IO", message)
    }
}

impl From<api::ApiError> for LicenseError {
    fn from(error: api::ApiError) -> Self {
        match error {
            api::ApiError::Network(message) => Self::new("NETWORK", message),
            api::ApiError::Signature(message) => Self::new("SIGNATURE", message),
            api::ApiError::Api { code, message } => {
                let code = match code.as_str() {
                    "MACHINE_LIMIT_EXCEEDED" => "MACHINE_LIMIT".to_string(),
                    other => other.to_string(),
                };
                Self { code, message }
            }
        }
    }
}

impl LicenseInfo {
    fn disabled() -> Self {
        Self {
            state: "disabled".into(),
            trial_days_remaining: None,
            license_is_trial: false,
            key_masked: None,
            machine_file_expiry: None,
            license_expiry: None,
            activated_at: None,
            activation_method: None,
            fingerprint: None,
        }
    }
}

fn mask_key(key: &str) -> String {
    let tail: String = key
        .chars()
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("•••••• {tail}")
}

fn rfc3339(datetime: OffsetDateTime) -> Option<String> {
    datetime.format(&Rfc3339).ok()
}

/// TTL to request for a machine-file checkout. Capped at the license's
/// remaining lifetime — a certificate claiming to outlive its license would
/// be misleading (and Keygen can reject such TTLs), so trial licenses and the
/// final stretch of an annual license get correspondingly shorter files.
/// Floor of one hour, Keygen's minimum.
fn checkout_ttl(license_expiry: Option<OffsetDateTime>, now: OffsetDateTime) -> i64 {
    license_expiry.map_or(config::CHECKOUT_TTL_SECS, |expiry| {
        (expiry - now)
            .whole_seconds()
            .clamp(3600, config::CHECKOUT_TTL_SECS)
    })
}

/// Derive the current LicenseInfo from disk. Fast and fully offline; the
/// frontend calls this on every launch (and the update module gates on it).
pub(crate) fn current_status(app: &tauri::AppHandle) -> Result<LicenseInfo, LicenseError> {
    if !config::enabled() {
        return Ok(LicenseInfo::disabled());
    }

    let dir = store::license_dir(app).map_err(LicenseError::io)?;
    let now = OffsetDateTime::now_utc();
    // Computed even while unlicensed: the activation gate shows it so an
    // air-gapped device can be registered from a connected machine.
    let device = fingerprint::fingerprint(&dir).map_err(LicenseError::io)?;

    // No local trial: without an activated license the app is gated
    // immediately. Evaluations run on Keygen-issued trial license keys, whose
    // expiry is enforced server-side and inside the signed machine file — so
    // deleting local state can't restart a trial.
    let Some(stored) = store::read_license(&dir) else {
        return Ok(LicenseInfo {
            state: "unlicensed".into(),
            fingerprint: Some(device),
            ..LicenseInfo::disabled()
        });
    };

    let base = LicenseInfo {
        key_masked: Some(mask_key(&stored.key)),
        activated_at: Some(stored.activated_at.clone()),
        activation_method: stored.activation_method.clone(),
        fingerprint: Some(device.clone()),
        ..LicenseInfo::disabled()
    };
    let verified = store::read_certificate(&dir)
        .and_then(|cert| verify::parse_and_verify(&cert, config::KEYGEN_VERIFY_KEY_HEX).ok());

    let Some(file) = verified else {
        return Ok(LicenseInfo {
            state: "invalid".into(),
            ..base
        });
    };

    let state = match verify::check(&file, &device, now) {
        verify::CheckResult::Valid => "licensed",
        verify::CheckResult::Stale => "stale",
        verify::CheckResult::LicenseExpired => "licenseExpired",
        verify::CheckResult::WrongMachine => "invalid",
    };

    // For an active trial license, surface a countdown so the UI can nudge
    // toward purchase.
    let trial_days_remaining = file
        .license_expiry
        .filter(|_| file.license_is_trial && state == "licensed")
        .map(|expiry| {
            (((expiry - now).whole_seconds() as f64) / 86_400.0)
                .ceil()
                .max(0.0) as i64
        });

    Ok(LicenseInfo {
        state: state.into(),
        trial_days_remaining,
        license_is_trial: file.license_is_trial,
        machine_file_expiry: rfc3339(file.expiry),
        license_expiry: file.license_expiry.and_then(rfc3339),
        ..base
    })
}

#[tauri::command]
pub fn license_status(app: tauri::AppHandle) -> Result<LicenseInfo, LicenseError> {
    current_status(&app)
}

/// Full license key for click-to-copy in the settings UI — only the masked
/// form travels in LicenseInfo. Returns None while unlicensed/disabled.
#[tauri::command]
pub fn license_key_reveal(app: tauri::AppHandle) -> Result<Option<String>, LicenseError> {
    if !config::enabled() {
        return Ok(None);
    }
    let dir = store::license_dir(&app).map_err(LicenseError::io)?;
    Ok(store::read_license(&dir).map(|stored| stored.key))
}

/// One-time online activation: validate the key, register this machine, and
/// check out the signed machine file that unlocks offline use.
#[tauri::command]
pub async fn license_activate(
    app: tauri::AppHandle,
    key: String,
) -> Result<LicenseInfo, LicenseError> {
    if !config::enabled() {
        return Ok(LicenseInfo::disabled());
    }
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err(LicenseError::new("INVALID_KEY", "no license key entered"));
    }

    let dir = store::license_dir(&app).map_err(LicenseError::io)?;
    let device = fingerprint::fingerprint(&dir).map_err(LicenseError::io)?;

    // Switching keys (e.g. upgrading a trial license to a purchased one):
    // free the seat on the old license first. Best-effort — the old license
    // may already be expired or deleted, which must not block the upgrade.
    if let Some(previous) = store::read_license(&dir) {
        if previous.key != key {
            let _ = api::deactivate_machine(&previous.key, &previous.machine_id).await;
        }
    }

    let validation = api::validate_key(&key, &device).await?;
    match validation.code.as_str() {
        // Not-yet-activated states are the expected starting point.
        "VALID" | "NO_MACHINE" | "NO_MACHINES" | "FINGERPRINT_SCOPE_MISMATCH" => {}
        "NOT_FOUND" => {
            return Err(LicenseError::new("INVALID_KEY", "license key not recognized"))
        }
        "EXPIRED" => return Err(LicenseError::new("EXPIRED", "this license has expired")),
        "SUSPENDED" | "BANNED" => {
            return Err(LicenseError::new("SUSPENDED", "this license is suspended"))
        }
        "TOO_MANY_MACHINES" => {
            return Err(LicenseError::new(
                "MACHINE_LIMIT",
                "this license is active on its maximum number of devices",
            ))
        }
        other => {
            return Err(LicenseError::new(
                "API_ERROR",
                format!("license validation failed ({other})"),
            ))
        }
    }
    let license_id = validation.license_id.ok_or_else(|| {
        LicenseError::new("API_ERROR", "validation response had no license id")
    })?;

    let machine_id = api::activate_machine(&key, &license_id, &device).await?;

    let license_expiry = validation
        .expiry
        .as_deref()
        .and_then(|expiry| OffsetDateTime::parse(expiry, &Rfc3339).ok());
    let ttl = checkout_ttl(license_expiry, OffsetDateTime::now_utc());
    let certificate = api::checkout_machine(&key, &machine_id, ttl).await?;

    // Never trust (or persist) a certificate we can't verify locally — if
    // this fails, something between us and Keygen is broken or hostile.
    let file = verify::parse_and_verify(&certificate, config::KEYGEN_VERIFY_KEY_HEX)
        .map_err(|err| LicenseError::new("API_ERROR", err.to_string()))?;
    if file.fingerprint != device {
        return Err(LicenseError::new(
            "API_ERROR",
            "machine file was issued for a different device",
        ));
    }

    let now = OffsetDateTime::now_utc();
    store::write_certificate(&dir, &certificate).map_err(LicenseError::io)?;
    store::write_license(
        &dir,
        &store::StoredLicense {
            key,
            license_id,
            machine_id,
            activated_at: rfc3339(now).unwrap_or_default(),
            activation_method: Some("online".into()),
        },
    )
    .map_err(LicenseError::io)?;

    current_status(&app)
}

/// Validate an out-of-band machine file for this device and derive the
/// activation record to persist — the same record an online activation
/// writes, so everything downstream (status, refresh, updates) behaves
/// identically afterwards. Pure, so the whole import decision is testable.
fn import_record(
    file: &verify::MachineFile,
    device: &str,
    now: OffsetDateTime,
) -> Result<store::StoredLicense, LicenseError> {
    match verify::check(file, device, now) {
        verify::CheckResult::Valid => {}
        verify::CheckResult::WrongMachine => {
            return Err(LicenseError::new(
                "WRONG_MACHINE",
                "this license file was issued for a different device",
            ))
        }
        verify::CheckResult::Stale => {
            return Err(LicenseError::new(
                "FILE_STALE",
                "this license file has lapsed, or the system clock is far off",
            ))
        }
        verify::CheckResult::LicenseExpired => {
            return Err(LicenseError::new(
                "EXPIRED",
                "the license inside this file has expired",
            ))
        }
    }

    // Refresh, deactivation and update checks all need the key and ids, so
    // a file checked out without `include=license` is not importable.
    let (Some(license_id), Some(key)) =
        (file.license_id.clone(), file.license_key.clone())
    else {
        return Err(LicenseError::new(
            "MALFORMED",
            "this file has no embedded license — check it out again with include=license,license.entitlements",
        ));
    };

    Ok(store::StoredLicense {
        key,
        license_id,
        machine_id: file.machine_id.clone(),
        activated_at: rfc3339(now).unwrap_or_default(),
        activation_method: Some("offline".into()),
    })
}

/// Air-gapped activation: import a machine file that was checked out on a
/// connected machine (see docs/licensing.md). Fully offline — the file's
/// Ed25519 signature and fingerprint binding give the same guarantees as an
/// online checkout. Also the renewal path for devices that stay offline.
#[tauri::command]
pub async fn license_import(app: tauri::AppHandle) -> Result<LicenseInfo, LicenseError> {
    use tauri_plugin_dialog::DialogExt;

    if !config::enabled() {
        return Ok(LicenseInfo::disabled());
    }
    let dir = store::license_dir(&app).map_err(LicenseError::io)?;
    let device = fingerprint::fingerprint(&dir).map_err(LicenseError::io)?;

    // Native picker on the Rust side (like lib.rs's save_file), so the
    // webview never handles the file. async keeps the main thread free to
    // pump the dialog.
    let Some(path) = app
        .dialog()
        .file()
        .add_filter("License file", &["lic"])
        .add_filter("All files", &["*"])
        .blocking_pick_file()
    else {
        // Cancelled — not an error, nothing changed.
        return current_status(&app);
    };
    let path = path.into_path().map_err(|err| LicenseError::io(err.to_string()))?;
    let certificate =
        std::fs::read_to_string(&path).map_err(|err| LicenseError::io(err.to_string()))?;

    let file = verify::parse_and_verify(&certificate, config::KEYGEN_VERIFY_KEY_HEX)
        .map_err(|err| LicenseError::new("MALFORMED", err.to_string()))?;
    let record = import_record(&file, &device, OffsetDateTime::now_utc())?;

    store::write_certificate(&dir, &certificate).map_err(LicenseError::io)?;
    store::write_license(&dir, &record).map_err(LicenseError::io)?;
    current_status(&app)
}

/// Best-effort background refresh: re-checkout the machine file when it is
/// aging (or already stale/broken) and the network allows. Never surfaces
/// network failures — offline is a supported state, not an error.
#[tauri::command]
pub async fn license_refresh(app: tauri::AppHandle) -> Result<LicenseInfo, LicenseError> {
    if !config::enabled() {
        return Ok(LicenseInfo::disabled());
    }
    let dir = store::license_dir(&app).map_err(LicenseError::io)?;
    let Some(stored) = store::read_license(&dir) else {
        return current_status(&app);
    };

    let now = OffsetDateTime::now_utc();
    let device = fingerprint::fingerprint(&dir).map_err(LicenseError::io)?;
    let current = store::read_certificate(&dir)
        .and_then(|cert| verify::parse_and_verify(&cert, config::KEYGEN_VERIFY_KEY_HEX).ok());
    let fresh_enough = current.as_ref().is_some_and(|file| {
        verify::check(file, &device, now) == verify::CheckResult::Valid
            && now - file.issued < time::Duration::days(config::REFRESH_AFTER_DAYS)
    });

    if !fresh_enough {
        // The stored certificate's license expiry may be outdated (e.g. the
        // license was just renewed) — the resulting short TTL self-corrects on
        // the next refresh, once the fresh certificate carries the new expiry.
        let ttl = checkout_ttl(current.and_then(|file| file.license_expiry), now);
        if let Ok(certificate) =
            api::checkout_machine(&stored.key, &stored.machine_id, ttl).await
        {
            let verifies = verify::parse_and_verify(&certificate, config::KEYGEN_VERIFY_KEY_HEX)
                .is_ok_and(|file| file.fingerprint == device);
            if verifies {
                store::write_certificate(&dir, &certificate).map_err(LicenseError::io)?;
            }
        }
    }

    current_status(&app)
}

/// Free this device's seat on the license and drop back to the unlicensed
/// state. Requires the network — deactivating only locally would leak the seat.
#[tauri::command]
pub async fn license_deactivate(app: tauri::AppHandle) -> Result<LicenseInfo, LicenseError> {
    if !config::enabled() {
        return Ok(LicenseInfo::disabled());
    }
    let dir = store::license_dir(&app).map_err(LicenseError::io)?;
    let Some(stored) = store::read_license(&dir) else {
        return current_status(&app);
    };

    api::deactivate_machine(&stored.key, &stored.machine_id).await?;
    store::delete_license(&dir);
    current_status(&app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::datetime;

    const NOW: OffsetDateTime = datetime!(2026-07-01 00:00 UTC);

    #[test]
    fn checkout_ttl_defaults_without_a_license_expiry() {
        assert_eq!(checkout_ttl(None, NOW), config::CHECKOUT_TTL_SECS);
    }

    #[test]
    fn checkout_ttl_is_capped_at_the_license_expiry() {
        // Short trial license: the certificate must not outlive it, and the
        // cap is below the default TTL so this is a genuine cap.
        let expiry = datetime!(2026-07-15 00:00 UTC);
        assert_eq!(checkout_ttl(Some(expiry), NOW), 14 * 24 * 60 * 60);
    }

    #[test]
    fn checkout_ttl_ignores_a_distant_license_expiry() {
        // Annual license with most of the year left: default TTL wins.
        let expiry = datetime!(2027-06-01 00:00 UTC);
        assert_eq!(checkout_ttl(Some(expiry), NOW), config::CHECKOUT_TTL_SECS);
    }

    #[test]
    fn checkout_ttl_floors_at_keygen_minimum() {
        // Already-expired license (e.g. stored cert predates a renewal):
        // request the 1-hour minimum rather than a negative TTL.
        let expiry = datetime!(2026-06-01 00:00 UTC);
        assert_eq!(checkout_ttl(Some(expiry), NOW), 3600);
    }

    const DEVICE: &str = "device-fp";

    fn importable_file() -> verify::MachineFile {
        verify::MachineFile {
            fingerprint: DEVICE.into(),
            issued: datetime!(2026-06-30 00:00 UTC),
            expiry: datetime!(2027-06-30 00:00 UTC),
            license_expiry: None,
            license_is_trial: false,
            machine_id: "machine-1".into(),
            license_id: Some("license-1".into()),
            license_key: Some("KEY-1".into()),
        }
    }

    #[test]
    fn import_reconstructs_the_activation_record() {
        let record = import_record(&importable_file(), DEVICE, NOW).unwrap();
        assert_eq!(record.key, "KEY-1");
        assert_eq!(record.license_id, "license-1");
        assert_eq!(record.machine_id, "machine-1");
        assert!(!record.activated_at.is_empty());
    }

    #[test]
    fn import_rejects_a_file_for_another_device() {
        let error = import_record(&importable_file(), "other-device", NOW).unwrap_err();
        assert_eq!(error.code, "WRONG_MACHINE");
    }

    #[test]
    fn import_rejects_a_lapsed_file() {
        let mut file = importable_file();
        file.expiry = datetime!(2026-06-30 12:00 UTC);
        assert_eq!(import_record(&file, DEVICE, NOW).unwrap_err().code, "FILE_STALE");
    }

    #[test]
    fn import_rejects_an_expired_license() {
        let mut file = importable_file();
        file.license_expiry = Some(datetime!(2026-06-30 12:00 UTC));
        assert_eq!(import_record(&file, DEVICE, NOW).unwrap_err().code, "EXPIRED");
    }

    #[test]
    fn import_requires_the_embedded_license() {
        // Checked out without include=license: no key to store, so refresh /
        // deactivate / updates would all be broken — refuse the import.
        let mut file = importable_file();
        file.license_key = None;
        assert_eq!(import_record(&file, DEVICE, NOW).unwrap_err().code, "MALFORMED");
    }
}
