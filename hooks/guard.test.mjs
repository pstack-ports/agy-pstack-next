import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { handleRawStdin, runGuard } from "./guard.mjs";

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GUARD_PATH = join(PLUGIN_ROOT, "hooks", "guard.mjs");
const HOOKS_JSON_PATH = join(PLUGIN_ROOT, "hooks.json");
const SYNC_HOOKS_PATH = join(PLUGIN_ROOT, "skills", "setup-pstack", "scripts", "sync-hooks.mjs");

function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), "pstack-guard-test-"));
  const appDataDir = join(root, ".gemini", "antigravity-cli");
  const worktree = join(root, "worktrees", "swarm-worker-a");
  const siblingWorktree = join(root, "worktrees", "swarm-worker-a-sibling");
  const outsideDir = join(root, "outside");
  const customTmpDir = join(root, "tmp");
  mkdirSync(join(appDataDir, "brain"), { recursive: true });
  mkdirSync(worktree, { recursive: true });
  mkdirSync(siblingWorktree, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  mkdirSync(customTmpDir, { recursive: true });
  return {
    root,
    appDataDir,
    worktree,
    siblingWorktree,
    outsideDir,
    customTmpDir,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function writeSwarmMembers(appDataDir, coordId, members) {
  const swarmDir = join(appDataDir, "brain", coordId, ".system_generated", "swarm");
  mkdirSync(swarmDir, { recursive: true });
  writeFileSync(join(swarmDir, "members.json"), JSON.stringify({ title: "test-swarm", members }, null, 2), "utf8");
}

function buildEnv(envOverrides = {}) {
  const env = { ...process.env };
  for (const k of [
    "PSTACK_APPDATA_DIR", "ANTIGRAVITY_APP_DATA_DIR", "PLUGIN_DATA", "PLUGIN_ROOT",
    "PSTACK_PLUGIN_ROOT", "PSTACK_CACHE_DIR", "PSTACK_CONFIG_DIR",
    "PSTACK_REMOTE_SWARM_CLI", "PSTACK_REMOTE_BOARD_CONFIG",
    "PSTACK_GUARD_DELEGATED", "PSTACK_ALLOW_PUSH", "PSTACK_FORCE_COORDINATOR",
  ]) {
    delete env[k];
  }
  if (!("PSTACK_CONFIG_DIR" in envOverrides) && !("HOME" in envOverrides) && !("PLUGIN_ROOT" in envOverrides) && !("PSTACK_PLUGIN_ROOT" in envOverrides)) {
    env.PSTACK_CONFIG_DIR = join(PLUGIN_ROOT, ".nonexistent-pstack-config-dir");
  }
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined || v === null) delete env[k];
    else env[k] = v;
  }
  return env;
}

function invokeGuard(payload, envOverrides = {}) {
  return runGuard(payload, buildEnv(envOverrides));
}

