import { useEffect, useMemo, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import { createRoot, type Root } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  FileCode2,
  GitPullRequest,
  HelpCircle,
  Loader2,
  Moon,
  MessageSquareText,
  RefreshCw,
  Search,
  Sun,
  X,
} from "lucide-react";
import type {
  PullRequestDiscussion,
  PullRequestFile,
  RecentPullRequest,
  ReviewNote,
  ReviewWorkspace,
  SymbolContext,
  DiffRow,
} from "../../shared/types";
import {
  discussionAffectsDiffPosition,
  discussionStateLabels,
  discussionsForFile,
  shouldCollapseDiscussion,
} from "../../shared/discussions";
import { buildDiffRows, tokenizeCodeLine } from "../../shared/symbol-context";

const defaultUrl = "";
const themeStorageKey = "pr-tool-theme";
const monacoThemes = {
  dark: "pr-tool-dark",
  light: "pr-tool-light",
} as const;
const nonClickableSymbols = new Set([
  "False",
  "None",
  "True",
  "and",
  "as",
  "async",
  "await",
  "class",
  "const",
  "def",
  "else",
  "except",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "interface",
  "let",
  "new",
  "null",
  "or",
  "return",
  "self",
  "this",
  "true",
  "try",
  "type",
  "undefined",
  "var",
  "with",
]);
let monacoThemeDefined = false;
type ThemeMode = keyof typeof monacoThemes;
type MonacoApi = typeof import("monaco-editor/esm/vs/editor/editor.api.js");

function loadMonaco(): Promise<MonacoApi> {
  return Promise.all([
    import("monaco-editor/esm/vs/editor/editor.api.js"),
    import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js"),
    import("monaco-editor/esm/vs/basic-languages/python/python.contribution.js"),
    import("monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js"),
    import("monaco-editor/min/vs/editor/editor.main.css"),
  ]).then(([monaco]) => monaco);
}

