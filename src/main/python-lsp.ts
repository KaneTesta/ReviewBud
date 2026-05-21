import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SymbolContext, SymbolContextRequest } from "../shared/types.js";
import { extractSymbolContext } from "../shared/symbol-context.js";

interface JsonRpcResponse<T> {
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

interface LspLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

type LspDefinitionResult = LspLocation | LspLocation[] | null;

export async function resolvePythonSymbolContextWithLsp(
  snapshotPath: string,
  request: SymbolContextRequest,
): Promise<SymbolContext | null> {
  if (path.extname(request.file) !== ".py") {
    return null;
  }

  const targetFile = path.join(snapshotPath, request.file);
  const projectRoot = findPythonProjectRoot(snapshotPath, targetFile);
  const client = new PyrightLanguageServer(projectRoot);

  try {
    await client.start();
    const targetSource = await readFile(targetFile, "utf8");
    await client.openDocument(targetFile, targetSource);
    const definition = await client.definition(targetFile, request.line - 1, positionForSymbol(targetSource, request));
    const location = await selectDefinitionLocation(definition, snapshotPath, targetFile, request.symbol);
    if (!location?.uri) {
      return null;
    }

    const definitionFile = fileURLToPath(location.uri);
    const definitionSource = await readFile(definitionFile, "utf8");
    const definitionLine = location.range.start.line + 1;

    return {
      ...extractSymbolContext(definitionSource, {
        file: relativeSourcePath(snapshotPath, definitionFile),
        line: definitionLine,
        symbol: request.symbol,
      }),
      sourceCode: definitionSource,
      source: "language-server",
    };
  } finally {
    await client.stop();
  }
}

function relativeSourcePath(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

class PyrightLanguageServer {
  private nextId = 1;
  private process: ChildProcessWithoutNullStreams | null = null;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  constructor(private readonly projectRoot: string) {}

  async start(): Promise<void> {
    const command = process.execPath;
    const langserver = path.join(
      process.cwd(),
      "node_modules",
      "pyright",
      "langserver.index.js",
    );
    this.process = spawn(command, [langserver, "--stdio"], {
      cwd: this.projectRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout.on("data", (chunk: Buffer) => this.receive(chunk));
    this.process.stderr.on("data", () => {
      // Pyright may emit progress/logging on stderr; request failures are reported through JSON-RPC.
    });
    this.process.on("exit", () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error("Pyright language server exited before responding."));
      }
      this.pending.clear();
    });

    await this.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(this.projectRoot).toString(),
      capabilities: {
        textDocument: {
          definition: {
            dynamicRegistration: false,
          },
        },
      },
      workspaceFolders: [{
        uri: pathToFileURL(this.projectRoot).toString(),
        name: path.basename(this.projectRoot),
      }],
    });
    this.notify("initialized", {});
  }

  async openDocument(filePath: string, source?: string): Promise<void> {
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri: pathToFileURL(filePath).toString(),
        languageId: "python",
        version: 1,
        text: source ?? await readFile(filePath, "utf8"),
      },
    });
  }

  async definition(filePath: string, line: number, character: number): Promise<LspDefinitionResult> {
    return this.request<LspDefinitionResult>("textDocument/definition", {
      textDocument: {
        uri: pathToFileURL(filePath).toString(),
      },
      position: {
        line,
        character,
      },
    });
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    try {
      await this.request("shutdown", null);
      this.notify("exit", {});
    } catch {
      this.process.kill();
    } finally {
      this.process = null;
    }
  }

  private request<T>(method: string, params: unknown): Promise<T> {
    if (!this.process) {
      return Promise.reject(new Error("Pyright language server is not running."));
    }

    const id = this.nextId;
    this.nextId += 1;
    this.send({ jsonrpc: "2.0", id, method, params });

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for Pyright response to ${method}.`));
      }, 15000);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  private notify(method: string, params: unknown): void {
    if (!this.process) return;
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(message: unknown): void {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    this.process?.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.process?.stdin.write(body);
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;

      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]);
      if (!Number.isFinite(length)) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + length;
      if (this.buffer.length < messageEnd) return;

      const rawMessage = this.buffer.slice(messageStart, messageEnd).toString("utf8");
      this.buffer = this.buffer.slice(messageEnd);
      this.handleMessage(JSON.parse(rawMessage) as JsonRpcResponse<unknown>);
    }
  }

  private handleMessage(message: JsonRpcResponse<unknown>): void {
    if (typeof message.id !== "number") return;

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message));
    } else {
      pending.resolve(message.result);
    }
  }
}

function findPythonProjectRoot(snapshotPath: string, targetFile: string): string {
  let directory = path.dirname(targetFile);

  while (directory.startsWith(snapshotPath)) {
    if (existsSync(path.join(directory, "pyrightconfig.json")) || existsSync(path.join(directory, "pyproject.toml"))) {
      return directory;
    }

    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return snapshotPath;
}

function positionForSymbol(source: string, request: Pick<SymbolContextRequest, "line" | "column" | "symbol">): number {
  const fallback = Math.max(0, (request.column ?? 1) - 1);
  const line = source.split("\n")[request.line - 1];
  if (!line || !request.symbol) {
    return fallback;
  }

  const matches = [...line.matchAll(new RegExp(`\\b${escapeRegExp(request.symbol)}\\b`, "g"))];
  if (matches.length === 0) {
    return fallback;
  }

  const requestedIndex = request.column == null ? fallback : Math.max(0, request.column - 1);
  const closest = matches.reduce((best, match) => {
    const index = match.index ?? 0;
    const distance = distanceToRange(requestedIndex, index, index + request.symbol.length);
    return distance < best.distance ? { index, distance } : best;
  }, { index: matches[0].index ?? 0, distance: Number.POSITIVE_INFINITY });

  return closest.index;
}

function distanceToRange(index: number, start: number, end: number): number {
  if (index < start) return start - index;
  if (index > end) return index - end;
  return 0;
}

async function selectDefinitionLocation(
  definition: LspDefinitionResult,
  snapshotPath: string,
  targetFile: string,
  symbol: string,
): Promise<LspLocation | null> {
  const locations = Array.isArray(definition) ? definition : definition ? [definition] : [];
  if (locations.length <= 1) {
    return locations[0] ?? null;
  }

  const sameFileLocations: LspLocation[] = [];
  for (const location of locations) {
    if (!location.uri) continue;

    const definitionFile = fileURLToPath(location.uri);
    if (definitionFile === targetFile) {
      sameFileLocations.push(location);
    }

    const definitionSource = await readFile(definitionFile, "utf8");
    const context = extractSymbolContext(definitionSource, {
      file: path.relative(snapshotPath, definitionFile),
      line: location.range.start.line + 1,
      symbol,
    });
    if (context.title === symbol) {
      return location;
    }
  }

  return locations.find((location) => fileURLToPath(location.uri) !== targetFile) ?? sameFileLocations[0] ?? locations[0] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
