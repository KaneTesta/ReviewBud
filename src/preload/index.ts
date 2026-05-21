import { contextBridge, ipcRenderer } from "electron";
import type {
  RecentPullRequest,
  ReviewWorkspace,
  SymbolContext,
  SymbolContextRequest,
} from "../shared/types.js";

export interface PrToolApi {
  loadPullRequest: (url: string) => Promise<ReviewWorkspace>;
  listRecent: () => Promise<RecentPullRequest[]>;
  openCached: (id: string) => Promise<ReviewWorkspace>;
  loadSymbolContext: (request: SymbolContextRequest) => Promise<SymbolContext>;
}

const api: PrToolApi = {
  loadPullRequest: (url) => ipcRenderer.invoke("pr:load", url) as Promise<ReviewWorkspace>,
  listRecent: () => ipcRenderer.invoke("pr:listRecent") as Promise<RecentPullRequest[]>,
  openCached: (id) => ipcRenderer.invoke("pr:openCached", id) as Promise<ReviewWorkspace>,
  loadSymbolContext: (request) => ipcRenderer.invoke("pr:symbolContext", request) as Promise<SymbolContext>,
};

contextBridge.exposeInMainWorld("prTool", api);