function runGuardCli(payload, envOverrides = {}, guardScriptPath = GUARD_PATH) {
  const res = spawnSync(process.execPath, [guardScriptPath], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: buildEnv(envOverrides),
  });
  assert.equal(res.status, 0, `guard exited non-zero: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function scanJsForRegexAndSandbox(source) {
  const regexLiterals = [];
  const regExpRefs = [];
  const EXPR_END_KEYWORDS = new Set(["this", "super", "true", "false", "null"]);
  const NON_EXPR_KEYWORDS = new Set([
    "return", "throw", "case", "delete", "void", "typeof", "yield", "await",
    "in", "instanceof", "of", "new", "else", "do",
  ]);
  let prevCanEndExpr = false;
  let i = 0;

  while (i < source.length) {
    const ch = source[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i += 1; continue; }
    if (ch === "#" && i === 0 && source[1] === "!") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
          i += 2;
          let depth = 1;
          while (i < source.length && depth > 0) {
            if (source[i] === "{") depth += 1;
            else if (source[i] === "}") depth -= 1;
            i += 1;
          }
          continue;
        }
        if (source[i] === quote) { i += 1; break; }
        i += 1;
      }
      prevCanEndExpr = true;
      continue;
    }
    if (ch === "/") {
      if (!prevCanEndExpr) {
        const start = i;
        i += 1;
        let inClass = false;
        while (i < source.length) {
          if (source[i] === "\\") { i += 2; continue; }
          if (source[i] === "[") inClass = true;
          else if (source[i] === "]") inClass = false;
          else if (source[i] === "/" && !inClass) { i += 1; break; }
          i += 1;
        }
        regexLiterals.push(source.slice(start, i));
        prevCanEndExpr = true;
        continue;
      }
      i += 1;
      prevCanEndExpr = false;
      continue;
    }
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$") {
      const start = i;
      while (i < source.length && (/[A-Za-z0-9_$]/.test(source[i]))) i += 1;
      const ident = source.slice(start, i);
      if (ident === "RegExp") regExpRefs.push(start);
      prevCanEndExpr = EXPR_END_KEYWORDS.has(ident) || !NON_EXPR_KEYWORDS.has(ident);
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      while (i < source.length && /[0-9a-fA-FxXoObBn._]/.test(source[i])) i += 1;
      prevCanEndExpr = true;
      continue;
    }
    if (ch === ")" || ch === "]") { i += 1; prevCanEndExpr = true; continue; }
    if ((ch === "+" && source[i + 1] === "+") || (ch === "-" && source[i + 1] === "-")) {
      i += 2;
      prevCanEndExpr = true;
      continue;
    }
    i += 1;
    prevCanEndExpr = false;
  }

  return {
    regexLiterals,
    regExpRefs,
    hasSandboxExec: source.includes("sandbox-exec"),
    hasBwrap: source.includes("bwrap"),
    hasUnshare: source.includes("unshare"),
  };
}

describe("Static zero-regex, zero-sandbox, packaging, and capsule prose checks", () => {
  test("hooks/guard.mjs and sync-hooks.mjs contain 0 regex literals, 0 RegExp references, and 0 OS sandbox calls", () => {
    for (const filePath of [GUARD_PATH, SYNC_HOOKS_PATH]) {
      const source = readFileSync(filePath, "utf8");
      const scan = scanJsForRegexAndSandbox(source);
      assert.deepEqual(scan.regexLiterals, [], `${filePath} must contain zero regex literals`);
      assert.deepEqual(scan.regExpRefs, [], `${filePath} must contain zero RegExp references`);
      assert.equal(scan.hasSandboxExec, false);
      assert.equal(scan.hasBwrap, false);
      assert.equal(scan.hasUnshare, false);
    }

    const probe = scanJsForRegexAndSandbox("const x = a / b; const y = /abc/i; const z = new RegExp('a');");
    assert.equal(probe.regexLiterals.length, 1);
    assert.equal(probe.regExpRefs.length, 1);
  });

  test("hooks.json includes SessionStart, PreInvocation, PreToolUse, and Stop handlers and scripts are executable", () => {
    assert.equal(existsSync(HOOKS_JSON_PATH), true);
    const hooksConfig = JSON.parse(readFileSync(HOOKS_JSON_PATH, "utf8"));
    const spec = hooksConfig["pstack-swarm-guard"];
    assert.ok(spec);
    assert.deepEqual(spec.SessionStart, [{ type: "command", command: "./hooks/guard.mjs", timeout: 10 }]);
    assert.deepEqual(spec.PreInvocation, [{ type: "command", command: "./hooks/guard.mjs", timeout: 10 }]);
    assert.deepEqual(spec.Stop, [{ type: "command", command: "./hooks/guard.mjs", timeout: 10 }]);
    assert.equal(spec.PreToolUse.length, 2);
    assert.notEqual(statSync(GUARD_PATH).mode & 0o111, 0, "hooks/guard.mjs must have +x permission");
    assert.notEqual(statSync(SYNC_HOOKS_PATH).mode & 0o111, 0, "sync-hooks.mjs must have +x permission");
  });

  test("all role capsules and Role override notice are free of em-dashes, en-dashes, and colons", () => {
    for (const name of ["coordinator.md", "research.md", "poteto-agent.md", "comment-sicko.md"]) {
      const content = readFileSync(join(PLUGIN_ROOT, "roles", name), "utf8");
      assert.equal(content.includes("—"), false, `${name} contains em-dash`);
      assert.equal(content.includes("–"), false, `${name} contains en-dash`);
      assert.equal(content.includes(":"), false, `${name} contains colon`);
    }

    const sb = makeSandbox();
    try {
      const transcriptPath = join(sb.appDataDir, "brain", "forked-impl", ".system_generated", "logs", "transcript.jsonl");
      mkdirSync(dirname(transcriptPath), { recursive: true });
      writeFileSync(
        transcriptPath,
        JSON.stringify({ type: "SYSTEM_MESSAGE", content: "# Research role capsule\n" }) + "\n",
        "utf8",
      );
      writeSwarmMembers(sb.appDataDir, "coord-punct", {
        coordinator: { conversation_id: "coord-punct", role: "coordinator" },
        "impl-1": { conversation_id: "forked-impl", role: "worker" },
      });
      const out = invokeGuard(
        { hookEventName: "SessionStart", conversationId: "forked-impl", rootConversationId: "coord-punct", transcriptPath },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      const injected = out.injectSteps[0].systemMessage.systemMessage;
      assert.ok(injected.startsWith("> **Role override.**"));
      assert.equal(injected.includes("—"), false);
      assert.equal(injected.includes("–"), false);
      assert.equal(injected.includes(":"), false);

      const forkMemTranscript = join(sb.appDataDir, "brain", "forked-ro-mem", ".system_generated", "logs", "transcript.jsonl");
      mkdirSync(dirname(forkMemTranscript), { recursive: true });
      writeFileSync(
        forkMemTranscript,
        JSON.stringify({ type: "USER_INPUT", content: "Everything before this turn is @ro-1's memory. Now inspect." }) + "\n",
        "utf8",
      );
      writeSwarmMembers(sb.appDataDir, "coord-punct", {
        coordinator: { conversation_id: "coord-punct", role: "coordinator" },
        "impl-1": { conversation_id: "forked-impl", role: "worker" },
        "ro-1": { conversation_id: "forked-ro-mem", role: "worker" },
      });
      const memOut = invokeGuard(
        { hookEventName: "SessionStart", conversationId: "forked-ro-mem", rootConversationId: "coord-punct", transcriptPath: forkMemTranscript },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.ok(memOut.injectSteps[0].systemMessage.systemMessage.startsWith("> **Role override.**"));
    } finally {
      sb.cleanup();
    }
  });
});

describe("Session classification, non-hijacking activation, disablement, and delegation", () => {
  test("does not hijack mid-sentence /pstack, plain /swarm, /ketchup --plain, or standalone inline skills", () => {
    const sb = makeSandbox();
    try {
      const unmanagedInputs = [
        "Is v2 better than /pstack in everyday chats?",
        "Compare /pstack with built-in /swarm please.",
        "/swarm investigate flaky test",
        "/ketchup --plain",
        "<USER_REQUEST>\n/ketchup --plain summarize that\n</USER_REQUEST>",
        "/bro explain what this hook does",
        "/technical-writing polish this doc",
        "/setup-pstack",
        "/statechart validate",
        "/control-ui check localhost",
        "/control-cli test cli",
        "/make-bot-ui scaffold",
      ];
      for (let i = 0; i < unmanagedInputs.length; i += 1) {
        const convId = `unmanaged-${i}`;
        assert.deepEqual(
          invokeGuard({ hookEventName: "SessionStart", conversationId: convId, lastUserInput: unmanagedInputs[i] }, { PSTACK_APPDATA_DIR: sb.appDataDir }),
          {},
          `expected unmanaged SessionStart for: ${unmanagedInputs[i]}`,
        );
        assert.deepEqual(
          invokeGuard(
            {
              hookEventName: "PreToolUse",
              conversationId: convId,
              cwd: sb.worktree,
              toolCall: { id: "sub-1", name: "invoke_subagent", args: { TypeName: "research" } },
            },
            { PSTACK_APPDATA_DIR: sb.appDataDir },
          ),
          { decision: "allow" },
          `expected invoke_subagent allowed for: ${unmanagedInputs[i]}`,
        );
      }
    } finally {
      sb.cleanup();
    }
  });

  test("activates coordinator ONLY on explicit leading slash commands, forced env, roster, or cached coordinator capsule", () => {
    const sb = makeSandbox();
    try {
      const coordInputs = [
        "/pstack fix bug",
        "  <USER_REQUEST>\n  /agy-pstack-next:pstack build feature\n</USER_REQUEST>",
        "/understand why hooks fired",
        "/crucible design new parser",
        "/interrogate auth flow",
        "/reflect on PR #4",
        "/verify-gen create harness",
        "/ketchup",
        "/ketchup --video",
        "/agy-pstack-next:ketchup --recall guard",
      ];
      for (let i = 0; i < coordInputs.length; i += 1) {
        const convId = `coord-slash-${i}`;
        const out = invokeGuard(
          { hookEventName: "SessionStart", conversationId: convId, lastUserInput: coordInputs[i] },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        );
        assert.ok(out.injectSteps?.[0]?.systemMessage?.systemMessage?.includes("Coordinator role capsule"), `expected coordinator capsule for ${coordInputs[i]}`);
        const subDeny = invokeGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: convId,
            cwd: sb.worktree,
            toolCall: { id: "sub-2", name: "invoke_subagent", args: { TypeName: "research" } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        );
        assert.equal(subDeny.decision, "deny");
      }

      const forced = invokeGuard(
        { hookEventName: "SessionStart", conversationId: "forced-coord", lastUserInput: "hello" },
        { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_FORCE_COORDINATOR: "1" },
      );
      assert.ok(forced.injectSteps?.[0]?.systemMessage?.systemMessage?.includes("Coordinator role capsule"));
    } finally {
      sb.cleanup();
    }
  });

  test("supports remote swarm.json --roster-only with 15s TTL / 5s miss backoff and validates remote swarm IDs", () => {
    const sb = makeSandbox();
    try {
      const mockCli = join(sb.root, "mock-swarm-cli.sh");
      const countFile = join(sb.root, "cli-calls.txt");
      writeFileSync(
        mockCli,
        `#!/bin/sh
echo "call" >> "${countFile}"
echo '{"swarm_id":"remote_swarm.1","members":{"coordinator":{"conversation_id":"rcoord","role":"coordinator"},"ro-1":{"conversation_id":"rworker-1","role":"worker"}}}'
`,
        "utf8",
      );
      chmodSync(mockCli, 0o755);

      const swarmDir = join(sb.appDataDir, "brain", "rcoord", ".system_generated", "swarm");
      mkdirSync(swarmDir, { recursive: true });
      writeFileSync(join(swarmDir, "swarm.json"), JSON.stringify({ backend: "spanner", swarm_id: "remote_swarm.1" }), "utf8");

      const out1 = invokeGuard(
        { hookEventName: "SessionStart", conversationId: "rworker-1", rootConversationId: "rcoord" },
        { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_REMOTE_SWARM_CLI: mockCli },
      );
      assert.ok(out1.injectSteps[0].systemMessage.systemMessage.includes("Read-only specialist role capsule"));
      const mapDoc = JSON.parse(readFileSync(join(sb.appDataDir, "plugin_data", "agy-pstack-next", "member-map.json"), "utf8"));
      assert.equal(mapDoc["rworker-1"], "ro-1");

      invokeGuard(
        { hookEventName: "SessionStart", conversationId: "missing-worker", rootConversationId: "rcoord" },
        { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_REMOTE_SWARM_CLI: mockCli },
      );
      assert.equal(readFileSync(countFile, "utf8").trim().split("\n").length, 1);

      for (const badId of ["abc", "-bad", "bad/id", "a".repeat(129)]) {
        const badDir = join(sb.appDataDir, "brain", "bad-coord", ".system_generated", "swarm");
        mkdirSync(badDir, { recursive: true });
        writeFileSync(join(badDir, "swarm.json"), JSON.stringify({ backend: "spanner", swarm_id: badId }), "utf8");
        invokeGuard(
          { hookEventName: "SessionStart", conversationId: "someone", rootConversationId: "bad-coord" },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_REMOTE_SWARM_CLI: mockCli },
        );
      }
      assert.equal(readFileSync(countFile, "utf8").trim().split("\n").length, 1);
    } finally {
      sb.cleanup();
    }
  });

  test("classifies numbered suffixes and respects config.json disablement with zero cache writes", () => {
    const sb = makeSandbox();
    try {
      writeSwarmMembers(sb.appDataDir, "coord-suffix", {
        coordinator: { conversation_id: "coord-suffix", role: "coordinator" },
        "impl-2": { conversation_id: "c-impl", role: "worker" },
        "cand-3": { conversation_id: "c-cand", role: "worker" },
        "lead-1": { conversation_id: "c-lead", role: "worker" },
        "ro-4": { conversation_id: "c-ro", role: "worker" },
        "adv-2": { conversation_id: "c-adv", role: "worker" },
        "sicko-5": { conversation_id: "c-sicko", role: "worker" },
        verifier: { conversation_id: "c-v0", role: "worker" },
        "verifier-2": { conversation_id: "c-v1", role: "worker" },
        "auth-verifier-3": { conversation_id: "c-v2", role: "worker" },
        "verify-2": { conversation_id: "c-v3", role: "worker" },
        "monitor-1": { conversation_id: "c-mon", role: "worker" },
        "narrator-2": { conversation_id: "c-nar", role: "worker" },
      });

      for (const vid of ["c-ro", "c-v0", "c-v1", "c-v2", "c-v3"]) {
        assert.equal(
          invokeGuard(
            { hookEventName: "PreToolUse", conversationId: vid, rootConversationId: "coord-suffix", cwd: sb.worktree, toolCall: { id: "1", name: "edit_file", args: { Path: join(sb.worktree, "a.js") } } },
            { PSTACK_APPDATA_DIR: sb.appDataDir },
          ).decision,
          "deny",
        );
      }
      for (const supId of ["c-mon", "c-nar"]) {
        assert.deepEqual(
          invokeGuard({ hookEventName: "SessionStart", conversationId: supId, rootConversationId: "coord-suffix" }, { PSTACK_APPDATA_DIR: sb.appDataDir }),
          {},
        );
        assert.equal(
          invokeGuard(
            { hookEventName: "PreToolUse", conversationId: supId, rootConversationId: "coord-suffix", cwd: sb.worktree, toolCall: { id: "2", name: "run_workflow", args: {} } },
            { PSTACK_APPDATA_DIR: sb.appDataDir },
          ).decision,
          "deny",
        );
      }

      const cfgDir = join(sb.root, "cfg");
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(join(cfgDir, "config.json"), JSON.stringify({ plugins: { "agy-pstack-next": { enabled: false } } }), "utf8");
      const cacheDir = join(sb.root, "disabled-cache");
      assert.deepEqual(
        invokeGuard(
          { hookEventName: "SessionStart", conversationId: "c-ro", rootConversationId: "coord-suffix" },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir, PSTACK_CACHE_DIR: cacheDir },
        ),
        {},
      );
      assert.equal(existsSync(cacheDir), false);
    } finally {
      sb.cleanup();
    }
  });

  test("16-way parallel SessionStart suffers zero capsule write loss and avoids negative-cache poisoning", async () => {
    const sb = makeSandbox();
    try {
      const members = { coordinator: { conversation_id: "coord-race", role: "coordinator" } };
      for (let i = 0; i < 16; i += 1) {
        members[`ro-${i}`] = { conversation_id: `ro-race-${i}`, role: "worker" };
      }
      writeSwarmMembers(sb.appDataDir, "coord-race", members);

      const spawnSessionStart = (convId) =>
        new Promise((resolvePromise, reject) => {
          const child = spawn(process.execPath, [GUARD_PATH], {
            env: buildEnv({ PSTACK_APPDATA_DIR: sb.appDataDir }),
            stdio: ["pipe", "pipe", "pipe"],
          });
          let out = "";
          let err = "";
          child.stdout.on("data", (d) => { out += d; });
          child.stderr.on("data", (d) => { err += d; });
          child.on("close", (code) => {
            if (code !== 0) reject(new Error(`exit ${code}: ${err}`));
            else resolvePromise(JSON.parse(out));
          });
          child.stdin.end(JSON.stringify({ hookEventName: "SessionStart", conversationId: convId, rootConversationId: "coord-race", cwd: sb.worktree }));
        });

      const results = await Promise.all(Array.from({ length: 16 }, (_, i) => spawnSessionStart(`ro-race-${i}`)));
      for (let i = 0; i < 16; i += 1) {
        assert.equal(results[i].injectSteps.length, 1);
        const capFile = join(sb.appDataDir, "plugin_data", "agy-pstack-next", "capsules", `ro-race-${i}.json`);
        assert.equal(existsSync(capFile), true);
        assert.equal(JSON.parse(readFileSync(capFile, "utf8")).capsule, "roles/research.md");
        assert.deepEqual(
          invokeGuard({ hookEventName: "PreInvocation", conversationId: `ro-race-${i}`, rootConversationId: "coord-race" }, { PSTACK_APPDATA_DIR: sb.appDataDir }),
          {},
        );
      }

      assert.deepEqual(
        invokeGuard({ hookEventName: "SessionStart", conversationId: "late-ro" }, { PSTACK_APPDATA_DIR: sb.appDataDir }),
        {},
      );
      writeSwarmMembers(sb.appDataDir, "coord-late", {
        coordinator: { conversation_id: "coord-late", role: "coordinator" },
        "ro-late": { conversation_id: "late-ro", role: "worker" },
      });
      assert.equal(
        invokeGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "late-ro",
            cwd: sb.worktree,
            toolCall: { id: "late-w", name: "write_file", args: { Path: join(sb.worktree, "pwn.txt") } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ).decision,
        "deny",
      );
    } finally {
      sb.cleanup();
    }
  });

  test("delegates via PSTACK_PLUGIN_ROOT dynamic import() in-process without spawning a second Node process", async () => {
    const sb = makeSandbox();
    try {
      const altRoot = join(sb.root, "alt-plugin");
      mkdirSync(join(altRoot, "hooks"), { recursive: true });
      writeFileSync(
        join(altRoot, "hooks", "guard.mjs"),
        `export async function handleRawStdin(raw, env) {
  const p = JSON.parse(raw);
  return JSON.stringify({ delegated: true, pid: process.pid, flag: env.PSTACK_GUARD_DELEGATED, event: p.hookEventName }) + "\\n";
}
`,
        "utf8",
      );
      const outStr = await handleRawStdin(
        JSON.stringify({ hookEventName: "SessionStart", conversationId: "x" }),
        buildEnv({ PSTACK_PLUGIN_ROOT: altRoot }),
      );
      const out = JSON.parse(outStr);
      assert.equal(out.delegated, true);
      assert.equal(out.pid, process.pid);
      assert.equal(out.flag, "1");
      assert.equal(out.event, "SessionStart");

      const cliOut = runGuardCli({ hookEventName: "SessionStart", conversationId: "x" }, { PSTACK_PLUGIN_ROOT: altRoot });
      assert.equal(cliOut.delegated, true);
      assert.equal(cliOut.flag, "1");

      const runOnlyRoot = join(sb.root, "run-only-plugin");
      mkdirSync(join(runOnlyRoot, "hooks"), { recursive: true });
      writeFileSync(
        join(runOnlyRoot, "hooks", "guard.mjs"),
        `export function runGuard(p, env) { return { runOnly: true, flag: env.PSTACK_GUARD_DELEGATED, event: p.hookEventName }; }\n`,
        "utf8",
      );
      const runOnlyOut = JSON.parse(await handleRawStdin(
        JSON.stringify({ hookEventName: "PreInvocation", conversationId: "y" }),
        buildEnv({ PSTACK_PLUGIN_ROOT: runOnlyRoot }),
      ));
      assert.deepEqual(runOnlyOut, { runOnly: true, flag: "1", event: "PreInvocation" });
    } finally {
      sb.cleanup();
    }
  });
});

describe("PreToolUse structural gates, path confinement, MCP, and git/gh checks", () => {
  test("blocks legacy subagent tools and run_workflow EXCEPT invoke_subagent with image-generator", () => {
    const sb = makeSandbox();
    try {
      writeSwarmMembers(sb.appDataDir, "coord-sub", {
        coordinator: { conversation_id: "coord-sub", role: "coordinator" },
        "impl-1": { conversation_id: "impl-sub", role: "worker" },
        "ro-1": { conversation_id: "ro-sub", role: "worker" },
        "adv-1": { conversation_id: "adv-sub", role: "worker" },
        "sicko-1": { conversation_id: "sicko-sub", role: "worker" },
        monitor: { conversation_id: "mon-sub", role: "worker" },
      });

      for (const convId of ["coord-sub", "impl-sub", "ro-sub", "adv-sub", "sicko-sub", "mon-sub"]) {
        for (const tool of ["invoke_subagent", "define_subagent", "manage_subagents", "send_message", "run_workflow"]) {
          assert.equal(
            invokeGuard(
              { hookEventName: "PreToolUse", conversationId: convId, rootConversationId: "coord-sub", cwd: sb.worktree, toolCall: { id: "t1", name: `default_api:${tool}`, args: {} } },
              { PSTACK_APPDATA_DIR: sb.appDataDir },
            ).decision,
            "deny",
          );
        }
        for (const key of ["TypeName", "SubagentName", "typeName", "subagentName"]) {
          assert.equal(
            invokeGuard(
              { hookEventName: "PreToolUse", conversationId: convId, rootConversationId: "coord-sub", cwd: sb.worktree, toolCall: { id: "t2", name: "default_api:invoke_subagent", args: { [key]: "Image-Generator" } } },
              { PSTACK_APPDATA_DIR: sb.appDataDir },
            ).decision,
            "allow",
          );
        }
      }
    } finally {
      sb.cleanup();
    }
  });

  test("enforces realpath, symlink, sibling-prefix, and .system_generated confinement across roles", () => {
    const sb = makeSandbox();
    try {
      writeSwarmMembers(sb.appDataDir, "coord-path", {
        coordinator: { conversation_id: "coord-path", role: "coordinator" },
        "impl-1": { conversation_id: "impl-p", role: "worker" },
        "adv-1": { conversation_id: "adv-p", role: "worker" },
        "sicko-1": { conversation_id: "sicko-p", role: "worker" },
        "ro-1": { conversation_id: "ro-p", role: "worker" },
      });
      symlinkSync(sb.outsideDir, join(sb.worktree, "escape-dir"));
      symlinkSync(join(sb.outsideDir, "dangling.txt"), join(sb.worktree, "dangling-link.txt"));

      const callPath = (convId, name, Path) =>
        invokeGuard(
          { hookEventName: "PreToolUse", conversationId: convId, rootConversationId: "coord-path", cwd: sb.worktree, toolCall: { id: "p", name, args: { Path } } },
          { PSTACK_APPDATA_DIR: sb.appDataDir, TMPDIR: sb.customTmpDir },
        );

      for (const convId of ["impl-p", "adv-p"]) {
        assert.equal(callPath(convId, "write_file", join(sb.worktree, "src", "ok.js")).decision, "allow");
        assert.equal(callPath(convId, "edit_file", join(sb.customTmpDir, "scratch.txt")).decision, "allow");
        assert.equal(callPath(convId, "write_file", join(sb.appDataDir, "brain", convId, "report.md")).decision, "allow");
        assert.equal(callPath(convId, "write_file", join(sb.appDataDir, "brain", convId, ".system_generated", "bad.json")).decision, "deny");
        assert.equal(callPath(convId, "write_file", join(sb.siblingWorktree, "pwn.js")).decision, "deny");
        assert.equal(callPath(convId, "edit_file", join(sb.outsideDir, "secret.txt")).decision, "deny");
        assert.equal(callPath(convId, "write_file", join(sb.worktree, "escape-dir", "pwn.txt")).decision, "deny");
        assert.equal(callPath(convId, "write_file", join(sb.worktree, "dangling-link.txt")).decision, "deny");
      }

      assert.equal(callPath("sicko-p", "write_file", join(sb.worktree, "new.js")).decision, "deny");
      assert.equal(callPath("sicko-p", "edit_file", join(sb.worktree, "existing.js")).decision, "allow");
      assert.equal(callPath("sicko-p", "edit_file", join(sb.customTmpDir, "scratch.txt")).decision, "deny");
      assert.equal(callPath("sicko-p", "edit_file", join(sb.siblingWorktree, "existing.js")).decision, "deny");

      assert.equal(callPath("ro-p", "edit_file", join(sb.customTmpDir, "scratch.txt")).decision, "deny");
      assert.equal(callPath("ro-p", "write_file", join(sb.customTmpDir, "notes.md")).decision, "allow");
      assert.equal(callPath("ro-p", "write_file", "/tmp/ro-probe-file.json").decision, "allow");
      assert.equal(callPath("ro-p", "write_file", join(sb.appDataDir, "brain", "ro-p", "shot.png")).decision, "allow");
      assert.equal(callPath("ro-p", "write_file", join(sb.appDataDir, "brain", "ro-p", "notes.md")).decision, "deny");
      assert.equal(callPath("ro-p", "write_file", join(sb.appDataDir, "brain", "ro-p", ".system_generated", "shot.png")).decision, "deny");
      assert.equal(callPath("ro-p", "write_file", join(sb.worktree, "shot.png")).decision, "deny");
    } finally {
      sb.cleanup();
    }
  });

  test("gates mutating MCP tools for readonly while allowing board tools and read-only calls", () => {
    const sb = makeSandbox();
    try {
      writeSwarmMembers(sb.appDataDir, "coord-mcp", {
        coordinator: { conversation_id: "coord-mcp", role: "coordinator" },
        "ro-1": { conversation_id: "ro-mcp", role: "worker" },
      });
      const callMcp = (name, args) =>
        invokeGuard(
          { hookEventName: "PreToolUse", conversationId: "ro-mcp", rootConversationId: "coord-mcp", cwd: sb.worktree, toolCall: { id: "m", name, args } },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        );

      for (const allowed of ["post_message", "read_board", "swarm_wait", "swarm", "list_resources", "read_resource", "get_issue", "list_pulls"]) {
        assert.equal(callMcp("call_mcp_tool", { ToolName: allowed }).decision, "allow");
      }
      assert.equal(callMcp("mcp_github_get_pull_request", {}).decision, "allow");
      for (const blocked of ["create_issue", "update-pr", "delete_comment", "post_review", "merge_pull", "send_email", "insert_row"]) {
        assert.equal(callMcp("call_mcp_tool", { ToolName: blocked }).decision, "deny");
      }
      assert.equal(callMcp("mcp_github_create_issue", {}).decision, "deny");
    } finally {
      sb.cleanup();
    }
  });

  test("allows all 10 prior false positives on ro-* while blocking git and gh footguns across roles", () => {
    const sb = makeSandbox();
    try {
      writeSwarmMembers(sb.appDataDir, "coord-cmd", {
        coordinator: { conversation_id: "coord-cmd", role: "coordinator" },
        "ro-1": { conversation_id: "ro-cmd", role: "worker" },
        "impl-1": { conversation_id: "impl-cmd", role: "worker" },
        "adv-1": { conversation_id: "adv-cmd", role: "worker" },
        "sicko-1": { conversation_id: "sicko-cmd", role: "worker" },
      });

      const runCmd = (convId, CommandLine, extraEnv = {}) =>
        invokeGuard(
          { hookEventName: "PreToolUse", conversationId: convId, rootConversationId: "coord-cmd", cwd: sb.worktree, toolCall: { id: "c", name: "run_command", args: { CommandLine } } },
          { PSTACK_APPDATA_DIR: sb.appDataDir, TMPDIR: sb.customTmpDir, ...extraEnv },
        );

      const allowedRoCommands = [
        `python3 -c "print('a:b'.split(':')[0].replace('a', 'c'))"`,
        `python3 -c "d = {'a': 1}; print(d.copy())"`,
        `python3 -c "import os; print(getattr(os, 'sep'))"`,
        `node -e "const o = { rm: 1 }; console.log(o.rm)"`,
        `node -e "console.log('fs.writeFileSync and open(a, b)')"`,
        `git tag --sort=-creatordate`,
        `git tag -n5`,
        `git tag -n 5`,
        `echo 'print(1)' > /tmp/pstack_chain_probe.py && python3 /tmp/pstack_chain_probe.py`,
        `for t in 1 2; do echo ok > "/tmp/pstack_race_test/t\${t}/out.txt"; done`,
        `git status && git diff && git log -n 5 && git show HEAD && git blame README.md && git rev-parse HEAD`,
        `git worktree list && git stash list && git stash show && git tag && git tag -l 'v*'`,
        `git branch && git branch -a && git branch --show-current && git branch > /tmp/branches.txt`,
        `git remote && git remote -v && git remote show origin && git config --get user.name && git config --list && git config user.name`,
        `git -C ${sb.customTmpDir}/scratch init && git -C /tmp/scratch commit -m test`,
        `gh pr view 1 && gh pr list && gh api repos/org/repo && gh api -X GET repos/org/repo`,
        `echo "git push -f origin main"`,
      ];
      for (const cmd of allowedRoCommands) {
        assert.equal(runCmd("ro-cmd", cmd).decision, "allow", `expected ro allow: ${cmd}`);
      }

      const deniedRoCommands = [
        `git add .`,
        `git commit -m x`,
        `git push origin feat`,
        `git pull`,
        `git checkout main`,
        `git switch main`,
        `git restore .`,
        `git reset --hard`,
        `git clean -fd`,
        `git branch evil-branch`,
        `git branch -D feat`,
        `git tag v1.0.0`,
        `git tag -d v1.0.0`,
        `git stash`,
        `git stash pop`,
        `git worktree add /tmp/wt`,
        `git remote add evil https://example.com`,
        `git config user.name Evil`,
        `git config --unset user.name`,
        `git -C ${sb.customTmpDir}/scratch -C ${sb.outsideDir} commit -m pwn`,
        `gh pr create --title x --body y`,
        `gh pr merge 1`,
        `gh issue comment 1 --body hi`,
        `gh release create v1`,
        `gh repo Fork org/repo`,
        `gh api -X POST repos/o/r/issues`,
        `gh api repos/o/r/issues -f title=x`,
        `gh api repos/o/r/issues --input body.json`,
      ];
      for (const cmd of deniedRoCommands) {
        assert.equal(runCmd("ro-cmd", cmd).decision, "deny", `expected ro deny: ${cmd}`);
      }

      for (const convId of ["coord-cmd", "impl-cmd", "ro-cmd", "adv-cmd", "sicko-cmd"]) {
        for (const cmd of [
          "git push --force origin main",
          "git push -f origin master",
          "git push -uf origin HEAD:main",
          "git push origin +main",
          "(git push -f origin +HEAD:refs/heads/master)",
        ]) {
          assert.equal(runCmd(convId, cmd, { PSTACK_ALLOW_PUSH: "1" }).decision, "deny", `expected force-push deny for ${convId}: ${cmd}`);
        }
      }
      assert.equal(runCmd("coord-cmd", "git push --force-with-lease origin main").decision, "allow");
      assert.equal(runCmd("coord-cmd", "git push --force-if-includes origin main").decision, "allow");
      assert.equal(runCmd("impl-cmd", "git push --force-with-lease origin main", { PSTACK_ALLOW_PUSH: "1" }).decision, "allow");

      const gitInWt = (args) => spawnSync("git", ["-C", sb.worktree, ...args], { encoding: "utf8" });
      gitInWt(["init", "-b", "main"]);
      gitInWt(["config", "user.email", "test@example.com"]);
      gitInWt(["config", "user.name", "Test"]);
      writeFileSync(join(sb.worktree, "init.txt"), "init\n", "utf8");
      gitInWt(["add", "init.txt"]);
      gitInWt(["commit", "-m", "init"]);
      for (const cmd of ["git push --force", "git push -f origin", "git push -f origin HEAD", "git push origin +HEAD"]) {
        assert.equal(runCmd("coord-cmd", cmd).decision, "deny", `expected implicit main deny for coord: ${cmd}`);
        assert.equal(runCmd("impl-cmd", cmd, { PSTACK_ALLOW_PUSH: "1" }).decision, "deny", `expected implicit main deny for impl: ${cmd}`);
      }
      gitInWt(["checkout", "-b", "feat/force-ok"]);
      for (const cmd of ["git push --force", "git push -f origin", "git push -f origin HEAD"]) {
        assert.equal(runCmd("coord-cmd", cmd).decision, "allow", `expected feature-branch allow for coord: ${cmd}`);
        assert.equal(runCmd("impl-cmd", cmd, { PSTACK_ALLOW_PUSH: "1" }).decision, "allow", `expected feature-branch allow for impl: ${cmd}`);
      }
      assert.equal(runCmd("impl-cmd", "git push --force origin main", { PSTACK_ALLOW_PUSH: "1" }).decision, "deny");
      const mainRepo = join(sb.root, "other-main-repo");
      mkdirSync(mainRepo, { recursive: true });
      spawnSync("git", ["-C", mainRepo, "init", "-b", "main"], { encoding: "utf8" });
      assert.equal(runCmd("coord-cmd", `git -C ${mainRepo} push -f origin`).decision, "deny");

      assert.equal(runCmd("impl-cmd", "git push origin feat").decision, "deny");
      assert.equal(runCmd("impl-cmd", "PSTACK_ALLOW_PUSH=1 git push origin feat").decision, "allow");
      assert.equal(runCmd("impl-cmd", "env PSTACK_ALLOW_PUSH=1 git push origin feat").decision, "allow");
      assert.equal(runCmd("impl-cmd", "PSTACK_ALLOW_PUSH=1 echo hi && git push origin feat").decision, "deny");
      assert.equal(runCmd("impl-cmd", "git push origin feat", { PSTACK_ALLOW_PUSH: "1" }).decision, "allow");

      for (const convId of ["adv-cmd", "sicko-cmd"]) {
        assert.equal(runCmd(convId, "PSTACK_ALLOW_PUSH=1 git push origin feat", { PSTACK_ALLOW_PUSH: "1" }).decision, "deny");
        assert.equal(runCmd(convId, "gh pr close 1").decision, "deny");
      }

      for (const cmd of ["git status", "git diff", "git log -n 2", "git add src/a.js", "git commit -m 'clean'"]) {
        assert.equal(runCmd("sicko-cmd", cmd).decision, "allow", `expected sicko allow: ${cmd}`);
      }
      for (const cmd of ["git fetch", "git checkout -- .", "git restore .", "git reset --hard", "git rm foo.js", "git mv a b", `git -C ${sb.outsideDir} add .`]) {
        assert.equal(runCmd("sicko-cmd", cmd).decision, "deny", `expected sicko deny: ${cmd}`);
      }
    } finally {
      sb.cleanup();
    }
  });
});

