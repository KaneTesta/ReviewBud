import { app, BrowserWindow, ipcMain } from "electron";
import { fetchFileSource, fetchPullRequest, fetchRecentPullRequests, fetchRecentRepositories, fetchSymbolContext, replyToPullRequestDiscussion, searchRepositories, submitPullRequestReview } from "./github.js";
import { ReviewStorage } from "./storage.js";
import { parsePullRequestUrl, pullRequestId } from "../shared/pr-url.js";
import { sortRepositoriesForDisplay } from "../shared/repositories.js";
import type { DraftReviewComment, DraftReviewSubmission, PullRequestDiscussionReplyRequest, PullRequestReviewSubmissionRequest, ReviewNote, SymbolContextRequest } from "../shared/types.js";

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

  ipcMain.handle("repos:list", async () =>
    sortRepositoriesForDisplay(await storage.applyRepositoryStars(await fetchRecentRepositories())),
  );

  ipcMain.handle("repos:search", async (_event, query: string, owner: string) =>
    sortRepositoriesForDisplay(await storage.applyRepositoryStars(await searchRepositories(query, owner))),
  );

  ipcMain.handle("repos:setStar", async (_event, fullName: string, isStarred: boolean) =>
    storage.setRepositoryStar(fullName, isStarred),
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

  ipcMain.handle("pr:replyDiscussion", async (_event, request: PullRequestDiscussionReplyRequest) => {
    const pullRequest = await replyToPullRequestDiscussion(request);
    return storage.savePullRequest(pullRequest);
  });

  ipcMain.handle("pr:submitReview", async (_event, request: PullRequestReviewSubmissionRequest) => {
    const workspaceId = pullRequestId(request);
    await storage.loadWorkspace(workspaceId);
    await submitPullRequestReview(request);
    const clearedWorkspace = await storage.clearSubmittedReview(workspaceId);

    try {
      return await storage.saveSubmittedPullRequest(await fetchPullRequest(request));
    } catch {
      return clearedWorkspace;
    }
  });
}
