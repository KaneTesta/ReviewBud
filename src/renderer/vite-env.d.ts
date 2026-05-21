/// <reference types="vite/client" />

import type { PrToolApi } from "../preload";

declare global {
  interface Window {
    prTool: PrToolApi;
  }
}
