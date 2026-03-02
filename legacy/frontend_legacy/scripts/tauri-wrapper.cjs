const { spawn } = require("child_process");
const path = require("path");

const args = process.argv.slice(2);
const baseDir =
  process.env.LOCALAPPDATA || process.env.APPDATA || process.env.USERPROFILE || process.cwd();
const cargoTargetDir = path.join(baseDir, "bookreader-tauri-target");
const isDev = args.includes("dev");
const isDebugBuild = args.includes("build") && args.includes("--debug");
const shouldUseDebugConfig = isDev || isDebugBuild;
const tauriArgs = shouldUseDebugConfig
  ? [...args, "--config", "src-tauri/tauri.debug.conf.json"]
  : args;
const npxCommand = "npx";
const sanitizedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("="))
);

const child = spawn(npxCommand, ["tauri", ...tauriArgs], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...sanitizedEnv,
    CARGO_TARGET_DIR: cargoTargetDir,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code || 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
