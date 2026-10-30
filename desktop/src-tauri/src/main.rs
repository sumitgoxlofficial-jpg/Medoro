// The desktop app is a window onto the pharmacy's own Medoro server. It holds no data of its own:
// the bundled start page asks for the server address, tells the app which server it chose, then
// loads it. Only that server (plus Google sign-in for Drive backups) may load in the window, and
// pages from it get no IPC access.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{MenuBuilder, MenuEvent, MenuItemBuilder, SubmenuBuilder};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_updater::UpdaterExt;

#[cfg(windows)]
const APP_ORIGIN: &str = "http://tauri.localhost";
#[cfg(not(windows))]
const APP_ORIGIN: &str = "tauri://localhost";

#[derive(Default)]
struct Server {
    origin: Mutex<Option<Url>>,
    loads: AtomicU64,
}

fn start_url(flag: &str) -> Url {
    Url::parse(&format!("{APP_ORIGIN}/index.html?{flag}=1")).expect("start page URL")
}

fn is_app(u: &Url) -> bool {
    u.scheme() == "tauri"
        || (matches!(u.scheme(), "http" | "https") && u.host_str() == Some("tauri.localhost"))
}

fn server(app: &AppHandle) -> Option<Url> {
    app.state::<Server>().origin.lock().unwrap().clone()
}

// Same host on any scheme/port, so an http -> https redirect on the server still works.
fn is_server(app: &AppHandle, u: &Url) -> bool {
    matches!(u.scheme(), "http" | "https")
        && server(app).is_some_and(|s| s.host_str().is_some() && s.host_str() == u.host_str())
}

fn is_google_signin(u: &Url) -> bool {
    u.scheme() == "https" && u.host_str() == Some("accounts.google.com")
}

fn open_outside(u: &Url) {
    if matches!(u.scheme(), "http" | "https" | "mailto" | "tel") {
        let _ = tauri_plugin_opener::open_url(u.as_str(), None::<&str>);
    }
}

fn allow_navigation(app: &AppHandle, u: &Url) -> bool {
    if is_app(u) || matches!(u.scheme(), "about" | "blob") || is_server(app, u) || is_google_signin(u) {
        return true;
    }
    if matches!(u.scheme(), "mailto" | "tel") {
        open_outside(u);
    }
    false
}

#[tauri::command]
fn set_server(origin: String, state: State<'_, Server>) -> Result<(), String> {
    let u = Url::parse(&origin).map_err(|_| "That doesn’t look like a web address.".to_string())?;
    if !matches!(u.scheme(), "http" | "https") || u.host_str().is_none() || is_app(&u) {
        return Err("That doesn’t look like a web address.".into());
    }
    let o = Url::parse(&u.origin().ascii_serialization()).map_err(|e| e.to_string())?;
    *state.origin.lock().unwrap() = Some(o);
    Ok(())
}

fn reachable(origin: &Url) -> bool {
    origin
        .socket_addrs(|| None)
        .map(|addrs| addrs.iter().any(|a| TcpStream::connect_timeout(a, Duration::from_secs(4)).is_ok()))
        .unwrap_or(false)
}

// After a page load, if the server can't be reached and the window shows an error page (or the
// service worker's plain-text "offline" answer), go back to the start page. Offline billing stays.
fn watch(window: WebviewWindow) {
    let app = window.app_handle().clone();
    let Some(origin) = server(&app) else { return };
    let n = app.state::<Server>().loads.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        let began = Instant::now();
        if reachable(&origin) {
            return;
        }
        if let Some(rest) = Duration::from_millis(1500).checked_sub(began.elapsed()) {
            std::thread::sleep(rest);
        }
        if app.state::<Server>().loads.load(Ordering::SeqCst) != n {
            return;
        }
        let host = origin.host_str().unwrap_or_default();
        let back = start_url("unreachable");
        let _ = window.eval(format!(
            "(function(){{if(location.href.indexOf({APP_ORIGIN:?})===0||location.hostname==='accounts.google.com')return;\
             if(location.hostname!=={host:?}||(document.contentType==='text/plain'&&location.pathname.indexOf('/offline')!==0))\
             location.replace({back:?});}})();",
            back = back.as_str()
        ));
        if let Ok(u) = window.url() {
            if !is_app(&u) && !is_server(&app, &u) && !is_google_signin(&u) {
                let _ = window.navigate(back);
            }
        }
    });
}

