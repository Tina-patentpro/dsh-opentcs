import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inject } from "../lib/index.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

/**
 * Regression guard for the DSH "duplicate dsh-tools" incident.
 *
 * DSH core modules hold module-scoped Symbols (TOOL_RUNTIME_SCHEDULER in
 * @deepseek-ai/dsh-tools, Service/Context Symbols in @deepseek-ai/cordis)
 * that MUST stay a single shared instance inside a profile. Declaring them as
 * `dependencies` makes pnpm install a second physical copy (profile uses
 * `nodeLinker: hoisted`), which splits the Symbol identity and breaks the
 * agent-loop scheduler lookup. They must be `peerDependencies` (satisfied at
 * runtime by the profile's official junction), with a devDependency copy only
 * for local `pnpm run test`.
 */
test("DSH 核心模块必须是 peer 而非 dependency（单例不变量）", () => {
  const deps = Object.keys(pkg.dependencies ?? {});
  for (const forbidden of [
    "@deepseek-ai/dsh-tools",
    "@deepseek-ai/dsh-credentials",
    "@deepseek-ai/cordis",
    "@deepseek-ai/schemastery"
  ]) {
    assert.ok(
      !deps.includes(forbidden),
      `${forbidden} 不得作为 runtime dependency（会导致 profile 内出现第二份副本、Symbol 身份分裂）`
    );
  }
  for (const peer of [
    "@deepseek-ai/dsh-tools",
    "@deepseek-ai/dsh-credentials",
    "@deepseek-ai/cordis"
  ]) {
    assert.ok(
      Object.keys(pkg.peerDependencies ?? {}).includes(peer),
      `${peer} 必须在 peerDependencies 中声明（与宿主共享单例）`
    );
  }
});

test("inject 覆盖插件消费的全部服务", () => {
  for (const svc of ["tools", "systemPrompt", "credentials"]) {
    assert.ok(inject.includes(svc), `inject 缺少 "${svc}"`);
  }
});
