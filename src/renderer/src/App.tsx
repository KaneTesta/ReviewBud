import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type * as Monaco from "monaco-editor";
import { createRoot, type Root } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  FileCode2,
  GitPullRequestArrow,
  GitPullRequestClosed,
  GitPullRequest,
  Loader2,
  Moon,
  MessageSquareText,
  RefreshCw,
  Send,
  Star,
  Sun,
  X,
} from "lucide-react";
import type {
  DraftReviewComment,
  DraftReviewSubmission,
  PullRequestDiscussion,
  PullRequestFile,
  PullRequestListItem,
  RepositorySummary,
  ReviewOutcome,
  ReviewWorkspace,
  SymbolContext,
  DiffRow,
} from "../../shared/types";
import {
  discussionAffectsDiffRow,
  discussionAffectsDiffPosition,
  discussionHasDiffLocation,
  discussionStateLabels,
  discussionsForFile,
  shouldCollapseDiscussion,
  shouldShowDiscussionAtFileTop,
} from "../../shared/discussions";
import {
  buildDiffRows,
  collapsedDiffRowKey,
  displayDiffLine,
  expandCollapsedDiffRows,
  tokenizeCodeLine,
} from "../../shared/symbol-context";
import {
  adjacentFile,
  completedAllFiles,
  createDraftReview,
  reviewProgress,
  toggleFileViewed,
  upsertDraftComment,
  withReviewState,
} from "../../shared/review-state";
import { filterRepositories, repositoryOwners, sortRepositoriesForDisplay } from "../../shared/repositories";

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
const minContextEditorHeight = 96;
const maxContextEditorHeight = 900;
const minSplitPanePercent = 24;
const maxSplitPanePercent = 76;
type LineSelection = {
  file: string;
  startLine: number;
  endLine: number;
} | null;

export function isClosedPullRequest(pullRequest: Pick<PullRequestListItem, "state">): boolean {
  return pullRequest.state.toLowerCase() === "closed";
}