fn dialog(app: &AppHandle, title: &str, text: String, choice: Option<(&str, &str)>, then: impl FnOnce(bool) + Send + 'static) {
    let title = title.to_string();
    let choice = choice.map(|(yes, no)| (yes.to_string(), no.to_string()));
    let _ = app.run_on_main_thread(move || {
        let yes = choice.as_ref().map(|c| c.0.clone());
        let buttons = match choice {
            Some((yes, no)) => rfd::MessageButtons::OkCancelCustom(yes, no),
            None => rfd::MessageButtons::Ok,
        };
        let shown = rfd::AsyncMessageDialog::new()
            .set_level(rfd::MessageLevel::Info)
            .set_title(title)
            .set_description(text)
            .set_buttons(buttons)
            .show();
        std::thread::spawn(move || {
            let r = tauri::async_runtime::block_on(shown);
            // Linux reports custom buttons as Ok/Cancel.
            let ok = match r {
                rfd::MessageDialogResult::Ok | rfd::MessageDialogResult::Yes => true,
                rfd::MessageDialogResult::Custom(s) => Some(s) == yes,
                _ => false,
            };
            then(ok);
        });
    });
}

fn tell(app: &AppHandle, text: String) {
    dialog(app, "Medoro", text, None, |_| {});
}

fn updates_configured(app: &AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .is_some_and(|k| !k.trim().is_empty() && !k.starts_with("REPLACE"))
}

async fn check_updates(app: AppHandle, asked: bool) {
    if !updates_configured(&app) {
        if asked {
            tell(&app, "Automatic updates aren’t set up in this build of Medoro.".into());
        }
        return;
    }
    let found = match app.updater() {
        Ok(u) => u.check().await,
        Err(e) => Err(e),
    };
    match found {
        Ok(Some(update)) => {
            let text = format!(
                "Medoro {} is available (you have {}). Install it now? Medoro will restart.",
                update.version, update.current_version
            );
            let handle = app.clone();
            dialog(&app, "Update available", text, Some(("Install and restart", "Later")), move |ok| {
                if !ok {
                    return;
                }
                tauri::async_runtime::spawn(async move {
                    match update.download_and_install(|_, _| {}, || {}).await {
                        Ok(()) => handle.restart(),
                        Err(e) => tell(&handle, format!("The update couldn’t be installed: {e}")),
                    }
                });
            });
        }
        Ok(None) => {
            if asked {
                tell(&app, format!("You have the latest version of Medoro ({}).", app.package_info().version));
            }
        }
        Err(e) => {
            if asked {
                tell(&app, format!("Couldn’t check for updates: {e}"));
            }
        }
    }
}

fn on_menu(app: &AppHandle, event: MenuEvent) {
    if event.id() == "change-server" {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.navigate(start_url("change"));
        }
    } else if event.id() == "check-updates" {
        tauri::async_runtime::spawn(check_updates(app.clone(), true));
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Server::default())
        .invoke_handler(tauri::generate_handler![set_server])
        .on_menu_event(on_menu)
        .setup(|app| {
            let change = MenuItemBuilder::with_id("change-server", "Change server…")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?;
            let updates = MenuItemBuilder::with_id("check-updates", "Check for updates…").build(app)?;
            let medoro = SubmenuBuilder::new(app, "Medoro")
                .item(&change)
                .item(&updates)
                .separator()
                .quit()
                .build()?;
            #[allow(unused_mut)]
            let mut menu = MenuBuilder::new(app).item(&medoro);
            #[cfg(target_os = "macos")]
            {
                let edit = SubmenuBuilder::new(app, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;
                menu = menu.item(&edit);
            }
            app.set_menu(menu.build()?)?;

            let nav = app.handle().clone();
            let popup = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Medoro")
                .inner_size(1360.0, 860.0)
                .min_inner_size(1024.0, 640.0)
                .center()
                .on_navigation(move |u| allow_navigation(&nav, u))
                .on_new_window(move |u, _| {
                    if u.scheme() == "about" || is_server(&popup, &u) {
                        NewWindowResponse::Allow
                    } else {
                        open_outside(&u);
                        NewWindowResponse::Deny
                    }
                })
                .on_page_load(|w, _| watch(w))
                .build()?;

            tauri::async_runtime::spawn(check_updates(app.handle().clone(), false));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Medoro could not start");
}
