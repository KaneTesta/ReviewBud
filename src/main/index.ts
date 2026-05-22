import { app, BrowserWindow, clipboard, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import { registerIpcHandlers } from "./ipc.js";
import {
  isPullRequestUrl,
  pullRequestUrlFromReviewBudUrl,
  reviewBudProtocol,
} from "../shared/pr-url.js";

const isDev =
  process.env.VITE_DEV_SERVER_URL || process.env.NODE_ENV === "development";
const isWindows = process.platform === "win32";
let mainWindow: BrowserWindow | null = null;
const pendingReviewPullRequestUrls: string[] = [];
let rendererReadyForReviewLinks = false;
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

function createWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
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
  rendererReadyForReviewLinks = false;
  mainWindow.on("closed", () => {
    mainWindow = null;
    rendererReadyForReviewLinks = false;
  });
  mainWindow.webContents.on("did-start-loading", () => {
    rendererReadyForReviewLinks = false;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("context-menu", (_event, params) => {
    const linkUrl = params.linkURL;
    if (!isPullRequestUrl(linkUrl)) {
      return;
    }

    Menu.buildFromTemplate([
      {
        label: "Review PR",
        click: () => {
          reviewPullRequestUrl(linkUrl);
        },
      },
      { type: "separator" },
      {
        label: "Open Link in Browser",
        click: () => {
          void shell.openExternal(linkUrl);
        },
      },
      {
        label: "Copy Link",
        click: () => {
          clipboard.writeText(linkUrl);
        },
      },
    ]).popup({ window: mainWindow ?? undefined });
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

  mainWindow.webContents.once("did-finish-load", () => {
    flushPendingReviewPullRequestUrls();
  });

  return mainWindow;
}

function registerReviewBudProtocol(): void {
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient(reviewBudProtocol, process.execPath, [
      path.resolve(process.argv[1] ?? "."),
    ]);
    return;
  }

  app.setAsDefaultProtocolClient(reviewBudProtocol);
}

function reviewPullRequestUrl(url: string): void {
  pendingReviewPullRequestUrls.push(url);

  if (!app.isReady()) {
    return;
  }

  const window = createWindow();
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  app.focus({ steal: true });
  window.focus();
  flushPendingReviewPullRequestUrls();
}

function flushPendingReviewPullRequestUrls(): void {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    mainWindow.webContents.isLoading() ||
    !rendererReadyForReviewLinks
  ) {
    return;
  }

  const urls = pendingReviewPullRequestUrls.splice(0);
  for (const url of urls) {
    mainWindow.webContents.send("pr:reviewLink", url);
  }
}

function claimPendingReviewPullRequestUrls(): string[] {
  return pendingReviewPullRequestUrls.splice(0);
}

function handleReviewBudDeepLink(url: string): void {
  const pullRequestUrl = pullRequestUrlFromReviewBudUrl(url);
  if (pullRequestUrl) {
    reviewPullRequestUrl(pullRequestUrl);
  }
}

function handleReviewBudDeepLinksFromArgv(argv: string[]): void {
  for (const value of argv) {
    if (value.startsWith(`${reviewBudProtocol}:`)) {
      handleReviewBudDeepLink(value);
    }
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  registerReviewBudProtocol();

  app.on("second-instance", (_event, argv) => {
    handleReviewBudDeepLinksFromArgv(argv);
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleReviewBudDeepLink(url);
  });
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) {
    return;
  }

  registerIpcHandlers();
  ipcMain.handle("app:rendererReadyForReviewLinks", () => {
    rendererReadyForReviewLinks = true;
    return claimPendingReviewPullRequestUrls();
  });
  createWindow();
  handleReviewBudDeepLinksFromArgv(process.argv);

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
