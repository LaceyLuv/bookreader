const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const tauriCli = path.join(
  __dirname,
  "..",
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js"
);

const sanitizedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("="))
);

if (!fs.existsSync(tauriCli)) {
  console.error(`[tauri-cli] tauri CLI not found: ${tauriCli}`);
  process.exit(1);
}

if (sanitizedEnv.CI === "1") {
  sanitizedEnv.CI = "true";
}

const child = spawn(process.execPath, [tauriCli, ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: false,
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
