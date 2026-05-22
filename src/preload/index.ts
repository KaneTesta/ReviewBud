import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type {
  DraftReviewComment,
  DraftReviewSubmission,
  PullRequestDiscussionReplyRequest,
  PullRequestListItem,
  RepositorySummary,
  ReviewNote,
  ReviewWorkspace,
  SymbolContext,
  SymbolContextRequest,
} from "../shared/types.js";

export interface PrToolApi {
  setTheme: (theme: "dark" | "light") => Promise<void>;
  markReadyForReviewPullRequestLinks: () => Promise<string[]>;
  listRepositories: () => Promise<RepositorySummary[]>;
  searchRepositories: (query: string, owner: string) => Promise<RepositorySummary[]>;
  setRepositoryStar: (fullName: string, isStarred: boolean) => Promise<string[]>;
  listPullRequests: (owner: string, repo: string) => Promise<PullRequestListItem[]>;
  loadPullRequest: (url: string) => Promise<ReviewWorkspace>;
  onReviewPullRequestLink: (handler: (url: string) => void) => () => void;
  saveReviewState: (
    id: string,
    state: {
      notes: ReviewNote[];
      draftComments: DraftReviewComment[];
      draftReview: DraftReviewSubmission | null;
    },
  ) => Promise<ReviewWorkspace>;
  loadSymbolContext: (request: SymbolContextRequest) => Promise<SymbolContext>;
  loadFileSource: (request: SymbolContextRequest) => Promise<string>;
  replyToDiscussion: (request: PullRequestDiscussionReplyRequest) => Promise<ReviewWorkspace>;
}

const api: PrToolApi = {
  setTheme: (theme) => ipcRenderer.invoke("app:setTheme", theme) as Promise<void>,
  markReadyForReviewPullRequestLinks: () =>
    ipcRenderer.invoke("app:rendererReadyForReviewLinks") as Promise<string[]>,
  listRepositories: () => ipcRenderer.invoke("repos:list") as Promise<RepositorySummary[]>,
  searchRepositories: (query, owner) => ipcRenderer.invoke("repos:search", query, owner) as Promise<RepositorySummary[]>,
  setRepositoryStar: (fullName, isStarred) => ipcRenderer.invoke("repos:setStar", fullName, isStarred) as Promise<string[]>,
  listPullRequests: (owner, repo) => ipcRenderer.invoke("prs:list", owner, repo) as Promise<PullRequestListItem[]>,
  loadPullRequest: (url) => ipcRenderer.invoke("pr:load", url) as Promise<ReviewWorkspace>,
  onReviewPullRequestLink: (handler) => {
    const listener = (_event: IpcRendererEvent, url: string) => {
      handler(url);
    };
    ipcRenderer.on("pr:reviewLink", listener);
    return () => {
      ipcRenderer.removeListener("pr:reviewLink", listener);
    };
  },
  saveReviewState: (id, state) => ipcRenderer.invoke("pr:saveReviewState", id, state) as Promise<ReviewWorkspace>,
  loadSymbolContext: (request) => ipcRenderer.invoke("pr:symbolContext", request) as Promise<SymbolContext>,
  loadFileSource: (request) => ipcRenderer.invoke("pr:fileSource", request) as Promise<string>,
  replyToDiscussion: (request) => ipcRenderer.invoke("pr:replyDiscussion", request) as Promise<ReviewWorkspace>,
};

contextBridge.exposeInMainWorld("prTool", api);
