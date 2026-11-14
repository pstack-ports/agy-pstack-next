import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fuzz, type Html, type Mermaid, type Render } from "./labels.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const charts = [];
for (const f of fs.readdirSync(path.join(here, "charts")))
  charts.push(path.join(here, "charts", f));
for (const d of fs.readdirSync(path.join(here, "corpus")))
  charts.push(path.join(here, "corpus", d, "chart.mmd"));
const guide = fs.readFileSync(path.join(here, "../../references/render.md"), "utf8");
const css = guide.match(/```css\n([\s\S]*?)```/);
assert.ok(css, "references/render.md has no css block");
const theme = css[1];
const configuredCache = path.join(
  process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
  "statechart",
);
const fallbackCache = path.join(os.tmpdir(), "statechart");

function parsePackageSpec(spec: string): { pkg: string; version: string | null } {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return { pkg: spec, version: null };
  return { pkg: spec.slice(0, at), version: spec.slice(at + 1) };
}

function resolveCached(root: string, name: string, packages: string[]): NodeRequire | null {
  const manifestPath = path.join(root, name, "package.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const req = createRequire(manifestPath);
    for (const spec of packages) {
      const { pkg, version } = parsePackageSpec(spec);
      if (version && manifest.dependencies?.[pkg] !== version) return null;
      req.resolve(pkg);
    }
    return req;
  } catch {
    return null;
  }
}

function isWritableCacheRoot(root: string): boolean {
  try {
    fs.mkdirSync(root, { recursive: true });
    const probe = path.join(root, `.write-probe-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

type PackageLoad = { req: NodeRequire } | { skipReason: string };

function resolveOrInstall(name: string, ...packages: string[]): PackageLoad {
  const cachedPrimary = resolveCached(configuredCache, name, packages);
  if (cachedPrimary) return { req: cachedPrimary };

  let targetRoot = configuredCache;
  if (!isWritableCacheRoot(configuredCache)) {
    const cachedFallback = resolveCached(fallbackCache, name, packages);
    if (cachedFallback) return { req: cachedFallback };
    targetRoot = fallbackCache;
  }

  const dir = path.join(targetRoot, name);
  const env =
    targetRoot === fallbackCache && !process.env.NPM_CONFIG_CACHE && !process.env.npm_config_cache
      ? { ...process.env, npm_config_cache: path.join(fallbackCache, "npm-cache") }
      : process.env;

  try {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync(
      "npm",
      ["install", "--prefix", dir, "--no-audit", "--no-fund", "--save-exact", ...packages],
      { stdio: ["ignore", "pipe", "pipe"], env },
    );
    return { req: createRequire(path.join(dir, "package.json")) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    const summary = code ? ` (${code})` : "";
    return {
      skipReason: `optional packages ${packages.join(", ")} are not cached in ${targetRoot} and npm install failed${summary}`,
    };
  }
}

let render: Render | undefined;
let mermaid: Mermaid | undefined;
let html: Html | undefined;
let peleSkipReason: string | undefined;
let mermaidSkipReason: string | undefined;

before(async () => {
  const pele = resolveOrInstall("test-pele-1.9.0", "pele@1.9.0");
  if ("skipReason" in pele) {
    peleSkipReason = pele.skipReason;
  } else {
    ({ render } = await import(pathToFileURL(pele.req.resolve("pele")).href));
  }

  const parser = resolveOrInstall("test-mermaid-11.16.0", "mermaid@11.16.0", "jsdom@26.1.0");
  if ("skipReason" in parser) {
    mermaidSkipReason = parser.skipReason;
  } else {
    const { window } = new (parser.req("jsdom").JSDOM)("");
    Object.assign(globalThis, { window, document: window.document, DOMParser: window.DOMParser });
    mermaid = (await import(pathToFileURL(parser.req.resolve("mermaid")).href)).default;
    html = (markup) => {
      const t = window.document.createElement("template");
      t.innerHTML = markup;
      return t.content.textContent ?? "";
    };
  }
});

const classes = new Set<string>();
for (const chart of charts) {
  const name = path.relative(here, chart);
  const text = fs.readFileSync(chart, "utf8");
  const marks = [...text.matchAll(/^ {2}class (\w+) (\w+)$/gm)];
  for (const [, , mark] of marks) classes.add(mark);

  test(`${name} renders in Pele 1.9.0 with each class on its node`, (t) => {
    if (peleSkipReason || !render) {
      t.skip(peleSkipReason ?? "pele@1.9.0 unavailable");
      return;
    }
    const { svg } = render(text);
    assert.match(svg, /^<svg /);
    for (const [, id, mark] of marks)
      assert.match(svg, new RegExp(`class="pele-node[^"]* ${mark}\\b[^"]*" data-id="${id}"`), id);
  });

  test(`${name} parses in mermaid.js, which chat views use`, async (t) => {
    if (mermaidSkipReason || !mermaid) {
      t.skip(mermaidSkipReason ?? "mermaid@11.16.0 unavailable");
      return;
    }
    await mermaid.parse(text);
  });
}

test("random labels and colors keep their text and the chart's shape in Mermaid and Pele", async (t) => {
  const skipReason = peleSkipReason ?? mermaidSkipReason;
  if (skipReason || !render || !mermaid || !html) {
    t.skip(skipReason ?? "render packages unavailable");
    return;
  }
  const { drawn, refused, failure } = await fuzz({ seed: 1, charts: 500, render, mermaid, html });
  if (failure) assert.fail(failure);
  assert.ok(drawn > 400 && refused > 20, `${drawn} charts drawn, ${refused} refused`);
});

test("the theme in references/render.md colors each class that the charts use", () => {
  assert.ok(classes.size > 0);
  for (const name of classes) assert.match(theme, new RegExp(`\\.pele \\.${name} rect \\{`), name);
});
