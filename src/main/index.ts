import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { registerIpcHandlers } from "./ipc.js";

const isDev =
  process.env.VITE_DEV_SERVER_URL || process.env.NODE_ENV === "development";
const isWindows = process.platform === "win32";
const titleBarThemes = {
  dark: {
    color: "#010102",
    symbolColor: "#f7f8f8",
  },
  light: {
    color: "#f4f6f8",
    symbolColor: "#151922",
  },
} as const;

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: "review bud",
    backgroundColor: "#010102",
    autoHideMenuBar: true,
    ...(isWindows
      ? {
          titleBarStyle: "hidden",
          titleBarOverlay: {
            ...titleBarThemes.dark,
            height: 40,
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });
  mainWindow.setMenu(null);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (isDev) {
    void mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, "../../dist-renderer/index.html"),
    );
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
