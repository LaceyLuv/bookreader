use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::path::Path;
#[cfg(not(debug_assertions))]
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri::RunEvent;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;

#[allow(dead_code)]
const BACKEND_HOST: &str = "127.0.0.1";
#[allow(dead_code)]
const BACKEND_HEALTH_ATTEMPTS: usize = 50;
#[allow(dead_code)]
const BACKEND_HEALTH_INTERVAL: Duration = Duration::from_millis(200);
#[allow(dead_code)]
const BACKEND_HEALTH_TIMEOUT: Duration = Duration::from_millis(500);
#[cfg(not(debug_assertions))]
const LEGACY_DATA_DIR_NAME: &str = "BookReader";
const LEGACY_MIGRATION_MARKER: &str = ".legacy-data-migration-v1.json";
const LEGACY_MIGRATION_PENDING: &str = ".legacy-data-migration-v1.pending.json";
const LEGACY_MIGRATION_STAGE: &str = ".legacy-data-migration-v1-stage";
const LEGACY_DATA_ENTRIES: &[&str] = &[
    "library.json",
    "library.json.bak",
    "annotations.json",
    "annotations.json.bak",
    "reading-progress.json",
    "reading-progress.json.bak",
    "delete-journal.json",
    "delete-journal.json.bak",
    "restore-journal.json",
    "restore-journal.json.bak",
    "books",
    "fonts",
    "backups",
    ".restore-sessions",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
struct BackendStatus {
    state: String,
    code: Option<String>,
    message: Option<String>,
    pid: Option<u32>,
    owned: bool,
}

impl BackendStatus {
    #[allow(dead_code)]
    fn starting(pid: Option<u32>) -> Self {
        Self {
            state: "starting".to_string(),
            code: None,
            message: Some("Backend sidecar is starting.".to_string()),
            pid,
            owned: true,
        }
    }

    #[allow(dead_code)]
    fn ready(pid: Option<u32>, owned: bool) -> Self {
        Self {
            state: "ready".to_string(),
            code: None,
            message: None,
            pid,
            owned,
        }
    }

    #[cfg(debug_assertions)]
    fn external_ready(message: impl Into<String>) -> Self {
        Self {
            state: "external".to_string(),
            code: None,
            message: Some(message.into()),
            pid: None,
            owned: false,
        }
    }

    fn failed(message: impl Into<String>) -> Self {
        Self::failed_with_code("backend_failed", message)
    }

    fn failed_with_code(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            state: "failed".to_string(),
            code: Some(code.into()),
            message: Some(message.into()),
            pid: None,
            owned: false,
        }
    }

    fn stopped() -> Self {
        Self {
            state: "stopped".to_string(),
            code: None,
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacyMigrationMarker {
    schema_version: u8,
    source: String,
    destination: String,
    copied_files: u64,
    copied_bytes: u64,
    completed_at_unix_seconds: u64,
    source_preserved: bool,
    files: Vec<MigrationFileRecord>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
struct MigrationFileRecord {
    relative_path: String,
    bytes: u64,
    sha256: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct CopyStats {
    files: u64,
    bytes: u64,
}

fn path_has_content(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|err| format!("failed to inspect {}: {err}", path.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "refusing symlink in data migration: {}",
            path.display()
        ));
    }
    if metadata.is_file() {
        return Ok(true);
    }
    if metadata.is_dir() {
        return fs::read_dir(path)
            .map_err(|err| format!("failed to inspect {}: {err}", path.display()))?
            .next()
            .transpose()
            .map(|entry| entry.is_some())
            .map_err(|err| format!("failed to inspect {}: {err}", path.display()));
    }
    Err(format!(
        "refusing special file in data migration: {}",
        path.display()
    ))
}

fn data_root_has_content(root: &Path) -> Result<bool, String> {
    for name in LEGACY_DATA_ENTRIES {
        let entry = root.join(name);
        if entry.exists() && measure_regular_tree(&entry)?.files > 0 {
            return Ok(true);
        }
    }
    Ok(false)
}

fn copy_verified(source: &Path, destination: &Path) -> Result<CopyStats, String> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|err| format!("failed to inspect {}: {err}", source.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "refusing symlink in data migration: {}",
            source.display()
        ));
    }
    if metadata.is_file() {
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create {}: {err}", parent.display()))?;
        }
        let copied = fs::copy(source, destination).map_err(|err| {
            format!(
                "failed to copy {} to {}: {err}",
                source.display(),
                destination.display()
            )
        })?;
        let destination_size = fs::metadata(destination)
            .map_err(|err| format!("failed to verify {}: {err}", destination.display()))?
            .len();
        if copied != metadata.len() || destination_size != metadata.len() {
            return Err(format!(
                "data migration size mismatch for {}",
                source.display()
            ));
        }
        fs::OpenOptions::new()
            .write(true)
            .open(destination)
            .and_then(|file| file.sync_all())
            .map_err(|err| format!("failed to flush {}: {err}", destination.display()))?;
        return Ok(CopyStats {
            files: 1,
            bytes: metadata.len(),
        });
    }
    if metadata.is_dir() {
        fs::create_dir_all(destination)
            .map_err(|err| format!("failed to create {}: {err}", destination.display()))?;
        let mut stats = CopyStats::default();
        for entry in fs::read_dir(source)
            .map_err(|err| format!("failed to read {}: {err}", source.display()))?
        {
            let entry = entry
                .map_err(|err| format!("failed to read entry in {}: {err}", source.display()))?;
            stats.add(copy_verified(
                &entry.path(),
                &destination.join(entry.file_name()),
            )?);
        }
        return Ok(stats);
    }
    Err(format!(
        "refusing special file in data migration: {}",
        source.display()
    ))
}

