import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { resolvePythonSymbolContextWithLsp } from "../src/main/python-lsp";

describe("resolvePythonSymbolContextWithLsp", () => {
  it("finds an imported async function definition through Pyright", async () => {
    const root = await createPythonProject();
    await mkdir(path.join(root, "app", "cache"), { recursive: true });
    await mkdir(path.join(root, "app", "api", "v1", "endpoints"), { recursive: true });
    await writeFile(path.join(root, "app", "__init__.py"), "", "utf8");
    await writeFile(path.join(root, "app", "cache", "__init__.py"), "", "utf8");
    await writeFile(path.join(root, "app", "api", "__init__.py"), "", "utf8");
    await writeFile(path.join(root, "app", "api", "v1", "__init__.py"), "", "utf8");
    await writeFile(path.join(root, "app", "api", "v1", "endpoints", "__init__.py"), "", "utf8");
    await writeFile(
      path.join(root, "app", "cache", "session_activity_leaderboard_scores_cache.py"),
      [
        "async def get_session_activity_leaderboard_scores_from_cache(",
        "    *,",
        "    redis_client,",
        "):",
        "    return None",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(root, "app", "api", "v1", "endpoints", "activity_leaderboards.py"),
      [
        "from app.cache.session_activity_leaderboard_scores_cache import (",
        "    get_session_activity_leaderboard_scores_from_cache,",
        ")",
        "",
        "async def route(redis_client):",
        "    return await get_session_activity_leaderboard_scores_from_cache(redis_client=redis_client)",
      ].join("\n"),
      "utf8",
    );

    const context = await resolvePythonSymbolContextWithLsp(root, {
      owner: "flowstate-zone",
      repo: "backend",
      number: 1,
      file: "app/api/v1/endpoints/activity_leaderboards.py",
      line: 6,
      column: 18,
      symbol: "get_session_activity_leaderboard_scores_from_cache",
    });

    assert.ok(context);
    assert.equal(context.source, "language-server");
    assert.equal(context.file, "app/cache/session_activity_leaderboard_scores_cache.py");
    assert.equal(context.title, "get_session_activity_leaderboard_scores_from_cache");
    assert.match(context.code, /async def get_session_activity_leaderboard_scores_from_cache/);
  });

  it("finds a function reached through an imported module attribute through Pyright", async () => {
    const root = await createPythonProject();
    await mkdir(path.join(root, "app", "api", "v1", "endpoints"), { recursive: true });
    await writeFile(path.join(root, "app", "__init__.py"), "", "utf8");
    await writeFile(path.join(root, "app", "api", "__init__.py"), "", "utf8");
    await writeFile(path.join(root, "app", "api", "v1", "__init__.py"), "", "utf8");
    await writeFile(path.join(root, "app", "api", "v1", "endpoints", "__init__.py"), "", "utf8");
    await writeFile(
      path.join(root, "app", "api", "deps.py"),
      [
        "async def get_db():",
        "    yield None",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(root, "app", "api", "v1", "endpoints", "activity_leaderboards.py"),
      [
        "from app.api import deps",
        "",
        "async def route():",
        "    db_session = Depends(deps.get_db)",
        "    return db_session",
      ].join("\n"),
      "utf8",
    );

    const context = await resolvePythonSymbolContextWithLsp(root, {
      owner: "flowstate-zone",
      repo: "backend",
      number: 1,
      file: "app/api/v1/endpoints/activity_leaderboards.py",
      line: 4,
      column: 31,
      symbol: "get_db",
    });

    assert.ok(context);
    assert.equal(context.source, "language-server");
    assert.equal(context.file, "app/api/deps.py");
    assert.equal(context.title, "get_db");
    assert.match(context.code, /async def get_db/);
  });

  it("re-anchors a dotted attribute lookup when the UI column is shifted by diff markup", async () => {
    const root = await createPythonProject();
    await mkdir(path.join(root, "app", "api", "v1", "endpoints"), { recursive: true });
    await writeFile(path.join(root, "app", "__init__.py"), "", "utf8");
    await writeFile(path.join(root, "app", "api", "__init__.py"), "", "utf8");
    await writeFile(path.join(root, "app", "api", "v1", "__init__.py"), "", "utf8");
    await writeFile(path.join(root, "app", "api", "v1", "endpoints", "__init__.py"), "", "utf8");
    await writeFile(path.join(root, "app", "api", "deps.py"), "async def get_db():\n    yield None\n", "utf8");
    await writeFile(
      path.join(root, "app", "api", "v1", "endpoints", "activity_leaderboards.py"),
      [
        "from fastapi import Depends",
        "from app.api import deps",
        "",
        "async def route():",
        "    db_session = Depends(deps.get_db),",
        "    return db_session",
      ].join("\n"),
      "utf8",
    );

    const context = await resolvePythonSymbolContextWithLsp(root, {
      owner: "flowstate-zone",
      repo: "backend",
      number: 1,
      file: "app/api/v1/endpoints/activity_leaderboards.py",
      line: 5,
      column: 27,
      symbol: "get_db",
    });

    assert.ok(context);
    assert.equal(context.source, "language-server");
    assert.equal(context.file, "app/api/deps.py");
    assert.equal(context.title, "get_db");
  });

  it("resolves imports from a nested Python application root in a monorepo", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "review-bud-pyright-"));
    await writeFile(path.join(root, "pyproject.toml"), "[tool.pyright]\ninclude = [\"fast-api\"]\n", "utf8");
    await mkdir(path.join(root, "fast-api", "app", "app", "api", "v1", "endpoints"), { recursive: true });
    await writeFile(path.join(root, "fast-api", "app", "app", "__init__.py"), "", "utf8");
    await writeFile(path.join(root, "fast-api", "app", "app", "api", "__init__.py"), "", "utf8");
    await writeFile(path.join(root, "fast-api", "app", "app", "api", "v1", "__init__.py"), "", "utf8");
    await writeFile(path.join(root, "fast-api", "app", "app", "api", "v1", "endpoints", "__init__.py"), "", "utf8");
    await writeFile(path.join(root, "fast-api", "app", "app", "api", "deps.py"), "async def get_db():\n    yield None\n", "utf8");
    await writeFile(
      path.join(root, "fast-api", "app", "app", "api", "v1", "endpoints", "activity_leaderboards.py"),
      [
        "from fastapi import Depends",
        "from app.api import deps",
        "",
        "async def route():",
        "    db_session = Depends(deps.get_db),",
        "    return db_session",
      ].join("\n"),
      "utf8",
    );

    const context = await resolvePythonSymbolContextWithLsp(root, {
      owner: "flowstate-zone",
      repo: "backend",
      number: 1,
      file: "fast-api/app/app/api/v1/endpoints/activity_leaderboards.py",
      line: 5,
      column: 31,
      symbol: "get_db",
    });

    assert.ok(context);
    assert.equal(context.source, "language-server");
    assert.equal(context.file, "fast-api/app/app/api/deps.py");
    assert.equal(context.title, "get_db");
  });
});

async function createPythonProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-bud-pyright-"));
  await writeFile(
    path.join(root, "pyproject.toml"),
    [
      "[tool.pyright]",
      "include = [\"app\"]",
      "extraPaths = [\".\"]",
    ].join("\n"),
    "utf8",
  );
  return root;
}
