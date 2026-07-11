use rand::{rngs::OsRng, RngCore};
use serde::Serialize;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;
use tauri::RunEvent;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;

#[allow(dead_code)]
const BACKEND_HOST: &str = "127.0.0.1";
#[allow(dead_code)]
#[allow(dead_code)]
const BACKEND_HEALTH_ATTEMPTS: usize = 50;
#[allow(dead_code)]
const BACKEND_HEALTH_INTERVAL: Duration = Duration::from_millis(200);
#[allow(dead_code)]
const BACKEND_HEALTH_TIMEOUT: Duration = Duration::from_millis(500);

#[derive(Clone, Debug, Serialize)]
struct BackendStatus {
    state: String,
    message: Option<String>,
    pid: Option<u32>,
    owned: bool,
}

impl BackendStatus {
    #[allow(dead_code)]
    fn starting(pid: Option<u32>) -> Self {
        Self {
            state: "starting".to_string(),
            message: Some("Backend sidecar is starting.".to_string()),
            pid,
            owned: true,
        }
    }

    #[allow(dead_code)]
    fn ready(pid: Option<u32>, owned: bool) -> Self {
        Self {
            state: "ready".to_string(),
            message: None,
            pid,
            owned,
        }
    }

    fn failed(message: impl Into<String>) -> Self {
        Self {
            state: "failed".to_string(),
            message: Some(message.into()),
            pid: None,
            owned: false,
        }
    }

    fn stopped() -> Self {
        Self {
            state: "stopped".to_string(),
            message: Some("Backend sidecar was stopped.".to_string()),
            pid: None,
            owned: false,
        }
    }
}

struct BackendRuntime {
    child: Option<tauri_plugin_shell::process::CommandChild>,
    status: BackendStatus,
    api_base: String,
    nonce: Option<String>,
    asset_token: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendConnection {
    api_base: String,
    nonce: Option<String>,
    asset_token: Option<String>,
}

struct BackendState(Arc<Mutex<BackendRuntime>>);

fn stop_backend(child: tauri_plugin_shell::process::CommandChild) {
    #[cfg(windows)]
    {
        let pid = child.pid().to_string();
        // Windows sidecars can leave worker descendants; taskkill /T cleans the tree.
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .status();
    }

    // macOS/Linux CommandChild::kill terminates the direct child. PyInstaller onefile
    // should keep backend workers in that process, so there is no extra tree walk here.
    let _ = child.kill();
}

fn cleanup_backend_runtime(runtime: &mut BackendRuntime) {
    if let Some(child) = runtime.child.take() {
        stop_backend(child);
    }
    runtime.status = BackendStatus::stopped();
}

fn set_backend_status(backend_state: &Arc<Mutex<BackendRuntime>>, status: BackendStatus) {
    if let Ok(mut runtime) = backend_state.lock() {
        runtime.status = status;
    }
}

#[allow(dead_code)]
fn probe_backend_health(
    host: &str,
    port: u16,
    nonce: Option<&str>,
    timeout: Duration,
) -> Result<(), String> {
    let address = format!("{host}:{port}")
        .to_socket_addrs()
        .map_err(|err| format!("failed to resolve backend address: {err}"))?
        .next()
        .ok_or_else(|| "failed to resolve backend address".to_string())?;

    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|err| format!("backend health connection failed: {err}"))?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let auth_header = nonce
        .map(|value| format!("X-BookReader-Nonce: {value}\r\n"))
        .unwrap_or_default();
    let request = format!(
        "GET /api/health HTTP/1.1\r\nHost: {host}:{port}\r\n{auth_header}Connection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|err| format!("backend health request failed: {err}"))?;

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|err| format!("backend health response failed: {err}"))?;

    if response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200") {
        let compact = response.replace(char::is_whitespace, "");
        let authenticated = nonce.is_none() || compact.contains("\"authenticated\":true");
        if compact.contains("\"ok\":true") && authenticated {
            return Ok(());
        }
    }

    Err("backend health check did not return { ok: true }".to_string())
}

#[allow(dead_code)]
fn wait_for_backend_health(
    host: &str,
    port: u16,
    nonce: Option<&str>,
    attempts: usize,
    interval: Duration,
) -> Result<(), String> {
    let mut last_error = "backend health check did not run".to_string();
    for attempt in 1..=attempts {
        match probe_backend_health(host, port, nonce, BACKEND_HEALTH_TIMEOUT) {
            Ok(()) => return Ok(()),
            Err(err) => last_error = err,
        }

        if attempt < attempts {
            std::thread::sleep(interval);
        }
    }

    Err(last_error)
}

#[tauri::command]
fn backend_status(state: tauri::State<'_, BackendState>) -> BackendStatus {
    state
        .0
        .lock()
        .map(|runtime| runtime.status.clone())
        .unwrap_or_else(|_| BackendStatus::failed("Backend status lock is unavailable."))
}

#[tauri::command]
fn backend_connection(state: tauri::State<'_, BackendState>) -> BackendConnection {
    state
        .0
        .lock()
        .map(|runtime| BackendConnection {
            api_base: runtime.api_base.clone(),
            nonce: runtime.nonce.clone(),
            asset_token: runtime.asset_token.clone(),
        })
        .unwrap_or(BackendConnection {
            api_base: String::new(),
            nonce: None,
            asset_token: None,
        })
}