export function pullRequestListRowClassName(pullRequest: Pick<PullRequestListItem, "state">): string {
  return isClosedPullRequest(pullRequest) ? "selection-row pr-row pr-row-closed" : "selection-row pr-row";
}

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
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [selectedRepository, setSelectedRepository] = useState<RepositorySummary | null>(null);
  const [pullRequests, setPullRequests] = useState<PullRequestListItem[]>([]);
  const [repoListState, setRepoListState] = useState<"idle" | "loading" | "error">("idle");
  const [prListState, setPrListState] = useState<"idle" | "loading" | "error">("idle");
  const [repoListError, setRepoListError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<ReviewWorkspace | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [symbolContexts, setSymbolContexts] = useState<SymbolContext[]>([]);
  const [symbolState, setSymbolState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [symbolError, setSymbolError] = useState<string | null>(null);
  const [commentSelection, setCommentSelection] = useState<LineSelection>(null);
  const [replyStateByDiscussionId, setReplyStateByDiscussionId] = useState<
    Record<string, { status: "submitting" | "error"; message?: string }>
  >({});
  const [finishReviewOpen, setFinishReviewOpen] = useState(false);
  const [fileSources, setFileSources] = useState<Record<string, string>>({});
  const [expandedDiffGaps, setExpandedDiffGaps] = useState<Record<string, string[]>>({});
  const [contextPanePercent, setContextPanePercent] = useState(50);
  const reviewColumnsRef = useRef<HTMLDivElement | null>(null);
  const previousReviewProgressRef = useRef<ReturnType<typeof reviewProgress> | null>(
    null,
  );

  useEffect(() => {
    document.documentElement.dataset.platform = navigator.platform;
  }, []);

  useEffect(() => {
    if (canListRepositories()) {
      void loadRepositories();
    } else {
      setRepoListState("error");
      setRepoListError("Restart ReviewBud to enable repository and PR selection. Direct PR URL loading is still available.");
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
    void window.prTool.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    const reviewPullRequestLink = (nextUrl: string) => {
      setUrl(nextUrl);
      void loadPullRequest(nextUrl);
    };
    const unsubscribe = window.prTool.onReviewPullRequestLink((nextUrl) => {
      reviewPullRequestLink(nextUrl);
    });
    void window.prTool.markReadyForReviewPullRequestLinks().then((pendingUrls) => {
      for (const nextUrl of pendingUrls) {
        reviewPullRequestLink(nextUrl);
      }
    });
    return unsubscribe;
  }, []);

  const currentFile = useMemo(() => {
    if (!workspace) return null;
    return (
      workspace.pullRequest.files.find(
        (file) => file.filename === selectedFile,
      ) ??
      workspace.pullRequest.files[0] ??
      null
    );
  }, [selectedFile, workspace]);
  const currentFileViewed =
    workspace?.notes.find((note) => note.file === currentFile?.filename)
      ?.status === "done";
  const progress = useMemo(
    () => (workspace ? reviewProgress(workspace.notes) : null),
    [workspace],
  );

  const showSymbolSplit =
    symbolState === "loading" ||
    symbolState === "error" ||
    symbolContexts.length > 0;
  const nextTheme = theme === "dark" ? "light" : "dark";
  const shortcuts = useMemo(() => keyboardShortcuts(), []);

  useEffect(() => {
    if (!progress) {
      previousReviewProgressRef.current = null;
      return;
    }
    if (completedAllFiles(previousReviewProgressRef.current, progress)) {
      setFinishReviewOpen(true);
    }
    previousReviewProgressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!workspace || isTypingTarget(event.target)) return;
      const hasShortcutModifier = event.metaKey || event.ctrlKey;
      if (!hasShortcutModifier) return;

      if (event.key === "ArrowRight") {
        event.preventDefault();
        selectAdjacentFile("next");
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        selectAdjacentFile("previous");
        return;
      }
      if (event.key === "Enter" && event.shiftKey) {
        event.preventDefault();
        setFinishReviewOpen(true);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        toggleCurrentFileViewed();
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentFile, workspace]);

  function closeSymbolContext() {
    setSymbolContexts([]);
    setSymbolState("idle");
    setSymbolError(null);
  }

  function closeSymbolContextAt(index: number) {
    setSymbolContexts((current) =>
      current.filter((_, contextIndex) => contextIndex !== index),
    );
    setSymbolError(null);
    if (symbolState === "error") {
      setSymbolState("idle");
    }
  }

  async function loadPullRequest(nextUrl = url) {
    setIsLoading(true);
    setError(null);

    try {
      const nextWorkspace = await window.prTool.loadPullRequest(nextUrl);
      previousReviewProgressRef.current = null;
      setWorkspace(nextWorkspace);
      setSelectedFile(nextWorkspace.pullRequest.files[0]?.filename ?? null);
      setSymbolContexts([]);
      setSymbolState("idle");
      setSymbolError(null);
      setUrl(nextWorkspace.pullRequest.summary.url);
      setFileSources({});
      setExpandedDiffGaps({});
      setReplyStateByDiscussionId({});
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function openSymbolContext(
    file: string,
    line: number,
    column: number,
    symbol: string,
    append = false,
  ) {
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
      setSymbolContexts((current) =>
        append ? [...current, nextContext] : [nextContext],
      );
      setSymbolState("idle");
    } catch (contextError) {
      setSymbolState("error");
      setSymbolError(
        contextError instanceof Error
          ? contextError.message
          : String(contextError),
      );
    }
  }

  function persistWorkspace(nextWorkspace: ReviewWorkspace) {
    setWorkspace(nextWorkspace);
    void window.prTool.saveReviewState(nextWorkspace.pullRequest.summary.id, {
      notes: nextWorkspace.notes,
      draftComments: nextWorkspace.draftComments ?? [],
      draftReview: nextWorkspace.draftReview ?? null,
    });
  }

  function selectAdjacentFile(direction: "next" | "previous") {
    if (!workspace) return;
    const nextFile = adjacentFile(
      workspace.pullRequest.files,
      currentFile?.filename ?? null,
      direction,
    );
    if (nextFile) {
      setSelectedFile(nextFile);
      setCommentSelection(null);
    }
  }

  function toggleCurrentFileViewed() {
    if (!workspace || !currentFile) return;
    persistWorkspace(
      withReviewState(workspace, {
        notes: toggleFileViewed(workspace.notes, currentFile.filename),
      }),
    );
  }

  function saveDraftComment(
    selection: Exclude<LineSelection, null>,
    body: string,
  ) {
    if (!workspace) return;
    const nextComments = upsertDraftComment(workspace.draftComments ?? [], {
      file: selection.file,
      startLine: selection.startLine,
      endLine: selection.endLine,
      body,
    });
    persistWorkspace(
      withReviewState(workspace, { draftComments: nextComments }),
    );
    setCommentSelection(null);
  }

  function saveDraftReview(outcome: ReviewOutcome, body: string) {
    if (!workspace) return;
    const draftReview = createDraftReview(outcome, body);
    persistWorkspace(withReviewState(workspace, { draftReview }));
    setFinishReviewOpen(false);
  }

  async function replyToDiscussion(discussion: PullRequestDiscussion, body: string) {
    if (!workspace) return;
    const trimmedBody = body.trim();
    if (!trimmedBody) return;

    const { summary } = workspace.pullRequest;
    setReplyStateByDiscussionId((current) => ({
      ...current,
      [discussion.id]: { status: "submitting" },
    }));

    try {
      const nextWorkspace = await window.prTool.replyToDiscussion({
        owner: summary.owner,
        repo: summary.repo,
        number: summary.number,
        discussionId: discussion.id,
        body: trimmedBody,
      });
      setWorkspace(nextWorkspace);
      setReplyStateByDiscussionId((current) => {
        const { [discussion.id]: _removed, ...remaining } = current;
        return remaining;
      });
    } catch (replyError) {
      setReplyStateByDiscussionId((current) => ({
        ...current,
        [discussion.id]: {
          status: "error",
          message: replyError instanceof Error ? replyError.message : String(replyError),
        },
      }));
    }
  }

  async function loadRepositories() {
    if (!canListRepositories()) {
      setRepoListState("error");
      setRepoListError("Restart ReviewBud to enable repository and PR selection. Direct PR URL loading is still available.");
      return;
    }

    setRepoListState("loading");
    setRepoListError(null);

    try {
      const nextRepositories = await window.prTool.listRepositories();
      setRepositories(nextRepositories);
      setRepoListState("idle");
      if (!selectedRepository && nextRepositories[0]) {
        void selectRepository(nextRepositories[0]);
      }
    } catch (listError) {
      setRepoListState("error");
      setRepoListError(listError instanceof Error ? listError.message : String(listError));
    }
  }

  async function searchRepositoryList(query: string, owner: string) {
    if (!canSearchRepositories()) {
      throw new Error("Restart ReviewBud to enable GitHub-backed repository search.");
    }

    return window.prTool.searchRepositories(query, owner);
  }

  async function selectRepository(repository: RepositorySummary) {
    if (!canListPullRequests()) {
      setPrListState("error");
      setRepoListError("Restart ReviewBud to enable repository and PR selection. Direct PR URL loading is still available.");
      return;
    }

    setSelectedRepository(repository);
    setPrListState("loading");
    setRepoListError(null);

    try {
      const nextPullRequests = await window.prTool.listPullRequests(repository.owner, repository.repo);
      setPullRequests(nextPullRequests);
      setPrListState("idle");
    } catch (listError) {
      setPullRequests([]);
      setPrListState("error");
      setRepoListError(listError instanceof Error ? listError.message : String(listError));
    }
  }

  async function toggleRepositoryStar(repository: RepositorySummary) {
    if (!canSetRepositoryStar()) {
      setRepoListError("Restart ReviewBud to enable repository starring.");
      return;
    }

    const nextIsStarred = !repository.isStarred;
    applyRepositoryStarState(repository.fullName, nextIsStarred);

    try {
      await window.prTool.setRepositoryStar(repository.fullName, nextIsStarred);
    } catch (starError) {
      applyRepositoryStarState(repository.fullName, Boolean(repository.isStarred));
      setRepoListError(starError instanceof Error ? starError.message : String(starError));
      throw starError;
    }
  }

  function applyRepositoryStarState(fullName: string, isStarred: boolean) {
    const updateRepository = (item: RepositorySummary): RepositorySummary =>
      item.fullName === fullName ? { ...item, isStarred } : item;
    setRepositories((current) => sortRepositoriesForDisplay(current.map(updateRepository)));
    setSelectedRepository((current) => (current?.fullName === fullName ? updateRepository(current) : current));
  }

  function returnToPullRequestList() {
    setWorkspace(null);
    setSelectedFile(null);
    setSymbolContexts([]);
    setSymbolState("idle");
    setSymbolError(null);
    setFileSources({});
    setExpandedDiffGaps({});
    setCommentSelection(null);
    setFinishReviewOpen(false);
    setReplyStateByDiscussionId({});
  }

  async function toggleCollapsedDiffGap(file: PullRequestFile, row: DiffRow) {
    if (!workspace) return;
    const key = collapsedDiffRowKey(row);
    if (!key) return;

    const filename = file.filename;
    if (expandedDiffGaps[filename]?.includes(key)) {
      setExpandedDiffGaps((current) => ({
        ...current,
        [filename]: current[filename]?.filter((item) => item !== key) ?? [],
      }));
      return;
    }

    let source = fileSources[filename];
    if (!source) {
      const { summary } = workspace.pullRequest;
      source = await window.prTool.loadFileSource({
        owner: summary.owner,
        repo: summary.repo,
        number: summary.number,
        file: filename,
        line: row.collapsedNewStart ?? 1,
        symbol: "",
        headRepoFullName: summary.headRepoFullName,
        headSha: summary.headSha,
      });
      setFileSources((current) => ({ ...current, [filename]: source }));
    }

    setExpandedDiffGaps((current) => ({
      ...current,
      [filename]: [...(current[filename] ?? []), key],
    }));
  }

  function startSplitResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const container = reviewColumnsRef.current;
    if (!container) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const containerRect = container.getBoundingClientRect();

    const onPointerMove = (moveEvent: PointerEvent) => {
      const rightPaneWidth = containerRect.right - moveEvent.clientX;
      const nextPercent = (rightPaneWidth / containerRect.width) * 100;
      setContextPanePercent(
        clamp(nextPercent, minSplitPanePercent, maxSplitPanePercent),
      );
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  function resizeSplitWithKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 10 : 4;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setContextPanePercent((percent) =>
        clamp(percent + step, minSplitPanePercent, maxSplitPanePercent),
      );
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setContextPanePercent((percent) =>
        clamp(percent - step, minSplitPanePercent, maxSplitPanePercent),
      );
    }
    if (event.key === "Home") {
      event.preventDefault();
      setContextPanePercent(maxSplitPanePercent);
    }
    if (event.key === "End") {
      event.preventDefault();
      setContextPanePercent(minSplitPanePercent);
    }
  }

  return (
    <main className="app-shell">
      <div className="window-titlebar-drag" aria-hidden="true" />
      <header className={workspace ? "topbar loaded" : "topbar"}>
        {workspace ? (
          <PullRequestHeader workspace={workspace} />
        ) : (
          <div className="brand">
            <GitPullRequest size={22} aria-hidden="true" />
            <div>
              <h1>review bud</h1>
              <p>Read GitHub pull requests locally without branch switching.</p>
            </div>
          </div>
        )}
        {workspace ? (
          <button type="button" className="back-to-list-button" onClick={returnToPullRequestList}>
            <ArrowLeft size={16} aria-hidden="true" />
            Back to PR list
          </button>
        ) : (
          <div aria-hidden="true" />
        )}
        <button
          type="button"
          className="theme-toggle"
          role="switch"
          aria-checked={theme === "dark"}
          aria-label={`Switch to ${nextTheme} mode`}
          title={`Switch to ${nextTheme} mode`}
          onClick={() => setTheme(nextTheme)}
        >
          {theme === "dark" ? (
            <Moon size={16} aria-hidden="true" />
          ) : (
            <Sun size={16} aria-hidden="true" />
          )}
          <span>{theme === "dark" ? "Dark" : "Light"}</span>
        </button>
      </header>

      <section className="content-shell">
        {error ? <div className="error-banner">{error}</div> : null}

        <section className="workspace">
          <section className="review-surface">
            {workspace && currentFile ? (
              <>
                <div
                  ref={reviewColumnsRef}
                  className={
                    showSymbolSplit ? "review-columns split" : "review-columns"
                  }
                  style={
                    showSymbolSplit
                      ? {
                          "--context-pane-width": `${contextPanePercent}%`,
                        } as CSSProperties
                      : undefined
                  }
                >
                  <DiffViewer
                    file={currentFile}
                    discussions={workspace.pullRequest.discussions}
                    draftComments={workspace.draftComments ?? []}
                    theme={theme}
                    viewed={currentFileViewed}
                    commentSelection={commentSelection}
                    source={fileSources[currentFile.filename] ?? null}
                    expandedGapKeys={expandedDiffGaps[currentFile.filename] ?? []}
                    replyStateByDiscussionId={replyStateByDiscussionId}
                    onOpenSymbol={openSymbolContext}
                    onToggleCollapsedGap={toggleCollapsedDiffGap}
                    onSelectCommentRange={setCommentSelection}
                    onReplyToDiscussion={replyToDiscussion}
                  />
                  {showSymbolSplit ? (
                    <>
                      <button
                        type="button"
                        className="split-resize-handle"
                        role="separator"
                        aria-label="Resize context pane"
                        aria-orientation="vertical"
                        aria-valuemin={minSplitPanePercent}
                        aria-valuemax={maxSplitPanePercent}
                        aria-valuenow={contextPanePercent}
                        title="Drag to resize panes"
                        onPointerDown={startSplitResize}
                        onKeyDown={resizeSplitWithKeyboard}
                      />
                      <SymbolContextPanel
                        contexts={symbolContexts}
                        state={symbolState}
                        error={symbolError}
                        theme={theme}
                        onClose={closeSymbolContext}
                        onCloseContext={closeSymbolContextAt}
                        onOpenSymbol={(file, line, column, symbol) =>
                          openSymbolContext(file, line, column, symbol, true)
                        }
                      />
                    </>
                  ) : null}
                </div>
                <ReviewActionPane
                  workspace={workspace}
                  currentFile={currentFile}
                  commentSelection={commentSelection}
                  shortcuts={shortcuts}
                  onNextFile={() => selectAdjacentFile("next")}
                  onPreviousFile={() => selectAdjacentFile("previous")}
                  onMarkViewed={toggleCurrentFileViewed}
                  onCancelComment={() => setCommentSelection(null)}
                  onSaveComment={saveDraftComment}
                  onFinishReview={() => setFinishReviewOpen(true)}
                />
              </>
            ) : (
              <Welcome
                url={url}
                repositories={repositories}
                selectedRepository={selectedRepository}
                pullRequests={pullRequests}
                isLoading={isLoading}
                repoListState={repoListState}
                prListState={prListState}
                error={repoListError}
                onUrlChange={setUrl}
                onLoadPullRequest={loadPullRequest}
                onSelectRepository={selectRepository}
                onReloadRepositories={loadRepositories}
                onSearchRepositories={searchRepositoryList}
                onToggleRepositoryStar={toggleRepositoryStar}
              />
            )}
          </section>
        </section>
      </section>
      {workspace ? (
        <FinishReviewModal
          open={finishReviewOpen}
          shortcuts={shortcuts}
          existingDraft={workspace.draftReview ?? null}
          onClose={() => setFinishReviewOpen(false)}
          onSave={saveDraftReview}
        />
      ) : null}
    </main>
  );
}

function initialTheme(): ThemeMode {
  const savedTheme = window.localStorage.getItem(themeStorageKey);
  if (savedTheme === "dark" || savedTheme === "light") return savedTheme;
  return "light";
}

function keyboardShortcuts() {
  const modifier = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    ? "Cmd"
    : "Ctrl";
  return {
    modifier,
    nextFile: `${modifier}+Right`,
    previousFile: `${modifier}+Left`,
    viewed: `${modifier}+Enter`,
    finish: `${modifier}+Shift+Enter`,
    approve: `${modifier}+Shift+A`,
    requestChanges: `${modifier}+Shift+R`,
    submitComment: `${modifier}+Shift+M`,
    saveComment: `${modifier}+S`,
    cancel: "Esc",
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  return target.matches("input, textarea, select, [contenteditable='true']");
}

function canListRepositories(): boolean {
  return typeof window.prTool.listRepositories === "function";
}

function canListPullRequests(): boolean {
  return typeof window.prTool.listPullRequests === "function";
}

function canSearchRepositories(): boolean {
  return typeof window.prTool.searchRepositories === "function";
}

function canSetRepositoryStar(): boolean {
  return typeof window.prTool.setRepositoryStar === "function";
}

function clearMonacoTextFocus() {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

function animateScrollTop(
  element: HTMLElement,
  targetScrollTop: number,
  durationMs: number,
) {
  const startScrollTop = element.scrollTop;
  const distance = targetScrollTop - startScrollTop;
  if (Math.abs(distance) < 1) return;

  const startedAt = performance.now();
  const step = (timestamp: number) => {
    const progress = Math.min(1, (timestamp - startedAt) / durationMs);
    const easedProgress = 1 - Math.pow(1 - progress, 3);
    element.scrollTop = startScrollTop + distance * easedProgress;

    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  };

  window.requestAnimationFrame(step);
}

type DiffPaneArrowKeyEvent = Pick<
  KeyboardEvent,
  | "altKey"
  | "ctrlKey"
  | "defaultPrevented"
  | "key"
  | "metaKey"
  | "shiftKey"
  | "target"
  | "preventDefault"
  | "stopPropagation"
>;

export function scrollDiffPaneWithArrowKey(
  event: DiffPaneArrowKeyEvent,
  scrollContainer: Pick<HTMLElement, "scrollBy">,
  lineHeight: number,
): boolean {
  if (
    event.defaultPrevented ||
    (event.key !== "ArrowDown" && event.key !== "ArrowUp") ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    isTypingTarget(event.target)
  ) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  scrollContainer.scrollBy({
    top: event.key === "ArrowDown" ? lineHeight : -lineHeight,
    behavior: "auto",
  });
  return true;
}

function ReviewActionPane({
  workspace,
  currentFile,
  commentSelection,
  shortcuts,
  onNextFile,
  onPreviousFile,
  onMarkViewed,
  onCancelComment,
  onSaveComment,
  onFinishReview,
}: {
  workspace: ReviewWorkspace;
  currentFile: PullRequestFile;
  commentSelection: LineSelection;
  shortcuts: ReturnType<typeof keyboardShortcuts>;
  onNextFile: () => void;
  onPreviousFile: () => void;
  onMarkViewed: () => void;
  onCancelComment: () => void;
  onSaveComment: (
    selection: Exclude<LineSelection, null>,
    body: string,
  ) => void;
  onFinishReview: () => void;
}) {
  const paneRef = useRef<HTMLElement | null>(null);
  const progress = reviewProgress(workspace.notes);
  const currentNote = workspace.notes.find(
    (note) => note.file === currentFile.filename,
  );
  const currentFileViewed = currentNote?.status === "done";
  const draftComments = workspace.draftComments ?? [];

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const updatePaneHeight = () => {
      document.documentElement.style.setProperty(
        "--review-action-pane-height",
        `${pane.offsetHeight}px`,
      );
    };
    updatePaneHeight();
    const resizeObserver = new ResizeObserver(updatePaneHeight);
    resizeObserver.observe(pane);
    window.addEventListener("resize", updatePaneHeight);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePaneHeight);
      document.documentElement.style.removeProperty(
        "--review-action-pane-height",
      );
    };
  }, [commentSelection, draftComments.length]);

  return (
    <section
      ref={paneRef}
      className="review-action-pane"
      aria-label="Review actions"
    >
      <div className="review-action-status">
        <span>
          {currentNote?.status === "done"
            ? "Viewed"
            : `${progress.viewed}/${progress.total} files viewed`}
        </span>
        <span>
          {draftComments.length} draft{" "}
          {draftComments.length === 1 ? "comment" : "comments"}
        </span>
      </div>
      <div className="review-actions">
        <ShortcutButton
          label="Previous file"
          shortcut={shortcuts.previousFile}
          onClick={onPreviousFile}
        >
          <ArrowLeft size={15} aria-hidden="true" />
        </ShortcutButton>
        <ShortcutButton
          label="Next file"
          shortcut={shortcuts.nextFile}
          onClick={onNextFile}
        >
          <ArrowRight size={15} aria-hidden="true" />
        </ShortcutButton>
        <ShortcutButton
          label={currentFileViewed ? "Viewed" : "Mark viewed"}
          shortcut={shortcuts.viewed}
          intent={currentFileViewed ? "success" : "secondary"}
          pressed={currentFileViewed}
          onClick={onMarkViewed}
        >
          {currentFileViewed ? (
            <CheckCircle2 size={15} aria-hidden="true" />
          ) : (
            <Eye size={15} aria-hidden="true" />
          )}
        </ShortcutButton>
        <ShortcutButton
          label="Finish review"
          shortcut={shortcuts.finish}
          intent="primary"
          onClick={onFinishReview}
        >
          <GitPullRequestArrow size={15} aria-hidden="true" />
        </ShortcutButton>
      </div>
      {commentSelection ? (
        <div className="comment-mode-hint" role="status">
          Add your draft comment below.
        </div>
      ) : null}
      {commentSelection ? (
        <LineCommentComposer
          selection={commentSelection}
          shortcuts={shortcuts}
          onSave={onSaveComment}
          onCancel={onCancelComment}
        />
      ) : null}
      {draftComments.length > 0 ? (
        <DraftCommentList comments={draftComments} />
      ) : null}
    </section>
  );
}

