import { contextBridge, ipcRenderer } from "electron";
import type {
  ReviewWorkspace,
  SymbolContext,
  SymbolContextRequest,
} from "../shared/types.js";

export interface PrToolApi {
  loadPullRequest: (url: string) => Promise<ReviewWorkspace>;
  loadSymbolContext: (request: SymbolContextRequest) => Promise<SymbolContext>;
}

const api: PrToolApi = {
  loadPullRequest: (url) => ipcRenderer.invoke("pr:load", url) as Promise<ReviewWorkspace>,
  loadSymbolContext: (request) => ipcRenderer.invoke("pr:symbolContext", request) as Promise<SymbolContext>,
};

contextBridge.exposeInMainWorld("prTool", api);
