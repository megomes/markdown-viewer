mod chipmenu;
mod panels;
mod pointer;
mod tray;

use std::sync::Mutex;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_fs::FsExt;

/// Files the system asked this app to open, waiting for the window to be ready
/// to take them.
///
/// A double click in the file manager can reach the app before the interface
/// has finished loading, so the paths are held here until it comes asking.
#[derive(Default)]
struct Opened(Mutex<Vec<String>>);

/// Hands over the paths waiting to be opened, and empties the queue.
#[tauri::command]
fn take_opened_paths(state: tauri::State<'_, Opened>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut held| std::mem::take(&mut *held))
        .unwrap_or_default()
}

/// Queues paths and tells the interface, which may or may not be listening yet.
fn queue_opened(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Some(state) = app.try_state::<Opened>() {
        if let Ok(mut held) = state.0.lock() {
            held.extend(paths.iter().cloned());
        }
    }
    let _ = app.emit("files-opened", paths);
}

/// The paths in the command line, which is how Windows and Linux pass a file
/// that was double clicked. A flag, or a name that is not a file, is not one.
fn paths_from_arguments() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|argument| !argument.starts_with('-'))
        .filter(|argument| std::path::Path::new(argument).is_file())
        .collect()
}

/// Opens the scope of the filesystem plugin to a folder the person just picked
/// in the system dialog. Nothing outside a folder they chose is reachable.
#[tauri::command]
fn allow_base(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let scope = app.fs_scope();
    scope
        .allow_directory(&path, true)
        .map_err(|error| error.to_string())?;
    // On macOS and Linux the scope's `**` does not reach a name that starts
    // with a dot, and the vault keeps the app's state in `.markdown-viewer`
    // ("forbidden path" on the Mac, never on Windows). Those names are allowed
    // one by one: the app's own folder, whether it exists yet or not, and every
    // dot file or folder already at the top of the vault.
    let base = std::path::Path::new(&path);
    scope
        .allow_directory(base.join(".markdown-viewer"), true)
        .map_err(|error| error.to_string())?;
    if let Ok(entries) = std::fs::read_dir(base) {
        for entry in entries.flatten() {
            if !entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            let item = entry.path();
            let allowed = if item.is_dir() {
                scope.allow_directory(&item, true)
            } else {
                scope.allow_file(&item)
            };
            allowed.map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

const KEYCHAIN_SERVICE: &str = "markdown-viewer";

/// Keeps a secret of the sync (the vault key, the device token) in the system
/// keychain, never in a file.
#[tauri::command]
fn secret_set(name: String, value: String) -> Result<(), String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, &name)
        .and_then(|entry| entry.set_password(&value))
        .map_err(|error| error.to_string())
}

/// The secret, or nothing when it was never kept on this machine.
#[tauri::command]
fn secret_get(name: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &name).map_err(|error| error.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn secret_delete(name: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &name).map_err(|error| error.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

/// The folder that keeps one vault's sync state, inside the app's own data
/// folder and never inside the vault. Created when missing and opened to the
/// filesystem plugin, so the engine can read and write it.
#[tauri::command]
fn sync_state_dir(app: tauri::AppHandle, vault: String) -> Result<String, String> {
    if vault.is_empty() || !vault.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(format!("nome de vault inválido: {vault}"));
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("sync")
        .join(&vault);
    std::fs::create_dir_all(dir.join("base")).map_err(|error| error.to_string())?;
    app.fs_scope()
        .allow_directory(&dir, true)
        .map_err(|error| error.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Sends a path to the system trash. Nothing in this app deletes for good.
#[tauri::command]
fn move_to_trash(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|error| error.to_string())
}

/// Opens the system file manager with the entry selected.
///
/// One file found by `scan_tree`: its path inside the folder, `/`-separated.
#[derive(serde::Serialize)]
struct ScannedFile {
    path: String,
    size: u64,
    /// Milliseconds since 1970, the same number the fs plugin's `stat` gives.
    mtime: u64,
}

/// Every file under `root`, with its size and date, in one call.
///
/// The sync and the link index used to walk the vault from the interface, one
/// call per folder and one per file, in a row: thousands of round trips on
/// every pass of a large vault. Here the walk is native and comes back whole.
/// Links are not followed, so a link to a folder above cannot loop. Folders
/// named in `skip` (`.git`, `node_modules`) are not walked into at all.
#[tauri::command]
async fn scan_tree(root: String, skip: Vec<String>) -> Result<Vec<ScannedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || scan(std::path::Path::new(&root), &skip))
        .await
        .map_err(|e| e.to_string())
}

fn scan(base: &std::path::Path, skip: &[String]) -> Vec<ScannedFile> {
    let mut out = Vec::new();
    let mut pending = vec![base.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else { continue };
            let path = entry.path();
            if kind.is_dir() {
                if !skip.iter().any(|name| entry.file_name().to_string_lossy() == *name) {
                    pending.push(path);
                }
            } else if kind.is_file() {
                let Ok(meta) = entry.metadata() else { continue };
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                let Ok(relative) = path.strip_prefix(base) else { continue };
                let path = relative
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join("/");
                out.push(ScannedFile { path, size: meta.len(), mtime });
            }
        }
    }
    out
}

#[cfg(test)]
mod scan_tests {
    use super::scan;

    #[test]
    fn finds_every_file_with_slash_paths_and_skips_folders() {
        let root = std::env::temp_dir().join(format!("mv-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("Pasta/Sub")).unwrap();
        std::fs::create_dir_all(root.join(".obsidian")).unwrap();
        std::fs::create_dir_all(root.join(".git/objects")).unwrap();
        std::fs::write(root.join("a.md"), "um").unwrap();
        std::fs::write(root.join("Pasta/Sub/b c.md"), "dois!").unwrap();
        std::fs::write(root.join(".obsidian/app.json"), "{}").unwrap();
        std::fs::write(root.join(".git/objects/x"), "x").unwrap();

        let mut found = scan(&root, &[".git".into()]);
        found.sort_by(|a, b| a.path.cmp(&b.path));
        let paths: Vec<_> = found.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, [".obsidian/app.json", "Pasta/Sub/b c.md", "a.md"]);
        assert_eq!(found[1].size, 5);
        let expected = std::fs::metadata(root.join("a.md"))
            .unwrap()
            .modified()
            .unwrap()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        assert_eq!(found[2].mtime, expected);
        let _ = std::fs::remove_dir_all(&root);
    }
}

/// Each system has its own way of saying "show me this one", and none of them
/// is just opening the folder: the point is that the file comes back selected.
#[tauri::command]
fn reveal_in_file_manager(path: String) -> Result<(), String> {
    use std::process::Command;

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg("-R").arg(&path);
        command
    };

    // Explorer only takes backslashes, and reads `/select,` itself, so the
    // argument goes in raw: Rust's own quoting wraps the whole of it, switch
    // included, and a path with a space in it then opens Documents instead.
    #[cfg(target_os = "windows")]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("explorer");
        command.raw_arg(explorer_select(&path));
        command
    };

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = {
        let parent = std::path::Path::new(&path)
            .parent()
            .map(|folder| folder.to_path_buf())
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        let mut command = Command::new("xdg-open");
        command.arg(parent);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Explorer's argument for selecting `path`: `/select,"C:\pasta\nome com espaço.md"`.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn explorer_select(path: &str) -> String {
    format!("/select,\"{}\"", path.replace('/', "\\"))
}

#[cfg(test)]
mod explorer_tests {
    #[test]
    fn backslashes_and_quotes_the_path() {
        assert_eq!(
            super::explorer_select(r"C:\Users\m\vault/Personal Notes/Ideia nova.md"),
            r#"/select,"C:\Users\m\vault\Personal Notes\Ideia nova.md""#
        );
    }
}

/// Hands a file to whatever the system opens that kind of file with.
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    use std::process::Command;

    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let program = "xdg-open";

    Command::new(program)
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Closing the app's own window puts it away instead of ending the app.
///
/// The notes on the edge of the screen are the point: they are supposed to
/// still be there after the editor is out of the way, the same way a sticky
/// note on a monitor does not depend on the drawer being open. The tray is
/// what brings the window back, and the tray is also the only thing that
/// really quits, along with the system's own Quit.
fn hide_instead_of_closing(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(panels::MAIN) else {
        return;
    };
    let hidden = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = hidden.hide();
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // One app at a time. A second one (a double click on a note with the app
    // already open, which on Windows starts the program again) would run a sync
    // of its own on the same vault, and the two sent the same new files twice.
    // It hands its file to the one already open, which comes forward, and ends.
    // The plugin has to be the first one registered.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        let paths = argv
            .iter()
            .skip(1)
            .filter(|argument| !argument.starts_with('-'))
            .filter(|argument| std::path::Path::new(argument).is_file())
            .cloned()
            .collect();
        queue_opened(app, paths);
        let _ = panels::show_main(app.clone());
    }));
    let app = builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(Opened::default())
        .manage(panels::Scale::default())
        .manage(pointer::Watch::default())
        .on_menu_event(|app, event| chipmenu::on_chosen(app, event.id().as_ref()))
        .invoke_handler(tauri::generate_handler![
            allow_base,
            move_to_trash,
            secret_set,
            sync_state_dir,
            secret_get,
            secret_delete,
            reveal_in_file_manager,
            scan_tree,
            open_path,
            take_opened_paths,
            panels::work_area,
            panels::panel_place,
            panels::panel_prepare,
            panels::cursor_at,
            pointer::watch_chips,
            chipmenu::chip_menu,
            panels::panel_hide,
            panels::panel_is_open,
            panels::show_main,
            panels::quit_app
        ])
        .setup(|app| {
            // The main window starts hidden and the interface shows it after its
            // first paint. If that never happens, it shows after three seconds:
            // a window that stays hidden is worse than a white flash.
            if let Some(window) = app.get_webview_window("main") {
                // On Windows and Linux the app draws its own title bar, in its own
                // colours and with the menu in it (TitleBar.tsx). On a Mac the
                // system's transparent bar from tauri.conf.json stays. Windows
                // gets its frameless, transparent, shadowless window from
                // tauri.windows.conf.json, because transparency only takes when
                // the window is created that way (note #12); Linux is set here.
                #[cfg(target_os = "linux")]
                let _ = window.set_decorations(false);
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                    }
                });
            }
            // Always on, also in the installed app: a file in the system's log
            // folder (on Windows %LOCALAPPDATA%\<identifier>\logs), a few
            // megabytes at most, which is what a slowness report is read from.
            // The interface writes into it through `src/platform/logging.ts`.
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .max_file_size(2_000_000)
                    .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(4))
                    .targets([
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                            file_name: Some("markdown-viewer".into()),
                        }),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    ])
                    .build(),
            )?;
            // The updater only exists on the desktop, and the interface is
            // what decides when to look: see `src/app/updates.ts`.
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            tray::install(app.handle())?;
            hide_instead_of_closing(app.handle());
            queue_opened(app.handle(), paths_from_arguments());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|_handle, _event| {
        // macOS does not pass the file on the command line: it sends it to the
        // running app, which is also how a second double click reaches the
        // window that is already open.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { ref urls } = _event {
            let paths = urls
                .iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|path| path.to_string_lossy().into_owned())
                .collect();
            queue_opened(_handle, paths);
        }

        // Clicking the icon in the Dock on a Mac, which is where somebody who
        // put the window away with the red button goes looking for it first.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = _event {
            let _ = panels::show_main(_handle.clone());
        }
    });
}
