const { spawn } = require("child_process");
const path = require("path");

const tauriCmd = path.join(
  __dirname,
  "..",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tauri.cmd" : "tauri"
);

const sanitizedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("="))
);

if (sanitizedEnv.CI === "1") {
  sanitizedEnv.CI = "true";
}

const child = spawn(tauriCmd, process.argv.slice(2), {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: sanitizedEnv,
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
