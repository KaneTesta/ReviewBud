import { contextBridge, ipcRenderer } from "electron";
import type {
  RecentPullRequest,
  ReviewNote,
  ReviewWorkspace,
  SymbolContext,
  SymbolContextRequest,
} from "../shared/types.js";

export interface PrToolApi {
  loadPullRequest: (url: string) => Promise<ReviewWorkspace>;
  listRecent: () => Promise<RecentPullRequest[]>;
  openCached: (id: string) => Promise<ReviewWorkspace>;
  saveNotes: (id: string, notes: ReviewNote[]) => Promise<ReviewNote[]>;
  loadSymbolContext: (request: SymbolContextRequest) => Promise<SymbolContext>;
}

const api: PrToolApi = {
  loadPullRequest: (url) => ipcRenderer.invoke("pr:load", url) as Promise<ReviewWorkspace>,
  listRecent: () => ipcRenderer.invoke("pr:listRecent") as Promise<RecentPullRequest[]>,
  openCached: (id) => ipcRenderer.invoke("pr:openCached", id) as Promise<ReviewWorkspace>,
  saveNotes: (id, notes) => ipcRenderer.invoke("pr:saveNotes", id, notes) as Promise<ReviewNote[]>,
  loadSymbolContext: (request) => ipcRenderer.invoke("pr:symbolContext", request) as Promise<SymbolContext>,
};

contextBridge.exposeInMainWorld("prTool", api);
