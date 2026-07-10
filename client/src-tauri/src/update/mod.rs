// Auto-updates via Keygen's Tauri distribution engine. macOS and Windows
// install updates in-place through tauri-plugin-updater; Linux ships
// .deb/.rpm (no AppImage), so it only notifies and links to the download
// page. Checks authenticate with the stored license key, which means lapsed
// licenses stop receiving updates — and the webview never sees the key or
// the updater API, only these commands.

use crate::license::{config, store, LicenseError};
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    /// The newer version, when one is available.
    pub version: Option<String>,
    /// Release notes (the Keygen release's description).
    pub notes: Option<String>,
    /// False on Linux — the UI offers a download link instead of installing.
    pub platform_supports_install: bool,
    pub download_url: Option<String>,
}

const SUPPORTS_INSTALL: bool = cfg!(any(target_os = "macos", target_os = "windows"));

fn no_update(current_version: String) -> UpdateInfo {
    UpdateInfo {
        available: false,
        current_version,
        version: None,
        notes: None,
        platform_supports_install: SUPPORTS_INSTALL,
        download_url: None,
    }
}

fn check_failed(err: impl std::fmt::Display) -> LicenseError {
    LicenseError::new("UPDATE_CHECK_FAILED", err.to_string())
}

/// The update found by the last check, held Rust-side so install doesn't have
/// to re-check (and the webview never handles updater internals).
#[cfg(any(target_os = "macos", target_os = "windows"))]
#[derive(Default)]
pub struct PendingUpdate(pub std::sync::Mutex<Option<tauri_plugin_updater::Update>>);

/// Ask the Keygen engine whether a newer version exists for this platform.
/// Requires an active license; the frontend keeps launch-time checks silent.
#[tauri::command]
pub async fn update_check(app: tauri::AppHandle) -> Result<UpdateInfo, LicenseError> {
    let current_version = app.package_info().version.to_string();
    if !config::updates_enabled() {
        return Ok(no_update(current_version));
    }

    let dir = store::license_dir(&app).map_err(LicenseError::io)?;
    let stored = store::read_license(&dir);
    let status = crate::license::current_status(&app)?;
    // `stale` is allowed through: the machine file has merely lapsed offline,
    // and the engine re-validates the license server-side anyway.
    let licensed = matches!(status.state.as_str(), "licensed" | "stale");
    let Some(stored) = stored.filter(|_| licensed) else {
        return Err(LicenseError::new(
            "NOT_LICENSED",
            "updates require an active license",
        ));
    };

    check_for_platform(&app, &stored.key, current_version).await
}

// macOS/Windows: delegate to tauri-plugin-updater against the engine
// endpoint. The {{target}}/{{arch}}/{{current_version}} placeholders are
// substituted by the plugin at request time.
#[cfg(any(target_os = "macos", target_os = "windows"))]
async fn check_for_platform(
    app: &tauri::AppHandle,
    key: &str,
    current_version: String,
) -> Result<UpdateInfo, LicenseError> {
    use tauri_plugin_updater::UpdaterExt;

    let url = format!(
        "{}/v1/accounts/{}/engines/tauri/{}?platform={{{{target}}}}&arch={{{{arch}}}}&version={{{{current_version}}}}",
        config::KEYGEN_API_URL,
        config::KEYGEN_ACCOUNT_ID,
        config::KEYGEN_PACKAGE
    );
    let url: tauri::Url = url.parse().map_err(check_failed)?;

    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(check_failed)?
        // Also sent on the download request, which the LICENSED distribution
        // strategy requires.
        .header("Authorization", format!("License {key}"))
        .map_err(check_failed)?
        .build()
        .map_err(check_failed)?;

    match updater.check().await.map_err(check_failed)? {
        Some(update) => {
            let info = UpdateInfo {
                available: true,
                current_version,
                version: Some(update.version.clone()),
                notes: update.body.clone(),
                platform_supports_install: true,
                download_url: None,
            };
            *app.state::<PendingUpdate>().0.lock().unwrap() = Some(update);
            Ok(info)
        }
        None => Ok(no_update(current_version)),
    }
}

// Linux: query the engine directly (same request style as license/api.rs) and
// report availability only; installation goes through the download page.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
async fn check_for_platform(
    _app: &tauri::AppHandle,
    key: &str,
    current_version: String,
) -> Result<UpdateInfo, LicenseError> {
    let url = format!(
        "{}/v1/accounts/{}/engines/tauri/{}?platform=linux&arch={}&version={}",
        config::KEYGEN_API_URL,
        config::KEYGEN_ACCOUNT_ID,
        config::KEYGEN_PACKAGE,
        std::env::consts::ARCH,
        current_version
    );

    let response = reqwest::Client::new()
        .get(&url)
        .header("Accept", "application/json")
        .header("Authorization", format!("License {key}"))
        .send()
        .await
        .map_err(check_failed)?;

    if response.status() == reqwest::StatusCode::NO_CONTENT {
        return Ok(no_update(current_version));
    }
    if !response.status().is_success() {
        return Err(check_failed(format!(
            "update check returned {}",
            response.status()
        )));
    }

    let text = response.text().await.map_err(check_failed)?;
    let body: serde_json::Value = serde_json::from_str(&text).map_err(check_failed)?;
    Ok(UpdateInfo {
        available: true,
        current_version,
        version: body["version"].as_str().map(str::to_string),
        notes: body["notes"].as_str().map(str::to_string),
        platform_supports_install: false,
        download_url: Some(config::UPDATE_DOWNLOAD_URL.to_string()),
    })
}

/// Download and apply the update found by the last check. The UI prompts
/// before calling this and again before `update_restart` — note that on
/// Windows the passive NSIS installer exits and relaunches the app itself, so
/// this may never resolve there.
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle) -> Result<(), LicenseError> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let pending = app.state::<PendingUpdate>().0.lock().unwrap().take();
        let Some(update) = pending else {
            return Err(LicenseError::new(
                "NO_UPDATE",
                "no update pending — check for updates first",
            ));
        };
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|err| LicenseError::new("UPDATE_INSTALL_FAILED", err.to_string()))?;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        Err(LicenseError::new(
            "UNSUPPORTED",
            "self-update is not supported on this platform",
        ))
    }
}

#[tauri::command]
pub fn update_restart(app: tauri::AppHandle) {
    app.restart();
}
