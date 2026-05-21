import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { SymbolContext, SymbolContextRequest } from "../shared/types.js";
import { extractSymbolContext } from "../shared/symbol-context.js";

const supportedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const ignoredDirectories = new Set([".git", "node_modules", "dist", "dist-renderer", "build", "coverage"]);

export async function resolveTypeScriptSymbolContext(
  snapshotPath: string,
  request: SymbolContextRequest,
): Promise<SymbolContext | null> {
  if (!supportedExtensions.has(path.extname(request.file))) {
    return null;
  }

  const targetFile = path.join(snapshotPath, request.file);
  const targetSource = await readFile(targetFile, "utf8");
  const position = positionForSymbol(targetSource, request);
  if (position == null) {
    return null;
  }

  const rootFiles = await collectSourceFiles(snapshotPath);
  if (!rootFiles.includes(targetFile)) {
    rootFiles.push(targetFile);
  }

  const service = ts.createLanguageService(createLanguageServiceHost(rootFiles));
  const definitions = service.getDefinitionAtPosition(targetFile, position) ?? [];
  const definition = definitions.find((item) => item.fileName && item.textSpan);
  if (!definition) {
    return null;
  }

  const definitionSource = await readFile(definition.fileName, "utf8");
  const line = lineForPosition(definitionSource, definition.textSpan.start);
  const file = path.relative(snapshotPath, definition.fileName);

  return {
    ...extractSymbolContext(definitionSource, {
      file,
      line,
      symbol: request.symbol,
    }),
    sourceCode: definitionSource,
    source: "language-service",
  };
}

function createLanguageServiceHost(rootFiles: string[]): ts.LanguageServiceHost {
  const versions = new Map(rootFiles.map((fileName) => [fileName, "0"]));
  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
  };

  return {
    getCompilationSettings: () => compilerOptions,
    getCurrentDirectory: () => process.cwd(),
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    getScriptFileNames: () => rootFiles,
    getScriptSnapshot: (fileName) => {
      if (!ts.sys.fileExists(fileName)) return undefined;
      return ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName) ?? "");
    },
    getScriptVersion: (fileName) => versions.get(fileName) ?? "0",
    fileExists: ts.sys.fileExists,
    readDirectory: ts.sys.readDirectory,
    readFile: ts.sys.readFile,
  };
}

async function collectSourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await collectSourceFilesInto(root, files);
  return files;
}

async function collectSourceFilesInto(directory: string, files: string[]): Promise<void> {
  if (files.length > 5000) return;

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        await collectSourceFilesInto(path.join(directory, entry.name), files);
      }
    } else if (supportedExtensions.has(path.extname(entry.name))) {
      files.push(path.join(directory, entry.name));
    }
  }
}

function positionForSymbol(source: string, request: Pick<SymbolContextRequest, "line" | "column" | "symbol">): number | null {
  const lines = source.split("\n");
  const lineText = lines[request.line - 1];
  if (lineText == null) return null;

  const requestedIndex = request.column == null ? null : Math.max(0, request.column - 1);
  const symbolIndex = requestedIndex != null && lineText.slice(requestedIndex, requestedIndex + request.symbol.length) === request.symbol
    ? requestedIndex
    : lineText.indexOf(request.symbol);
  if (symbolIndex < 0) return null;

  return lines.slice(0, request.line - 1).reduce((sum, item) => sum + item.length + 1, 0) + symbolIndex;
}

function lineForPosition(source: string, position: number): number {
  return source.slice(0, position).split("\n").length;
}
