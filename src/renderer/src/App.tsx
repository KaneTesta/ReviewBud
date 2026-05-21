import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  FileCode2,
  GitPullRequest,
  HelpCircle,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type {
  PullRequestDiscussion,
  PullRequestFile,
  RecentPullRequest,
  ReviewNote,
  ReviewWorkspace,
  SymbolContext,
} from "../../shared/types";
import {
  discussionAffectsDiffPosition,
  discussionStateLabels,
  discussionsForFile,
  shouldCollapseDiscussion,
} from "../../shared/discussions";
import { buildDiffRows, tokenizeCodeLine } from "../../shared/symbol-context";

const defaultUrl = "";

export function App() {
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

  function closeSymbolContext() {
    setSymbolContexts([]);
    setSymbolState("idle");
    setSymbolError(null);
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
                <DiffViewer file={currentFile} discussions={workspace.pullRequest.discussions} onOpenSymbol={openSymbolContext} />
                {showSymbolSplit ? (
                  <SymbolContextPanel
                    contexts={symbolContexts}
                    state={symbolState}
                    error={symbolError}
                    onClose={closeSymbolContext}
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
  onOpenSymbol,
}: {
  file: PullRequestFile;
  discussions: PullRequestDiscussion[];
  onOpenSymbol: (file: string, line: number, column: number, symbol: string) => void;
}) {
  const rows = buildDiffRows(file.patch || "Diff omitted by GitHub API for this file.");
  const fileDiscussions = discussionsForFile(discussions, file.filename);
  const topDiscussions = fileDiscussions.filter((discussion) => !discussion.position);
  const [hoveredDiscussion, setHoveredDiscussion] = useState<PullRequestDiscussion | null>(null);

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
        {rows.map((row, index) => {
          const diffPosition = index + 1;
          const rowDiscussions = fileDiscussions.filter((discussion) => discussionAffectsDiffPosition(discussion, diffPosition));
          const isHighlighted = hoveredDiscussion
            ? discussionAffectsDiffPosition(hoveredDiscussion, diffPosition)
            : false;
          return (
            <div key={`${index}-${row.text.slice(0, 20)}`}>
              <span className={diffLineClass(row.text, isHighlighted)}>
                {tokenizeCodeLine(row.text || " ").map((token, tokenIndex) =>
                  token.kind === "identifier" && row.newLine ? (
                    <button
                      key={`${tokenIndex}-${token.text}`}
                      type="button"
                      className="code-token"
                      title={`Cmd-click to inspect ${token.text}`}
                      onClick={(event) => {
                        if (!event.metaKey && !event.ctrlKey) return;
                        event.preventDefault();
                        onOpenSymbol(file.filename, row.newLine!, Math.max(1, token.startIndex), token.text);
                      }}
                    >
                      {token.text}
                    </button>
                  ) : (
                    <span key={`${tokenIndex}-${token.text}`}>{token.text}</span>
                  ),
                )}
              </span>
              {rowDiscussions.length > 0 ? (
                <InlineDiscussions
                  discussions={rowDiscussions}
                  onHoverDiscussion={setHoveredDiscussion}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SymbolContextPanel({
  contexts,
  state,
  error,
  onClose,
  onOpenSymbol,
}: {
  contexts: SymbolContext[];
  state: "idle" | "loading" | "error";
  error: string | null;
  onClose: () => void;
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
                ? latestContext.source === "language-service"
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
              <div className="context-title">
                <strong>{context.title}</strong>
                <span>{context.file} · lines {context.startLine}-{context.endLine}</span>
              </div>
              <pre className="context-code">
                {context.code.split("\n").map((line, index) => {
                  const lineNumber = context.startLine + index;
                  return (
                    <span key={`${lineNumber}-${line}`}>
                      <span className="context-line-number">{lineNumber}</span>
                      <span>
                        {tokenizeCodeLine(line || " ").map((token, tokenIndex) =>
                          token.kind === "identifier" ? (
                            <button
                              key={`${tokenIndex}-${token.text}`}
                              type="button"
                              className="code-token"
                              title={`Cmd-click to inspect ${token.text}`}
                              onClick={(event) => {
                                if (!event.metaKey && !event.ctrlKey) return;
                                event.preventDefault();
                                onOpenSymbol(context.file, lineNumber, token.startIndex + 1, token.text);
                              }}
                            >
                              {token.text}
                            </button>
                          ) : (
                            <span key={`${tokenIndex}-${token.text}`}>{token.text}</span>
                          ),
                        )}
                      </span>
                    </span>
                  );
                })}
              </pre>
            </article>
          ))}
        </div>
      ) : state !== "error" ? (
        <p className="muted">Cmd-click an identifier in the diff to inspect its implementation here.</p>
      ) : null}
    </section>
  );
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
            <p>{discussion.body}</p>
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
            <p>{discussion.body}</p>
          </article>
        );
      })}
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

function diffLineClass(line: string, isHighlighted = false): string {
  const classes = ["diff-line"];
  if (line.startsWith("+") && !line.startsWith("+++")) classes.push("added");
  if (line.startsWith("-") && !line.startsWith("---")) classes.push("removed");
  if (line.startsWith("@@")) classes.push("hunk");
  if (isHighlighted) classes.push("comment-highlight");
  return classes.join(" ");
}