function ShortcutButton({
  label,
  shortcut,
  pressed,
  intent = "secondary",
  onClick,
  children,
}: {
  label: string;
  shortcut: string;
  pressed?: boolean;
  intent?: "primary" | "secondary" | "success";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`shortcut-button ${intent}${pressed ? " active" : ""}`}
      aria-pressed={pressed}
      title={`${label} (${shortcut})`}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
      <kbd>{shortcut}</kbd>
    </button>
  );
}

function LineCommentComposer({
  selection,
  shortcuts,
  onSave,
  onCancel,
}: {
  selection: Exclude<LineSelection, null>;
  shortcuts: ReturnType<typeof keyboardShortcuts>;
  onSave: (selection: Exclude<LineSelection, null>, body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [selection]);

  function save() {
    if (body.trim()) {
      onSave(selection, body);
      setBody("");
    }
  }

  return (
    <form
      className="line-comment-composer"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="composer-heading">
        <strong>
          {selection.file}:
          {selection.startLine === selection.endLine
            ? selection.startLine
            : `${selection.startLine}-${selection.endLine}`}
        </strong>
        <span>Draft line comment</span>
      </div>
      <textarea
        ref={textareaRef}
        value={body}
        aria-label="Draft line comment"
        placeholder="Leave a comment on this line range"
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "s"
          ) {
            event.preventDefault();
            save();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="composer-actions">
        <button
          type="button"
          className="secondary-action"
          title={`Cancel (${shortcuts.cancel})`}
          onClick={onCancel}
        >
          <X size={14} aria-hidden="true" />
          Cancel
          <kbd>{shortcuts.cancel}</kbd>
        </button>
        <button
          type="submit"
          className="primary-action"
          disabled={!body.trim()}
          title={`Save comment (${shortcuts.saveComment})`}
        >
          <Send size={14} aria-hidden="true" />
          Save comment
          <kbd>{shortcuts.saveComment}</kbd>
        </button>
      </div>
    </form>
  );
}

function DraftCommentList({ comments }: { comments: DraftReviewComment[] }) {
  return (
    <div className="draft-comment-list" aria-label="Draft review comments">
      {comments.map((comment) => (
        <article key={comment.id} className="draft-comment">
          <span>
            {comment.file}:
            {comment.startLine === comment.endLine
              ? comment.startLine
              : `${comment.startLine}-${comment.endLine}`}
          </span>
          <p>{comment.body}</p>
        </article>
      ))}
    </div>
  );
}

function FinishReviewModal({
  open,
  shortcuts,
  existingDraft,
  onClose,
  onSave,
}: {
  open: boolean;
  shortcuts: ReturnType<typeof keyboardShortcuts>;
  existingDraft: DraftReviewSubmission | null;
  onClose: () => void;
  onSave: (outcome: ReviewOutcome, body: string) => void;
}) {
  const [outcome, setOutcome] = useState<ReviewOutcome>(
    existingDraft?.outcome ?? "comment",
  );
  const [body, setBody] = useState(existingDraft?.body ?? "");
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setOutcome(existingDraft?.outcome ?? "comment");
    setBody(existingDraft?.body ?? "");
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);
  }, [existingDraft, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        setOutcome("approve");
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        setOutcome("request-changes");
      }
      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        setOutcome("comment");
      }
      if (event.key === "Enter") {
        event.preventDefault();
        onSave(outcome, body);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [body, onClose, onSave, open, outcome]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="review-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="finish-review-title"
      >
        <div className="modal-heading">
          <div>
            <h2 id="finish-review-title">Finish review</h2>
            <p>Choose the review result and leave an overall comment.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-button"
            title={`Close (${shortcuts.cancel})`}
            aria-label="Close finish review"
            onClick={onClose}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
        <div
          className="review-outcomes"
          role="radiogroup"
          aria-label="Review outcome"
        >
          <OutcomeButton
            outcome="approve"
            active={outcome === "approve"}
            shortcut={shortcuts.approve}
            onSelect={setOutcome}
          />
          <OutcomeButton
            outcome="request-changes"
            active={outcome === "request-changes"}
            shortcut={shortcuts.requestChanges}
            onSelect={setOutcome}
          />
          <OutcomeButton
            outcome="comment"
            active={outcome === "comment"}
            shortcut={shortcuts.submitComment}
            onSelect={setOutcome}
          />
        </div>
        <textarea
          className="review-summary-input"
          aria-label="Review comment"
          value={body}
          placeholder="Add a summary comment"
          onChange={(event) => setBody(event.target.value)}
        />
        <div className="modal-actions">
          <button
            type="button"
            className="secondary-action"
            title={`Cancel (${shortcuts.cancel})`}
            onClick={onClose}
          >
            <X size={14} aria-hidden="true" />
            Cancel
            <kbd>{shortcuts.cancel}</kbd>
          </button>
          <button
            type="button"
            className="primary-action"
            title={`Save review (${shortcuts.finish})`}
            onClick={() => onSave(outcome, body)}
          >
            <Send size={14} aria-hidden="true" />
            Save review
            <kbd>{shortcuts.finish}</kbd>
          </button>
        </div>
      </section>
    </div>
  );
}