fn measure_regular_tree(path: &Path) -> Result<CopyStats, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|err| format!("failed to inspect {}: {err}", path.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "refusing symlink in data migration: {}",
            path.display()
        ));
    }
    if metadata.is_file() {
        return Ok(CopyStats {
            files: 1,
            bytes: metadata.len(),
        });
    }
    if metadata.is_dir() {
        let mut stats = CopyStats::default();
        for entry in
            fs::read_dir(path).map_err(|err| format!("failed to read {}: {err}", path.display()))?
        {
            let entry = entry
                .map_err(|err| format!("failed to read entry in {}: {err}", path.display()))?;
            stats.add(measure_regular_tree(&entry.path())?);
        }
        return Ok(stats);
    }
    Err(format!(
        "refusing special file in data migration: {}",
        path.display()
    ))
}

fn normalized_marker_path(path: &Path) -> Result<String, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|err| format!("failed to resolve current directory: {err}"))?
            .join(path)
    };
    let text = absolute.to_str().map(str::to_owned).ok_or_else(|| {
        format!(
            "migration path is not valid Unicode: {}",
            absolute.display()
        )
    })?;
    #[cfg(windows)]
    return Ok(text
        .strip_prefix(r"\\?\")
        .unwrap_or(&text)
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase());
    #[cfg(not(windows))]
    return Ok(text.trim_end_matches('/').to_string());
}

fn hash_regular_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .map_err(|err| format!("failed to open {} for hashing: {err}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|err| format!("failed to hash {}: {err}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn collect_manifest_entry(
    path: &Path,
    relative_path: &Path,
    records: &mut Vec<MigrationFileRecord>,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|err| format!("failed to inspect {}: {err}", path.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "refusing symlink in data migration: {}",
            path.display()
        ));
    }
    if metadata.is_file() {
        let relative_text = relative_path
            .to_str()
            .ok_or_else(|| {
                format!(
                    "migration filename is not valid Unicode: {}",
                    path.display()
                )
            })?
            .replace('\\', "/");
        records.push(MigrationFileRecord {
            relative_path: relative_text,
            bytes: metadata.len(),
            sha256: hash_regular_file(path)?,
        });
        return Ok(());
    }
    if metadata.is_dir() {
        for entry in
            fs::read_dir(path).map_err(|err| format!("failed to read {}: {err}", path.display()))?
        {
            let entry = entry
                .map_err(|err| format!("failed to read entry in {}: {err}", path.display()))?;
            collect_manifest_entry(
                &entry.path(),
                &relative_path.join(entry.file_name()),
                records,
            )?;
        }
        return Ok(());
    }
    Err(format!(
        "refusing special file in data migration: {}",
        path.display()
    ))
}

fn collect_migration_manifest(root: &Path) -> Result<Vec<MigrationFileRecord>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let metadata = fs::symlink_metadata(root)
        .map_err(|err| format!("failed to inspect {}: {err}", root.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!(
            "migration data root is not a regular directory: {}",
            root.display()
        ));
    }
    let mut records = Vec::new();
    for name in LEGACY_DATA_ENTRIES {
        let entry = root.join(name);
        if entry.exists() {
            collect_manifest_entry(&entry, Path::new(name), &mut records)?;
        }
    }
    records.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(records)
}

