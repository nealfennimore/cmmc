use base64::Engine as _;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

mod license;
mod update;

// File bytes cross the IPC bridge base64-encoded: serde parses one string
// instead of a JSON number per byte, which stalled on 100MB+ exports.
fn decode_base64(data: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|err| err.to_string())
}

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
fn open_evidence(app: tauri::AppHandle, filename: String, data_b64: String) -> Result<(), String> {
    let data = decode_base64(&data_b64)?;
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
    data_b64: String,
) -> Result<bool, String> {
    let data = decode_base64(&data_b64)?;
    match app.dialog().file().set_file_name(&filename).blocking_save_file() {
        Some(path) => {
            let path = path.into_path().map_err(|err| err.to_string())?;
            std::fs::write(&path, &data).map_err(|err| err.to_string())?;
            Ok(true)
        }
        None => Ok(false),
    }
}

// Prompt for a JSON file and return its contents (database import). The
// webview's <input type=file> is unreliable in the desktop shell — WebView2
// derives its dialog filter from the accept MIME type via the registry, and
// when .json has no mapping there the dialog hides *.json entirely — so
// import uses the native dialog like the save paths do. Returns None when
// the user cancels.
#[tauri::command]
async fn open_json_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    match app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file()
    {
        Some(path) => {
            let path = path.into_path().map_err(|err| err.to_string())?;
            let text = std::fs::read_to_string(&path).map_err(|err| err.to_string())?;
            Ok(Some(text))
        }
        None => Ok(None),
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutgoingFile {
    filename: String,
    data_b64: String,
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
                let data = decode_base64(&file.data_b64)?;
                std::fs::write(dir.join(name), &data).map_err(|err| err.to_string())?;
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
            open_json_file,
            save_file,
            save_files,
            license::license_status,
            license::license_key_reveal,
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