function OutcomeButton({
  outcome,
  active,
  shortcut,
  onSelect,
}: {
  outcome: ReviewOutcome;
  active: boolean;
  shortcut: string;
  onSelect: (outcome: ReviewOutcome) => void;
}) {
  const label =
    outcome === "approve"
      ? "Approve"
      : outcome === "request-changes"
        ? "Request changes"
        : "Comment";
  return (
    <button
      type="button"
      className={active ? "outcome-button active" : "outcome-button"}
      role="radio"
      aria-checked={active}
      title={`${label} (${shortcut})`}
      onClick={() => onSelect(outcome)}
    >
      <CheckCircle2 size={15} aria-hidden="true" />
      <span>{label}</span>
      <kbd>{shortcut}</kbd>
    </button>
  );
}

function PullRequestHeader({ workspace }: { workspace: ReviewWorkspace }) {
  const { summary } = workspace.pullRequest;
  return (
    <section className="pr-header">
      <div>
        <div className="eyebrow">
          {summary.owner}/{summary.repo}#{summary.number}
        </div>
        <h2>
          <a href={summary.url} target="_blank" rel="noreferrer">
            {summary.title}
          </a>
        </h2>
        <p>
          {summary.author} wants to merge <strong>{summary.headRef}</strong>{" "}
          into <strong>{summary.baseRef}</strong>
        </p>
      </div>
      <div className="stats">
        <span>{summary.changedFiles} files</span>
        <span className="plus">+{summary.additions}</span>
        <span className="minus">-{summary.deletions}</span>
        {summary.reviewDecision ? <span>{summary.reviewDecision}</span> : null}
      </div>
    </section>
  );
}

function DiffViewer({
  file,
  discussions,
  draftComments,
  theme,
  viewed,
  commentSelection,
  source,
  expandedGapKeys,
  replyStateByDiscussionId,
  onOpenSymbol,
  onToggleCollapsedGap,
  onSelectCommentRange,
  onReplyToDiscussion,
}: {
  file: PullRequestFile;
  discussions: PullRequestDiscussion[];
  draftComments: DraftReviewComment[];
  theme: ThemeMode;
  viewed: boolean;
  commentSelection: LineSelection;
  source: string | null;
  expandedGapKeys: string[];
  replyStateByDiscussionId: Record<string, { status: "submitting" | "error"; message?: string }>;
  onOpenSymbol: (
    file: string,
    line: number,
    column: number,
    symbol: string,
    append?: boolean,
  ) => void;
  onToggleCollapsedGap: (file: PullRequestFile, row: DiffRow) => void;
  onSelectCommentRange: (selection: Exclude<LineSelection, null>) => void;
  onReplyToDiscussion: (discussion: PullRequestDiscussion, body: string) => void;
}) {
  const rows = useMemo(
    () =>
      buildDiffRows(file.patch || "Diff omitted by GitHub API for this file."),
    [file.patch],
  );
  const visibleRows = useMemo(
    () => source ? expandCollapsedDiffRows(rows, source, new Set(expandedGapKeys)) : rows,
    [expandedGapKeys, rows, source],
  );
  const fileDiscussions = useMemo(
    () => discussionsForFile(discussions, file.filename),
    [discussions, file.filename],
  );
  const fileDraftComments = useMemo(
    () => draftComments.filter((comment) => comment.file === file.filename),
    [draftComments, file.filename],
  );
  const topDiscussions = useMemo(
    () => fileDiscussions.filter(shouldShowDiscussionAtFileTop),
    [fileDiscussions],
  );
  const lineDiscussions = useMemo(
    () => fileDiscussions.filter(discussionHasDiffLocation),
    [fileDiscussions],
  );

  return (
    <section className="diff-panel">
      <div className="diff-heading">
        <FileCode2 size={18} aria-hidden="true" />
        <div>
          <h3>
            <span>{file.filename}</span>
            {viewed ? (
              <span className="diff-heading-viewed" title="Viewed">
                <CheckCircle2 size={14} aria-hidden="true" />
              </span>
            ) : null}
          </h3>
          <p>
            {file.status} · {file.changes} changes
          </p>
        </div>
      </div>
      <div
        className="diff"
        role="region"
        aria-label={`Diff for ${file.filename}`}
        tabIndex={0}
        onKeyDown={(event) => {
          scrollDiffPaneWithArrowKey(event.nativeEvent, event.currentTarget, 18);
        }}
      >
        {topDiscussions.length > 0 ? (
          <InlineDiscussions
            discussions={topDiscussions}
            replyStateByDiscussionId={replyStateByDiscussionId}
            onReply={onReplyToDiscussion}
          />
        ) : null}
        <DiffCodeEditor
          file={file}
          rows={visibleRows}
          discussions={lineDiscussions}
          draftComments={fileDraftComments}
          theme={theme}
          commentSelection={
            commentSelection?.file === file.filename ? commentSelection : null
          }
          onOpenSymbol={onOpenSymbol}
          onToggleCollapsedGap={onToggleCollapsedGap}
          onSelectCommentRange={onSelectCommentRange}
          replyStateByDiscussionId={replyStateByDiscussionId}
          onReplyToDiscussion={onReplyToDiscussion}
        />
      </div>
    </section>
  );
}

