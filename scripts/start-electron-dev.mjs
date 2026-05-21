import electron from "electron";
import { spawn } from "node:child_process";

const child = spawn(electron, ["."], {
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
