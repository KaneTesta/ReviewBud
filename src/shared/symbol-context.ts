import type { DiffRow, SymbolContext, SymbolContextRequest } from "./types";

type CodeLineToken = { kind: "identifier" | "text"; text: string; startIndex: number };

const identifierPattern = /[$A-Z_a-z][$\w]*/g;

export function buildDiffRows(patch: string): DiffRow[] {
  let oldLine = 0;
  let newLine = 0;

  return patch.split("\n").map((text) => {
    const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { text, kind: "hunk" };
    }

    if (text.startsWith("+") && !text.startsWith("+++")) {
      return { text, kind: "added", newLine: newLine++ };
    }

    if (text.startsWith("-") && !text.startsWith("---")) {
      return { text, kind: "removed", oldLine: oldLine++ };
    }

    const row: DiffRow = { text, kind: "context", oldLine, newLine };
    oldLine += 1;
    newLine += 1;
    return row;
  });
}

export function displayDiffLine(row: DiffRow): string {
  if (row.kind === "hunk") {
    return row.text.match(/^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@\s?(.*)$/)?.[1] ?? row.text;
  }

  if (/^[ +\-]/.test(row.text)) return row.text.slice(1);
  return row.text;
}

export function tokenizeCodeLine(line: string): CodeLineToken[] {
  const tokens: CodeLineToken[] = [];
  let index = 0;

  for (const match of line.matchAll(identifierPattern)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > index) {
      tokens.push({ kind: "text", text: line.slice(index, matchIndex), startIndex: index });
    }
    tokens.push({ kind: "identifier", text: match[0], startIndex: matchIndex });
    index = matchIndex + match[0].length;
  }

  if (index < line.length) {
    tokens.push({ kind: "text", text: line.slice(index), startIndex: index });
  }

  return tokens.length > 0 ? tokens : [{ kind: "text", text: line, startIndex: 0 }];
}

type LocalSymbolContextRequest = Pick<SymbolContextRequest, "file" | "line" | "symbol">;

export function extractSymbolContext(source: string, request: LocalSymbolContextRequest): SymbolContext {
  const lines = source.split("\n");
  const targetIndex = Math.max(0, Math.min(lines.length - 1, request.line - 1));
  const boundaryStart = findBoundaryStart(lines, targetIndex, request.symbol);

  if (boundaryStart == null) {
    return buildFallbackContext(lines, request, targetIndex);
  }

  const boundaryEnd = findBoundaryEnd(lines, boundaryStart);
  return {
    file: request.file,
    symbol: request.symbol,
    title: inferTitle(lines[boundaryStart], request.symbol),
    startLine: boundaryStart + 1,
    endLine: boundaryEnd + 1,
    code: lines.slice(boundaryStart, boundaryEnd + 1).join("\n"),
  };
}

function findBoundaryStart(lines: string[], targetIndex: number, symbol: string): number | null {
  for (let index = targetIndex; index >= 0; index -= 1) {
    if (isImplementationBoundary(lines[index], symbol)) {
      return index;
    }
  }

  return null;
}

function isImplementationBoundary(line: string, symbol: string): boolean {
  const escaped = escapeRegExp(symbol);
  return [
    new RegExp(`^\\s*(async\\s+)?def\\s+${escaped}\\s*\\(`),
    new RegExp(`\\b(function|class|interface|type)\\s+${escaped}\\b`),
    new RegExp(`\\b(function|class|interface|type)\\s+[$A-Z_a-z][$\\w]*\\b`),
    new RegExp(`\\b(const|let|var)\\s+${escaped}\\b\\s*=\\s*(async\\s*)?(function\\b|\\([^)]*\\)|[$A-Z_a-z][$\\w]*)?\\s*=>`),
    new RegExp(`\\b(const|let|var)\\s+[$A-Z_a-z][$\\w]*\\s*=\\s*(async\\s*)?(\\([^)]*\\)|[$A-Z_a-z][$\\w]*)?\\s*=>`),
    /^\s*(public|private|protected)?\s*(async\s+)?[$A-Z_a-z][$\w]*\s*\([^)]*\)\s*[{:]?/,
  ].some((pattern) => pattern.test(line));
}

function findBoundaryEnd(lines: string[], startIndex: number): number {
  const pythonBoundaryEnd = findPythonBoundaryEnd(lines, startIndex);
  if (pythonBoundaryEnd != null) {
    return pythonBoundaryEnd;
  }

  let depth = 0;
  let sawBrace = false;

  for (let index = startIndex; index < lines.length; index += 1) {
    for (const char of stripLineComment(lines[index])) {
      if (char === "{") {
        depth += 1;
        sawBrace = true;
      } else if (char === "}") {
        depth -= 1;
      }
    }

    if (sawBrace && depth <= 0) {
      return index;
    }
  }

  return Math.min(lines.length - 1, startIndex + 24);
}

function findPythonBoundaryEnd(lines: string[], startIndex: number): number | null {
  if (!/^\s*(async\s+)?def\s+[$A-Z_a-z][$\w]*\s*\(/.test(lines[startIndex])) {
    return null;
  }

  const startIndent = indentationLength(lines[startIndex]);
  let endIndex = startIndex;
  let signatureComplete = lines[startIndex].trimEnd().endsWith(":");

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") {
      endIndex = index;
      continue;
    }

    if (!signatureComplete) {
      endIndex = index;
      signatureComplete = line.trimEnd().endsWith(":");
      continue;
    }

    if (indentationLength(line) <= startIndent) {
      return endIndex;
    }

    endIndex = index;
  }

  return endIndex;
}

function indentationLength(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function buildFallbackContext(lines: string[], request: LocalSymbolContextRequest, targetIndex: number): SymbolContext {
  const startIndex = Math.max(0, targetIndex - 8);
  const endIndex = Math.min(lines.length - 1, targetIndex + 8);
  return {
    file: request.file,
    symbol: request.symbol,
    title: request.symbol,
    startLine: startIndex + 1,
    endLine: endIndex + 1,
    code: lines.slice(startIndex, endIndex + 1).join("\n"),
  };
}

function inferTitle(line: string, fallback: string): string {
  const pythonDef = line.match(/^\s*(?:async\s+)?def\s+([$A-Z_a-z][$\w]*)\s*\(/);
  if (pythonDef) return pythonDef[1];

  const named = line.match(/\b(?:function|class|interface|type)\s+([$A-Z_a-z][$\w]*)\b/);
  if (named) return named[1];

  const assigned = line.match(/\b(?:const|let|var)\s+([$A-Z_a-z][$\w]*)\b/);
  if (assigned) return assigned[1];

  const method = line.match(/^\s*(?:public|private|protected)?\s*(?:async\s+)?([$A-Z_a-z][$\w]*)\s*\(/);
  return method?.[1] ?? fallback;
}

function stripLineComment(line: string): string {
  return line.replace(/\/\/.*$/, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