describe("Stop hook git cleanliness check and loop guards", () => {
  function initGitRepo(dir) {
    const run = (args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    run(["init"]);
    run(["config", "user.email", "test@example.com"]);
    run(["config", "user.name", "Test"]);
    writeFileSync(join(dir, "tracked.txt"), "hello\n", "utf8");
    writeFileSync(join(dir, "baseline-dirty.txt"), "initial\n", "utf8");
    run(["add", "tracked.txt", "baseline-dirty.txt"]);
    run(["commit", "-m", "init"]);
    writeFileSync(join(dir, "baseline-dirty.txt"), "dirty-before-session\n", "utf8");
  }

  test("enforces git cleanliness on Stop for readonly and sicko against SessionStart/PreInvocation baseline", () => {
    const sb = makeSandbox();
    try {
      initGitRepo(sb.worktree);
      writeSwarmMembers(sb.appDataDir, "coord-stop", {
        coordinator: { conversation_id: "coord-stop", role: "coordinator" },
        "ro-1": { conversation_id: "ro-stop", role: "worker" },
        "sicko-1": { conversation_id: "sicko-stop", role: "worker" },
        "impl-1": { conversation_id: "impl-stop", role: "worker" },
      });

      invokeGuard({ hookEventName: "SessionStart", conversationId: "ro-stop", rootConversationId: "coord-stop", cwd: sb.worktree }, { PSTACK_APPDATA_DIR: sb.appDataDir });
      invokeGuard({ hookEventName: "SessionStart", conversationId: "sicko-stop", rootConversationId: "coord-stop", cwd: sb.worktree }, { PSTACK_APPDATA_DIR: sb.appDataDir });

      assert.deepEqual(
        invokeGuard({ hookEventName: "Stop", conversationId: "ro-stop", rootConversationId: "coord-stop", cwd: sb.worktree, terminationReason: "NO_TOOL_CALL" }, { PSTACK_APPDATA_DIR: sb.appDataDir }),
        {},
      );

      writeFileSync(join(sb.worktree, "tracked.txt"), "mutated\n", "utf8");
      const roStop = invokeGuard(
        { hookEventName: "Stop", conversationId: "ro-stop", rootConversationId: "coord-stop", cwd: sb.worktree, terminationReason: "NO_TOOL_CALL" },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.equal(roStop.decision, "continue");
      assert.ok(roStop.reason.includes("tracked.txt"));

      assert.deepEqual(
        invokeGuard(
          { hookEventName: "Stop", conversationId: "ro-stop", rootConversationId: "coord-stop", cwd: sb.worktree, continuationActive: true },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        {},
      );
      assert.deepEqual(
        invokeGuard(
          { hookEventName: "Stop", conversationId: "ro-stop", rootConversationId: "coord-stop", cwd: sb.worktree, terminationReason: "MAX_TURNS" },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        {},
      );

      assert.deepEqual(
        invokeGuard(
          { hookEventName: "Stop", conversationId: "sicko-stop", rootConversationId: "coord-stop", cwd: sb.worktree, terminationReason: "NO_TOOL_CALL" },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        {},
      );
      writeFileSync(join(sb.worktree, "stray-untracked.txt"), "oops\n", "utf8");
      const sickoUntracked = invokeGuard(
        { hookEventName: "Stop", conversationId: "sicko-stop", rootConversationId: "coord-stop", cwd: sb.worktree, terminationReason: "NO_TOOL_CALL" },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.equal(sickoUntracked.decision, "continue");
      assert.ok(sickoUntracked.reason.includes("stray-untracked.txt"));
      rmSync(join(sb.worktree, "stray-untracked.txt"));
      rmSync(join(sb.worktree, "tracked.txt"));
      const sickoDeleted = invokeGuard(
        { hookEventName: "Stop", conversationId: "sicko-stop", rootConversationId: "coord-stop", cwd: sb.worktree },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.equal(sickoDeleted.decision, "continue");
      assert.ok(sickoDeleted.reason.includes("tracked.txt"));

      assert.deepEqual(
        invokeGuard(
          { hookEventName: "Stop", conversationId: "impl-stop", rootConversationId: "coord-stop", cwd: sb.worktree },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        {},
      );

      writeSwarmMembers(sb.appDataDir, "coord-stop", {
        coordinator: { conversation_id: "coord-stop", role: "coordinator" },
        "ro-1": { conversation_id: "ro-stop", role: "worker" },
        "ro-2": { conversation_id: "ro-late-cwd", role: "worker" },
        "sicko-1": { conversation_id: "sicko-stop", role: "worker" },
        "impl-1": { conversation_id: "impl-stop", role: "worker" },
      });
      invokeGuard({ hookEventName: "SessionStart", conversationId: "ro-late-cwd", rootConversationId: "coord-stop" }, { PSTACK_APPDATA_DIR: sb.appDataDir });
      invokeGuard({ hookEventName: "PreInvocation", conversationId: "ro-late-cwd", rootConversationId: "coord-stop", cwd: sb.worktree }, { PSTACK_APPDATA_DIR: sb.appDataDir });
      assert.deepEqual(
        invokeGuard({ hookEventName: "Stop", conversationId: "ro-late-cwd", rootConversationId: "coord-stop", cwd: sb.worktree, terminationReason: "NO_TOOL_CALL" }, { PSTACK_APPDATA_DIR: sb.appDataDir }),
        {},
      );

      const scratchRepo = join(sb.customTmpDir, "scratch-stop");
      mkdirSync(scratchRepo, { recursive: true });
      initGitRepo(scratchRepo);
      writeFileSync(join(scratchRepo, "tracked.txt"), "scratch-dirty\n", "utf8");
      assert.deepEqual(
        invokeGuard(
          { hookEventName: "Stop", conversationId: "ro-stop", rootConversationId: "coord-stop", cwd: scratchRepo, terminationReason: "NO_TOOL_CALL" },
          { PSTACK_APPDATA_DIR: sb.appDataDir, TMPDIR: sb.customTmpDir },
        ),
        {},
      );
      assert.deepEqual(
        invokeGuard(
          { hookEventName: "Stop", conversationId: "ro-stop", rootConversationId: "coord-stop", cwd: sb.outsideDir, terminationReason: "NO_TOOL_CALL" },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        {},
      );
    } finally {
      sb.cleanup();
    }
  });
});

describe("Global hooks sync, drift warning, coordinator release, unforkedRoot cache, dual-hook dedup, and legacy cleanup", () => {
  test("sync-hooks.mjs supports --check on missing/stale/synced, preserves sibling keys, and writes 2-space JSON", () => {
    const sb = makeSandbox();
    try {
      const cfgDir = join(sb.root, "gemini-cfg");
      const globalHooksPath = join(cfgDir, "hooks.json");
      const runSync = (args = [], extraEnv = {}) =>
        spawnSync(process.execPath, [SYNC_HOOKS_PATH, ...args], {
          encoding: "utf8",
          env: buildEnv({ PSTACK_CONFIG_DIR: undefined, ...extraEnv }),
        });

      const missingCheck = runSync(["--check", "--config-dir", cfgDir]);
      assert.equal(missingCheck.status, 1);

      mkdirSync(cfgDir, { recursive: true });
      const siblingHerdr = { SessionStart: [{ type: "command", command: "herdr-hook", timeout: 5 }] };
      writeFileSync(
        globalHooksPath,
        JSON.stringify({
          herdr: siblingHerdr,
          "pstack-swarm-guard": {
            SessionStart: [{ type: "command", command: `node '${GUARD_PATH}'`, timeout: 10 }],
          },
        }, null, 2),
        "utf8",
      );
      const staleCheck = runSync(["--check"], { PSTACK_CONFIG_DIR: cfgDir });
      assert.equal(staleCheck.status, 1);

      const syncRes = runSync(["--config-dir", cfgDir]);
      assert.equal(syncRes.status, 0, syncRes.stderr);

      const rawSynced = readFileSync(globalHooksPath, "utf8");
      const parsedSynced = JSON.parse(rawSynced);
      assert.equal(rawSynced, `${JSON.stringify(parsedSynced, null, 2)}\n`);
      assert.deepEqual(parsedSynced.herdr, siblingHerdr);

      const absGuard = realpathSync(GUARD_PATH);
      const expectedCmd = `test ! -f '${absGuard}' || node '${absGuard}'`;
      const guardSpec = parsedSynced["pstack-swarm-guard"];
      assert.deepEqual(guardSpec.SessionStart, [{ type: "command", command: expectedCmd, timeout: 10 }]);
      assert.deepEqual(guardSpec.PreInvocation, [{ type: "command", command: expectedCmd, timeout: 10 }]);
      assert.deepEqual(guardSpec.Stop, [{ type: "command", command: expectedCmd, timeout: 10 }]);
      assert.equal(guardSpec.PreToolUse.length, 2);
      assert.equal(guardSpec.PreToolUse[0].hooks[0].command, expectedCmd);
      assert.equal(guardSpec.PreToolUse[1].hooks[0].command, expectedCmd);

      const syncedCheck = runSync(["--check"], { PSTACK_CONFIG_DIR: cfgDir });
      assert.equal(syncedCheck.status, 0, syncedCheck.stderr);

      const wrongTargetDir = join(sb.root, "wrong-cfg");
      mkdirSync(wrongTargetDir, { recursive: true });
      writeFileSync(
        join(wrongTargetDir, "hooks.json"),
        JSON.stringify({
          "pstack-swarm-guard": {
            SessionStart: [{ type: "command", command: "node '/nonexistent/guard.mjs'", timeout: 10 }],
            PreInvocation: [{ type: "command", command: "node '/nonexistent/guard.mjs'", timeout: 10 }],
            PreToolUse: guardSpec.PreToolUse,
            Stop: [{ type: "command", command: "node '/nonexistent/guard.mjs'", timeout: 10 }],
          },
        }, null, 2),
        "utf8",
      );
      assert.equal(runSync(["--check", `--config-dir=${wrongTargetDir}`]).status, 1);
    } finally {
      sb.cleanup();
    }
  });

  test("emits colon-free, dash-free drift warning on stale global hooks.json and avoids duplicate warnings", () => {
    const sb = makeSandbox();
    try {
      const cfgDir = join(sb.root, "drift-cfg");
      mkdirSync(cfgDir, { recursive: true });
      const absGuard = realpathSync(GUARD_PATH);
      const cmd = `test ! -f '${absGuard}' || node '${absGuard}'`;
      writeFileSync(
        join(cfgDir, "hooks.json"),
        JSON.stringify({
          "pstack-swarm-guard": {
            SessionStart: [{ type: "command", command: cmd, timeout: 10 }],
            PreInvocation: [{ type: "command", command: cmd, timeout: 10 }],
            PreToolUse: [
              {
                matcher: "(invoke|define)_subagent|manage_subagents|send_message|run_workflow",
                hooks: [{ type: "command", command: cmd, timeout: 10 }],
              },
            ],
          },
        }, null, 2),
        "utf8",
      );

      const out1 = invokeGuard(
        { hookEventName: "SessionStart", conversationId: "drift-coord-1", lastUserInput: "/pstack fix bug" },
        { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir },
      );
      const msg1 = out1.injectSteps?.[0]?.systemMessage?.systemMessage || "";
      assert.ok(msg1.includes("Coordinator role capsule"));
      assert.ok(msg1.includes("sync-hooks.mjs"));
      assert.ok(msg1.includes("/setup-pstack"));
      assert.equal(msg1.includes(":"), false, "drift warning + capsule must contain zero colons");
      assert.equal(msg1.includes("—"), false, "drift warning + capsule must contain zero em-dashes");
      assert.equal(msg1.includes("–"), false, "drift warning + capsule must contain zero en-dashes");

      assert.deepEqual(
        invokeGuard(
          { hookEventName: "SessionStart", conversationId: "drift-coord-1", lastUserInput: "/pstack fix bug" },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir },
        ),
        {},
      );

      const capDir = join(sb.appDataDir, "plugin_data", "agy-pstack-next", "capsules");
      mkdirSync(capDir, { recursive: true });
      writeFileSync(
        join(capDir, "drift-coord-2.json"),
        JSON.stringify({ capsule: "roles/coordinator.md", activePrompt: "/pstack pre-injected" }, null, 2),
        "utf8",
      );
      const out2 = invokeGuard(
        { hookEventName: "SessionStart", conversationId: "drift-coord-2", lastUserInput: "/pstack pre-injected" },
        { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir },
      );
      const msg2 = out2.injectSteps?.[0]?.systemMessage?.systemMessage || "";
      assert.ok(msg2.includes("sync-hooks.mjs"));
      assert.equal(msg2.includes("Coordinator role capsule"), false);
      assert.equal(msg2.includes(":"), false);
      assert.equal(msg2.includes("—"), false);
      assert.equal(msg2.includes("–"), false);

      assert.deepEqual(
        invokeGuard(
          { hookEventName: "SessionStart", conversationId: "drift-coord-2", lastUserInput: "/pstack pre-injected" },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir },
        ),
        {},
      );

      writeFileSync(
        join(cfgDir, "hooks.json"),
        JSON.stringify({
          "pstack-swarm-guard": {
            enabled: false,
            SessionStart: [{ type: "command", command: cmd, timeout: 10 }],
          },
        }, null, 2),
        "utf8",
      );
      const disabledDrift = invokeGuard(
        { hookEventName: "SessionStart", conversationId: "drift-coord-3", lastUserInput: "/pstack quiet" },
        { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir },
      );
      assert.equal(disabledDrift.injectSteps[0].systemMessage.systemMessage.includes("sync-hooks.mjs"), false);
    } finally {
      sb.cleanup();
    }
  });

  test("releases sticky coordinator lock after all task workers are killed and re-engages without duplicate capsule", () => {
    const sb = makeSandbox();
    try {
      const convId = "coord-release";
      const capPath = join(sb.appDataDir, "plugin_data", "agy-pstack-next", "capsules", `${convId}.json`);

      const firstStart = invokeGuard(
        { hookEventName: "SessionStart", conversationId: convId, lastUserInput: "/pstack implement feature" },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.ok(firstStart.injectSteps[0].systemMessage.systemMessage.includes("Coordinator role capsule"));
      assert.equal(JSON.parse(readFileSync(capPath, "utf8")).activePrompt, "/pstack implement feature");

      assert.equal(
        invokeGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: convId,
            cwd: sb.worktree,
            toolCall: { id: "t-turn0", name: "invoke_subagent", args: { TypeName: "research" } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ).decision,
        "deny",
      );

      writeSwarmMembers(sb.appDataDir, convId, {
        coordinator: { conversation_id: convId, role: "coordinator" },
        monitor: { conversation_id: "mon-1", role: "worker" },
        "impl-1": { conversation_id: "impl-1-cid", role: "worker" },
      });
      assert.equal(
        invokeGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: convId,
            lastUserInput: "follow up while worker active",
            cwd: sb.worktree,
            toolCall: { id: "t-active", name: "invoke_subagent", args: { TypeName: "research" } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ).decision,
        "deny",
      );

      writeSwarmMembers(sb.appDataDir, convId, {
        coordinator: { conversation_id: convId, role: "coordinator" },
        monitor: { conversation_id: "mon-1", role: "worker" },
        "impl-1": { conversation_id: "impl-1-cid", role: "worker", state: "killed" },
        "ro-1": { conversation_id: "ro-1-cid", role: "worker", killed: true },
      });

      assert.deepEqual(
        invokeGuard(
          { hookEventName: "SessionStart", conversationId: convId, lastUserInput: "now let us discuss unrelated docs" },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        {},
      );
      const releasedState = JSON.parse(readFileSync(capPath, "utf8"));
      assert.equal(releasedState.capsule, "roles/coordinator.md");
      assert.equal(releasedState.activePrompt, undefined);

      assert.equal(
        invokeGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: convId,
            cwd: sb.worktree,
            toolCall: { id: "t-released", name: "invoke_subagent", args: { TypeName: "research" } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ).decision,
        "allow",
      );

      const secondStart = invokeGuard(
        { hookEventName: "SessionStart", conversationId: convId, lastUserInput: "/pstack second wave" },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(secondStart, {});
      assert.equal(JSON.parse(readFileSync(capPath, "utf8")).activePrompt, "/pstack second wave");
      assert.equal(
        invokeGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: convId,
            lastUserInput: "/pstack second wave",
            cwd: sb.worktree,
            toolCall: { id: "t-reengaged", name: "run_workflow", args: {} },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ).decision,
        "deny",
      );
    } finally {
      sb.cleanup();
    }
  });

  test("caches unforkedRoot true after first transcript check without caching missing transcripts or blocking later /pstack", () => {
    const sb = makeSandbox();
    try {
      const capPathMissing = join(sb.appDataDir, "plugin_data", "agy-pstack-next", "capsules", "no-tx-conv.json");
      assert.deepEqual(
        invokeGuard(
          { hookEventName: "SessionStart", conversationId: "no-tx-conv", lastUserInput: "hello" },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        {},
      );
      assert.equal(existsSync(capPathMissing), false, "must not cache unforkedRoot when transcript does not exist");

      const convId = "unforked-chat";
      const txPath = join(sb.appDataDir, "brain", convId, ".system_generated", "logs", "transcript.jsonl");
      mkdirSync(dirname(txPath), { recursive: true });
      writeFileSync(txPath, `${JSON.stringify({ type: "USER_INPUT", content: "ordinary question" })}\n`, "utf8");

      assert.deepEqual(
        invokeGuard(
          { hookEventName: "SessionStart", conversationId: convId, lastUserInput: "ordinary question", transcriptPath: txPath },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        {},
      );
      const capPath = join(sb.appDataDir, "plugin_data", "agy-pstack-next", "capsules", `${convId}.json`);
      assert.equal(JSON.parse(readFileSync(capPath, "utf8")).unforkedRoot, true);

      writeFileSync(txPath, "[swarm] new board message should not be re-read\n", "utf8");
      writeSwarmMembers(sb.appDataDir, "unrelated-swarm", {
        coordinator: { conversation_id: "unrelated-swarm", role: "coordinator" },
        "ro-1": { conversation_id: convId, role: "worker" },
      });
      assert.equal(
        invokeGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: convId,
            transcriptPath: txPath,
            cwd: sb.worktree,
            toolCall: { id: "u-1", name: "invoke_subagent", args: { TypeName: "research" } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ).decision,
        "allow",
      );

      const pstackTurn = invokeGuard(
        { hookEventName: "SessionStart", conversationId: convId, lastUserInput: "/pstack escalate now", transcriptPath: txPath },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.ok(pstackTurn.injectSteps[0].systemMessage.systemMessage.includes("Coordinator role capsule"));
      assert.equal(JSON.parse(readFileSync(capPath, "utf8")).unforkedRoot, true);
    } finally {
      sb.cleanup();
    }
  });

  test("short-circuits duplicate PLUGIN_ROOT invocations when global hooks.json covers the event and target guard", () => {
    const sb = makeSandbox();
    try {
      const cfgDir = join(sb.root, "dual-cfg");
      const syncRes = spawnSync(process.execPath, [SYNC_HOOKS_PATH, "--config-dir", cfgDir], {
        encoding: "utf8",
        env: buildEnv({ PSTACK_CONFIG_DIR: undefined }),
      });
      assert.equal(syncRes.status, 0, syncRes.stderr);

      writeSwarmMembers(sb.appDataDir, "coord-dual", {
        coordinator: { conversation_id: "coord-dual", role: "coordinator" },
        "ro-1": { conversation_id: "ro-dual", role: "worker" },
      });

      assert.deepEqual(
        invokeGuard(
          { hookEventName: "SessionStart", conversationId: "ro-dual", rootConversationId: "coord-dual" },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir, PLUGIN_ROOT },
        ),
        {},
      );
      assert.deepEqual(
        invokeGuard(
          { hookEventName: "PreInvocation", conversationId: "ro-dual", rootConversationId: "coord-dual" },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir, PLUGIN_ROOT },
        ),
        {},
      );
      assert.equal(
        invokeGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "ro-dual",
            rootConversationId: "coord-dual",
            cwd: sb.worktree,
            toolCall: { id: "d1", name: "edit_file", args: { Path: join(sb.worktree, "a.js") } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir, PLUGIN_ROOT },
        ).decision,
        "allow",
      );
      assert.equal(
        invokeGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "ro-dual",
            rootConversationId: "coord-dual",
            cwd: sb.worktree,
            toolCall: { id: "d2", name: "invoke_subagent", args: { TypeName: "research" } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir, PLUGIN_ROOT },
        ).decision,
        "allow",
      );

      const repoDir = join(sb.root, "dual-repo");
      mkdirSync(repoDir, { recursive: true });
      spawnSync("git", ["-C", repoDir, "init"], { encoding: "utf8" });
      writeFileSync(join(repoDir, "dirty.txt"), "dirty\n", "utf8");
      assert.deepEqual(
        invokeGuard(
          { hookEventName: "Stop", conversationId: "ro-dual", rootConversationId: "coord-dual", cwd: repoDir, terminationReason: "NO_TOOL_CALL" },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir, PLUGIN_ROOT },
        ),
        {},
      );

      const globalHooksPath = join(cfgDir, "hooks.json");
      const hooksDoc = JSON.parse(readFileSync(globalHooksPath, "utf8"));
      delete hooksDoc["pstack-swarm-guard"].Stop;
      writeFileSync(globalHooksPath, JSON.stringify(hooksDoc, null, 2), "utf8");

      const stopOut = invokeGuard(
        { hookEventName: "Stop", conversationId: "ro-dual", rootConversationId: "coord-dual", cwd: repoDir, terminationReason: "NO_TOOL_CALL" },
        { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir, PLUGIN_ROOT },
      );
      assert.equal(stopOut.decision, "continue");
      assert.ok(stopOut.reason.includes("dirty.txt"));

      const delegatedOut = invokeGuard(
        { hookEventName: "SessionStart", conversationId: "ro-dual", rootConversationId: "coord-dual" },
        { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir, PLUGIN_ROOT, PSTACK_PLUGIN_ROOT: PLUGIN_ROOT },
      );
      assert.ok(delegatedOut.injectSteps[0].systemMessage.systemMessage.includes("Read-only specialist role capsule"));
    } finally {
      sb.cleanup();
    }
  });

  test("unlinks legacy injected-capsules.json and non-worker-roots.json on SessionStart", () => {
    const sb = makeSandbox();
    try {
      const cacheDir = join(sb.appDataDir, "plugin_data", "agy-pstack-next");
      mkdirSync(cacheDir, { recursive: true });
      const legacyCapsules = join(cacheDir, "injected-capsules.json");
      const legacyRoots = join(cacheDir, "non-worker-roots.json");
      writeFileSync(legacyCapsules, "{}", "utf8");
      writeFileSync(legacyRoots, "{}", "utf8");

      invokeGuard(
        { hookEventName: "SessionStart", conversationId: "legacy-clean-conv", lastUserInput: "hello" },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );

      assert.equal(existsSync(legacyCapsules), false);
      assert.equal(existsSync(legacyRoots), false);
    } finally {
      sb.cleanup();
    }
  });
});
