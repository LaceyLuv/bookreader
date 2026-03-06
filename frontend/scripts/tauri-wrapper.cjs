const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const DEV_BACKEND_FLAG = "--dev-backend-python";
const tauriCliArgs = args.filter((arg) => arg !== DEV_BACKEND_FLAG);
if (!tauriCliArgs.includes("dev")) {
  console.error("[tauri-wrapper] This wrapper is dev-only. Use 'npm run tauri -- <command>' for non-dev commands.");
  process.exit(1);
}
const baseDir =
  process.env.LOCALAPPDATA || process.env.APPDATA || process.env.USERPROFILE || process.cwd();
const cargoTargetDir = path.join(baseDir, "bookreader-tauri-target");
const isDev = tauriCliArgs.includes("dev");
const shouldSpawnPythonBackend = isDev && args.includes(DEV_BACKEND_FLAG);
const tauriArgs = tauriCliArgs.includes("--config")
  ? tauriCliArgs
  : [...tauriCliArgs, "--config", "src-tauri/tauri.debug.conf.json"];
const sanitizedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("="))
);
const backendDir = path.join(__dirname, "..", "..", "backend");
const tauriCmd = path.join(
  __dirname,
  "..",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tauri.cmd" : "tauri"
);

if (!fs.existsSync(tauriCmd)) {
  console.error(`[tauri-wrapper] tauri CLI not found: ${tauriCmd}`);
  process.exit(1);
}

function startDevBackend() {
  const venvPython = path.join(backendDir, ".venv", "Scripts", "python.exe");
  const pythonCommand = process.env.BOOKREADER_PYTHON || (fs.existsSync(venvPython) ? venvPython : "python");
  const backendArgs = ["run_server.py", "--host", "127.0.0.1", "--port", "8000"];

  console.log(`[desktop:dev] starting Python backend (${pythonCommand})`);
  const backend = spawn(pythonCommand, backendArgs, {
    cwd: backendDir,
    stdio: "inherit",
    shell: false,
    env: sanitizedEnv,
  });

  backend.on("error", (error) => {
    console.error("[desktop:dev] failed to start Python backend:", error);
  });

  return backend;
}

let backendChild = null;
if (shouldSpawnPythonBackend) {
  backendChild = startDevBackend();
}

function stopBackend() {
  if (backendChild && !backendChild.killed) {
    backendChild.kill();
  }
}

const child = spawn(tauriCmd, tauriArgs, {
  stdio: "inherit",
  shell: false,
  env: {
    ...sanitizedEnv,
    CARGO_TARGET_DIR: cargoTargetDir,
  },
});

child.on("exit", (code, signal) => {
  stopBackend();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code || 0);
});

child.on("error", (error) => {
  stopBackend();
  console.error(error);
  process.exit(1);
});
