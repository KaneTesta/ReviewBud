import { contextBridge, ipcRenderer } from "electron";
import type {
  DraftReviewComment,
  DraftReviewSubmission,
  ReviewNote,
  ReviewWorkspace,
  SymbolContext,
  SymbolContextRequest,
} from "../shared/types.js";

export interface PrToolApi {
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
}

const api: PrToolApi = {
  loadPullRequest: (url) => ipcRenderer.invoke("pr:load", url) as Promise<ReviewWorkspace>,
  saveReviewState: (id, state) => ipcRenderer.invoke("pr:saveReviewState", id, state) as Promise<ReviewWorkspace>,
  loadSymbolContext: (request) => ipcRenderer.invoke("pr:symbolContext", request) as Promise<SymbolContext>,
};

contextBridge.exposeInMainWorld("prTool", api);