#[allow(dead_code)]
fn reserve_loopback_port() -> Result<u16, String> {
    TcpListener::bind((BACKEND_HOST, 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|err| format!("failed to reserve a loopback port: {err}"))
}

#[allow(dead_code)]
fn generate_nonce() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BackendState(Arc::new(Mutex::new(BackendRuntime {
            child: None,
            status: BackendStatus::failed("Backend has not been initialized."),
            api_base: "http://127.0.0.1:8000".to_string(),
            nonce: None,
            asset_token: None,
        }))))
        .invoke_handler(tauri::generate_handler![backend_status, backend_connection])
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
                let backend_state = app.state::<BackendState>().0.clone();
                set_backend_status(
                    &backend_state,
                    BackendStatus::external_ready(
                        "Debug build expects an external Python backend on 127.0.0.1:8000.",
                    ),
                );
            }

            #[cfg(not(debug_assertions))]
            {
                let app_handle = app.handle();
                let backend_state = app.state::<BackendState>().0.clone();
                let backend_port = reserve_loopback_port().map_err(|err| {
                    std::io::Error::new(std::io::ErrorKind::AddrNotAvailable, err)
                })?;
                let nonce = generate_nonce();
                let asset_token = generate_nonce();
                if let Ok(mut runtime) = backend_state.lock() {
                    runtime.api_base = format!("http://{BACKEND_HOST}:{backend_port}");
                    runtime.nonce = Some(nonce.clone());
                    runtime.asset_token = Some(asset_token.clone());
                }
                let port_arg = backend_port.to_string();

                match app_handle
                    .shell()
                    .sidecar("bookreader-backend")
                    .and_then(|c| {
                        c.env("BOOKREADER_SIDECAR_NONCE", &nonce)
                            .env("BOOKREADER_SIDECAR_ASSET_TOKEN", &asset_token)
                            .args(["--host", BACKEND_HOST, "--port", &port_arg])
                            .spawn()
                    }) {
                    Ok((mut rx, child)) => {
                        let pid = child.pid();
                        std::thread::spawn(move || {
                            while let Some(event) = rx.blocking_recv() {
                                match event {
                                    tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                                        eprintln!(
                                            "[sidecar:stdout] {}",
                                            String::from_utf8_lossy(&line)
                                        );
                                    }
                                    tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                                        eprintln!(
                                            "[sidecar:stderr] {}",
                                            String::from_utf8_lossy(&line)
                                        );
                                    }
                                    tauri_plugin_shell::process::CommandEvent::Error(line) => {
                                        eprintln!("[sidecar:error] {}", line);
                                    }
                                    _ => {}
                                }
                            }
                        });

                        if let Ok(mut slot) = backend_state.lock() {
                            slot.status = BackendStatus::starting(Some(pid));
                            slot.child = Some(child);
                        }

                        let readiness_state = backend_state.clone();
                        let readiness_nonce = nonce.clone();
                        std::thread::spawn(move || {
                            match wait_for_backend_health(
                                BACKEND_HOST,
                                backend_port,
                                Some(&readiness_nonce),
                                BACKEND_HEALTH_ATTEMPTS,
                                BACKEND_HEALTH_INTERVAL,
                            ) {
                                Ok(()) => set_backend_status(
                                    &readiness_state,
                                    BackendStatus::ready(Some(pid), true),
                                ),
                                Err(err) => set_backend_status(
                                    &readiness_state,
                                    BackendStatus::failed(format!(
                                        "Backend sidecar did not become ready: {err}"
                                    )),
                                ),
                            }
                        });
                    }
                    Err(err) => {
                        eprintln!("[tauri] backend sidecar spawn failed ({err}).");
                        set_backend_status(
                            &backend_state,
                            BackendStatus::failed(format!("Backend sidecar spawn failed: {err}")),
                        );
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
            if let Ok(mut runtime) = backend_state.lock() {
                cleanup_backend_runtime(&mut runtime);
            };
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn backend_status_records_spawn_failure() {
        let status = BackendStatus::failed("backend sidecar spawn failed: missing binary");

        assert_eq!(status.state, "failed");
        assert_eq!(
            status.message.as_deref(),
            Some("backend sidecar spawn failed: missing binary")
        );
        assert_eq!(status.pid, None);
        assert!(!status.owned);
    }

    #[test]
    fn backend_health_probe_accepts_ok_payload() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
        let port = listener.local_addr().expect("listener address").port();

        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept health probe");
            let mut buffer = [0; 512];
            let _ = stream.read(&mut buffer);
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{\"ok\":true}",
                )
                .expect("write health response");
        });

        let result = wait_for_backend_health("127.0.0.1", port, None, 2, Duration::from_millis(1));

        assert!(result.is_ok());
    }

    #[test]
    fn backend_health_probe_reports_failure_after_retries() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
        let port = listener.local_addr().expect("listener address").port();
        drop(listener);

        let result = wait_for_backend_health("127.0.0.1", port, None, 1, Duration::from_millis(1));

        assert!(result.is_err());
    }

    #[test]
    fn cleanup_without_child_marks_backend_stopped() {
        let mut runtime = BackendRuntime {
            child: None,
            status: BackendStatus::starting(Some(42)),
            api_base: "http://127.0.0.1:12345".to_string(),
            nonce: Some("test".to_string()),
            asset_token: Some("asset-test".to_string()),
        };

        cleanup_backend_runtime(&mut runtime);

        assert_eq!(runtime.status.state, "stopped");
        assert_eq!(runtime.status.pid, None);
        assert!(!runtime.status.owned);
    }
}
