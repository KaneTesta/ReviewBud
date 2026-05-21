import { app, BrowserWindow, ipcMain } from "electron";
import { fetchFileSource, fetchPullRequest, fetchRecentPullRequests, fetchRecentRepositories, fetchSymbolContext, searchRepositories } from "./github.js";
import { ReviewStorage } from "./storage.js";
import { parsePullRequestUrl } from "../shared/pr-url.js";
import type { DraftReviewComment, DraftReviewSubmission, ReviewNote, SymbolContextRequest } from "../shared/types.js";

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

export function registerIpcHandlers(): void {
  const storage = new ReviewStorage(app.getPath("userData"));

  ipcMain.handle("app:setTheme", (event, theme: keyof typeof titleBarThemes) => {
    if (process.platform !== "win32") return;
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.setTitleBarOverlay({
      ...titleBarThemes[theme],
      height: 40,
    });
  });

  ipcMain.handle("pr:load", async (_event, url: string) => {
    const ref = parsePullRequestUrl(url);
    const pullRequest = await fetchPullRequest(ref);
    return storage.savePullRequest(pullRequest);
  });

  ipcMain.handle("repos:list", () => fetchRecentRepositories());

  ipcMain.handle("repos:search", (_event, query: string, owner: string) =>
    searchRepositories(query, owner),
  );

  ipcMain.handle("prs:list", (_event, owner: string, repo: string) =>
    fetchRecentPullRequests({ owner, repo }),
  );

  ipcMain.handle(
    "pr:saveReviewState",
    async (
      _event,
      id: string,
      state: {
        notes: ReviewNote[];
        draftComments: DraftReviewComment[];
        draftReview: DraftReviewSubmission | null;
      },
    ) => storage.saveReviewState(id, state),
  );

  ipcMain.handle("pr:symbolContext", async (_event, request: SymbolContextRequest) =>
    fetchSymbolContext(request, app.getPath("userData")),
  );

  ipcMain.handle("pr:fileSource", async (_event, request: SymbolContextRequest) =>
    fetchFileSource(request),
  );
}