function DiffCodeEditor({
  file,
  rows,
  discussions,
  draftComments,
  theme,
  commentSelection,
  onOpenSymbol,
  onToggleCollapsedGap,
  onSelectCommentRange,
  replyStateByDiscussionId,
  onReplyToDiscussion,
}: {
  file: PullRequestFile;
  rows: DiffRow[];
  discussions: PullRequestDiscussion[];
  draftComments: DraftReviewComment[];
  theme: ThemeMode;
  commentSelection: LineSelection;
  onOpenSymbol: (
    file: string,
    line: number,
    column: number,
    symbol: string,
    append?: boolean,
  ) => void;
  onToggleCollapsedGap: (file: PullRequestFile, row: DiffRow) => void;
  onSelectCommentRange: (selection: Exclude<LineSelection, null>) => void;
  replyStateByDiscussionId: Record<string, { status: "submitting" | "error"; message?: string }>;
  onReplyToDiscussion: (discussion: PullRequestDiscussion, body: string) => void;
}) {
  const editorElementRef = useRef<HTMLDivElement | null>(null);
  const onOpenSymbolRef = useRef(onOpenSymbol);
  const onToggleCollapsedGapRef = useRef(onToggleCollapsedGap);
  const onSelectCommentRangeRef = useRef(onSelectCommentRange);
  const dragStartLineRef = useRef<number | null>(null);
  const editorModel = useMemo(() => buildDiffEditorModel(rows), [rows]);
  const discussionGroups = useMemo(
    () => discussionsByPosition(discussions, rows),
    [discussions, rows],
  );
  const discussionZoneHeight = discussionGroups.reduce(
    (total, group) => total + discussionGroupHeight(group.discussions),
    0,
  );
  const editorHeight = Math.max(
    240,
    editorModel.lines.length * 18 + discussionZoneHeight + 16,
  );

  useEffect(() => {
    onOpenSymbolRef.current = onOpenSymbol;
  }, [onOpenSymbol]);

  useEffect(() => {
    onToggleCollapsedGapRef.current = onToggleCollapsedGap;
  }, [onToggleCollapsedGap]);

  useEffect(() => {
    onSelectCommentRangeRef.current = onSelectCommentRange;
  }, [onSelectCommentRange]);

  useEffect(() => {
    const editorElement = editorElementRef.current;
    if (!editorElement) return;
    let disposed = false;
    let cleanup = () => {};

    void (async () => {
      const monaco = await loadMonaco();
      if (disposed) return;

      defineMonacoTheme(monaco);

      const model = monaco.editor.createModel(
        editorModel.source,
        languageForFile(file.filename),
      );
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
          horizontal: "hidden",
          horizontalScrollbarSize: 0,
          vertical: "hidden",
          verticalScrollbarSize: 0,
        },
        overviewRulerLanes: 0,
        renderLineHighlight: "none",
        scrollBeyondLastLine: false,
        stickyScroll: { enabled: false },
        wordWrap: "off",
        lineNumbers: (lineNumber: number) =>
          editorModel.lineNumbers[lineNumber - 1] ?? "",
        padding: { top: 8, bottom: 8 },
      });
      const diffDecorations = editor.createDecorationsCollection(
        diffDecorationsForRows(
          monaco,
          editorModel.rows,
          discussions,
          draftComments,
          true,
          commentSelection,
          null,
        ),
      );
      const discussionZoneRoots = applyDiffDiscussionZones(
        editor,
        discussionGroups,
        replyStateByDiscussionId,
        onReplyToDiscussion,
      );
      let interactionSelection: LineSelection = null;
      let interactionSelectionKey = "";
      const setInteractionSelection = (selection: LineSelection) => {
        const nextKey = selection
          ? `${selection.file}:${selection.startLine}-${selection.endLine}`
          : "";
        if (nextKey === interactionSelectionKey) return;
        interactionSelection = selection;
        interactionSelectionKey = nextKey;
        diffDecorations.set(
          diffDecorationsForRows(
            monaco,
            editorModel.rows,
            discussions,
            draftComments,
            true,
            commentSelection,
            interactionSelection,
          ),
        );
      };

      const clickDisposable = editor.onMouseDown(
        (event: Monaco.editor.IEditorMouseEvent) => {
          const position = event.target.position;
          if (!position) return;
          const row = editorModel.rows[position.lineNumber - 1];
          if (row?.collapsedLines) {
            event.event.preventDefault();
            onToggleCollapsedGapRef.current(file, row);
            return;
          }
          if (!event.event.metaKey && !event.event.ctrlKey) return;
          if (!row?.newLine) return;
          const word = model.getWordAtPosition(position);
          if (!word) return;
          const line = displayDiffLine(row);
          if (!isClickableSymbol(line, word.word, word.startColumn - 1)) return;
          event.event.preventDefault();
          onOpenSymbolRef.current(
            file.filename,
            row.newLine,
            position.column,
            word.word,
            true,
          );
        },
      );
      const editorPointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return;
        const target = editor.getTargetAtClientPoint(event.clientX, event.clientY);
        const position = target?.position;
        if (!position) return;
        const row = editorModel.rows[position.lineNumber - 1];
        if (row?.collapsedLines && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          clearMonacoTextFocus();
          onToggleCollapsedGapRef.current(file, row);
          return;
        }

        if (event.metaKey || event.ctrlKey) {
          const word = model.getWordAtPosition(position);
          const line = row ? displayDiffLine(row) : "";
          if (
            row?.newLine &&
            word &&
            isClickableSymbol(line, word.word, word.startColumn - 1)
          ) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            clearMonacoTextFocus();
            onOpenSymbolRef.current(
              file.filename,
              row.newLine,
              position.column,
              word.word,
              true,
            );
            return;
          }
        }

        if (row?.newLine) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        clearMonacoTextFocus();
      };
      const mouseUpDisposable = editor.onMouseUp(
        (event: Monaco.editor.IEditorMouseEvent) => {
          if (dragStartLineRef.current == null) return;
          const endLine =
            newLineFromMouseEvent(event, editorModel.rows) ??
            dragStartLineRef.current;
          onSelectCommentRangeRef.current({
            file: file.filename,
            startLine: Math.min(dragStartLineRef.current, endLine),
            endLine: Math.max(dragStartLineRef.current, endLine),
          });
          dragStartLineRef.current = null;
          setInteractionSelection(null);
        },
      );
      const mouseMoveDisposable = editor.onMouseMove(
        (event: Monaco.editor.IEditorMouseEvent) => {
          const hoverLine = newLineFromMouseEvent(event, editorModel.rows);
          if (!hoverLine) {
            if (dragStartLineRef.current == null) setInteractionSelection(null);
            return;
          }
          const startLine = dragStartLineRef.current ?? hoverLine;
          setInteractionSelection({
            file: file.filename,
            startLine: Math.min(startLine, hoverLine),
            endLine: Math.max(startLine, hoverLine),
          });
        },
      );
      const mouseLeaveDisposable = editor.onMouseLeave(() => {
        if (dragStartLineRef.current == null) {
          setInteractionSelection(null);
        }
      });
      const commentPointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
        const newLine = newLineFromClientPoint(
          editor,
          editorModel.rows,
          event.clientX,
          event.clientY,
        );
        if (!newLine) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        editorElement.setPointerCapture?.(event.pointerId);
        dragStartLineRef.current = newLine;
        editor.setSelection(new monaco.Range(1, 1, 1, 1));
        setInteractionSelection({
          file: file.filename,
          startLine: newLine,
          endLine: newLine,
        });
      };
      const commentPointerMove = (event: PointerEvent) => {
        const hoverLine = newLineFromClientPoint(
          editor,
          editorModel.rows,
          event.clientX,
          event.clientY,
        );
        if (!hoverLine) return;
        if (dragStartLineRef.current != null) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
        }
        const startLine = dragStartLineRef.current ?? hoverLine;
        editor.setSelection(new monaco.Range(1, 1, 1, 1));
        setInteractionSelection({
          file: file.filename,
          startLine: Math.min(startLine, hoverLine),
          endLine: Math.max(startLine, hoverLine),
        });
      };
      const commentPointerUp = (event: PointerEvent) => {
        if (dragStartLineRef.current == null) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const endLine =
          newLineFromClientPoint(
            editor,
            editorModel.rows,
            event.clientX,
            event.clientY,
          ) ?? dragStartLineRef.current;
        onSelectCommentRangeRef.current({
          file: file.filename,
          startLine: Math.min(dragStartLineRef.current, endLine),
          endLine: Math.max(dragStartLineRef.current, endLine),
        });
        dragStartLineRef.current = null;
        setInteractionSelection(null);
        editor.setSelection(new monaco.Range(1, 1, 1, 1));
        if (editorElement.hasPointerCapture?.(event.pointerId)) {
          editorElement.releasePointerCapture?.(event.pointerId);
        }
      };
      const scrollDiffWithKeyboard = (event: KeyboardEvent) => {
        const scrollContainer = editorElement.closest(".diff");
        if (!(scrollContainer instanceof HTMLElement)) return;

        const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
        scrollDiffPaneWithArrowKey(event, scrollContainer, lineHeight);
      };
      editorElement.addEventListener("pointerdown", editorPointerDown, true);
      editorElement.addEventListener("pointerdown", commentPointerDown, true);
      editorElement.addEventListener("pointermove", commentPointerMove, true);
      editorElement.addEventListener("pointerup", commentPointerUp, true);
      editorElement.addEventListener("keydown", scrollDiffWithKeyboard, true);

      cleanup = () => {
        editorElement.removeEventListener(
          "pointerdown",
          editorPointerDown,
          true,
        );
        editorElement.removeEventListener(
          "pointerdown",
          commentPointerDown,
          true,
        );
        editorElement.removeEventListener(
          "pointermove",
          commentPointerMove,
          true,
        );
        editorElement.removeEventListener("pointerup", commentPointerUp, true);
        editorElement.removeEventListener(
          "keydown",
          scrollDiffWithKeyboard,
          true,
        );
        clickDisposable.dispose();
        mouseUpDisposable.dispose();
        mouseMoveDisposable.dispose();
        mouseLeaveDisposable.dispose();
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
  }, [
    commentSelection,
    discussionGroups,
    discussions,
    draftComments,
    editorModel,
    file.filename,
    onReplyToDiscussion,
    replyStateByDiscussionId,
    theme,
  ]);

  return (
    <div
      ref={editorElementRef}
      className="diff-editor diff-editor-comment-mode"
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
  onOpenSymbol: (
    file: string,
    line: number,
    column: number,
    symbol: string,
  ) => void;
}) {
  const latestContext = contexts.at(-1) ?? null;
  const contextStackRef = useRef<HTMLDivElement | null>(null);
  const latestContextRef = useRef<HTMLElement | null>(null);
  const previousContextCountRef = useRef(contexts.length);

  useEffect(() => {
    if (contexts.length <= previousContextCountRef.current) {
      previousContextCountRef.current = contexts.length;
      return;
    }

    previousContextCountRef.current = contexts.length;
    const animationFrame = window.requestAnimationFrame(() => {
      const contextStack = contextStackRef.current;
      const latestContextElement = latestContextRef.current;
      if (!contextStack || !latestContextElement) return;

      const stackRect = contextStack.getBoundingClientRect();
      const contextRect = latestContextElement.getBoundingClientRect();
      const targetScrollTop =
        contextStack.scrollTop + contextRect.bottom - stackRect.bottom;

      animateScrollTop(contextStack, Math.max(0, targetScrollTop), 260);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [contexts.length]);

  return (
    <section className="panel symbol-context">
      <div className="panel-heading split">
        <h2>Context</h2>
        <div className="heading-actions">
          <span>
            {state === "loading"
              ? "Loading"
              : latestContext
                ? latestContext.source === "language-service" ||
                  latestContext.source === "language-server"
                  ? "Definition"
                  : `${latestContext.startLine}-${latestContext.endLine}`
                : "Cmd-click"}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Close context pane"
            title="Close context pane"
            onClick={onClose}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      {state === "error" ? (
        <p className="context-error">
          {error ?? "Could not load symbol context."}
        </p>
      ) : null}
      {contexts.length > 0 ? (
        <div className="context-stack" ref={contextStackRef}>
          {contexts.map((context, contextIndex) => (
            <article
              className="context-entry"
              key={`${context.file}-${context.startLine}-${context.symbol}-${contextIndex}`}
              ref={
                contextIndex === contexts.length - 1 ? latestContextRef : null
              }
            >
              <div className="context-entry-heading">
                <div className="context-title">
                  <strong>{context.title}</strong>
                  <span>
                    {context.file} · lines {context.startLine}-{context.endLine}
                  </span>
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
              <ContextCodeEditor
                context={context}
                theme={theme}
                onOpenSymbol={onOpenSymbol}
              />
            </article>
          ))}
        </div>
      ) : state !== "error" ? (
        <p className="muted">Finding symbol</p>
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
  onOpenSymbol: (
    file: string,
    line: number,
    column: number,
    symbol: string,
  ) => void;
}) {
  const editorElementRef = useRef<HTMLDivElement | null>(null);
  const onOpenSymbolRef = useRef(onOpenSymbol);
  const editorCode = context.sourceCode ?? context.code;
  const isFullFileContext = Boolean(context.sourceCode);
  const lineCount = editorCode.split("\n").length;
  const defaultEditorHeight = Math.min(
    420,
    Math.max(minContextEditorHeight, lineCount * 18 + 16),
  );
  const [editorHeight, setEditorHeight] = useState(defaultEditorHeight);

  useEffect(() => {
    setEditorHeight(defaultEditorHeight);
  }, [defaultEditorHeight]);

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

      const model = monaco.editor.createModel(
        editorCode,
        languageForFile(context.file),
      );
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
          horizontal: "hidden",
          horizontalScrollbarSize: 0,
          vertical: "hidden",
          verticalScrollbarSize: 0,
        },
        overviewRulerLanes: 0,
        renderLineHighlight: "none",
        scrollBeyondLastLine: false,
        stickyScroll: { enabled: false },
        wordWrap: "off",
        lineNumbers: (lineNumber: number) =>
          String(
            isFullFileContext ? lineNumber : context.startLine + lineNumber - 1,
          ),
        padding: { top: 8, bottom: 8 },
      });
      const symbolDecorations = editor.createDecorationsCollection(
        symbolDecorationsForContext(
          monaco,
          editorCode,
          context,
          isFullFileContext,
        ),
      );
      if (isFullFileContext) {
        editor.revealLineInCenter(context.startLine);
        editor.setPosition({ lineNumber: context.startLine, column: 1 });
      }

      const clickDisposable = editor.onMouseDown(
        (event: Monaco.editor.IEditorMouseEvent) => {
          if (!event.event.metaKey && !event.event.ctrlKey) return;
          const position = event.target.position;
          if (!position) return;
          const word = model.getWordAtPosition(position);
          if (!word) return;
          const line = model.getLineContent(position.lineNumber);
          if (!isClickableSymbol(line, word.word, word.startColumn - 1)) return;
          event.event.preventDefault();
          const sourceLine = isFullFileContext
            ? position.lineNumber
            : context.startLine + position.lineNumber - 1;
          onOpenSymbolRef.current(
            context.file,
            sourceLine,
            position.column,
            word.word,
          );
        },
      );
      const editorPointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return;
        const target = editor.getTargetAtClientPoint(event.clientX, event.clientY);
        const position = target?.position;
        if (!position) return;

        if (event.metaKey || event.ctrlKey) {
          const word = model.getWordAtPosition(position);
          const line = model.getLineContent(position.lineNumber);
          if (word && isClickableSymbol(line, word.word, word.startColumn - 1)) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            clearMonacoTextFocus();
            const sourceLine = isFullFileContext
              ? position.lineNumber
              : context.startLine + position.lineNumber - 1;
            onOpenSymbolRef.current(
              context.file,
              sourceLine,
              position.column,
              word.word,
            );
            return;
          }
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        clearMonacoTextFocus();
      };
      editorElement.addEventListener("pointerdown", editorPointerDown, true);

      cleanup = () => {
        editorElement.removeEventListener(
          "pointerdown",
          editorPointerDown,
          true,
        );
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

  function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = editorHeight;

    const onPointerMove = (moveEvent: PointerEvent) => {
      setEditorHeight(
        clamp(
          startHeight + moveEvent.clientY - startY,
          minContextEditorHeight,
          maxContextEditorHeight,
        ),
      );
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const largeStep = event.shiftKey ? 72 : 18;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setEditorHeight((height) =>
        clamp(height + largeStep, minContextEditorHeight, maxContextEditorHeight),
      );
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setEditorHeight((height) =>
        clamp(height - largeStep, minContextEditorHeight, maxContextEditorHeight),
      );
    }
    if (event.key === "Home") {
      event.preventDefault();
      setEditorHeight(minContextEditorHeight);
    }
    if (event.key === "End") {
      event.preventDefault();
      setEditorHeight(maxContextEditorHeight);
    }
  }

  return (
    <div className="context-editor-frame">
      <div
        ref={editorElementRef}
        className="context-editor"
        style={{ height: `${editorHeight}px` }}
        aria-label={`${context.title} source context`}
      />
      <button
        type="button"
        className="context-resize-handle"
        aria-label={`Resize ${context.title} source context`}
        title="Drag to resize snippet"
        onPointerDown={startResize}
        onKeyDown={resizeWithKeyboard}
      />
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
        range: new monaco.Range(
          lineIndex + 1,
          token.startIndex + 1,
          lineIndex + 1,
          token.startIndex + token.text.length + 1,
        ),
        options: {
          inlineClassName: "context-symbol-token",
        },
      })),
  );

  if (!isFullFileContext) {
    return symbolDecorations;
  }

  const focusDecorations = Array.from(
    { length: context.endLine - context.startLine + 1 },
    (_, index) => ({
      range: new monaco.Range(
        context.startLine + index,
        1,
        context.startLine + index,
        1,
      ),
      options: {
        isWholeLine: true,
        className: "context-focus-line",
      },
    }),
  );

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

