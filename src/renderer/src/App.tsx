import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
  GitPullRequest,
  MessageSquarePlus,
  Loader2,
  Moon,
  MessageSquareText,
  RefreshCw,
  Send,
  Sun,
  X,
} from "lucide-react";
import type {
  DraftReviewComment,
  DraftReviewSubmission,
  PullRequestDiscussion,
  PullRequestFile,
  ReviewOutcome,
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
import { buildDiffRows, displayDiffLine, tokenizeCodeLine } from "../../shared/symbol-context";
import {
  adjacentFile,
  createDraftReview,
  reviewProgress,
  toggleFileViewed,
  upsertDraftComment,
  withReviewState,
} from "../../shared/review-state";

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
type LineSelection = {
  file: string;
  startLine: number;
  endLine: number;
} | null;

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
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [symbolContexts, setSymbolContexts] = useState<SymbolContext[]>([]);
  const [symbolState, setSymbolState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [symbolError, setSymbolError] = useState<string | null>(null);
  const [commentMode, setCommentMode] = useState(false);
  const [commentSelection, setCommentSelection] = useState<LineSelection>(null);
  const [finishReviewOpen, setFinishReviewOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

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

  const showSymbolSplit =
    symbolState === "loading" ||
    symbolState === "error" ||
    symbolContexts.length > 0;
  const nextTheme = theme === "dark" ? "light" : "dark";
  const shortcuts = useMemo(() => keyboardShortcuts(), []);

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
      if (event.key.toLowerCase() === "c" && event.shiftKey) {
        event.preventDefault();
        setCommentMode((current) => !current);
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
      setWorkspace(nextWorkspace);
      setSelectedFile(nextWorkspace.pullRequest.files[0]?.filename ?? null);
      setSymbolContexts([]);
      setSymbolState("idle");
      setSymbolError(null);
      setUrl(nextWorkspace.pullRequest.summary.url);
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

  return (
    <main className="app-shell">
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
            {isLoading ? (
              <Loader2 className="spin" size={16} aria-hidden="true" />
            ) : (
              <RefreshCw size={16} aria-hidden="true" />
            )}
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
                  className={
                    showSymbolSplit ? "review-columns split" : "review-columns"
                  }
                >
                  <DiffViewer
                    file={currentFile}
                    discussions={workspace.pullRequest.discussions}
                    draftComments={workspace.draftComments ?? []}
                    theme={theme}
                    commentMode={commentMode}
                    commentSelection={commentSelection}
                    onOpenSymbol={openSymbolContext}
                    onSelectCommentRange={setCommentSelection}
                  />
                  {showSymbolSplit ? (
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
                  ) : null}
                </div>
                <ReviewActionPane
                  workspace={workspace}
                  currentFile={currentFile}
                  commentMode={commentMode}
                  commentSelection={commentSelection}
                  shortcuts={shortcuts}
                  onNextFile={() => selectAdjacentFile("next")}
                  onPreviousFile={() => selectAdjacentFile("previous")}
                  onMarkViewed={toggleCurrentFileViewed}
                  onToggleCommentMode={() =>
                    setCommentMode((current) => !current)
                  }
                  onCancelComment={() => setCommentSelection(null)}
                  onSaveComment={saveDraftComment}
                  onFinishReview={() => setFinishReviewOpen(true)}
                />
              </>
            ) : (
              <Welcome />
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
    comment: `${modifier}+Shift+C`,
    finish: `${modifier}+Shift+Enter`,
    approve: `${modifier}+Shift+A`,
    requestChanges: `${modifier}+Shift+R`,
    submitComment: `${modifier}+Shift+M`,
    saveComment: `${modifier}+S`,
    cancel: "Esc",
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches("input, textarea, select, [contenteditable='true']");
}

function ReviewActionPane({
  workspace,
  currentFile,
  commentMode,
  commentSelection,
  shortcuts,
  onNextFile,
  onPreviousFile,
  onMarkViewed,
  onToggleCommentMode,
  onCancelComment,
  onSaveComment,
  onFinishReview,
}: {
  workspace: ReviewWorkspace;
  currentFile: PullRequestFile;
  commentMode: boolean;
  commentSelection: LineSelection;
  shortcuts: ReturnType<typeof keyboardShortcuts>;
  onNextFile: () => void;
  onPreviousFile: () => void;
  onMarkViewed: () => void;
  onToggleCommentMode: () => void;
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
      document.documentElement.style.removeProperty("--review-action-pane-height");
    };
  }, [commentMode, commentSelection, draftComments.length]);

  return (
    <section ref={paneRef} className="review-action-pane" aria-label="Review actions">
      <div className="review-action-status">
        <strong>{currentFile.filename}</strong>
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
          label={commentMode ? "Comment on" : "Comment"}
          shortcut={shortcuts.comment}
          pressed={commentMode}
          onClick={onToggleCommentMode}
        >
          <MessageSquarePlus size={15} aria-hidden="true" />
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
      {commentMode ? (
        <div className="comment-mode-hint" role="status">
          {commentSelection
            ? "Add your draft comment below."
            : "Click or drag changed lines in the diff to draft a comment."}
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
  intent?: "primary" | "secondary";
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
  commentMode,
  commentSelection,
  onOpenSymbol,
  onSelectCommentRange,
}: {
  file: PullRequestFile;
  discussions: PullRequestDiscussion[];
  draftComments: DraftReviewComment[];
  theme: ThemeMode;
  commentMode: boolean;
  commentSelection: LineSelection;
  onOpenSymbol: (
    file: string,
    line: number,
    column: number,
    symbol: string,
  ) => void;
  onSelectCommentRange: (selection: Exclude<LineSelection, null>) => void;
}) {
  const rows = useMemo(
    () =>
      buildDiffRows(file.patch || "Diff omitted by GitHub API for this file."),
    [file.patch],
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
    () => fileDiscussions.filter((discussion) => !discussion.position),
    [fileDiscussions],
  );
  const lineDiscussions = useMemo(
    () => fileDiscussions.filter((discussion) => discussion.position),
    [fileDiscussions],
  );

  return (
    <section className="diff-panel">
      <div className="diff-heading">
        <FileCode2 size={18} aria-hidden="true" />
        <div>
          <h3>{file.filename}</h3>
          <p>
            {file.status} · {file.changes} changes
          </p>
        </div>
      </div>
      <div
        className="diff"
        role="region"
        aria-label={`Diff for ${file.filename}`}
      >
        {topDiscussions.length > 0 ? (
          <InlineDiscussions discussions={topDiscussions} />
        ) : null}
        <DiffCodeEditor
          file={file}
          rows={rows}
          discussions={lineDiscussions}
          draftComments={fileDraftComments}
          theme={theme}
          commentMode={commentMode}
          commentSelection={
            commentSelection?.file === file.filename ? commentSelection : null
          }
          onOpenSymbol={onOpenSymbol}
          onSelectCommentRange={onSelectCommentRange}
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
  commentMode,
  commentSelection,
  onOpenSymbol,
  onSelectCommentRange,
}: {
  file: PullRequestFile;
  rows: DiffRow[];
  discussions: PullRequestDiscussion[];
  draftComments: DraftReviewComment[];
  theme: ThemeMode;
  commentMode: boolean;
  commentSelection: LineSelection;
  onOpenSymbol: (
    file: string,
    line: number,
    column: number,
    symbol: string,
  ) => void;
  onSelectCommentRange: (selection: Exclude<LineSelection, null>) => void;
}) {
  const editorElementRef = useRef<HTMLDivElement | null>(null);
  const onOpenSymbolRef = useRef(onOpenSymbol);
  const onSelectCommentRangeRef = useRef(onSelectCommentRange);
  const commentModeRef = useRef(commentMode);
  const dragStartLineRef = useRef<number | null>(null);
  const editorModel = useMemo(() => buildDiffEditorModel(rows), [rows]);
  const discussionGroups = useMemo(
    () => discussionsByPosition(discussions, rows.length),
    [discussions, rows.length],
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
    onSelectCommentRangeRef.current = onSelectCommentRange;
  }, [onSelectCommentRange]);

  useEffect(() => {
    commentModeRef.current = commentMode;
  }, [commentMode]);

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
          horizontalScrollbarSize: 10,
          verticalScrollbarSize: 10,
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
          commentMode,
          commentSelection,
          null,
        ),
      );
      const discussionZoneRoots = applyDiffDiscussionZones(
        editor,
        discussionGroups,
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
            commentModeRef.current,
            commentSelection,
            interactionSelection,
          ),
        );
      };

      const clickDisposable = editor.onMouseDown(
        (event: Monaco.editor.IEditorMouseEvent) => {
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
          onOpenSymbolRef.current(
            file.filename,
            row.newLine,
            position.column,
            word.word,
          );
        },
      );
      const mouseUpDisposable = editor.onMouseUp(
        (event: Monaco.editor.IEditorMouseEvent) => {
          if (!commentModeRef.current || dragStartLineRef.current == null)
            return;
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
          if (!commentModeRef.current) {
            setInteractionSelection(null);
            return;
          }
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
        if (!commentModeRef.current || event.button !== 0) return;
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
        if (!commentModeRef.current) return;
        const hoverLine = newLineFromClientPoint(
          editor,
          editorModel.rows,
          event.clientX,
          event.clientY,
        );
        if (!hoverLine) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const startLine = dragStartLineRef.current ?? hoverLine;
        editor.setSelection(new monaco.Range(1, 1, 1, 1));
        setInteractionSelection({
          file: file.filename,
          startLine: Math.min(startLine, hoverLine),
          endLine: Math.max(startLine, hoverLine),
        });
      };
      const commentPointerUp = (event: PointerEvent) => {
        if (!commentModeRef.current || dragStartLineRef.current == null) return;
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
      editorElement.addEventListener("pointerdown", commentPointerDown, true);
      editorElement.addEventListener("pointermove", commentPointerMove, true);
      editorElement.addEventListener("pointerup", commentPointerUp, true);

      cleanup = () => {
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
    commentMode,
    commentSelection,
    discussionGroups,
    discussions,
    draftComments,
    editorModel,
    file.filename,
    theme,
  ]);

  return (
    <div
      ref={editorElementRef}
      className={`diff-editor${commentMode ? " diff-editor-comment-mode" : ""}`}
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
        <div className="context-stack">
          {contexts.map((context, contextIndex) => (
            <article
              className="context-entry"
              key={`${context.file}-${context.startLine}-${context.symbol}-${contextIndex}`}
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
        <p className="muted">
          Cmd-click an identifier in the diff to inspect its implementation
          here.
        </p>
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
          horizontalScrollbarSize: 10,
          verticalScrollbarSize: 10,
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

function diffDecorationsForRows(
  monaco: MonacoApi,
  rows: DiffRow[],
  discussions: PullRequestDiscussion[],
  draftComments: DraftReviewComment[],
  commentMode: boolean,
  commentSelection: LineSelection,
  interactionSelection: LineSelection,
): Monaco.editor.IModelDeltaDecoration[] {
  return rows.flatMap((row, index) => {
    const lineNumber = index + 1;
    const diffPosition = index + 1;
    const lineClasses = ["diff-monaco-line"];
    if (row.kind === "added") lineClasses.push("diff-monaco-line-added");
    if (row.kind === "removed") lineClasses.push("diff-monaco-line-removed");
    if (row.kind === "hunk") lineClasses.push("diff-monaco-line-hunk");
    if (
      discussions.some((discussion) =>
        discussionAffectsDiffPosition(discussion, diffPosition),
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
    if (row.newLine && commentMode) {
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

    const lineDecoration: Monaco.editor.IModelDeltaDecoration = {
      range: new monaco.Range(lineNumber, 1, lineNumber, 1),
      options: {
        isWholeLine: true,
        className: lineClasses.join(" "),
        lineNumberClassName: lineClasses.join(" "),
        marginClassName: lineClasses.join(" "),
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

function Welcome() {
  return (
    <section className="welcome">
      <GitPullRequest size={36} aria-hidden="true" />
      <h2>Local PR reading, no checkout required.</h2>
      <p>
        Load a pull request to inspect metadata, changed files, review
        discussion, and unified diffs in one focused workspace.
      </p>
    </section>
  );
}