fn collect_pending_migration_manifest(
    stage: &Path,
    destination: &Path,
) -> Result<Vec<MigrationFileRecord>, String> {
    if stage.exists() {
        let metadata = fs::symlink_metadata(stage)
            .map_err(|err| format!("failed to inspect {}: {err}", stage.display()))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(format!(
                "migration stage is not a regular directory: {}",
                stage.display()
            ));
        }
    }
    let mut records = Vec::new();
    for name in LEGACY_DATA_ENTRIES {
        let staged_entry = stage.join(name);
        let destination_entry = destination.join(name);
        let selected = if staged_entry.exists() {
            if destination_entry.exists() && path_has_content(&destination_entry)? {
                return Err(format!(
                    "migration entry exists in both stage and destination: {name}"
                ));
            }
            Some(staged_entry)
        } else if destination_entry.exists() {
            Some(destination_entry)
        } else {
            None
        };
        if let Some(path) = selected {
            collect_manifest_entry(&path, Path::new(name), &mut records)?;
        }
    }
    records.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(records)
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    let payload = serde_json::to_vec_pretty(value)
        .map_err(|err| format!("failed to serialize migration marker: {err}"))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create {}: {err}", parent.display()))?;
    }
    let mut file = fs::File::create(&temporary)
        .map_err(|err| format!("failed to create {}: {err}", temporary.display()))?;
    file.write_all(&payload)
        .and_then(|_| file.write_all(b"\n"))
        .and_then(|_| file.sync_all())
        .map_err(|err| format!("failed to write {}: {err}", temporary.display()))?;
    fs::rename(&temporary, path).map_err(|err| {
        format!(
            "failed to publish {} as {}: {err}",
            temporary.display(),
            path.display()
        )
    })
}

fn read_valid_migration_marker(
    path: &Path,
    source: &Path,
    destination: &Path,
    completed: bool,
) -> Result<LegacyMigrationMarker, String> {
    let metadata = fs::symlink_metadata(path).map_err(|err| {
        format!(
            "failed to inspect migration marker {}: {err}",
            path.display()
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!(
            "migration marker is not a regular file: {}",
            path.display()
        ));
    }
    let payload = fs::read(path)
        .map_err(|err| format!("failed to read migration marker {}: {err}", path.display()))?;
    let marker: LegacyMigrationMarker = serde_json::from_slice(&payload)
        .map_err(|err| format!("invalid migration marker {}: {err}", path.display()))?;
    let expected_completion = if completed {
        marker.completed_at_unix_seconds > 0
    } else {
        marker.completed_at_unix_seconds == 0
    };
    let manifest_bytes = marker
        .files
        .iter()
        .try_fold(0_u64, |total, file| total.checked_add(file.bytes));
    let manifest_is_valid = !marker.files.is_empty()
        && marker.copied_files == marker.files.len() as u64
        && manifest_bytes == Some(marker.copied_bytes)
        && marker
            .files
            .windows(2)
            .all(|pair| pair[0].relative_path.as_str() < pair[1].relative_path.as_str())
        && marker.files.iter().all(|file| {
            let mut components = file.relative_path.split('/');
            let first = components.next().unwrap_or_default();
            LEGACY_DATA_ENTRIES.contains(&first)
                && !file.relative_path.contains('\\')
                && !file.relative_path.starts_with('/')
                && !file
                    .relative_path
                    .split('/')
                    .any(|part| part.is_empty() || part == "." || part == "..")
                && file.sha256.len() == 64
                && file.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        });
    if marker.schema_version != 1
        || marker.source != normalized_marker_path(source)?
        || marker.destination != normalized_marker_path(destination)?
        || !manifest_is_valid
        || !marker.source_preserved
        || !expected_completion
    {
        return Err(format!(
            "migration marker does not match this migration: {}",
            path.display()
        ));
    }
    Ok(marker)
}

fn remove_empty_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|err| format!("failed to inspect {}: {err}", path.display()))?;
    if metadata.is_dir() && !path_has_content(path)? {
        fs::remove_dir(path)
            .map_err(|err| format!("failed to remove empty {}: {err}", path.display()))?;
    }
    Ok(())
}

fn publish_staged_legacy_data(stage: &Path, destination: &Path) -> Result<(), String> {
    for name in LEGACY_DATA_ENTRIES {
        let staged_entry = stage.join(name);
        let destination_entry = destination.join(name);
        if staged_entry.exists() {
            measure_regular_tree(&staged_entry)?;
        }
        if destination_entry.exists() {
            if staged_entry.exists() && path_has_content(&destination_entry)? {
                return Err(format!(
                    "data migration destination became non-empty: {}",
                    destination_entry.display()
                ));
            }
            if staged_entry.exists() {
                remove_empty_directory(&destination_entry)?;
            }
        }
        if staged_entry.exists() && !destination_entry.exists() {
            fs::rename(&staged_entry, &destination_entry).map_err(|err| {
                format!(
                    "failed to publish {} as {}: {err}",
                    staged_entry.display(),
                    destination_entry.display()
                )
            })?;
        }
    }
    Ok(())
}