function buildDiffEditorModel(rows: DiffRow[]): {
  source: string;
  lines: string[];
  lineNumbers: string[];
  rows: DiffRow[];
} {
  const lines = rows.map((row) => displayDiffLine(row));
  return {
    source: lines.join("\n"),
    lines,
    lineNumbers: rows.map((row) => {
      if (row.collapsedLines) return "...";
      if (row.newLine) return String(row.newLine);
      if (row.oldLine) return String(row.oldLine);
      return "";
    }),
    rows,
  };
}

function isClickableSymbol(
  line: string,
  symbol: string,
  startIndex: number,
): boolean {
  if (
    !symbol ||
    nonClickableSymbols.has(symbol) ||
    isInsideString(line, startIndex) ||
    isInsideLineComment(line, startIndex)
  ) {
    return false;
  }

  const before = line.slice(0, startIndex);
  const after = line.slice(startIndex + symbol.length);
  if (
    new RegExp(
      `\\b(class|def|function|interface|type)\\s+${escapeRegExp(symbol)}\\b`,
    ).test(line)
  ) {
    return true;
  }
  if (
    new RegExp(
      `\\b(const|let|var)\\s+${escapeRegExp(symbol)}\\b\\s*=\\s*(async\\s*)?(function\\b|\\([^)]*\\)|[$A-Z_a-z][$\\w]*)?\\s*=>`,
    ).test(line)
  ) {
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
  let quote: "'" | '"' | "`" | null = null;
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
    if (char === "'" || char === '"' || char === "`") {
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

export function diffDecorationsForRows(
  monaco: MonacoApi,
  rows: DiffRow[],
  discussions: PullRequestDiscussion[],
  draftComments: DraftReviewComment[],
  _commentMode: boolean,
  commentSelection: LineSelection,
  interactionSelection: LineSelection,
): Monaco.editor.IModelDeltaDecoration[] {
  return rows.flatMap((row, index) => {
    const lineNumber = index + 1;
    const diffPosition = row.diffPosition;
    const lineClasses = ["diff-monaco-line"];
    if (row.kind === "added") lineClasses.push("diff-monaco-line-added");
    if (row.kind === "removed") lineClasses.push("diff-monaco-line-removed");
    if (row.kind === "hunk") lineClasses.push("diff-monaco-line-hunk");
    if (row.collapsedLines) lineClasses.push("diff-monaco-line-collapsed");
    if (
      discussions.some((discussion) =>
        discussionAffectsDiffRow(discussion, row),
      )
    ) {
      lineClasses.push("diff-monaco-line-comment");
    }
    if (
      row.newLine &&
      draftComments.some(
        (comment) =>
          row.newLine != null &&
          row.newLine >= comment.startLine &&
          row.newLine <= comment.endLine,
      )
    ) {
      lineClasses.push("diff-monaco-line-draft-comment");
    }
    if (row.newLine) {
      lineClasses.push("diff-monaco-line-commentable");
    }
    if (
      row.newLine &&
      commentSelection?.file &&
      row.newLine >= commentSelection.startLine &&
      row.newLine <= commentSelection.endLine
    ) {
      lineClasses.push("diff-monaco-line-selected-comment");
    }
    if (
      row.newLine &&
      interactionSelection?.file &&
      row.newLine >= interactionSelection.startLine &&
      row.newLine <= interactionSelection.endLine
    ) {
      lineClasses.push("diff-monaco-line-hover-comment");
    }

    const hasCommentSelectionEdge =
      lineClasses.includes("diff-monaco-line-selected-comment") ||
      lineClasses.includes("diff-monaco-line-hover-comment");
    const marginClasses = lineClasses.filter(
      (className) =>
        className !== "diff-monaco-line-selected-comment" &&
        className !== "diff-monaco-line-hover-comment",
    );
    if (hasCommentSelectionEdge) {
      marginClasses.push("diff-monaco-line-comment-selection-fill");
      marginClasses.push("diff-monaco-line-comment-selection-edge");
    }
    const lineDecoration: Monaco.editor.IModelDeltaDecoration = {
      range: new monaco.Range(lineNumber, 1, lineNumber, 1),
      options: {
        isWholeLine: true,
        className: lineClasses.join(" "),
        lineNumberClassName: marginClasses.join(" "),
        marginClassName: marginClasses.join(" "),
      },
    };

    if (!row.newLine) {
      return [lineDecoration];
    }

    const symbolDecorations = tokenizeCodeLine(displayDiffLine(row))
      .filter((token) => token.kind === "identifier")
      .filter((token) =>
        isClickableSymbol(displayDiffLine(row), token.text, token.startIndex),
      )
      .map((token) => ({
        range: new monaco.Range(
          lineNumber,
          token.startIndex + 1,
          lineNumber,
          token.startIndex + token.text.length + 1,
        ),
        options: {
          inlineClassName: "context-symbol-token",
        },
      }));

    return [lineDecoration, ...symbolDecorations];
  });
}

function newLineFromMouseEvent(
  event: Monaco.editor.IEditorMouseEvent,
  rows: DiffRow[],
): number | null {
  const position = event.target.position;
  if (!position) return null;
  return rows[position.lineNumber - 1]?.newLine ?? null;
}

function newLineFromClientPoint(
  editor: Monaco.editor.IStandaloneCodeEditor,
  rows: DiffRow[],
  clientX: number,
  clientY: number,
): number | null {
  const target = editor.getTargetAtClientPoint(clientX, clientY);
  const lineNumber = target?.position?.lineNumber;
  if (!lineNumber) return null;
  return rows[lineNumber - 1]?.newLine ?? null;
}

function discussionsByPosition(
  discussions: PullRequestDiscussion[],
  rows: DiffRow[],
): Array<{ position: number; discussions: PullRequestDiscussion[] }> {
  const grouped = new Map<number, PullRequestDiscussion[]>();
  const editorLineByDiffPosition = new Map<number, number>();
  const editorLineByRightLine = new Map<number, number>();
  const editorLineByLeftLine = new Map<number, number>();

  rows.forEach((row, index) => {
    const editorLine = index + 1;
    if (row.diffPosition) {
      editorLineByDiffPosition.set(row.diffPosition, editorLine);
    }
    if (row.newLine) {
      editorLineByRightLine.set(row.newLine, editorLine);
    }
    if (row.oldLine) {
      editorLineByLeftLine.set(row.oldLine, editorLine);
    }
  });

  for (const discussion of discussions) {
    const position =
      discussion.line != null
        ? discussion.side === "LEFT"
          ? editorLineByLeftLine.get(discussion.line)
          : editorLineByRightLine.get(discussion.line)
        : discussion.position != null
          ? editorLineByDiffPosition.get(discussion.position)
          : undefined;
    if (!position) continue;
    grouped.set(position, [...(grouped.get(position) ?? []), discussion]);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([position, group]) => ({ position, discussions: group }));
}

function applyDiffDiscussionZones(
  editor: Monaco.editor.IStandaloneCodeEditor,
  groups: Array<{ position: number; discussions: PullRequestDiscussion[] }>,
  replyStateByDiscussionId: Record<string, { status: "submitting" | "error"; message?: string }>,
  onReply: (discussion: PullRequestDiscussion, body: string) => void,
): Root[] {
  const roots: Root[] = [];
  editor.changeViewZones((accessor) => {
    for (const group of groups) {
      const node = document.createElement("div");
      node.className = "diff-discussion-zone";
      const root = createRoot(node);
      root.render(
        <InlineDiscussions
          discussions={group.discussions}
          replyStateByDiscussionId={replyStateByDiscussionId}
          onReply={onReply}
        />,
      );
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
    return height + Math.max(126, 110 + bodyLines * 18);
  }, 8);
}

function InlineDiscussions({
  discussions,
  replyStateByDiscussionId = {},
  onReply,
  onHoverDiscussion,
}: {
  discussions: PullRequestDiscussion[];
  replyStateByDiscussionId?: Record<string, { status: "submitting" | "error"; message?: string }>;
  onReply?: (discussion: PullRequestDiscussion, body: string) => void;
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
            {onReply ? (
              <DiscussionReplyComposer
                discussion={discussion}
                state={replyStateByDiscussionId[discussion.id]}
                onReply={onReply}
              />
            ) : null}
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
            {onReply ? (
              <DiscussionReplyComposer
                discussion={discussion}
                state={replyStateByDiscussionId[discussion.id]}
                onReply={onReply}
              />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function DiscussionReplyComposer({
  discussion,
  state,
  onReply,
}: {
  discussion: PullRequestDiscussion;
  state?: { status: "submitting" | "error"; message?: string };
  onReply: (discussion: PullRequestDiscussion, body: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [body, setBody] = useState("");
  const isSubmitting = state?.status === "submitting";

  useEffect(() => {
    if (!isSubmitting && state?.status !== "error") {
      setBody("");
      setIsOpen(false);
    }
  }, [isSubmitting, state?.status]);

  if (!isOpen) {
    return (
      <button
        type="button"
        className="discussion-reply-toggle"
        onClick={() => setIsOpen(true)}
      >
        <MessageSquareText size={14} aria-hidden="true" />
        Reply
      </button>
    );
  }

  return (
    <form
      className="discussion-reply-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.trim() || isSubmitting) return;
        onReply(discussion, body);
      }}
    >
      <textarea
        value={body}
        aria-label={`Reply to ${discussion.author}`}
        placeholder="Reply to this discussion"
        disabled={isSubmitting}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !isSubmitting) {
            event.preventDefault();
            setIsOpen(false);
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            if (body.trim() && !isSubmitting) {
              onReply(discussion, body);
            }
          }
        }}
      />
      {state?.status === "error" ? (
        <p className="discussion-reply-error">{state.message}</p>
      ) : null}
      <div className="composer-actions">
        <button
          type="button"
          className="secondary-action"
          disabled={isSubmitting}
          onClick={() => setIsOpen(false)}
        >
          <X size={14} aria-hidden="true" />
          Cancel
        </button>
        <button
          type="submit"
          className="primary-action"
          disabled={!body.trim() || isSubmitting}
        >
          {isSubmitting ? (
            <Loader2 className="spin" size={14} aria-hidden="true" />
          ) : (
            <Send size={14} aria-hidden="true" />
          )}
          {isSubmitting ? "Replying" : "Reply"}
        </button>
      </div>
    </form>
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

function Welcome({
  url,
  repositories,
  selectedRepository,
  pullRequests,
  isLoading,
  repoListState,
  prListState,
  error,
  onUrlChange,
  onLoadPullRequest,
  onSelectRepository,
  onReloadRepositories,
  onSearchRepositories,
  onToggleRepositoryStar,
}: {
  url: string;
  repositories: RepositorySummary[];
  selectedRepository: RepositorySummary | null;
  pullRequests: PullRequestListItem[];
  isLoading: boolean;
  repoListState: "idle" | "loading" | "error";
  prListState: "idle" | "loading" | "error";
  error: string | null;
  onUrlChange: (url: string) => void;
  onLoadPullRequest: (url?: string) => Promise<void>;
  onSelectRepository: (repository: RepositorySummary) => Promise<void>;
  onReloadRepositories: () => Promise<void>;
  onSearchRepositories: (query: string, owner: string) => Promise<RepositorySummary[]>;
  onToggleRepositoryStar: (repository: RepositorySummary) => Promise<void>;
}) {
  const [repositoryQuery, setRepositoryQuery] = useState("");
  const [repositoryOwner, setRepositoryOwner] = useState("");
  const [searchRepositories, setSearchRepositories] = useState<RepositorySummary[]>([]);
  const [repositorySearchState, setRepositorySearchState] = useState<"idle" | "loading" | "error">("idle");
  const [repositorySearchError, setRepositorySearchError] = useState<string | null>(null);
  const owners = useMemo(() => repositoryOwners(repositories), [repositories]);
  const shouldSearchGitHub = repositoryQuery.trim().length > 0 || repositoryOwner.length > 0;
  const visibleRepositories = shouldSearchGitHub ? searchRepositories : repositories;
  const filteredRepositories = useMemo(
    () =>
      sortRepositoriesForDisplay(
        shouldSearchGitHub
          ? visibleRepositories
          : filterRepositories(visibleRepositories, repositoryQuery, repositoryOwner),
      ),
    [repositoryOwner, repositoryQuery, shouldSearchGitHub, visibleRepositories],
  );

  function applySearchRepositoryStarState(fullName: string, isStarred: boolean) {
    setSearchRepositories((current) =>
      sortRepositoriesForDisplay(
        current.map((repository) =>
          repository.fullName === fullName ? { ...repository, isStarred } : repository,
        ),
      ),
    );
  }

  useEffect(() => {
    if (!shouldSearchGitHub) {
      setSearchRepositories([]);
      setRepositorySearchState("idle");
      setRepositorySearchError(null);
      return;
    }

    let cancelled = false;
    setRepositorySearchState("loading");
    setRepositorySearchError(null);

    const timeoutId = window.setTimeout(() => {
      void onSearchRepositories(repositoryQuery, repositoryOwner)
        .then((nextRepositories) => {
          if (cancelled) return;
          setSearchRepositories(sortRepositoriesForDisplay(nextRepositories));
          setRepositorySearchState("idle");
        })
        .catch((searchError) => {
          if (cancelled) return;
          setSearchRepositories([]);
          setRepositorySearchState("error");
          setRepositorySearchError(searchError instanceof Error ? searchError.message : String(searchError));
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [onSearchRepositories, repositoryOwner, repositoryQuery, shouldSearchGitHub]);

  return (
    <section className="welcome">
      <div className="welcome-heading">
        <GitPullRequest size={32} aria-hidden="true" />
        <div>
          <h2>Choose a pull request to review</h2>
          <p>Select a recent repository, pick a PR, or paste a GitHub pull request URL.</p>
        </div>
      </div>

      <div className="landing-layout">
        <section className="landing-panel repo-panel">
          <div className="landing-panel-heading">
            <h3>Repositories</h3>
            <button
              type="button"
              className="icon-button"
              aria-label="Refresh repositories"
              title="Refresh repositories"
              onClick={() => void onReloadRepositories()}
              disabled={repoListState === "loading"}
            >
              <RefreshCw className={repoListState === "loading" ? "spin" : undefined} size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="repo-search">
            <select
              aria-label="Filter repositories by organization"
              value={repositoryOwner}
              onChange={(event) => setRepositoryOwner(event.target.value)}
            >
              <option value="">All orgs</option>
              {owners.map((owner) => (
                <option key={owner} value={owner}>
                  {owner}
                </option>
              ))}
            </select>
            <input
              type="search"
              aria-label="Filter repositories"
              placeholder="Search repositories"
              value={repositoryQuery}
              onChange={(event) => setRepositoryQuery(event.target.value)}
            />
          </div>
          <div className="selection-list" role="list" aria-label="Recent repositories">
            {filteredRepositories.map((repository) => (
              <div
                key={repository.fullName}
                className={selectedRepository?.fullName === repository.fullName ? "selection-row repo-row selected" : "selection-row repo-row"}
              >
                <button
                  type="button"
                  className={repository.isStarred ? "repo-star-button active" : "repo-star-button"}
                  aria-label={`${repository.isStarred ? "Unstar" : "Star"} ${repository.fullName}`}
                  title={`${repository.isStarred ? "Unstar" : "Star"} ${repository.fullName}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onToggleRepositoryStar(repository).then(() => {
                      applySearchRepositoryStarState(repository.fullName, !repository.isStarred);
                    }).catch(() => {
                      applySearchRepositoryStarState(repository.fullName, Boolean(repository.isStarred));
                    });
                  }}
                >
                  <Star size={15} aria-hidden="true" fill={repository.isStarred ? "currentColor" : "none"} />
                </button>
                <button
                  type="button"
                  className="repo-select-button"
                  onClick={() => void onSelectRepository(repository)}
                >
                  <strong>{repository.fullName}</strong>
                  <small>{repository.description || "No description"}</small>
                </button>
              </div>
            ))}
            {(repoListState === "loading" && repositories.length === 0) || repositorySearchState === "loading" ? (
              <div className="landing-empty">Loading repositories...</div>
            ) : null}
            {repositorySearchState === "error" ? (
              <div className="landing-empty">{repositorySearchError}</div>
            ) : null}
            {repoListState === "idle" && repositorySearchState === "idle" && visibleRepositories.length > 0 && filteredRepositories.length === 0 ? (
              <div className="landing-empty">No repositories match your search.</div>
            ) : null}
            {repositorySearchState === "idle" && shouldSearchGitHub && searchRepositories.length === 0 ? (
              <div className="landing-empty">No repositories found on GitHub.</div>
            ) : null}
          </div>
        </section>

        <section className="landing-panel">
          <div className="landing-panel-heading">
            <h3>{selectedRepository ? selectedRepository.fullName : "Pull requests"}</h3>
          </div>
          <div className="selection-list" role="list" aria-label="Recent pull requests">
            {pullRequests.map((pullRequest) => (
              <button
                key={pullRequest.id}
                type="button"
                className={pullRequestListRowClassName(pullRequest)}
                disabled={isLoading}
                onClick={() => void onLoadPullRequest(pullRequest.url)}
              >
                {isClosedPullRequest(pullRequest) ? (
                  <GitPullRequestClosed className="pr-state-icon" size={15} aria-hidden="true" />
                ) : (
                  <GitPullRequestArrow className="pr-state-icon" size={15} aria-hidden="true" />
                )}
                <span>
                  <strong>#{pullRequest.number} {pullRequest.title}</strong>
                  <small>{pullRequest.state} by {pullRequest.author}</small>
                </span>
              </button>
            ))}
            {prListState === "loading" ? (
              <div className="landing-empty">Loading pull requests...</div>
            ) : null}
            {prListState === "idle" && selectedRepository && pullRequests.length === 0 ? (
              <div className="landing-empty">No recent pull requests found.</div>
            ) : null}
            {!selectedRepository && repoListState !== "loading" ? (
              <div className="landing-empty">Select a repository to show recent pull requests.</div>
            ) : null}
          </div>
        </section>
      </div>

      <form
        className="url-form landing-url-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onLoadPullRequest();
        }}
      >
        <input
          aria-label="GitHub pull request URL"
          placeholder="https://github.com/owner/repo/pull/123"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
        />
        <button type="submit" disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="spin" size={16} aria-hidden="true" />
          ) : (
            <RefreshCw size={16} aria-hidden="true" />
          )}
          Load from URL
        </button>
      </form>

      {error ? <div className="landing-error">{error}</div> : null}
    </section>
  );
}
