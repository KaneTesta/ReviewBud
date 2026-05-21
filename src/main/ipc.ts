import { app, ipcMain } from "electron";
import { fetchPullRequest, fetchSymbolContext } from "./github.js";
import { ReviewStorage } from "./storage.js";
import { parsePullRequestUrl } from "../shared/pr-url.js";
import type { DraftReviewComment, DraftReviewSubmission, ReviewNote, SymbolContextRequest } from "../shared/types.js";

export function registerIpcHandlers(): void {
  const storage = new ReviewStorage(app.getPath("userData"));

  ipcMain.handle("pr:load", async (_event, url: string) => {
    const ref = parsePullRequestUrl(url);
    const pullRequest = await fetchPullRequest(ref);
    return storage.savePullRequest(pullRequest);
  });

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
}