fn cleanup_completed_migration_residue(stage: &Path, pending_path: &Path) -> Result<(), String> {
    if stage.exists() {
        let metadata = fs::symlink_metadata(stage)
            .map_err(|err| format!("failed to inspect {}: {err}", stage.display()))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(format!(
                "refusing unexpected migration stage: {}",
                stage.display()
            ));
        }
        measure_regular_tree(stage)?;
        fs::remove_dir_all(stage)
            .map_err(|err| format!("failed to remove {}: {err}", stage.display()))?;
    }
    if pending_path.exists() {
        let metadata = fs::symlink_metadata(pending_path)
            .map_err(|err| format!("failed to inspect {}: {err}", pending_path.display()))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!(
                "refusing unexpected migration journal: {}",
                pending_path.display()
            ));
        }
        fs::remove_file(pending_path)
            .map_err(|err| format!("failed to remove {}: {err}", pending_path.display()))?;
    }
    Ok(())
}

fn migrate_legacy_data(source: &Path, destination: &Path) -> Result<Option<CopyStats>, String> {
    if source == destination {
        return Ok(None);
    }
    fs::create_dir_all(destination).map_err(|err| {
        format!(
            "failed to create data directory {}: {err}",
            destination.display()
        )
    })?;
    let destination_metadata = fs::symlink_metadata(destination)
        .map_err(|err| format!("failed to inspect {}: {err}", destination.display()))?;
    if destination_metadata.file_type().is_symlink() || !destination_metadata.is_dir() {
        return Err(format!(
            "migration destination is not a regular directory: {}",
            destination.display()
        ));
    }

    let stage = destination.join(LEGACY_MIGRATION_STAGE);
    let pending_path = destination.join(LEGACY_MIGRATION_PENDING);
    let completed_path = destination.join(LEGACY_MIGRATION_MARKER);
    if completed_path.exists() {
        read_valid_migration_marker(&completed_path, source, destination, true)?;
        if !data_root_has_content(destination)? {
            return Err(format!(
                "completed migration marker exists but migrated data is missing in {}",
                destination.display()
            ));
        }
        cleanup_completed_migration_residue(&stage, &pending_path)?;
        return Ok(None);
    }
    let pending_exists = pending_path.exists();

    if !pending_exists {
        let source_manifest = collect_migration_manifest(source)?;
        let source_has_content = !source_manifest.is_empty();
        let destination_has_content = data_root_has_content(destination)?;
        if !source_has_content {
            return Ok(None);
        }
        if destination_has_content {
            return Err(format!(
                "legacy and destination data both exist; refusing to hide or overwrite data (source: {}, destination: {})",
                source.display(),
                destination.display()
            ));
        }
        if stage.exists() {
            fs::remove_dir_all(&stage)
                .map_err(|err| format!("failed to reset {}: {err}", stage.display()))?;
        }
        fs::create_dir(&stage)
            .map_err(|err| format!("failed to create {}: {err}", stage.display()))?;

        let mut stats = CopyStats::default();
        for name in LEGACY_DATA_ENTRIES {
            let source_entry = source.join(name);
            if source_entry.exists() {
                stats.add(copy_verified(&source_entry, &stage.join(name))?);
            }
        }
        let staged_manifest = collect_migration_manifest(&stage)?;
        if staged_manifest != source_manifest {
            return Err("legacy data changed or was corrupted while staging".to_string());
        }
        let manifest_bytes = source_manifest
            .iter()
            .try_fold(0_u64, |total, file| total.checked_add(file.bytes));
        if stats.files != source_manifest.len() as u64 || manifest_bytes != Some(stats.bytes) {
            return Err("legacy data manifest totals do not match the staged copy".to_string());
        }
        let marker = LegacyMigrationMarker {
            schema_version: 1,
            source: normalized_marker_path(source)?,
            destination: normalized_marker_path(destination)?,
            copied_files: stats.files,
            copied_bytes: stats.bytes,
            completed_at_unix_seconds: 0,
            source_preserved: true,
            files: source_manifest,
        };
        write_json_atomic(&pending_path, &marker)?;
    }

    let mut marker = read_valid_migration_marker(&pending_path, source, destination, false)?;
    if collect_migration_manifest(source)? != marker.files {
        return Err("legacy source changed after the migration journal was written".to_string());
    }
    if collect_pending_migration_manifest(&stage, destination)? != marker.files {
        return Err("staged migration data does not match the migration journal".to_string());
    }
    publish_staged_legacy_data(&stage, destination)?;
    if collect_migration_manifest(destination)? != marker.files {
        return Err("published migration data does not match the migration journal".to_string());
    }
    marker.completed_at_unix_seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    write_json_atomic(&completed_path, &marker)?;
    cleanup_completed_migration_residue(&stage, &pending_path)?;
    Ok(Some(CopyStats {
        files: marker.copied_files,
        bytes: marker.copied_bytes,
    }))
}

