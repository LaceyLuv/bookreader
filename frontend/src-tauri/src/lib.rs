use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri::RunEvent;
use tauri_plugin_shell::ShellExt;

struct BackendState(Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .manage(BackendState(Arc::new(Mutex::new(None))))
    .setup(|app| {
      #[cfg(debug_assertions)]
      {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;

        if let Some(main_window) = app.get_webview_window("main") {
          main_window.open_devtools();
        }
      }

      if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.show();
        let _ = main_window.unminimize();
        let _ = main_window.set_focus();
      }

      #[cfg(debug_assertions)]
      {
        eprintln!("[tauri] debug build: expecting Python backend at 127.0.0.1:8000");
      }

      #[cfg(not(debug_assertions))]
      {
        let app_handle = app.handle();
        let backend_state = app.state::<BackendState>().0.clone();
        match app_handle
          .shell()
          .sidecar("bookreader-backend")
          .and_then(|c| c.args(["--host", "127.0.0.1", "--port", "8000"]).spawn())
        {
          Ok((mut rx, child)) => {
            std::thread::spawn(move || {
              while let Some(event) = rx.blocking_recv() {
                match event {
                  tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                    eprintln!("[sidecar:stdout] {}", String::from_utf8_lossy(&line));
                  }
                  tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                    eprintln!("[sidecar:stderr] {}", String::from_utf8_lossy(&line));
                  }
                  tauri_plugin_shell::process::CommandEvent::Error(line) => {
                    eprintln!("[sidecar:error] {}", line);
                  }
                  _ => {}
                }
              }
            });

            if let Ok(mut slot) = backend_state.lock() {
              *slot = Some(child);
            }
          }
          Err(err) => {
            eprintln!("[tauri] backend sidecar spawn failed ({err}).");
          }
        }
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(move |app, event| {
    if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
      let backend_state = app.state::<BackendState>().0.clone();
      if let Ok(mut slot) = backend_state.lock() {
        if let Some(child) = slot.take() {
          let _ = child.kill();
        }
      };
    }
  });
}
