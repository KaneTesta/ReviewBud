import { readFile } from "node:fs/promises";
import {
  buildSnippetExplanationPrompt,
  extractNearbySource,
} from "../shared/snippet-explanation.js";
import {
  ensureSourceSnapshot,
  resolveSourceSnapshotFile,
} from "./source-snapshot.js";
import type {
  SnippetExplanation,
  SnippetExplanationRequest,
} from "../shared/types.js";

type CodexSdk = typeof import("@openai/codex-sdk");

let codexSdkPromise: Promise<CodexSdk> | null = null;

export async function explainSnippetWithCodex(
  request: SnippetExplanationRequest,
  userDataPath: string,
): Promise<SnippetExplanation> {
  try {
    const workingDirectory = await ensureSourceSnapshot({
      userDataPath,
      repositoryFullName: request.headRepoFullName,
      headSha: request.headSha,
    });
    const source = await readFile(
      resolveSourceSnapshotFile(workingDirectory, request.file),
      "utf8",
    );
    const nearbySource = extractNearbySource(
      source,
      request.startLine,
      request.endLine,
    );
    const { Codex } = await loadCodexSdk();
    const codex = new Codex({
      config: {
        history: { persistence: "none" },
        project_root_markers: [],
      },
    });
    const thread = codex.startThread({
      approvalPolicy: "never",
      networkAccessEnabled: false,
      sandboxMode: "read-only",
      skipGitRepoCheck: true,
      webSearchMode: "disabled",
      workingDirectory,
    });
    const result = await thread.run(
      buildSnippetExplanationPrompt(request, nearbySource),
    );
    const markdown = result.finalResponse.trim();
    if (!markdown) {
      throw new Error("Codex returned an empty explanation");
    }

    return {
      file: request.file,
      startLine: Math.min(request.startLine, request.endLine),
      endLine: Math.max(request.startLine, request.endLine),
      code: request.code,
      markdown,
    };
  } catch (error) {
    throw new Error(normalizeCodexExplanationError(error));
  }
}

export function normalizeCodexExplanationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|unauthori[sz]ed|authentication|login required|not logged in|signed out/i.test(message)) {
    return "Codex is signed out. Run `codex login`, choose Sign in with ChatGPT, then try again.";
  }
  if (/unable to locate codex cli|unsupported platform|enoent/i.test(message)) {
    return "The local Codex runtime is unavailable. Reinstall ReviewBud or Codex, then try again.";
  }
  return `Codex could not explain this snippet: ${message}`;
}

function loadCodexSdk(): Promise<CodexSdk> {
  if (!codexSdkPromise) {
    const importEsm = new Function(
      "specifier",
      "return import(specifier)",
    ) as (specifier: string) => Promise<CodexSdk>;
    codexSdkPromise = importEsm("@openai/codex-sdk");
  }
  return codexSdkPromise;
}
