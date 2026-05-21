import { contextBridge, ipcRenderer } from "electron";
import type {
  DraftReviewComment,
  DraftReviewSubmission,
  PullRequestListItem,
  RepositorySummary,
  ReviewNote,
  ReviewWorkspace,
  SymbolContext,
  SymbolContextRequest,
} from "../shared/types.js";

export interface PrToolApi {
  setTheme: (theme: "dark" | "light") => Promise<void>;
  listRepositories: () => Promise<RepositorySummary[]>;
  searchRepositories: (query: string, owner: string) => Promise<RepositorySummary[]>;
  listPullRequests: (owner: string, repo: string) => Promise<PullRequestListItem[]>;
  loadPullRequest: (url: string) => Promise<ReviewWorkspace>;
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
}

const api: PrToolApi = {
  setTheme: (theme) => ipcRenderer.invoke("app:setTheme", theme) as Promise<void>,
  listRepositories: () => ipcRenderer.invoke("repos:list") as Promise<RepositorySummary[]>,
  searchRepositories: (query, owner) => ipcRenderer.invoke("repos:search", query, owner) as Promise<RepositorySummary[]>,
  listPullRequests: (owner, repo) => ipcRenderer.invoke("prs:list", owner, repo) as Promise<PullRequestListItem[]>,
  loadPullRequest: (url) => ipcRenderer.invoke("pr:load", url) as Promise<ReviewWorkspace>,
  saveReviewState: (id, state) => ipcRenderer.invoke("pr:saveReviewState", id, state) as Promise<ReviewWorkspace>,
  loadSymbolContext: (request) => ipcRenderer.invoke("pr:symbolContext", request) as Promise<SymbolContext>,
  loadFileSource: (request) => ipcRenderer.invoke("pr:fileSource", request) as Promise<string>,
};

contextBridge.exposeInMainWorld("prTool", api);