export function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => initialTheme());
  const [url, setUrl] = useState(defaultUrl);
  const [workspace, setWorkspace] = useState<ReviewWorkspace | null>(null);
  const [recent, setRecent] = useState<RecentPullRequest[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [symbolContexts, setSymbolContexts] = useState<SymbolContext[]>([]);
  const [symbolState, setSymbolState] = useState<"idle" | "loading" | "error">("idle");
  const [symbolError, setSymbolError] = useState<string | null>(null);

  useEffect(() => {
    void refreshRecent();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  const currentFile = useMemo(() => {
    if (!workspace) return null;
    return workspace.pullRequest.files.find((file) => file.filename === selectedFile) ?? workspace.pullRequest.files[0] ?? null;
  }, [selectedFile, workspace]);

  const filteredFiles = useMemo(() => {
    if (!workspace) return [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return workspace.pullRequest.files;
    return workspace.pullRequest.files.filter((file) => file.filename.toLowerCase().includes(needle));
  }, [filter, workspace]);

  const showSymbolSplit = symbolState === "loading" || symbolState === "error" || symbolContexts.length > 0;
  const nextTheme = theme === "dark" ? "light" : "dark";

  function closeSymbolContext() {
    setSymbolContexts([]);
    setSymbolState("idle");
    setSymbolError(null);
  }

  function closeSymbolContextAt(index: number) {
    setSymbolContexts((current) => current.filter((_, contextIndex) => contextIndex !== index));
    setSymbolError(null);
    if (symbolState === "error") {
      setSymbolState("idle");
    }
  }

  async function refreshRecent() {
    setRecent(await window.prTool.listRecent());
  }

  async function loadPullRequest(nextUrl = url) {
    setIsLoading(true);
    setError(null);

    try {
      const nextWorkspace = await window.prTool.loadPullRequest(nextUrl);
      setWorkspace(nextWorkspace);
      setSelectedFile(nextWorkspace.pullRequest.files[0]?.filename ?? null);
      setSymbolContexts([]);
      setSymbolState("idle");
      setSymbolError(null);
      setUrl(nextWorkspace.pullRequest.summary.url);
      await refreshRecent();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }

  async function openCached(id: string) {
    setIsLoading(true);
    setError(null);

    try {
      const nextWorkspace = await window.prTool.openCached(id);
      setWorkspace(nextWorkspace);
      setSelectedFile(nextWorkspace.pullRequest.files[0]?.filename ?? null);
      setSymbolContexts([]);
      setSymbolState("idle");
      setSymbolError(null);
      setUrl(nextWorkspace.pullRequest.summary.url);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }

  async function openSymbolContext(file: string, line: number, column: number, symbol: string, append = false) {
    if (!workspace) return;
    const { summary } = workspace.pullRequest;
    setSymbolState("loading");
    setSymbolError(null);
    if (!append) {
      setSymbolContexts([]);
    }

    try {
      const nextContext = await window.prTool.loadSymbolContext({
        owner: summary.owner,
        repo: summary.repo,
        number: summary.number,
        file,
        line,
        column,
        symbol,
        headRepoFullName: summary.headRepoFullName,
        headSha: summary.headSha,
      });
      setSymbolContexts((current) => (append ? [...current, nextContext] : [nextContext]));
      setSymbolState("idle");
    } catch (contextError) {
      setSymbolState("error");
      setSymbolError(contextError instanceof Error ? contextError.message : String(contextError));
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <GitPullRequest size={22} aria-hidden="true" />
          <div>
            <h1>PR Tool</h1>
            <p>Read GitHub pull requests locally without branch switching.</p>
          </div>
        </div>
        <form
          className="url-form"
          onSubmit={(event) => {
            event.preventDefault();
            void loadPullRequest();
          }}
        >
          <input
            aria-label="GitHub pull request URL"
            placeholder="https://github.com/owner/repo/pull/123"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <button type="submit" disabled={isLoading}>
            {isLoading ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
            Load
          </button>
        </form>
        <button
          type="button"
          className="theme-toggle"
          role="switch"
          aria-checked={theme === "dark"}
          aria-label={`Switch to ${nextTheme} mode`}
          title={`Switch to ${nextTheme} mode`}
          onClick={() => setTheme(nextTheme)}
        >
          {theme === "dark" ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
          <span>{theme === "dark" ? "Dark" : "Light"}</span>
        </button>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="workspace">
        <aside className="sidebar">
          <RecentList recent={recent} onOpen={openCached} activeId={workspace?.pullRequest.summary.id ?? null} />
          {workspace ? (
            <FileNavigator
              files={filteredFiles}
              allFiles={workspace.pullRequest.files}
              notes={workspace.notes}
              filter={filter}
              selectedFile={currentFile?.filename ?? null}
              onFilter={setFilter}
              onSelect={setSelectedFile}
            />
          ) : (
            <EmptyPanel />
          )}
        </aside>

        <section className="review-surface">
          {workspace && currentFile ? (
            <>
              <PullRequestHeader workspace={workspace} />
              <div className={showSymbolSplit ? "review-columns split" : "review-columns"}>
                <DiffViewer file={currentFile} discussions={workspace.pullRequest.discussions} theme={theme} onOpenSymbol={openSymbolContext} />
                {showSymbolSplit ? (
                  <SymbolContextPanel
                    contexts={symbolContexts}
                    state={symbolState}
                    error={symbolError}
                    theme={theme}
                    onClose={closeSymbolContext}
                    onCloseContext={closeSymbolContextAt}
                    onOpenSymbol={(file, line, column, symbol) => openSymbolContext(file, line, column, symbol, true)}
                  />
                ) : null}
              </div>
            </>
          ) : (
            <Welcome />
          )}
        </section>
      </section>
    </main>
  );
}

function initialTheme(): ThemeMode {
  const savedTheme = window.localStorage.getItem(themeStorageKey);
  if (savedTheme === "dark" || savedTheme === "light") return savedTheme;
  return "light";
}

function RecentList({
  recent,
  activeId,
  onOpen,
}: {
  recent: RecentPullRequest[];
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="panel recent">
      <div className="panel-heading">
        <h2>Recent</h2>
      </div>
      {recent.length === 0 ? (
        <p className="muted">No cached pull requests yet.</p>
      ) : (
        <div className="recent-list">
          {recent.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === activeId ? "recent-item active" : "recent-item"}
              onClick={() => onOpen(item.id)}
            >
              <span>{item.owner}/{item.repo}#{item.number}</span>
              <strong>{item.title}</strong>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function FileNavigator({
  files,
  allFiles,
  notes,
  filter,
  selectedFile,
  onFilter,
  onSelect,
}: {
  files: PullRequestFile[];
  allFiles: PullRequestFile[];
  notes: ReviewNote[];
  filter: string;
  selectedFile: string | null;
  onFilter: (value: string) => void;
  onSelect: (file: string) => void;
}) {
  const doneCount = notes.filter((note) => note.status === "done").length;

  return (
    <section className="panel file-panel">
      <div className="panel-heading split">
        <h2>Files</h2>
        <span>{doneCount}/{allFiles.length}</span>
      </div>
      <label className="search-box">
        <Search size={15} aria-hidden="true" />
        <input aria-label="Filter changed files" value={filter} onChange={(event) => onFilter(event.target.value)} placeholder="Filter files" />
      </label>
      <div className="file-list">
        {files.map((file) => {
          const note = notes.find((item) => item.file === file.filename);
          return (
            <button
              key={file.filename}
              type="button"
              className={file.filename === selectedFile ? "file-row active" : "file-row"}
              onClick={() => onSelect(file.filename)}
            >
              {note?.status === "done" ? <CheckCircle2 size={15} aria-hidden="true" /> : <Circle size={15} aria-hidden="true" />}
              <span className="file-name">{file.filename}</span>
              <span className="change-count">+{file.additions} -{file.deletions}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PullRequestHeader({ workspace }: { workspace: ReviewWorkspace }) {
  const { summary } = workspace.pullRequest;
  return (
    <section className="pr-header">
      <div>
        <div className="eyebrow">{summary.owner}/{summary.repo}#{summary.number}</div>
        <h2>{summary.title}</h2>
        <p>
          {summary.author} wants to merge <strong>{summary.headRef}</strong> into <strong>{summary.baseRef}</strong>
        </p>
      </div>
      <div className="stats">
        <span>{summary.changedFiles} files</span>
        <span className="plus">+{summary.additions}</span>
        <span className="minus">-{summary.deletions}</span>
        {summary.reviewDecision ? <span>{summary.reviewDecision}</span> : null}
        <a href={summary.url} target="_blank" rel="noreferrer" aria-label="Open pull request on GitHub">
          <ExternalLink size={16} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}

function DiffViewer({
  file,
  discussions,
  theme,
  onOpenSymbol,
}: {
  file: PullRequestFile;
  discussions: PullRequestDiscussion[];
  theme: ThemeMode;
  onOpenSymbol: (file: string, line: number, column: number, symbol: string) => void;
}) {
  const rows = useMemo(() => buildDiffRows(file.patch || "Diff omitted by GitHub API for this file."), [file.patch]);
  const fileDiscussions = useMemo(() => discussionsForFile(discussions, file.filename), [discussions, file.filename]);
  const topDiscussions = useMemo(() => fileDiscussions.filter((discussion) => !discussion.position), [fileDiscussions]);
  const lineDiscussions = useMemo(() => fileDiscussions.filter((discussion) => discussion.position), [fileDiscussions]);

  return (
    <section className="diff-panel">
      <div className="diff-heading">
        <FileCode2 size={18} aria-hidden="true" />
        <div>
          <h3>{file.filename}</h3>
          <p>{file.status} · {file.changes} changes</p>
        </div>
      </div>
      <div className="diff" role="region" aria-label={`Diff for ${file.filename}`}>
        {topDiscussions.length > 0 ? <InlineDiscussions discussions={topDiscussions} /> : null}
        <DiffCodeEditor file={file} rows={rows} discussions={lineDiscussions} theme={theme} onOpenSymbol={onOpenSymbol} />
      </div>
    </section>
  );
}

function DiffCodeEditor({
  file,
  rows,
  discussions,
  theme,
  onOpenSymbol,
}: {
  file: PullRequestFile;
  rows: DiffRow[];
  discussions: PullRequestDiscussion[];
  theme: ThemeMode;
  onOpenSymbol: (file: string, line: number, column: number, symbol: string) => void;
}) {
  const editorElementRef = useRef<HTMLDivElement | null>(null);
  const onOpenSymbolRef = useRef(onOpenSymbol);
  const editorModel = useMemo(() => buildDiffEditorModel(rows), [rows]);
  const discussionGroups = useMemo(() => discussionsByPosition(discussions, rows.length), [discussions, rows.length]);
  const discussionZoneHeight = discussionGroups.reduce((total, group) => total + discussionGroupHeight(group.discussions), 0);
  const editorHeight = Math.max(240, editorModel.lines.length * 18 + discussionZoneHeight + 16);

  useEffect(() => {
    onOpenSymbolRef.current = onOpenSymbol;
  }, [onOpenSymbol]);

  useEffect(() => {
    const editorElement = editorElementRef.current;
    if (!editorElement) return;
    let disposed = false;
    let cleanup = () => {};

    void (async () => {
      const monaco = await loadMonaco();
      if (disposed) return;

      defineMonacoTheme(monaco);

      const model = monaco.editor.createModel(editorModel.source, languageForFile(file.filename));
      const editor = monaco.editor.create(editorElement, {
        model,
        readOnly: true,
        domReadOnly: true,
        automaticLayout: true,
        theme: monacoThemes[theme],
        fontFamily: "var(--mono)",
        fontSize: 12,
        lineHeight: 18,
        minimap: { enabled: false },
        folding: true,
        showFoldingControls: "always",
        scrollbar: {
          alwaysConsumeMouseWheel: false,
          horizontalScrollbarSize: 10,
          verticalScrollbarSize: 10,
        },
        overviewRulerLanes: 0,
        renderLineHighlight: "none",
        scrollBeyondLastLine: false,
        stickyScroll: { enabled: false },
        wordWrap: "off",
        lineNumbers: (lineNumber: number) => editorModel.lineNumbers[lineNumber - 1] ?? "",
        padding: { top: 8, bottom: 8 },
      });
      const diffDecorations = editor.createDecorationsCollection(
        diffDecorationsForRows(monaco, editorModel.rows, discussions),
      );
      const discussionZoneRoots = applyDiffDiscussionZones(editor, discussionGroups);

      const clickDisposable = editor.onMouseDown((event: Monaco.editor.IEditorMouseEvent) => {
        if (!event.event.metaKey && !event.event.ctrlKey) return;
        const position = event.target.position;
        if (!position) return;
        const row = editorModel.rows[position.lineNumber - 1];
        if (!row?.newLine) return;
        const word = model.getWordAtPosition(position);
        if (!word) return;
        const line = displayDiffLine(row);
        if (!isClickableSymbol(line, word.word, word.startColumn - 1)) return;
        event.event.preventDefault();
        onOpenSymbolRef.current(file.filename, row.newLine, position.column, word.word);
      });

      cleanup = () => {
        clickDisposable.dispose();
        diffDecorations.clear();
        discussionZoneRoots.forEach((root) => root.unmount());
        editor.dispose();
        model.dispose();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [discussionGroups, discussions, editorModel, file.filename, theme]);

  return (
    <div
      ref={editorElementRef}
      className="diff-editor"
      style={{ height: `${editorHeight}px` }}
      aria-label={`${file.filename} diff`}
    />
  );
}

function SymbolContextPanel({
  contexts,
  state,
  error,
  theme,
  onClose,
  onCloseContext,
  onOpenSymbol,
}: {
  contexts: SymbolContext[];
  state: "idle" | "loading" | "error";
  error: string | null;
  theme: ThemeMode;
  onClose: () => void;
  onCloseContext: (index: number) => void;
  onOpenSymbol: (file: string, line: number, column: number, symbol: string) => void;
}) {
  const latestContext = contexts.at(-1) ?? null;

  return (
    <section className="panel symbol-context">
      <div className="panel-heading split">
        <h2>Context</h2>
        <div className="heading-actions">
          <span>
            {state === "loading"
              ? "Loading"
              : latestContext
                ? latestContext.source === "language-service" || latestContext.source === "language-server"
                  ? "Definition"
                  : `${latestContext.startLine}-${latestContext.endLine}`
                : "Cmd-click"}
          </span>
          <button type="button" className="icon-button" aria-label="Close context pane" title="Close context pane" onClick={onClose}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      {state === "error" ? <p className="context-error">{error ?? "Could not load symbol context."}</p> : null}
      {contexts.length > 0 ? (
        <div className="context-stack">
          {contexts.map((context, contextIndex) => (
            <article className="context-entry" key={`${context.file}-${context.startLine}-${context.symbol}-${contextIndex}`}>
              <div className="context-entry-heading">
                <div className="context-title">
                  <strong>{context.title}</strong>
                  <span>{context.file} · lines {context.startLine}-{context.endLine}</span>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Close ${context.title} context`}
                  title={`Close ${context.title} context`}
                  onClick={() => onCloseContext(contextIndex)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              <ContextCodeEditor context={context} theme={theme} onOpenSymbol={onOpenSymbol} />
            </article>
          ))}
        </div>
      ) : state !== "error" ? (
        <p className="muted">Cmd-click an identifier in the diff to inspect its implementation here.</p>
      ) : null}
    </section>
  );
}

function ContextCodeEditor({
  context,
  theme,
  onOpenSymbol,
}: {
  context: SymbolContext;
  theme: ThemeMode;
  onOpenSymbol: (file: string, line: number, column: number, symbol: string) => void;
}) {
  const editorElementRef = useRef<HTMLDivElement | null>(null);
  const onOpenSymbolRef = useRef(onOpenSymbol);
  const editorCode = context.sourceCode ?? context.code;
  const isFullFileContext = Boolean(context.sourceCode);
  const lineCount = editorCode.split("\n").length;
  const editorHeight = Math.min(420, Math.max(96, lineCount * 18 + 16));

  useEffect(() => {
    onOpenSymbolRef.current = onOpenSymbol;
  }, [onOpenSymbol]);

  useEffect(() => {
    const editorElement = editorElementRef.current;
    if (!editorElement) return;
    let disposed = false;
    let cleanup = () => {};

    void (async () => {
      const monaco = await loadMonaco();
      if (disposed) return;

      defineMonacoTheme(monaco);

      const model = monaco.editor.createModel(editorCode, languageForFile(context.file));
      const editor = monaco.editor.create(editorElement, {
        model,
        readOnly: true,
        domReadOnly: true,
        automaticLayout: true,
        theme: monacoThemes[theme],
        fontFamily: "var(--mono)",
        fontSize: 12,
        lineHeight: 18,
        minimap: { enabled: false },
        scrollbar: {
          alwaysConsumeMouseWheel: false,
          horizontalScrollbarSize: 10,
          verticalScrollbarSize: 10,
        },
        overviewRulerLanes: 0,
        renderLineHighlight: "none",
        scrollBeyondLastLine: false,
        stickyScroll: { enabled: false },
        wordWrap: "off",
        lineNumbers: (lineNumber: number) => String(isFullFileContext ? lineNumber : context.startLine + lineNumber - 1),
        padding: { top: 8, bottom: 8 },
      });
      const symbolDecorations = editor.createDecorationsCollection(symbolDecorationsForContext(monaco, editorCode, context, isFullFileContext));
      if (isFullFileContext) {
        editor.revealLineInCenter(context.startLine);
        editor.setPosition({ lineNumber: context.startLine, column: 1 });
      }

      const clickDisposable = editor.onMouseDown((event: Monaco.editor.IEditorMouseEvent) => {
        if (!event.event.metaKey && !event.event.ctrlKey) return;
        const position = event.target.position;
        if (!position) return;
        const word = model.getWordAtPosition(position);
        if (!word) return;
        const line = model.getLineContent(position.lineNumber);
        if (!isClickableSymbol(line, word.word, word.startColumn - 1)) return;
        event.event.preventDefault();
        const sourceLine = isFullFileContext ? position.lineNumber : context.startLine + position.lineNumber - 1;
        onOpenSymbolRef.current(context.file, sourceLine, position.column, word.word);
      });

      cleanup = () => {
        clickDisposable.dispose();
        symbolDecorations.clear();
        editor.dispose();
        model.dispose();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [context, editorCode, isFullFileContext, theme]);

  return (
    <div
      ref={editorElementRef}
      className="context-editor"
      style={{ height: `${editorHeight}px` }}
      aria-label={`${context.title} source context`}
    />
  );
}

function symbolDecorationsForContext(
  monaco: MonacoApi,
  code: string,
  context: SymbolContext,
  isFullFileContext: boolean,
): Monaco.editor.IModelDeltaDecoration[] {
  const symbolDecorations = code.split("\n").flatMap((line, lineIndex) =>
    tokenizeCodeLine(line)
      .filter((token) => token.kind === "identifier")
      .filter((token) => isClickableSymbol(line, token.text, token.startIndex))
      .map((token) => ({
        range: new monaco.Range(lineIndex + 1, token.startIndex + 1, lineIndex + 1, token.startIndex + token.text.length + 1),
        options: {
          inlineClassName: "context-symbol-token",
        },
      })),
  );

  if (!isFullFileContext) {
    return symbolDecorations;
  }

  const focusDecorations = Array.from({ length: context.endLine - context.startLine + 1 }, (_, index) => ({
    range: new monaco.Range(context.startLine + index, 1, context.startLine + index, 1),
    options: {
      isWholeLine: true,
      className: "context-focus-line",
    },
  }));

  return [...focusDecorations, ...symbolDecorations];
}

function defineMonacoTheme(monaco: MonacoApi) {
  if (monacoThemeDefined) return;
  monaco.editor.defineTheme(monacoThemes.dark, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#0e1117",
      "editor.foreground": "#cdd7e3",
      "editorLineNumber.foreground": "#718096",
      "editorLineNumber.activeForeground": "#a5b4c4",
      "editorCursor.foreground": "#93c5fd",
      "editor.selectionBackground": "#264f78",
      "editorIndentGuide.background1": "#202938",
    },
  });
  monaco.editor.defineTheme(monacoThemes.light, {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#f8fafc",
      "editor.foreground": "#263241",
      "editorLineNumber.foreground": "#8993a1",
      "editorLineNumber.activeForeground": "#344054",
      "editorCursor.foreground": "#3151b7",
      "editor.selectionBackground": "#bfd4ff",
      "editorIndentGuide.background1": "#d9e0ea",
    },
  });
  monacoThemeDefined = true;
}

function languageForFile(file: string): string {
  if (/\.py$/.test(file)) return "python";
  if (/\.(tsx|ts|mts|cts)$/.test(file)) return "typescript";
  if (/\.(jsx|js|mjs|cjs)$/.test(file)) return "javascript";
  return "plaintext";
}

function buildDiffEditorModel(rows: DiffRow[]): { source: string; lines: string[]; lineNumbers: string[]; rows: DiffRow[] } {
  const lines = rows.map((row) => displayDiffLine(row));
  return {
    source: lines.join("\n"),
    lines,
    lineNumbers: rows.map((row) => {
      if (row.newLine) return String(row.newLine);
      if (row.oldLine) return String(row.oldLine);
      return "";
    }),
    rows,
  };
}

function displayDiffLine(row: DiffRow): string {
  if (row.kind === "hunk") return row.text;
  if (/^[ +\-]/.test(row.text)) return row.text.slice(1);
  return row.text;
}

function isClickableSymbol(line: string, symbol: string, startIndex: number): boolean {
  if (!symbol || nonClickableSymbols.has(symbol) || isInsideString(line, startIndex) || isInsideLineComment(line, startIndex)) {
    return false;
  }

  const before = line.slice(0, startIndex);
  const after = line.slice(startIndex + symbol.length);
  if (new RegExp(`\\b(class|def|function|interface|type)\\s+${escapeRegExp(symbol)}\\b`).test(line)) {
    return true;
  }
  if (new RegExp(`\\b(const|let|var)\\s+${escapeRegExp(symbol)}\\b\\s*=\\s*(async\\s*)?(function\\b|\\([^)]*\\)|[$A-Z_a-z][$\\w]*)?\\s*=>`).test(line)) {
    return true;
  }
  if (/^\s*\(/.test(after)) {
    return true;
  }
  if (before.endsWith(".") && /^\s*(\(|,|\)|$)/.test(after)) {
    return true;
  }
  if (/^\s*(from\s+\S+\s+)?import\b/.test(line)) {
    return true;
  }
  if (/\b(new|extends|implements)\s+$/.test(before)) {
    return true;
  }
  return /^[A-Z]/.test(symbol) && !/^\s*:/.test(after);
}

function isInsideString(line: string, index: number): boolean {
  let quote: "'" | "\"" | "`" | null = null;
  let escaped = false;

  for (let position = 0; position < index; position += 1) {
    const char = line[position];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
    }
  }

  return quote != null;
}

function isInsideLineComment(line: string, index: number): boolean {
  const hashIndex = line.indexOf("#");
  const slashIndex = line.indexOf("//");
  const commentIndex = [hashIndex, slashIndex]
    .filter((position) => position >= 0 && !isInsideString(line, position))
    .sort((left, right) => left - right)[0];
  return commentIndex != null && index > commentIndex;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function diffDecorationsForRows(
  monaco: MonacoApi,
  rows: DiffRow[],
  discussions: PullRequestDiscussion[],
): Monaco.editor.IModelDeltaDecoration[] {
  return rows.flatMap((row, index) => {
    const lineNumber = index + 1;
    const diffPosition = index + 1;
    const lineClasses = ["diff-monaco-line"];
    if (row.kind === "added") lineClasses.push("diff-monaco-line-added");
    if (row.kind === "removed") lineClasses.push("diff-monaco-line-removed");
    if (row.kind === "hunk") lineClasses.push("diff-monaco-line-hunk");
    if (discussions.some((discussion) => discussionAffectsDiffPosition(discussion, diffPosition))) {
      lineClasses.push("diff-monaco-line-comment");
    }

    const lineDecoration: Monaco.editor.IModelDeltaDecoration = {
      range: new monaco.Range(lineNumber, 1, lineNumber, 1),
      options: {
        isWholeLine: true,
        className: lineClasses.join(" "),
      },
    };

    if (!row.newLine) {
      return [lineDecoration];
    }

    const symbolDecorations = tokenizeCodeLine(displayDiffLine(row))
      .filter((token) => token.kind === "identifier")
      .filter((token) => isClickableSymbol(displayDiffLine(row), token.text, token.startIndex))
      .map((token) => ({
        range: new monaco.Range(lineNumber, token.startIndex + 1, lineNumber, token.startIndex + token.text.length + 1),
        options: {
          inlineClassName: "context-symbol-token",
        },
      }));

    return [lineDecoration, ...symbolDecorations];
  });
}

function discussionsByPosition(
  discussions: PullRequestDiscussion[],
  rowCount: number,
): Array<{ position: number; discussions: PullRequestDiscussion[] }> {
  const grouped = new Map<number, PullRequestDiscussion[]>();

  for (const discussion of discussions) {
    if (!discussion.position) continue;
    const position = Math.max(1, Math.min(rowCount, discussion.position));
    grouped.set(position, [...(grouped.get(position) ?? []), discussion]);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([position, group]) => ({ position, discussions: group }));
}

function applyDiffDiscussionZones(
  editor: Monaco.editor.IStandaloneCodeEditor,
  groups: Array<{ position: number; discussions: PullRequestDiscussion[] }>,
): Root[] {
  const roots: Root[] = [];
  editor.changeViewZones((accessor) => {
    for (const group of groups) {
      const node = document.createElement("div");
      node.className = "diff-discussion-zone";
      const root = createRoot(node);
      root.render(<InlineDiscussions discussions={group.discussions} />);
      roots.push(root);

      accessor.addZone({
        afterLineNumber: group.position,
        heightInPx: discussionGroupHeight(group.discussions),
        domNode: node,
      });
    }
  });
  return roots;
}

function discussionGroupHeight(discussions: PullRequestDiscussion[]): number {
  return discussions.reduce((height, discussion) => {
    const bodyLines = Math.ceil(discussion.body.length / 90);
    return height + Math.max(86, 70 + bodyLines * 18);
  }, 8);
}

function InlineDiscussions({
  discussions,
  onHoverDiscussion,
}: {
  discussions: PullRequestDiscussion[];
  onHoverDiscussion?: (discussion: PullRequestDiscussion | null) => void;
}) {
  return (
    <div className="inline-discussions">
      {discussions.map((discussion) => {
        const labels = discussionStateLabels(discussion);
        const heading = (
          <div className="discussion-heading">
            <MessageSquareText size={15} aria-hidden="true" />
            <strong>{discussion.author}</strong>
            {labels.length > 0 ? (
              <span className="discussion-chips" aria-label={labels.join(", ")}>
                {labels.map((label) => (
                  <span key={label} className="discussion-chip">
                    {label}
                  </span>
                ))}
              </span>
            ) : null}
          </div>
        );

        return shouldCollapseDiscussion(discussion) ? (
          <details
            key={discussion.id}
            className="discussion discussion-collapsed"
            onMouseEnter={() => onHoverDiscussion?.(discussion)}
            onMouseLeave={() => onHoverDiscussion?.(null)}
            onFocus={() => onHoverDiscussion?.(discussion)}
            onBlur={() => onHoverDiscussion?.(null)}
          >
            <summary>{heading}</summary>
            <MarkdownBody body={discussion.body} />
          </details>
        ) : (
          <article
            key={discussion.id}
            className="discussion"
            onMouseEnter={() => onHoverDiscussion?.(discussion)}
            onMouseLeave={() => onHoverDiscussion?.(null)}
            onFocus={() => onHoverDiscussion?.(discussion)}
            onBlur={() => onHoverDiscussion?.(null)}
          >
            {heading}
            <MarkdownBody body={discussion.body} />
          </article>
        );
      })}
    </div>
  );
}

function MarkdownBody({ body }: { body: string }) {
  return (
    <div className="discussion-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

function EmptyPanel() {
  return (
    <section className="panel empty-panel">
      <HelpCircle size={20} aria-hidden="true" />
      <p>Paste a GitHub PR URL to begin. The app fetches data through `gh` and caches it locally.</p>
    </section>
  );
}

function Welcome() {
  return (
    <section className="welcome">
      <GitPullRequest size={36} aria-hidden="true" />
      <h2>Local PR reading, no checkout required.</h2>
      <p>Load a pull request to inspect metadata, changed files, review discussion, and unified diffs in one focused workspace.</p>
    </section>
  );
}
