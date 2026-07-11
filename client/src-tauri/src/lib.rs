use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

mod license;
mod update;

// Open a URL in the user's default browser. Invoked from the frontend; runs
// Rust-side so it isn't subject to the opener plugin's JS capability scope.
#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|err| err.to_string())
}

// Write an evidence artifact to a temp file and open it in the OS default
// application. The webview can't open the blob URLs the web build uses, so the
// desktop app round-trips the bytes through disk instead.
#[tauri::command]
fn open_evidence(app: tauri::AppHandle, filename: String, data: Vec<u8>) -> Result<(), String> {
    let safe_name = std::path::Path::new(&filename)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "evidence".to_string());

    let mut path = std::env::temp_dir();
    path.push("cmmc-evidence");
    std::fs::create_dir_all(&path).map_err(|err| err.to_string())?;
    path.push(safe_name);
    std::fs::write(&path, &data).map_err(|err| err.to_string())?;

    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|err| err.to_string())
}

// Prompt for a destination and write a single exported file (report, POA&M,
// database, evidence map, …). Returns false if the user cancels the dialog.
// async so it runs off the main thread — the blocking dialog calls need the
// main thread free to pump the native dialog.
#[tauri::command]
async fn save_file(
    app: tauri::AppHandle,
    filename: String,
    data: Vec<u8>,
) -> Result<bool, String> {
    match app.dialog().file().set_file_name(&filename).blocking_save_file() {
        Some(path) => {
            let path = path.into_path().map_err(|err| err.to_string())?;
            std::fs::write(&path, &data).map_err(|err| err.to_string())?;
            Ok(true)
        }
        None => Ok(false),
    }
}

#[derive(serde::Deserialize)]
struct OutgoingFile {
    filename: String,
    data: Vec<u8>,
}

// Prompt for a folder and write several files into it (bulk evidence export),
// so the user picks a destination once instead of per file.
#[tauri::command]
async fn save_files(
    app: tauri::AppHandle,
    files: Vec<OutgoingFile>,
) -> Result<bool, String> {
    match app.dialog().file().blocking_pick_folder() {
        Some(folder) => {
            let dir = folder.into_path().map_err(|err| err.to_string())?;
            for file in files {
                let name = std::path::Path::new(&file.filename)
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| "evidence".to_string());
                std::fs::write(dir.join(name), &file.data).map_err(|err| err.to_string())?;
            }
            Ok(true)
        }
        None => Ok(false),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    // Self-update only where the updater supports in-place installs; Linux
    // (.deb/.rpm, no AppImage) is notify-only and never loads the plugin.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update::PendingUpdate::default());

    builder
        .invoke_handler(tauri::generate_handler![
            open_external,
            open_evidence,
            save_file,
            save_files,
            license::license_status,
            license::license_activate,
            license::license_import,
            license::license_refresh,
            license::license_deactivate,
            update::update_check,
            update::update_install,
            update::update_restart
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
