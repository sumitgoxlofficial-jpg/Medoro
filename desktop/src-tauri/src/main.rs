// The desktop app is a window onto the pharmacy's own Medoro server. It holds no data of its own:
// the start page asks for the server address, then loads it. Offline billing comes from the
// server's service worker, exactly as in a browser.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Medoro could not start");
}