#[cfg(not(debug_assertions))]
fn legacy_windows_data_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("APPDATA"))
        .map(PathBuf::from)
        .map(|root| root.join(LEGACY_DATA_DIR_NAME))
}

#[cfg(not(debug_assertions))]
fn prepare_backend_data_dir<R: tauri::Runtime>(app: &tauri::App<R>) -> Result<PathBuf, String> {
    let destination = app
        .path()
        .app_local_data_dir()
        .map_err(|err| format!("failed to resolve the application data directory: {err}"))?;
    if let Some(source) = legacy_windows_data_dir() {
        migrate_legacy_data(&source, &destination)?;
    } else {
        fs::create_dir_all(&destination).map_err(|err| {
            format!(
                "failed to create application data directory {}: {err}",
                destination.display()
            )
        })?;
    }
    Ok(destination)
}

impl CopyStats {
    fn add(&mut self, other: Self) {
        self.files += other.files;
        self.bytes += other.bytes;
    }
}

fn stop_backend(child: tauri_plugin_shell::process::CommandChild) -> Result<(), String> {
    #[cfg(windows)]
    {
        let pid = child.pid().to_string();
        // Windows sidecars can leave worker descendants; taskkill /T cleans the tree.
        let taskkill_result = std::process::Command::new("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .status();
        if matches!(taskkill_result, Ok(status) if status.success()) {
            return Ok(());
        }
        let fallback = child
            .kill()
            .map(|_| "direct child fallback succeeded".to_string())
            .unwrap_or_else(|err| format!("direct child fallback failed: {err}"));
        return Err(match taskkill_result {
            Ok(status) => format!(
                "taskkill could not verify backend process-tree shutdown for PID {pid} (status {status}); {fallback}"
            ),
            Err(taskkill_error) => format!(
                "taskkill could not run for backend PID {pid}: {taskkill_error}; {fallback}"
            ),
        });
    }

    // macOS/Linux CommandChild::kill terminates the direct child. PyInstaller onefile
    // should keep backend workers in that process, so there is no extra tree walk here.
    #[cfg(not(windows))]
    return child
        .kill()
        .map_err(|err| format!("failed to stop backend sidecar: {err}"));
}

fn cleanup_backend_runtime(runtime: &mut BackendRuntime) {
    let stop_error = runtime
        .child
        .take()
        .and_then(|child| stop_backend(child).err());
    if let Some(error) = stop_error {
        runtime.status = BackendStatus::failed_with_code("sidecar_stop_failed", error);
    } else {
        runtime.status = BackendStatus::stopped();
    }
}

fn set_backend_status(backend_state: &Arc<Mutex<BackendRuntime>>, status: BackendStatus) {
    if let Ok(mut runtime) = backend_state.lock() {
        runtime.status = status;
    }
}

fn set_backend_status_if_starting(
    backend_state: &Arc<Mutex<BackendRuntime>>,
    status: BackendStatus,
) {
    if let Ok(mut runtime) = backend_state.lock() {
        if runtime.status.state == "starting" {
            runtime.status = status;
        }
    }
}

fn record_backend_termination(
    backend_state: &Arc<Mutex<BackendRuntime>>,
    pid: u32,
    code: Option<i32>,
    signal: Option<i32>,
) {
    if let Ok(mut runtime) = backend_state.lock() {
        if runtime.status.pid != Some(pid) || runtime.status.state == "stopped" {
            return;
        }
        runtime.child.take();
        runtime.status = BackendStatus::failed_with_code(
            "sidecar_exited",
            format!(
                "Backend sidecar exited before shutdown (code: {}, signal: {}).",
                code.map(|value| value.to_string())
                    .unwrap_or_else(|| "unknown".to_string()),
                signal
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "none".to_string())
            ),
        );
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

#[tauri::command]
fn restart_application(
    app: tauri::AppHandle,
    state: tauri::State<'_, BackendState>,
) -> Result<(), String> {
    {
        let mut runtime = state
            .0
            .lock()
            .map_err(|_| "Backend status lock is unavailable during restart.".to_string())?;
        cleanup_backend_runtime(&mut runtime);
        if runtime.status.code.as_deref() == Some("sidecar_stop_failed") {
            return Err(runtime
                .status
                .message
                .clone()
                .unwrap_or_else(|| "Backend sidecar could not be stopped.".to_string()));
        }
    }
    app.restart();
}

#[allow(dead_code)]
fn reserve_loopback_listener() -> Result<TcpListener, String> {
    TcpListener::bind((BACKEND_HOST, 0))
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
            status: BackendStatus::failed_with_code(
                "backend_not_initialized",
                "Backend has not been initialized.",
            ),
            api_base: "http://127.0.0.1:1".to_string(),
            nonce: None,
            asset_token: None,
        }))))
        .invoke_handler(tauri::generate_handler![
            backend_status,
            backend_connection,
            restart_application
        ])
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
                if std::env::var_os("BOOKREADER_DESKTOP_FAULT_SMOKE").is_some() {
                    let _ = main_window.hide();
                } else {
                    let _ = main_window.show();
                    let _ = main_window.unminimize();
                    let _ = main_window.set_focus();
                }
            }

            #[cfg(debug_assertions)]
            {
                eprintln!("[tauri] debug build: expecting Python backend at 127.0.0.1:8000");
                let backend_state = app.state::<BackendState>().0.clone();
                if let Ok(mut runtime) = backend_state.lock() {
                    runtime.api_base = "http://127.0.0.1:8000".to_string();
                }
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
                let backend_data_dir = match prepare_backend_data_dir(app) {
                    Ok(path) => path,
                    Err(err) => {
                        set_backend_status(
                            &backend_state,
                            BackendStatus::failed_with_code(
                                "data_migration_failed",
                                format!("Gyeol Reader could not prepare its data directory: {err}"),
                            ),
                        );
                        return Ok(());
                    }
                };
                let backend_listener = reserve_loopback_listener().map_err(|err| {
                    std::io::Error::new(std::io::ErrorKind::AddrNotAvailable, err)
                })?;
                let backend_port = backend_listener
                    .local_addr()
                    .map_err(|err| std::io::Error::new(std::io::ErrorKind::AddrNotAvailable, err))?
                    .port();
                let nonce = generate_nonce();
                let asset_token = generate_nonce();
                if let Ok(mut runtime) = backend_state.lock() {
                    runtime.api_base = format!("http://{BACKEND_HOST}:{backend_port}");
                    runtime.nonce = Some(nonce.clone());
                    runtime.asset_token = Some(asset_token.clone());
                }
                let port_arg = backend_port.to_string();
                drop(backend_listener);

                match app_handle
                    .shell()
                    .sidecar("bookreader-backend")
                    .and_then(|c| {
                        c.env("BOOKREADER_SIDECAR_NONCE", &nonce)
                            .env("BOOKREADER_SIDECAR_ASSET_TOKEN", &asset_token)
                            .env("BOOKREADER_DATA_DIR", backend_data_dir.as_os_str())
                            .env("BOOKREADER_PARENT_PID", std::process::id().to_string())
                            .args(["--host", BACKEND_HOST, "--port", &port_arg])
                            .spawn()
                    }) {
                    Ok((mut rx, child)) => {
                        let pid = child.pid();
                        if let Ok(mut slot) = backend_state.lock() {
                            slot.status = BackendStatus::starting(Some(pid));
                            slot.child = Some(child);
                        }

                        let event_state = backend_state.clone();
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
                                        set_backend_status_if_starting(
                                            &event_state,
                                            BackendStatus::failed_with_code(
                                                "sidecar_io_error",
                                                format!("Backend sidecar process error: {line}"),
                                            ),
                                        );
                                    }
                                    tauri_plugin_shell::process::CommandEvent::Terminated(
                                        payload,
                                    ) => {
                                        record_backend_termination(
                                            &event_state,
                                            pid,
                                            payload.code,
                                            payload.signal,
                                        );
                                    }
                                    _ => {}
                                }
                            }
                        });

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
                                Ok(()) => set_backend_status_if_starting(
                                    &readiness_state,
                                    BackendStatus::ready(Some(pid), true),
                                ),
                                Err(err) => set_backend_status_if_starting(
                                    &readiness_state,
                                    BackendStatus::failed_with_code(
                                        "sidecar_not_ready",
                                        format!("Backend sidecar did not become ready: {err}"),
                                    ),
                                ),
                            }
                        });
                    }
                    Err(err) => {
                        eprintln!("[tauri] backend sidecar spawn failed ({err}).");
                        set_backend_status(
                            &backend_state,
                            BackendStatus::failed_with_code(
                                "sidecar_spawn_failed",
                                format!("Backend sidecar spawn failed: {err}"),
                            ),
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
        assert_eq!(status.code.as_deref(), Some("backend_failed"));
        assert_eq!(
            status.message.as_deref(),
            Some("backend sidecar spawn failed: missing binary")
        );
        assert_eq!(status.pid, None);
        assert!(!status.owned);
    }

    #[test]
    fn external_backend_status_is_explicit_and_unowned() {
        let status = BackendStatus::external_ready("development backend");

        assert_eq!(status.state, "external");
        assert_eq!(status.code, None);
        assert_eq!(status.message.as_deref(), Some("development backend"));
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
    fn authenticated_health_probe_rejects_an_unauthenticated_payload() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
        let port = listener.local_addr().expect("listener address").port();

        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept health probe");
            let mut buffer = [0; 512];
            let _ = stream.read(&mut buffer);
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 12\r\n\r\n{\"ok\":true}",
                )
                .expect("write health response");
        });

        let result = wait_for_backend_health(
            "127.0.0.1",
            port,
            Some("launch-secret"),
            1,
            Duration::from_millis(1),
        );

        assert!(result.is_err());
    }

    #[test]
    fn reserved_listener_keeps_the_selected_port_owned_until_spawn() {
        let listener = reserve_loopback_listener().expect("reserve listener");
        let port = listener.local_addr().expect("listener address").port();

        assert!(TcpListener::bind((BACKEND_HOST, port)).is_err());
        drop(listener);
        assert!(TcpListener::bind((BACKEND_HOST, port)).is_ok());
    }

    #[test]
    fn sidecar_termination_records_exit_details_without_waiting_for_health_timeout() {
        let state = Arc::new(Mutex::new(BackendRuntime {
            child: None,
            status: BackendStatus::starting(Some(42)),
            api_base: "http://127.0.0.1:12345".to_string(),
            nonce: Some("test".to_string()),
            asset_token: Some("asset-test".to_string()),
        }));

        record_backend_termination(&state, 42, Some(23), None);

        let runtime = state.lock().expect("backend state");
        assert_eq!(runtime.status.state, "failed");
        assert_eq!(runtime.status.code.as_deref(), Some("sidecar_exited"));
        assert!(runtime
            .status
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("23"));
    }

    #[test]
    fn late_readiness_result_cannot_overwrite_a_terminal_failure() {
        let state = Arc::new(Mutex::new(BackendRuntime {
            child: None,
            status: BackendStatus::failed_with_code("sidecar_exited", "exit 23"),
            api_base: "http://127.0.0.1:12345".to_string(),
            nonce: Some("test".to_string()),
            asset_token: Some("asset-test".to_string()),
        }));

        set_backend_status_if_starting(&state, BackendStatus::ready(Some(42), true));

        let runtime = state.lock().expect("backend state");
        assert_eq!(runtime.status.code.as_deref(), Some("sidecar_exited"));
    }

    #[test]
    fn legacy_data_migration_is_allowlisted_verified_and_non_destructive() {
        let root = std::env::temp_dir().join(format!(
            "bookreader-migration-test-{}-{}",
            std::process::id(),
            generate_nonce().chars().take(8).collect::<String>()
        ));
        let source = root.join("legacy-install");
        let destination = root.join("app-data");
        fs::create_dir_all(source.join("books")).expect("source books");
        fs::write(source.join("library.json"), b"{\"version\":4,\"books\":[]}")
            .expect("source library");
        fs::write(source.join("books").join("book.txt"), b"book bytes").expect("source book");
        fs::write(source.join("uninstall.exe"), b"must not migrate")
            .expect("unrelated installer file");

        let stats = migrate_legacy_data(&source, &destination)
            .expect("migration")
            .expect("migration performed");

        assert_eq!(stats.files, 2);
        assert!(destination.join("library.json").is_file());
        assert_eq!(
            fs::read(destination.join("books").join("book.txt")).expect("migrated book"),
            b"book bytes"
        );
        assert!(!destination.join("uninstall.exe").exists());
        assert!(destination.join(LEGACY_MIGRATION_MARKER).is_file());
        assert!(!destination.join(LEGACY_MIGRATION_PENDING).exists());
        assert!(source.join("library.json").is_file());
        assert!(source.join("books").join("book.txt").is_file());
        assert!(migrate_legacy_data(&source, &destination)
            .expect("idempotent migration")
            .is_none());
        fs::remove_dir_all(&source).expect("simulate user removing old install data");
        assert!(migrate_legacy_data(&source, &destination)
            .expect("completed marker remains valid after source removal")
            .is_none());

        fs::remove_dir_all(root).expect("cleanup migration test");
    }

    #[test]
    fn legacy_data_migration_rejects_conflicting_destination_data() {
        let root = std::env::temp_dir().join(format!(
            "bookreader-migration-conflict-test-{}-{}",
            std::process::id(),
            generate_nonce().chars().take(8).collect::<String>()
        ));
        let source = root.join("legacy-install");
        let destination = root.join("app-data");
        fs::create_dir_all(&source).expect("source");
        fs::create_dir_all(&destination).expect("destination");
        fs::write(source.join("library.json"), b"legacy").expect("legacy store");
        fs::write(destination.join("annotations.json"), b"new data").expect("new store");

        let error = migrate_legacy_data(&source, &destination)
            .expect_err("conflicting roots must fail closed");

        assert!(error.contains("both exist"));
        assert_eq!(fs::read(source.join("library.json")).unwrap(), b"legacy");
        assert_eq!(
            fs::read(destination.join("annotations.json")).unwrap(),
            b"new data"
        );
        assert!(!destination.join(LEGACY_MIGRATION_PENDING).exists());
        fs::remove_dir_all(root).expect("cleanup conflict test");
    }

    #[test]
    fn legacy_data_migration_rejects_same_size_staged_tampering() {
        let root = std::env::temp_dir().join(format!(
            "bookreader-migration-tamper-test-{}-{}",
            std::process::id(),
            generate_nonce().chars().take(8).collect::<String>()
        ));
        let source = root.join("legacy-install");
        let destination = root.join("app-data");
        let stage = destination.join(LEGACY_MIGRATION_STAGE);
        fs::create_dir_all(source.join("books")).expect("source books");
        fs::create_dir_all(stage.join("books")).expect("stage books");
        fs::write(source.join("books").join("book.txt"), b"AAAA").expect("source book");
        fs::write(stage.join("books").join("book.txt"), b"BBBB").expect("tampered stage");
        let files = collect_migration_manifest(&source).expect("source manifest");
        let marker = LegacyMigrationMarker {
            schema_version: 1,
            source: normalized_marker_path(&source).expect("source path"),
            destination: normalized_marker_path(&destination).expect("destination path"),
            copied_files: files.len() as u64,
            copied_bytes: files.iter().map(|file| file.bytes).sum(),
            completed_at_unix_seconds: 0,
            source_preserved: true,
            files,
        };
        write_json_atomic(&destination.join(LEGACY_MIGRATION_PENDING), &marker)
            .expect("pending marker");

        let error = migrate_legacy_data(&source, &destination)
            .expect_err("same-size staged tampering must fail closed");

        assert!(error.contains("does not match the migration journal"));
        assert!(!destination.join("books").join("book.txt").exists());
        assert_eq!(
            fs::read(source.join("books").join("book.txt")).unwrap(),
            b"AAAA"
        );
        fs::remove_dir_all(root).expect("cleanup tamper test");
    }

    #[test]
    fn legacy_data_migration_rejects_invalid_completed_marker() {
        let root = std::env::temp_dir().join(format!(
            "bookreader-migration-marker-test-{}-{}",
            std::process::id(),
            generate_nonce().chars().take(8).collect::<String>()
        ));
        let source = root.join("legacy-install");
        let destination = root.join("app-data");
        fs::create_dir_all(&source).expect("source");
        fs::write(source.join("library.json"), b"legacy").expect("legacy store");
        migrate_legacy_data(&source, &destination).expect("initial migration");
        let marker_path = destination.join(LEGACY_MIGRATION_MARKER);
        let mut marker: serde_json::Value =
            serde_json::from_slice(&fs::read(&marker_path).expect("read marker"))
                .expect("parse marker");
        marker["schemaVersion"] = serde_json::json!(99);
        fs::write(&marker_path, serde_json::to_vec(&marker).unwrap()).expect("corrupt marker");

        let error = migrate_legacy_data(&source, &destination)
            .expect_err("invalid completion marker must fail closed");

        assert!(error.contains("does not match this migration"));
        assert_eq!(
            fs::read(destination.join("library.json")).unwrap(),
            b"legacy"
        );
        fs::remove_dir_all(root).expect("cleanup marker test");
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
        assert_eq!(runtime.status.code, None);
        assert_eq!(runtime.status.pid, None);
        assert!(!runtime.status.owned);
    }
}
