import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GUARD_PATH = join(PLUGIN_ROOT, "hooks", "guard.mjs");
const HOOKS_JSON_PATH = join(PLUGIN_ROOT, "hooks.json");

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
  writeFileSync(
    join(swarmDir, "members.json"),
    JSON.stringify({ title: "test-swarm", members }, null, 2),
    "utf8",
  );
}

function writeTranscriptLines(transcriptPath, steps) {
  mkdirSync(dirname(transcriptPath), { recursive: true });
  const text = steps
    .map((s) => (typeof s === "string" ? s : JSON.stringify(s)))
    .join("\n") + "\n";
  writeFileSync(transcriptPath, text, "utf8");
}

function runGuard(payload, envOverrides = {}, guardScriptPath = GUARD_PATH) {
  const env = { ...process.env };
  delete env.PSTACK_APPDATA_DIR;
  delete env.ANTIGRAVITY_APP_DATA_DIR;
  delete env.PLUGIN_DATA;
  delete env.PLUGIN_ROOT;
  delete env.PSTACK_PLUGIN_ROOT;
  delete env.PSTACK_CACHE_DIR;
  delete env.PSTACK_CONFIG_DIR;
  delete env.PSTACK_REMOTE_SWARM_CLI;
  delete env.PSTACK_REMOTE_BOARD_CONFIG;
  delete env.PSTACK_GUARD_DELEGATED;
  delete env.PSTACK_ALLOW_PUSH;
  delete env.PSTACK_FORCE_COORDINATOR;
  if (
    guardScriptPath === GUARD_PATH &&
    !("PSTACK_CONFIG_DIR" in envOverrides) &&
    !("HOME" in envOverrides) &&
    !("PLUGIN_ROOT" in envOverrides) &&
    !("PSTACK_PLUGIN_ROOT" in envOverrides)
  ) {
    env.PSTACK_CONFIG_DIR = join(PLUGIN_ROOT, ".nonexistent-pstack-config-dir");
  }
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined || v === null) delete env[k];
    else env[k] = v;
  }

  const res = spawnSync(process.execPath, [guardScriptPath], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env,
  });

  assert.equal(res.status, 0, `guard exited non-zero: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

describe("hooks.json, guard.mjs packaging, and role capsule prose", () => {
  test("places hooks.json at plugin root with run_workflow matcher and executable script", () => {
    assert.equal(existsSync(HOOKS_JSON_PATH), true);
    assert.equal(existsSync(join(PLUGIN_ROOT, "hooks", "hooks.json")), false);

    const hooksConfig = JSON.parse(readFileSync(HOOKS_JSON_PATH, "utf8"));
    const guardSpec = hooksConfig["pstack-swarm-guard"];
    assert.ok(guardSpec);
    assert.deepEqual(guardSpec.SessionStart, [
      { type: "command", command: "./hooks/guard.mjs", timeout: 10 },
    ]);
    assert.deepEqual(guardSpec.PreInvocation, [
      { type: "command", command: "./hooks/guard.mjs", timeout: 10 },
    ]);
    assert.equal(guardSpec.PreToolUse.length, 2);
    assert.equal(
      guardSpec.PreToolUse[0].matcher,
      "(invoke|define)_subagent|manage_subagents|send_message|run_workflow",
    );
    assert.equal(
      guardSpec.PreToolUse[1].matcher,
      "(edit|write)_file|run_command|call_mcp_tool|mcp_.*",
    );

    const mode = statSync(GUARD_PATH).mode;
    assert.notEqual(mode & 0o111, 0, "hooks/guard.mjs must have +x permission");
  });

  test("keeps all role capsules free of em-dashes, en-dashes, and mid-sentence colons with required guidance", () => {
    const roleFiles = [
      "coordinator.md",
      "research.md",
      "poteto-agent.md",
      "comment-sicko.md",
    ];
    for (const name of roleFiles) {
      const content = readFileSync(join(PLUGIN_ROOT, "roles", name), "utf8");
      assert.equal(content.includes("—"), false, `${name} contains em-dash`);
      assert.equal(content.includes("–"), false, `${name} contains en-dash`);
      assert.equal(content.includes(":"), false, `${name} contains colon`);
    }

    const coordText = readFileSync(join(PLUGIN_ROOT, "roles", "coordinator.md"), "utf8");
    assert.match(coordText, /always_on/);
    assert.match(coordText, /SKILL\.md/);
    assert.match(coordText, /Never kill `monitor` or `narrator` unless the user\s+asks/);

    const researchText = readFileSync(join(PLUGIN_ROOT, "roles", "research.md"), "utf8");
    assert.match(researchText, /canonical temp roots/);
  });
});

describe("Legacy subagent and run_workflow ban with default_api prefix normalization", () => {
  test("denies all 5 legacy and workflow tools (bare and default_api:) across managed roles while allowing unmanaged sessions", () => {
    const sb = makeSandbox();
    try {
      writeSwarmMembers(sb.appDataDir, "coord-conv", {
        coordinator: { conversation_id: "coord-conv", role: "coordinator" },
        monitor: { conversation_id: "mon-conv", role: "worker" },
        "impl-1": { conversation_id: "impl-conv", role: "worker" },
        "ro-1": { conversation_id: "ro-conv", role: "worker" },
        verifier: { conversation_id: "verifier-conv", role: "worker" },
        "adv-1": { conversation_id: "adv-conv", role: "worker" },
        "sicko-1": { conversation_id: "sicko-conv", role: "worker" },
      });

      const bannedTools = [
        "invoke_subagent",
        "define_subagent",
        "manage_subagents",
        "send_message",
        "run_workflow",
      ];
      const managedConvIds = [
        "coord-conv",
        "mon-conv",
        "impl-conv",
        "ro-conv",
        "verifier-conv",
        "adv-conv",
        "sicko-conv",
      ];

      for (const convId of managedConvIds) {
        for (const bareTool of bannedTools) {
          for (const toolName of [bareTool, `default_api:${bareTool}`]) {
            const out = runGuard({
              hookEventName: "PreToolUse",
              conversationId: convId,
              transcriptPath: join(sb.appDataDir, "brain", convId, "transcript.jsonl"),
              cwd: sb.worktree,
              toolCall: { id: "tc-1", name: toolName, args: {} },
            });
            assert.deepEqual(out, {
              decision: "deny",
              reason: "Legacy subagent tools are disabled in Swarm-Centric Pstack v2. Use native swarm.",
            });
          }
        }
      }

      for (const bareTool of bannedTools) {
        for (const toolName of [bareTool, `default_api:${bareTool}`]) {
          const unmanagedOut = runGuard({
            hookEventName: "PreToolUse",
            conversationId: "ordinary-chat-conv",
            transcriptPath: join(sb.appDataDir, "brain", "ordinary-chat-conv", "transcript.jsonl"),
            lastUserInput: "Refactor utils.ts using a subagent",
            cwd: sb.worktree,
            toolCall: { id: "tc-2", name: toolName, args: {} },
          });
          assert.deepEqual(unmanagedOut, { decision: "allow" });
        }
      }

      const prefixedWriteOnRo = runGuard(
        {
          hookEventName: "PreToolUse",
          conversationId: "ro-conv",
          cwd: sb.worktree,
          toolCall: {
            id: "tc-3",
            name: "default_api:write_file",
            args: { Path: join(sb.worktree, "blocked.txt") },
          },
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.equal(prefixedWriteOnRo.decision, "deny");
    } finally {
      sb.cleanup();
    }
  });
});

describe("appDataDir resolution and shared plugin_data/agy-pstack-next cache", () => {
  test("resolves ANTIGRAVITY_APP_DATA_DIR and shares plugin_data/agy-pstack-next across plugin and global hooks without duplicate injections", () => {
    const root = mkdtempSync(join(tmpdir(), "pstack-variants-"));
    try {
      for (const product of ["antigravity-cli", "antigravity", "antigravity-ide"]) {
        const appData = join(root, ".gemini", product);
        writeSwarmMembers(appData, "coord-1", {
          "ro-probe": { conversation_id: `conv-${product}`, role: "worker" },
        });

        const viaTranscript = runGuard({
          hookEventName: "SessionStart",
          conversationId: `conv-${product}`,
          transcriptPath: join(
            appData,
            "brain",
            `conv-${product}`,
            ".system_generated",
            "logs",
            "transcript.jsonl",
          ),
        });
        const expectedResearch = readFileSync(join(PLUGIN_ROOT, "roles", "research.md"), "utf8");
        assert.deepEqual(viaTranscript, {
          injectSteps: [{ systemMessage: { systemMessage: expectedResearch } }],
        });
      }

      const cliAppData = join(root, ".gemini", "antigravity-cli-global");
      const sharedPluginData = join(cliAppData, "plugin_data", "agy-pstack-next");
      writeSwarmMembers(cliAppData, "coord-dual", {
        coordinator: { conversation_id: "coord-dual", role: "coordinator" },
        "sicko-clean": { conversationId: "worker-via-env", role: "worker" },
      });

      const expectedCoord = readFileSync(join(PLUGIN_ROOT, "roles", "coordinator.md"), "utf8");
      const fromPluginHook = runGuard(
        {
          hookEventName: "SessionStart",
          conversationId: "coord-dual",
        },
        {
          ANTIGRAVITY_APP_DATA_DIR: cliAppData,
          PLUGIN_DATA: sharedPluginData,
        },
      );
      assert.deepEqual(fromPluginHook, {
        injectSteps: [{ systemMessage: { systemMessage: expectedCoord } }],
      });

      const fromGlobalHook = runGuard(
        {
          hookEventName: "SessionStart",
          conversationId: "coord-dual",
        },
        {
          ANTIGRAVITY_APP_DATA_DIR: cliAppData,
        },
      );
      assert.deepEqual(fromGlobalHook, {});
      assert.equal(existsSync(join(sharedPluginData, "injected-capsules.json")), true);

      const expectedSicko = readFileSync(join(PLUGIN_ROOT, "roles", "comment-sicko.md"), "utf8");
      const workerViaEnvAppData = runGuard(
        {
          hookEventName: "SessionStart",
          conversationId: "worker-via-env",
          rootConversationId: "coord-dual",
        },
        {
          ANTIGRAVITY_APP_DATA_DIR: cliAppData,
        },
      );
      assert.deepEqual(workerViaEnvAppData, {
        injectSteps: [{ systemMessage: { systemMessage: expectedSicko } }],
      });
      assert.equal(existsSync(join(sharedPluginData, "member-map.json")), true);

      const customPluginRoot = join(root, "custom-plugin");
      const customPluginData = join(root, "custom-plugin-data");
      mkdirSync(join(customPluginRoot, "roles"), { recursive: true });
      writeFileSync(join(customPluginRoot, "roles", "coordinator.md"), "custom-coord-capsule\n", "utf8");
      const viaOverrides = runGuard(
        { hookEventName: "SessionStart", conversationId: "override-conv" },
        {
          PSTACK_APPDATA_DIR: cliAppData,
          PLUGIN_ROOT: customPluginRoot,
          PLUGIN_DATA: customPluginData,
          PSTACK_FORCE_COORDINATOR: "1",
        },
      );
      assert.deepEqual(viaOverrides, {
        injectSteps: [{ systemMessage: { systemMessage: "custom-coord-capsule\n" } }],
      });
      assert.equal(existsSync(join(customPluginData, "injected-capsules.json")), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("skips builtin monitor and narrator roles cleanly without capsule injection", () => {
    const sb = makeSandbox();
    try {
      writeSwarmMembers(sb.appDataDir, "coord-1", {
        monitor: { conversation_id: "id-mon", role: "worker" },
        "monitor-2": { conversation_id: "id-mon-2", role: "worker" },
        narrator: { conversation_id: "id-nar", role: "worker" },
        "narrator-1": { conversation_id: "id-nar-1", role: "worker" },
      });

      for (const id of ["id-mon", "id-mon-2", "id-nar", "id-nar-1"]) {
        for (const hookEventName of ["SessionStart", "PreInvocation"]) {
          const out = runGuard(
            { hookEventName, conversationId: id, rootConversationId: "coord-1" },
            { PSTACK_APPDATA_DIR: sb.appDataDir },
          );
          assert.deepEqual(out, {});
        }
      }
    } finally {
      sb.cleanup();
    }
  });
});

describe("Session classification (worker, coordinator, unmanaged) and O(1) lookup", () => {
  test("leaves non-swarm chats unmanaged and classifies coordinators strictly across the 5 coordinator signals", () => {
    const sb = makeSandbox();
    try {
      const coordCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "coordinator.md"), "utf8");

      const normalTranscript = join(
        sb.appDataDir,
        "brain",
        "normal-chat",
        ".system_generated",
        "logs",
        "transcript.jsonl",
      );
      writeTranscriptLines(normalTranscript, [
        { step_index: 0, type: "USER_INPUT", content: "Fix the failing unit test" },
      ]);

      assert.deepEqual(
        runGuard(
          {
            hookEventName: "SessionStart",
            conversationId: "normal-chat",
            transcriptPath: normalTranscript,
            lastUserInput: "Fix the failing unit test",
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        {},
      );
      assert.deepEqual(
        runGuard(
          {
            hookEventName: "PreInvocation",
            conversationId: "normal-chat",
            transcriptPath: normalTranscript,
            lastUserInput: "/compact please",
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        {},
      );
      assert.deepEqual(
        runGuard(
          {
            hookEventName: "PreInvocation",
            conversationId: "normal-chat",
            transcriptPath: normalTranscript,
            lastUserInput: "See https://example.com/pstack for docs",
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        {},
      );

      const slashPrompts = [
        "/pstack ship auth",
        "/agy-pstack-next:pstack check compatibility",
        "please run /agy-pstack-next:setup-pstack",
        "/understand auth flow",
        "/agy-pstack-next:crucible parser",
        "/interrogate hooks",
        "/reflect session",
        "/ketchup --plain",
        "/verify-gen --formal",
        "/control-ui login",
        "/control-cli repl",
        "/statechart spec.ts",
        "/technical-writing README.md",
        "/make-bot-ui chat",
      ];

      slashPrompts.forEach((prompt, idx) => {
        const convId = `slash-coord-${idx}`;
        const out = runGuard(
          {
            hookEventName: "PreInvocation",
            conversationId: convId,
            lastUserInput: prompt,
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        );
        assert.deepEqual(out, {
          injectSteps: [{ systemMessage: { systemMessage: coordCapsule } }],
        });
      });

      const followUpDenied = runGuard(
        {
          hookEventName: "PreToolUse",
          conversationId: "slash-coord-0",
          lastUserInput: "looks good, continue",
          cwd: sb.worktree,
          toolCall: { id: "t1", name: "invoke_subagent", args: {} },
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.equal(followUpDenied.decision, "deny");

      for (const boardTool of ["swarm", "default_api:swarm", "post_message", "read_board", "default_api:swarm_wait"]) {
        const out = runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "spontaneous-swarm-root",
            cwd: sb.worktree,
            toolCall: { id: "b1", name: boardTool, args: { action: "status" } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        );
        assert.equal(out.decision, "allow");
      }
      const unmanagedAfterBoardTool = runGuard(
        {
          hookEventName: "SessionStart",
          conversationId: "spontaneous-swarm-root",
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(unmanagedAfterBoardTool, {});

      writeSwarmMembers(sb.appDataDir, "own-swarm-coord", {
        coordinator: { conversation_id: "own-swarm-coord", role: "coordinator" },
      });
      const viaOwnSwarm = runGuard(
        { hookEventName: "SessionStart", conversationId: "own-swarm-coord" },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(viaOwnSwarm, {
        injectSteps: [{ systemMessage: { systemMessage: coordCapsule } }],
      });

      const viaForceEnv = runGuard(
        { hookEventName: "SessionStart", conversationId: "forced-coord" },
        { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_FORCE_COORDINATOR: "1" },
      );
      assert.deepEqual(viaForceEnv, {
        injectSteps: [{ systemMessage: { systemMessage: coordCapsule } }],
      });
    } finally {
      sb.cleanup();
    }
  });

  test("resolves workers in O(1), skips brain scan on USER_INPUT transcripts, caches non-worker-roots.json, and batch-caches workers", () => {
    const sb = makeSandbox();
    try {
      const cacheDir = join(sb.appDataDir, "plugin_data", "agy-pstack-next");

      writeSwarmMembers(sb.appDataDir, "other-swarm", {
        "ro-decoy": { conversation_id: "user-root-conv", role: "worker" },
      });
      const userTranscript = join(
        sb.appDataDir,
        "brain",
        "user-root-conv",
        ".system_generated",
        "logs",
        "transcript.jsonl",
      );
      writeTranscriptLines(userTranscript, [
        { step_index: 0, type: "USER_INPUT", content: "Normal user chat" },
      ]);

      const skippedScanOut = runGuard(
        {
          hookEventName: "SessionStart",
          conversationId: "user-root-conv",
          transcriptPath: userTranscript,
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(skippedScanOut, {});

      const subagentTranscript = join(
        sb.appDataDir,
        "brain",
        "custom-subagent-1",
        ".system_generated",
        "logs",
        "transcript.jsonl",
      );
      writeTranscriptLines(subagentTranscript, [
        { step_index: 0, type: "SYSTEM_MESSAGE", content: "Subagent task" },
      ]);

      const firstSubagentOut = runGuard(
        {
          hookEventName: "SessionStart",
          conversationId: "custom-subagent-1",
          transcriptPath: subagentTranscript,
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(firstSubagentOut, {});

      const nonWorkerRoots = JSON.parse(readFileSync(join(cacheDir, "non-worker-roots.json"), "utf8"));
      assert.equal(nonWorkerRoots["custom-subagent-1"], true);

      const memberMapAfterScan = JSON.parse(readFileSync(join(cacheDir, "member-map.json"), "utf8"));
      assert.equal(memberMapAfterScan["user-root-conv"], "ro-decoy");

      writeSwarmMembers(sb.appDataDir, "late-other-swarm", {
        "ro-should-not-scan": { conversation_id: "custom-subagent-1", role: "worker" },
      });
      const secondSubagentOut = runGuard(
        {
          hookEventName: "PreInvocation",
          conversationId: "custom-subagent-1",
          transcriptPath: subagentTranscript,
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(secondSubagentOut, {});

      writeSwarmMembers(sb.appDataDir, "direct-root", {
        coordinator: { conversation_id: "direct-root", role: "coordinator" },
        "impl-a": { conversation_id: "w-impl-a", role: "worker" },
        "cand-b": { conversation_id: "w-cand-b", role: "worker" },
        "lead-c": { conversation_id: "w-lead-c", role: "worker" },
      });

      const agentCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "poteto-agent.md"), "utf8");
      const viaRootConvId = runGuard(
        {
          hookEventName: "SessionStart",
          conversationId: "w-impl-a",
          rootConversationId: "direct-root",
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(viaRootConvId, {
        injectSteps: [{ systemMessage: { systemMessage: agentCapsule } }],
      });

      const mapBatch = JSON.parse(readFileSync(join(cacheDir, "member-map.json"), "utf8"));
      assert.equal(mapBatch["w-impl-a"], "impl-a");
      assert.equal(mapBatch["w-cand-b"], "cand-b");
      assert.equal(mapBatch["w-lead-c"], "lead-c");
      assert.equal(mapBatch["direct-root"], undefined);

      rmSync(join(sb.appDataDir, "brain", "direct-root"), { recursive: true, force: true });
      const cachedCand = runGuard(
        { hookEventName: "SessionStart", conversationId: "w-cand-b" },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(cachedCand, {
        injectSteps: [{ systemMessage: { systemMessage: agentCapsule } }],
      });
    } finally {
      sb.cleanup();
    }
  });
});

describe("Verifier helper mapping and capsule override notices on upgrade and fork", () => {
  test("maps verifier, verifier-*, *-verifier, and verify-* helpers to readonly while preserving explicit prefixes", () => {
    const sb = makeSandbox();
    try {
      const researchCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "research.md"), "utf8");
      const agentCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "poteto-agent.md"), "utf8");
      const sickoCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "comment-sicko.md"), "utf8");

      writeSwarmMembers(sb.appDataDir, "coord-v", {
        verifier: { conversation_id: "id-v0", role: "worker" },
        "verifier-1": { conversation_id: "id-v1", role: "worker" },
        "api-verifier": { conversation_id: "id-v2", role: "worker" },
        "verify-links": { conversation_id: "id-v3", role: "worker" },
        "impl-verifier": { conversation_id: "id-impl-v", role: "worker" },
        "sicko-verifier": { conversation_id: "id-sicko-v", role: "worker" },
      });

      for (const id of ["id-v0", "id-v1", "id-v2", "id-v3"]) {
        const sessionOut = runGuard(
          { hookEventName: "SessionStart", conversationId: id, rootConversationId: "coord-v" },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        );
        assert.deepEqual(sessionOut, {
          injectSteps: [{ systemMessage: { systemMessage: researchCapsule } }],
        });

        const editRepoOut = runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: id,
            cwd: sb.worktree,
            toolCall: { id: "t1", name: "write_file", args: { Path: join(sb.worktree, "out.txt") } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        );
        assert.equal(editRepoOut.decision, "deny");
      }

      const implVerifierOut = runGuard(
        { hookEventName: "SessionStart", conversationId: "id-impl-v", rootConversationId: "coord-v" },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(implVerifierOut, {
        injectSteps: [{ systemMessage: { systemMessage: agentCapsule } }],
      });

      const sickoVerifierOut = runGuard(
        { hookEventName: "SessionStart", conversationId: "id-sicko-v", rootConversationId: "coord-v" },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(sickoVerifierOut, {
        injectSteps: [{ systemMessage: { systemMessage: sickoCapsule } }],
      });
    } finally {
      sb.cleanup();
    }
  });

  test("prepends concise role-override notice when upgrading injected-capsules.json or forking a capsule transcript", () => {
    const sb = makeSandbox();
    try {
      const coordCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "coordinator.md"), "utf8");
      const researchCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "research.md"), "utf8");
      const agentCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "poteto-agent.md"), "utf8");

      const firstCoord = runGuard(
        {
          hookEventName: "SessionStart",
          conversationId: "upgrade-conv",
          lastUserInput: "/pstack audit",
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(firstCoord, {
        injectSteps: [{ systemMessage: { systemMessage: coordCapsule } }],
      });

      writeSwarmMembers(sb.appDataDir, "coord-root", {
        "ro-1": { conversation_id: "upgrade-conv", role: "worker" },
        "impl-forked": { conversation_id: "forked-impl-conv", role: "worker" },
        "impl-from-coord": { conversation_id: "forked-from-coord-conv", role: "worker" },
      });

      const upgraded = runGuard(
        {
          hookEventName: "PreInvocation",
          conversationId: "upgrade-conv",
          rootConversationId: "coord-root",
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      const upgradedMsg = upgraded.injectSteps[0].systemMessage.systemMessage;
      assert.equal(upgradedMsg.endsWith(researchCapsule), true);
      assert.notEqual(upgradedMsg, researchCapsule);
      assert.match(upgradedMsg, /Role override/);
      assert.match(upgradedMsg, /supersedes/);
      assert.equal(upgradedMsg.includes("—"), false);
      assert.equal(upgradedMsg.includes(":"), false);

      const dedupedUpgrade = runGuard(
        {
          hookEventName: "PreInvocation",
          conversationId: "upgrade-conv",
          rootConversationId: "coord-root",
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(dedupedUpgrade, {});

      const forkedTranscript = join(
        sb.appDataDir,
        "brain",
        "forked-impl-conv",
        ".system_generated",
        "logs",
        "transcript.jsonl",
      );
      writeTranscriptLines(forkedTranscript, [
        {
          step_index: 0,
          source: "SYSTEM_SDK",
          type: "SYSTEM_MESSAGE",
          content: `The following system message was injected by a SessionStart hook:\n${researchCapsule}`,
        },
      ]);

      const forkedInject = runGuard(
        {
          hookEventName: "SessionStart",
          conversationId: "forked-impl-conv",
          rootConversationId: "coord-root",
          transcriptPath: forkedTranscript,
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      const forkedMsg = forkedInject.injectSteps[0].systemMessage.systemMessage;
      assert.equal(forkedMsg.endsWith(agentCapsule), true);
      assert.notEqual(forkedMsg, agentCapsule);
      assert.match(forkedMsg, /Role override/);
      assert.match(forkedMsg, /supersedes/);

      const forkedRepeat = runGuard(
        {
          hookEventName: "PreInvocation",
          conversationId: "forked-impl-conv",
          rootConversationId: "coord-root",
          transcriptPath: forkedTranscript,
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(forkedRepeat, {});

      const forkedCoordTranscript = join(
        sb.appDataDir,
        "brain",
        "forked-from-coord-conv",
        ".system_generated",
        "logs",
        "transcript.jsonl",
      );
      writeTranscriptLines(forkedCoordTranscript, [
        { step_index: 0, type: "USER_INPUT", content: "/pstack fix guard" },
        {
          step_index: 1,
          type: "SYSTEM_MESSAGE",
          content: `The following system message was injected by a PreInvocation hook:\n${coordCapsule}`,
        },
      ]);

      const forkedFromCoordInject = runGuard(
        {
          hookEventName: "SessionStart",
          conversationId: "forked-from-coord-conv",
          transcriptPath: forkedCoordTranscript,
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      const forkedCoordMsg = forkedFromCoordInject.injectSteps[0].systemMessage.systemMessage;
      assert.equal(forkedCoordMsg.endsWith(agentCapsule), true);
      assert.match(forkedCoordMsg, /Role override/);
    } finally {
      sb.cleanup();
    }
  });
});

describe("Author and adversary worktree, artifact, temp-root, and shell confinement", () => {
  test("allows write_file and edit_file in cwd, artifactDir, and canonical temp roots while blocking sibling, outside, and symlink escapes", () => {
    const sb = makeSandbox();
    const slashTmpSandbox = mkdtempSync("/tmp/pstack-author-tmp-");
    try {
      const artifactDir = join(sb.appDataDir, "brain", "impl-conv");
      mkdirSync(artifactDir, { recursive: true });
      writeSwarmMembers(sb.appDataDir, "coord-1", {
        "impl-auth": { conversation_id: "impl-conv", role: "worker" },
        "adv-sec": { conversation_id: "adv-conv", role: "worker" },
        "eval-runner-1": { conversation_id: "eval-conv", role: "worker" },
      });

      const outsideExistingFile = join(sb.outsideDir, "secret.txt");
      writeFileSync(outsideExistingFile, "secret", "utf8");
      symlinkSync(sb.outsideDir, join(sb.worktree, "linked-outside-dir"));
      symlinkSync(outsideExistingFile, join(sb.worktree, "linked-outside-file.txt"));
      symlinkSync(join(sb.outsideDir, "nonexistent-victim.txt"), join(sb.worktree, "dangling-escape.txt"));
      symlinkSync(sb.outsideDir, join(slashTmpSandbox, "tmp-escape-link"));

      const internalRealDir = join(sb.worktree, "packages", "core");
      mkdirSync(internalRealDir, { recursive: true });
      symlinkSync(internalRealDir, join(sb.worktree, "internal-link"));

      const checkPath = (convId, toolName, targetPath) =>
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: convId,
            rootConversationId: "coord-1",
            artifactDirectoryPath: artifactDir,
            cwd: sb.worktree,
            toolCall: { id: "tc", name: toolName, args: { Path: targetPath } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, TMPDIR: sb.customTmpDir },
        );

      assert.equal(
        checkPath("impl-conv", "write_file", join(sb.worktree, "src", "new", "deep", "index.mjs")).decision,
        "allow",
      );
      assert.equal(
        checkPath("impl-conv", "edit_file", "relative/new-subdir/module.mjs").decision,
        "allow",
      );
      assert.equal(
        checkPath("impl-conv", "write_file", join(sb.worktree, "internal-link", "sub", "ok.mjs")).decision,
        "allow",
      );
      assert.equal(
        checkPath("impl-conv", "write_file", join(artifactDir, "scratch", "notes.md")).decision,
        "allow",
      );
      assert.equal(
        checkPath("eval-conv", "write_file", join(slashTmpSandbox, "trial-1", ".agents", "skills", "s", "SKILL.md")).decision,
        "allow",
      );
      assert.equal(
        checkPath("adv-conv", "write_file", "/private/tmp/pstack-adv-repro.mjs").decision,
        "allow",
      );
      assert.equal(
        checkPath("adv-conv", "edit_file", join(sb.customTmpDir, "repro-notes.txt")).decision,
        "allow",
      );

      assert.equal(
        checkPath("impl-conv", "write_file", "../swarm-worker-a-sibling/hack.mjs").decision,
        "deny",
      );
      assert.equal(
        checkPath("impl-conv", "edit_file", join(sb.siblingWorktree, "hack.mjs")).decision,
        "deny",
      );
      assert.equal(
        checkPath("impl-conv", "write_file", join(sb.worktree, "linked-outside-dir", "new", "pwn.mjs")).decision,
        "deny",
      );
      assert.equal(
        checkPath("adv-conv", "edit_file", join(sb.worktree, "linked-outside-file.txt")).decision,
        "deny",
      );
      assert.equal(
        checkPath("eval-conv", "write_file", join(sb.worktree, "dangling-escape.txt")).decision,
        "deny",
      );
      assert.equal(
        checkPath("eval-conv", "write_file", join(slashTmpSandbox, "tmp-escape-link", "pwn.mjs")).decision,
        "deny",
      );

      const coordOutside = checkPath("coord-1", "write_file", join(sb.outsideDir, "pstack-models.md"));
      assert.equal(coordOutside.decision, "allow");
    } finally {
      rmSync(slashTmpSandbox, { recursive: true, force: true });
      sb.cleanup();
    }
  });

  test("confines author and adversary run_command redirects and cp/mv/ln/rm/patch/sed -i targets", () => {
    const sb = makeSandbox();
    const slashTmpSandbox = mkdtempSync("/tmp/pstack-author-shell-");
    try {
      const artifactDir = join(sb.appDataDir, "brain", "impl-conv");
      mkdirSync(artifactDir, { recursive: true });
      symlinkSync(sb.outsideDir, join(slashTmpSandbox, "tmp-escape"));

      writeSwarmMembers(sb.appDataDir, "coord-1", {
        "impl-1": { conversation_id: "impl-conv", role: "worker" },
        "adv-1": { conversation_id: "adv-conv", role: "worker" },
      });

      const runAuthorCmd = (convId, CommandLine) =>
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: convId,
            rootConversationId: "coord-1",
            artifactDirectoryPath: artifactDir,
            cwd: sb.worktree,
            toolCall: { id: "c1", name: "run_command", args: { CommandLine } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, TMPDIR: sb.customTmpDir },
        );

      const allowedCmds = [
        "echo build-ok > dist/output.txt",
        "node --test hooks/guard.test.mjs 2>/dev/null",
        `echo trial > ${join(slashTmpSandbox, "out.log")}`,
        `echo custom-tmp > ${join(sb.customTmpDir, "scratch.log")}`,
        "echo $TMPDIR/ok > $TMPDIR/probe.txt",
        "cp /etc/hosts ./hosts-copy.txt",
        `cp README.md ${join(slashTmpSandbox, "README.bak")}`,
        `cp ${join(slashTmpSandbox, "README.bak")} .`,
        "mv src/old.mjs src/new.mjs",
        `mv ${join(slashTmpSandbox, "staged.json")} src/staged.json`,
        "ln -s ../core packages/link-core",
        "rm -rf dist/ build/",
        `rm -f ${join(slashTmpSandbox, "out.log")}`,
        "patch -p1 < fix.diff",
        "patch src/app.mjs fix.diff",
        "sed -i '' '/^DEBUG/d' src/app.mjs",
        "sed -i 's/foo/bar/g' src/app.mjs",
        `cat <<'EOF' > ${join(slashTmpSandbox, "heredoc.mjs")}\nconst x = a > b;\nrm -rf /outside\nEOF`,
      ];

      for (const cmd of allowedCmds) {
        assert.equal(runAuthorCmd("impl-conv", cmd).decision, "allow", `expected allow for: ${cmd}`);
        assert.equal(runAuthorCmd("adv-conv", cmd).decision, "allow", `expected allow for adv: ${cmd}`);
      }

      const deniedCmds = [
        `echo escaped > ${join(sb.outsideDir, "escaped.txt")}`,
        "echo escaped > ../swarm-worker-a-sibling/escaped.txt",
        "echo escaped > ~/escaped-home.txt",
        `echo escaped > ${join(slashTmpSandbox, "tmp-escape", "pwn.txt")}`,
        `cp /etc/hosts ${join(sb.outsideDir, "escaped.txt")}`,
        "cp src/a.mjs ../swarm-worker-a-sibling/a.mjs",
        `mv src/a.mjs ${join(sb.outsideDir, "a.mjs")}`,
        `mv ${join(sb.outsideDir, "secret.txt")} src/secret.txt`,
        `ln -s /etc/hosts ${join(sb.outsideDir, "hosts-link")}`,
        `ln -s ${join(sb.outsideDir, "secret.txt")} ./escape-link`,
        `rm -rf ${join(sb.outsideDir, "victim")}`,
        "rm -f ../swarm-worker-a-sibling/file.mjs",
        `patch -d ${sb.outsideDir} -p1 < fix.diff`,
        `patch ${join(sb.outsideDir, "victim.txt")} fix.diff`,
        `sed -i '' 's/a/b/g' ${join(sb.outsideDir, "victim.txt")}`,
        "sed -i 's/a/b/g' ../swarm-worker-a-sibling/victim.txt",
      ];

      for (const cmd of deniedCmds) {
        assert.equal(runAuthorCmd("impl-conv", cmd).decision, "deny", `expected deny for: ${cmd}`);
        assert.equal(runAuthorCmd("adv-conv", cmd).decision, "deny", `expected deny for adv: ${cmd}`);
      }
    } finally {
      rmSync(slashTmpSandbox, { recursive: true, force: true });
      sb.cleanup();
    }
  });
});

describe("ro-* Read-Only Guard with canonical temp roots, inline script checks, and read-only git refs", () => {
  test("allows ro-* temp-root write_file/edit_file/FS/inline-script/git-tag/git-stash probes while blocking non-temp mutations", () => {
    const sb = makeSandbox();
    const slashTmpDir = mkdtempSync("/tmp/pstack-ro-probe-");
    try {
      symlinkSync(sb.outsideDir, join(slashTmpDir, "escape-symlink"));
      writeSwarmMembers(sb.appDataDir, "coord-1", {
        "ro-verify": { conversation_id: "ro-id", role: "worker" },
      });

      const callRoFileTool = (toolName, targetPath) =>
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "ro-id",
            rootConversationId: "coord-1",
            cwd: sb.worktree,
            toolCall: { id: "t1", name: toolName, args: { Path: targetPath } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, TMPDIR: sb.customTmpDir },
        );

      assert.equal(callRoFileTool("write_file", join(slashTmpDir, "probe.txt")).decision, "allow");
      assert.equal(callRoFileTool("edit_file", "/private/tmp/ro-notes.md").decision, "allow");
      assert.equal(callRoFileTool("write_file", join(sb.customTmpDir, "tmpdir-probe.json")).decision, "allow");
      assert.equal(callRoFileTool("write_file", realpathSync(slashTmpDir) + "/real-probe.txt").decision, "allow");

      assert.equal(callRoFileTool("write_file", join(sb.worktree, "f.txt")).decision, "deny");
      assert.equal(callRoFileTool("edit_file", join(sb.worktree, "f.txt")).decision, "deny");
      assert.equal(callRoFileTool("write_file", join(sb.outsideDir, "f.txt")).decision, "deny");
      assert.equal(callRoFileTool("write_file", "/tmp/../etc/pwned").decision, "deny");
      assert.equal(callRoFileTool("write_file", join(slashTmpDir, "escape-symlink", "pwn.txt")).decision, "deny");

      const runCmd = (CommandLine) =>
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "ro-id",
            rootConversationId: "coord-1",
            cwd: sb.worktree,
            toolCall: { id: "t2", name: "run_command", args: { CommandLine } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, TMPDIR: sb.customTmpDir },
        );

      const allowedCommands = [
        "git status --short",
        "git -C /tmp/repo diff 051c56d -- skills/statechart/scripts",
        "git log --oneline -n 10 2>/dev/null",
        "git show HEAD:hooks.json",
        "git tag",
        "git tag -l",
        "git tag -l 'v1.*'",
        "git tag --list",
        "git tag -v v1.0.0",
        "git tag --verify v1.0.0",
        "git tag --contains HEAD",
        "git tag --points-at HEAD",
        "git stash list",
        "git stash show",
        "git stash show -p stash@{0}",
        "node --test hooks/guard.test.mjs 2>&1",
        "grep -rn 'git push|rm -rf' hooks/",
        "sed -n '1,20p' README.md",
        "npm test",
        `echo probe-result > ${join(slashTmpDir, "probe.txt")}`,
        `echo tmpdir-result > ${join(sb.customTmpDir, "probe.txt")}`,
        "echo env-tmp > $TMPDIR/env-probe.txt",
        "git status | tee /dev/null",
        `git log -n 3 | tee -a ${join(slashTmpDir, "git.log")}`,
        `mkdir -p ${join(slashTmpDir, "nested")} && cp README.md ${join(slashTmpDir, "nested", "README.md")}`,
        `mv ${join(slashTmpDir, "a.txt")} ${join(slashTmpDir, "b.txt")}`,
        `chmod +x ${join(slashTmpDir, "probe.sh")} && unlink ${join(slashTmpDir, "b.txt")}`,
        `rm -rf ${join(slashTmpDir, "nested")} ${join(sb.customTmpDir, "probe.txt")}`,
        "node -e \"console.log(JSON.parse(require('fs').readFileSync('hooks.json', 'utf8')))\"",
        `node -e "require('fs').writeFileSync('${join(slashTmpDir, "inline.json")}', '{}')"`,
        "python3 -c \"import json; print(json.load(open('hooks.json', encoding='utf-8')))\"",
        `python3 -c "open('${join(slashTmpDir, "py.txt")}', 'w').write('ok')"`,
        `python3 -c "from pathlib import Path; Path('${join(slashTmpDir, "p.txt")}').write_text('ok')"`,
        `python3 -c "import os; os.remove('${join(slashTmpDir, "p.txt")}')"`,
      ];
      for (const cmd of allowedCommands) {
        assert.equal(runCmd(cmd).decision, "allow", `expected allow for: ${cmd}`);
      }

      const deniedCommands = [
        "git commit -m 'sneaky'",
        "git -C /tmp/repo push origin main",
        "git merge feature",
        "git rebase main",
        "git cherry-pick abc1234",
        "git reset --hard HEAD~1",
        "git clean -fd",
        "git stash",
        "git stash push",
        "git stash pop",
        "git stash drop",
        "git stash apply",
        "git stash clear",
        "git tag v2.0.0",
        "git tag -a v2.0.0 -m 'release'",
        "git tag -d v2.0.0",
        "git tag --delete v2.0.0",
        "git tag -f -l v2.0.0",
        "git am patch.mbox",
        "git apply fix.patch",
        "git mv a.js b.js",
        "git rm a.js",
        "git checkout -b new-branch",
        "git checkout -B reset-branch",
        "git checkout --orphan empty-branch",
        "git checkout -- README.md",
        "git switch -c another-branch",
        "git switch -C force-branch",
        "rm -rf dist",
        `rm -f ${join(slashTmpDir, "escape-symlink", "secret.txt")}`,
        "rmdir empty-dir",
        "mv a.txt b.txt",
        `mv README.md ${join(slashTmpDir, "stolen.md")}`,
        "cp a.txt b.txt",
        `cp ${join(slashTmpDir, "a.txt")} README.md`,
        "chmod +x script.sh",
        "unlink README.md",
        "chown nobody file.txt",
        "truncate -s 0 file.txt",
        "dd if=/dev/zero of=out.bin count=1",
        "patch -p1 < fix.diff",
        "sed -i '' 's/foo/bar/g' file.txt",
        "perl -pi -e 's/foo/bar/g' file.txt",
        "npm install lodash",
        "pnpm add zod",
        "yarn",
        "yarn add react",
        "bun install",
        "pip install requests",
        "python3 -m pip install click",
        "echo hacked > README.md",
        "echo escaped > /tmp/../etc/pwned",
        `echo escaped > ${join(slashTmpDir, "escape-symlink", "pwned.txt")}`,
        "echo appended >> notes.md",
        "git status | tee status.txt",
        "git status | tee /tmp/../outside.txt",
        "sh -c 'rm -f secret.txt'",
        "echo $(touch pwned.txt)",
        "node -e \"require('fs').writeFileSync('README.md', 'hacked')\"",
        "node -e \"import('node:fs').then(fs => fs.unlinkSync('hooks.json'))\"",
        `node -e "require('fs').writeFileSync('${join(slashTmpDir, "escape-symlink", "pwn.txt")}', 'x')"`,
        "node -e \"const p = 'README.md'; require('fs').rmSync(p)\"",
        "node -e \"const w = require('fs').writeFileSync; w('README.md', 'x')\"",
        "node -e \"const { writeFileSync: w } = require('fs'); w('README.md', 'x')\"",
        "python3 -c \"open('README.md', 'w').write('hacked')\"",
        "python3 -c \"import os; r = os.remove; r('hooks.json')\"",
        "python3 -c \"from os import remove as r; r('hooks.json')\"",
        "python3 -c \"o = open; o('README.md', 'w').write('x')\"",
        "python3 -c \"import os; os.remove('hooks.json')\"",
        "python3 -c \"import shutil; shutil.rmtree('skills')\"",
        "python3 -c \"from pathlib import Path; Path('README.md').write_text('x')\"",
        "python3 -c \"from pathlib import Path; p = Path('README.md'); p.write_text('x')\"",
      ];
      for (const cmd of deniedCommands) {
        assert.equal(runCmd(cmd).decision, "deny", `expected deny for: ${cmd}`);
      }
    } finally {
      rmSync(slashTmpDir, { recursive: true, force: true });
      sb.cleanup();
    }
  });

  test("allows native swarm and read-only MCP calls while blocking mutating MCP tools", () => {
    const sb = makeSandbox();
    try {
      writeSwarmMembers(sb.appDataDir, "coord-1", {
        "ro-mesh": { conversation_id: "ro-mcp-id", role: "worker" },
      });

      const callTool = (name, args = {}) =>
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "ro-mcp-id",
            rootConversationId: "coord-1",
            cwd: sb.worktree,
            toolCall: { id: "m1", name, args },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        );

      assert.equal(callTool("call_mcp_tool", { ToolName: "post_message" }).decision, "allow");
      assert.equal(callTool("call_mcp_tool", { ToolName: "read_board" }).decision, "allow");
      assert.equal(callTool("call_mcp_tool", { ToolName: "swarm_wait" }).decision, "allow");
      assert.equal(callTool("call_mcp_tool", { ToolName: "swarm" }).decision, "allow");
      assert.equal(callTool("mcp_swarm_post_message").decision, "allow");

      assert.equal(callTool("mcp_github_get_pull_request").decision, "allow");
      assert.equal(callTool("mcp_linear_list_issues").decision, "allow");
      assert.equal(callTool("call_mcp_tool", { ToolName: "search_code" }).decision, "allow");
      assert.equal(callTool("call_mcp_tool", { toolName: "inspect_trace" }).decision, "allow");

      assert.equal(callTool("mcp_github_create_pull_request").decision, "deny");
      assert.equal(callTool("mcp_github_merge_pull_request").decision, "deny");
      assert.equal(callTool("mcp_linear_update_issue").decision, "deny");
      assert.equal(callTool("mcp_slack_send_message").decision, "deny");
      assert.equal(callTool("call_mcp_tool", { ToolName: "delete_branch" }).decision, "deny");
      assert.equal(callTool("call_mcp_tool", { ToolName: "reply_to_comment" }).decision, "deny");
      assert.equal(callTool("call_mcp_tool", { toolName: "write-page" }).decision, "deny");
    } finally {
      sb.cleanup();
    }
  });
});

describe("sicko-* Guard and git push Gate", () => {
  test("enforces sicko-* write_file ban, edit_file confinement, shell file-creation/mutation ban, and git push block", () => {
    const sb = makeSandbox();
    try {
      const targetInside = join(sb.worktree, "app.mjs");
      writeFileSync(targetInside, "// comment\nexport const x = 1;\n", "utf8");
      writeSwarmMembers(sb.appDataDir, "coord-1", {
        "sicko-1": { conversation_id: "sicko-id", role: "worker" },
      });

      const writeAttempt = runGuard(
        {
          hookEventName: "PreToolUse",
          conversationId: "sicko-id",
          rootConversationId: "coord-1",
          cwd: sb.worktree,
          toolCall: { id: "s1", name: "write_file", args: { Path: targetInside } },
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.equal(writeAttempt.decision, "deny");

      const editInside = runGuard(
        {
          hookEventName: "PreToolUse",
          conversationId: "sicko-id",
          rootConversationId: "coord-1",
          cwd: sb.worktree,
          toolCall: { id: "s2", name: "edit_file", args: { Path: targetInside } },
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.equal(editInside.decision, "allow");

      const editOutside = runGuard(
        {
          hookEventName: "PreToolUse",
          conversationId: "sicko-id",
          rootConversationId: "coord-1",
          cwd: sb.worktree,
          toolCall: {
            id: "s3",
            name: "edit_file",
            args: { Path: join(sb.outsideDir, "other.mjs") },
          },
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.equal(editOutside.decision, "deny");

      const editTmpDeniedForSicko = runGuard(
        {
          hookEventName: "PreToolUse",
          conversationId: "sicko-id",
          rootConversationId: "coord-1",
          cwd: sb.worktree,
          toolCall: {
            id: "s3b",
            name: "edit_file",
            args: { Path: "/tmp/sicko-scratch.mjs" },
          },
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.equal(editTmpDeniedForSicko.decision, "deny");

      const runSickoCmd = (CommandLine, extraEnv = {}) =>
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "sicko-id",
            rootConversationId: "coord-1",
            cwd: sb.worktree,
            toolCall: { id: "s4", name: "run_command", args: { CommandLine } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, ...extraEnv },
        );

      for (const allowedSickoCmd of [
        "git status --short",
        "git diff HEAD",
        "git blame app.mjs",
        "git log -S 'MUST KILL' 2>/dev/null",
        "node --test hooks/guard.test.mjs 2>&1",
        "git commit -am 'chore: strip narration comments'",
        "git status | tee /dev/null",
      ]) {
        assert.equal(
          runSickoCmd(allowedSickoCmd).decision,
          "allow",
          `expected sicko allow for: ${allowedSickoCmd}`,
        );
      }

      for (const deniedSickoCmd of [
        "echo 'export const y = 2;' > new.ts",
        "echo scratch > /tmp/sicko.txt",
        "cat app.mjs >> copy.mjs",
        "git status | tee status.txt",
        "cp app.mjs copy.mjs",
        "mv app.mjs renamed.mjs",
        "rm -f app.mjs",
        "touch created.ts",
        "truncate -s 0 app.mjs",
        "dd if=/dev/zero of=app.mjs count=1",
        "patch -p1 < comments.diff",
        "sed -i '' '/^\\/\\//d' app.mjs",
        "perl -pi -e 's/\\/\\/.*//' app.mjs",
        "PSTACK_ALLOW_PUSH=1 git push origin feat",
      ]) {
        assert.equal(
          runSickoCmd(deniedSickoCmd, { PSTACK_ALLOW_PUSH: "1" }).decision,
          "deny",
          `expected sicko deny for: ${deniedSickoCmd}`,
        );
      }
    } finally {
      sb.cleanup();
    }
  });

  test("enforces adv-* push ban, impl-* PSTACK_ALLOW_PUSH=1 gate, and universal force-push main/master ban", () => {
    const sb = makeSandbox();
    try {
      writeSwarmMembers(sb.appDataDir, "coord-id", {
        coordinator: { conversation_id: "coord-id", role: "coordinator" },
        "adv-1": { conversation_id: "adv-id", role: "worker" },
        "impl-1": { conversation_id: "impl-id", role: "worker" },
      });

      const runPush = (convId, CommandLine, extraEnv = {}) =>
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: convId,
            rootConversationId: convId === "coord-id" ? undefined : "coord-id",
            cwd: sb.worktree,
            toolCall: { id: "p1", name: "run_command", args: { CommandLine } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, ...extraEnv },
        );

      assert.equal(runPush("adv-id", "git push origin feat").decision, "deny");
      assert.equal(
        runPush("adv-id", "PSTACK_ALLOW_PUSH=1 git push origin feat", { PSTACK_ALLOW_PUSH: "1" }).decision,
        "deny",
      );

      assert.equal(runPush("impl-id", "git push origin feat").decision, "deny");
      assert.equal(
        runPush("impl-id", "echo PSTACK_ALLOW_PUSH=1 && git push origin feat").decision,
        "deny",
      );
      assert.equal(
        runPush("impl-id", "git commit -m 'enforce git push gate'").decision,
        "allow",
      );
      assert.equal(
        runPush("impl-id", "PSTACK_ALLOW_PUSH=1 git push origin feat").decision,
        "allow",
      );
      assert.equal(
        runPush("impl-id", "git push origin feat", { PSTACK_ALLOW_PUSH: "1" }).decision,
        "allow",
      );

      assert.equal(
        runPush("impl-id", "PSTACK_ALLOW_PUSH=1 git push --force origin main").decision,
        "deny",
      );
      assert.equal(
        runPush("impl-id", "PSTACK_ALLOW_PUSH=1 git push -f origin master").decision,
        "deny",
      );
      assert.equal(runPush("coord-id", "git push --force origin main").decision, "deny");
      assert.equal(runPush("coord-id", "git push -f origin master").decision, "deny");
      assert.equal(runPush("coord-id", "git push origin +HEAD:main").decision, "deny");
      assert.equal(runPush("coord-id", "git push --force-with-lease origin main").decision, "deny");

      assert.equal(runPush("coord-id", "git push origin main").decision, "allow");
      assert.equal(runPush("coord-id", "git push --force origin feat-stack").decision, "allow");
    } finally {
      sb.cleanup();
    }
  });
});

describe("agy 1.5.9 audit fixes: shell vars, evolve isolation, numbered verifiers, B4 confinement, M2/M3/T1, and swarm capacity", () => {
  test("B1+M2+B4 expands per-segment shell vars and redirects while anchoring canonicalTempRoots to outer env", () => {
    const sb = makeSandbox();
    try {
      writeSwarmMembers(sb.appDataDir, "coord-1", {
        "ro-cli": { conversation_id: "ro-id", role: "worker" },
        "impl-cli": { conversation_id: "impl-id", role: "worker" },
        "adv-cli": { conversation_id: "adv-id", role: "worker" },
      });

      const runCmd = (convId, CommandLine) =>
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: convId,
            cwd: sb.worktree,
            toolCall: { id: "v1", name: "run_command", args: { CommandLine } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, TMPDIR: sb.customTmpDir },
        );

      const allowedCommands = [
        'RUN_DIR="/tmp/cli-${WORKER_NAME:-local}-$$-$(date +%s)"; mkdir -p "$RUN_DIR/home" "$RUN_DIR/tmp" "$RUN_DIR/artifacts" && echo ok > "$RUN_DIR/artifacts/help.txt"',
        'RUN_ID="run-42"; mkdir -p "/tmp/verify-app-$RUN_ID" "/tmp/statechart-${WORKER_NAME:-local}-${RUN_ID:-$$}"',
        'RUN_DIR="/tmp/cli-$(date -u +%Y%m%d)-$(uuidgen)"; mkdir -p "$RUN_DIR" && echo x > "$RUN_DIR/out.txt"',
        "HOME=/tmp/h echo hi > ~/out.txt",
        "export HOME=/tmp/h; echo ok > ~/ok.txt",
      ];

      for (const convId of ["ro-id", "impl-id", "adv-id"]) {
        for (const cmd of allowedCommands) {
          assert.equal(runCmd(convId, cmd).decision, "allow", `expected allow for ${convId}: ${cmd}`);
        }
      }

      const deniedCommands = [
        `export TMPDIR=${sb.outsideDir}; echo x > $TMPDIR/pwn.txt`,
        `TMPDIR=${sb.outsideDir} mkdir -p $TMPDIR/pwn`,
        "echo x > $UNSET_VAR/pwn.txt",
        "echo x > $(id)/pwn.txt",
        `RUN_DIR="${sb.outsideDir}"; echo x > "$RUN_DIR/pwn.txt"`,
      ];

      for (const convId of ["ro-id", "impl-id", "adv-id"]) {
        for (const cmd of deniedCommands) {
          assert.equal(runCmd(convId, cmd).decision, "deny", `expected deny for ${convId}: ${cmd}`);
        }
      }
    } finally {
      sb.cleanup();
    }
  });

  test("B2 isolates evolve trials via PSTACK_PLUGIN_ROOT delegation and PSTACK_CACHE_DIR", () => {
    const sb = makeSandbox();
    try {
      const stagedPlugin = join(sb.root, "pack-oak");
      const stagedCache = join(sb.root, "state-oak");
      mkdirSync(join(stagedPlugin, "hooks"), { recursive: true });
      mkdirSync(join(stagedPlugin, "roles"), { recursive: true });
      writeFileSync(join(stagedPlugin, "roles", "coordinator.md"), "staged-oak-coord\n", "utf8");
      writeFileSync(
        join(stagedPlugin, "hooks", "guard.mjs"),
        `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ delegatedFrom: "pack-oak", delegatedFlag: process.env.PSTACK_GUARD_DELEGATED }) + "\\n");\n`,
        "utf8",
      );

      const delegatedOut = runGuard(
        { hookEventName: "SessionStart", conversationId: "oak-conv" },
        { PSTACK_PLUGIN_ROOT: stagedPlugin, PSTACK_CACHE_DIR: stagedCache },
      );
      assert.deepEqual(delegatedOut, { delegatedFrom: "pack-oak", delegatedFlag: "1" });

      writeSwarmMembers(sb.appDataDir, "coord-evolve", {
        "ro-oak": { conversation_id: "ro-oak-id", role: "worker" },
      });
      const stagedRolesOnly = join(sb.root, "pack-pine");
      mkdirSync(join(stagedRolesOnly, "roles"), { recursive: true });
      writeFileSync(join(stagedRolesOnly, "roles", "research.md"), "pine-research-capsule\n", "utf8");

      const isolatedSessionOut = runGuard(
        { hookEventName: "SessionStart", conversationId: "ro-oak-id" },
        {
          PSTACK_APPDATA_DIR: sb.appDataDir,
          PSTACK_PLUGIN_ROOT: stagedRolesOnly,
          PSTACK_CACHE_DIR: stagedCache,
        },
      );
      assert.deepEqual(isolatedSessionOut, {
        injectSteps: [{ systemMessage: { systemMessage: "pine-research-capsule\n" } }],
      });
      assert.equal(existsSync(join(stagedCache, "injected-capsules.json")), true);
      assert.equal(existsSync(join(stagedCache, "member-map.json")), true);
      assert.equal(existsSync(join(sb.appDataDir, "plugin_data", "agy-pstack-next", "injected-capsules.json")), false);
    } finally {
      sb.cleanup();
    }
  });

  test("B3 maps numbered *-verifier-k copies to readonly while keeping impl-verifier-k and sicko-verifier-k roles", () => {
    const sb = makeSandbox();
    try {
      const researchCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "research.md"), "utf8");
      const agentCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "poteto-agent.md"), "utf8");
      const sickoCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "comment-sicko.md"), "utf8");

      writeSwarmMembers(sb.appDataDir, "coord-b3", {
        "api-verifier-1": { conversation_id: "api-v1", role: "worker" },
        "api-verifier-2": { conversation_id: "api-v2", role: "worker" },
        "impl-verifier-1": { conversation_id: "impl-v1", role: "worker" },
        "sicko-verifier-1": { conversation_id: "sicko-v1", role: "worker" },
      });

      for (const id of ["api-v1", "api-v2"]) {
        const sOut = runGuard(
          { hookEventName: "SessionStart", conversationId: id },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        );
        assert.deepEqual(sOut, { injectSteps: [{ systemMessage: { systemMessage: researchCapsule } }] });

        const wOut = runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: id,
            cwd: sb.worktree,
            toolCall: { id: "t1", name: "write_file", args: { Path: join(sb.worktree, "x.txt") } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        );
        assert.equal(wOut.decision, "deny");
      }

      assert.deepEqual(
        runGuard({ hookEventName: "SessionStart", conversationId: "impl-v1" }, { PSTACK_APPDATA_DIR: sb.appDataDir }),
        { injectSteps: [{ systemMessage: { systemMessage: agentCapsule } }] },
      );
      assert.deepEqual(
        runGuard({ hookEventName: "SessionStart", conversationId: "sicko-v1" }, { PSTACK_APPDATA_DIR: sb.appDataDir }),
        { injectSteps: [{ systemMessage: { systemMessage: sickoCapsule } }] },
      );
    } finally {
      sb.cleanup();
    }
  });

  test("B4 enforces git, download/archive, find, and temp script confinement while preserving swarm capacity", () => {
    const sb = makeSandbox();
    const slashTmpDir = mkdtempSync("/tmp/pstack-b4-");
    try {
      writeSwarmMembers(sb.appDataDir, "coord-b4", {
        "ro-verify": { conversation_id: "ro-id", role: "worker" },
        "impl-1": { conversation_id: "impl-id", role: "worker" },
        "adv-1": { conversation_id: "adv-id", role: "worker" },
        "sicko-1": { conversation_id: "sicko-id", role: "worker" },
      });

      const badJs = join(slashTmpDir, "bad.mjs");
      const okJs = join(slashTmpDir, "ok.mjs");
      const badPy = join(slashTmpDir, "bad.py");
      const okPy = join(slashTmpDir, "ok.py");
      const badSh = join(slashTmpDir, "bad.sh");
      const okSh = join(slashTmpDir, "ok.sh");
      const perlScript = join(slashTmpDir, "probe.pl");
      const codemodJs = join(slashTmpDir, "codemod.mjs");
      const outsidePy = join(slashTmpDir, "outside.py");

      writeFileSync(badJs, "import fs from 'node:fs'; fs.writeFileSync('README.md', 'pwn');\n", "utf8");
      writeFileSync(
        okJs,
        `import fs from 'node:fs'; import path from 'node:path'; const runDir = '${slashTmpDir}'; fs.writeFileSync(path.join(runDir, 'after.png'), 'ok'); fs.writeFileSync(\`/tmp/ui-\${id}/shot.png\`, 'ok');\n`,
        "utf8",
      );
      writeFileSync(badPy, "from pathlib import Path\nPath('README.md').write_text('pwn')\n", "utf8");
      writeFileSync(
        okPy,
        `import os, tempfile\nrun_dir = tempfile.mkdtemp(prefix='ui-')\nopen(os.path.join(run_dir, 'out.txt'), 'w').write('ok')\nopen(f'/tmp/ui-{id}/snap.txt', 'w').write('ok')\n`,
        "utf8",
      );
      writeFileSync(badSh, "#!/bin/sh\nrm -f README.md\n", "utf8");
      writeFileSync(okSh, `#!/bin/sh\necho ok > ${join(slashTmpDir, "sh-ok.txt")}\n`, "utf8");
      writeFileSync(perlScript, "print 'hi';\n", "utf8");
      writeFileSync(
        codemodJs,
        "import fs from 'node:fs'; for (const f of files) { fs.writeFileSync(f, 'updated'); }\n",
        "utf8",
      );
      writeFileSync(
        outsidePy,
        `from pathlib import Path\nPath('${join(sb.outsideDir, "pwn.txt")}').write_text('x')\n`,
        "utf8",
      );

      const runCmd = (convId, CommandLine) =>
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: convId,
            cwd: sb.worktree,
            toolCall: { id: "b4", name: "run_command", args: { CommandLine } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, TMPDIR: sb.customTmpDir },
        );

      const roAllowed = [
        "git fetch origin",
        "git notes list",
        "git replace -l",
        "git submodule status",
        "git symbolic-ref HEAD",
        "curl https://example.com",
        `curl -o ${join(slashTmpDir, "dl.json")} https://example.com`,
        "wget --spider https://example.com",
        `wget -P ${slashTmpDir} https://example.com/a.txt`,
        "tar -tf archive.tar",
        `tar -xf archive.tar -C ${slashTmpDir}`,
        "unzip -l archive.zip",
        `unzip archive.zip -d ${slashTmpDir}`,
        `rsync -n -a src/ ${sb.outsideDir}/`,
        `find ${slashTmpDir} -delete`,
        `node ${okJs}`,
        `python3 ${okPy}`,
        `sh ${okSh}`,
        `node -e "import fs from 'node:fs'; fs.writeFileSync(\\\`/tmp/ui-\${id}/after.png\\\`, 'ok')"`,
        "python3 -c \"open(f'/tmp/ui-{id}/snap.txt', 'w').write('ok')\"",
      ];
      for (const cmd of roAllowed) {
        assert.equal(runCmd("ro-id", cmd).decision, "allow", `expected ro allow: ${cmd}`);
      }

      const roDenied = [
        "git pull",
        "git update-ref HEAD HEAD~1",
        "git fetch origin main:refs/heads/x",
        "git fetch -p",
        "git fetch --force",
        "git notes add -m x",
        "git replace HEAD~1 HEAD",
        "git submodule update",
        "git symbolic-ref HEAD refs/heads/x",
        "truncate -s 0 README.md",
        "dd if=/dev/zero of=README.md count=1",
        "install src.txt README.md",
        "curl -o README.md https://example.com",
        "curl -O https://example.com/a.txt",
        "wget https://example.com/a.txt",
        "wget -O README.md https://example.com",
        "tar -xf archive.tar",
        "tar -cf out.tar src/",
        "unzip archive.zip",
        "rsync -a src/ dst/",
        "rsync -a src/ user@host:dst/",
        "find . -delete",
        "find . -fprint out.txt",
        "find . -exec rm {} ;",
        `node ${join(slashTmpDir, "nonexistent.mjs")}`,
        `node ${badJs}`,
        `python3 ${badPy}`,
        `sh ${badSh}`,
        `perl ${perlScript}`,
      ];
      for (const cmd of roDenied) {
        assert.equal(runCmd("ro-id", cmd).decision, "deny", `expected ro deny: ${cmd}`);
      }

      const authorAllowed = [
        `git fetch ${sb.siblingWorktree} abc1234 && git cherry-pick abc1234`,
        `git -C ${sb.siblingWorktree} status --short`,
        `git -C ${join(slashTmpDir, "trial")} init && git -C ${join(slashTmpDir, "trial")} add . && git -C ${join(slashTmpDir, "trial")} commit -m init`,
        `node ${codemodJs}`,
        "node -e \"const fs = require('fs'); for (const f of files) fs.writeFileSync(f, 'x')\"",
        "python3 -c \"from pathlib import Path\nfor p in paths:\n  Path(p).write_text('x')\"",
        `mkdir -p ${join(slashTmpDir, "d")} && touch ${join(slashTmpDir, "d", "f")}`,
        `curl -o ${join(slashTmpDir, "a.json")} https://example.com`,
      ];
      for (const convId of ["impl-id", "adv-id"]) {
        for (const cmd of authorAllowed) {
          assert.equal(runCmd(convId, cmd).decision, "allow", `expected ${convId} allow: ${cmd}`);
        }
      }

      const authorDenied = [
        `git -C ${sb.outsideDir} commit -m pwn`,
        `mkdir -p ${join(sb.outsideDir, "pwn")}`,
        `touch ${join(sb.outsideDir, "pwn.txt")}`,
        `chmod +x ${join(sb.outsideDir, "pwn.sh")}`,
        `truncate -s 0 ${join(sb.outsideDir, "pwn.txt")}`,
        `dd if=/dev/zero of=${join(sb.outsideDir, "pwn.bin")} count=1`,
        `install README.md ${join(sb.outsideDir, "README.md")}`,
        `curl -o ${join(sb.outsideDir, "pwn.txt")} https://example.com`,
        `wget -P ${sb.outsideDir} https://example.com/a.txt`,
        `tar -xf a.tar -C ${sb.outsideDir}`,
        `unzip a.zip -d ${sb.outsideDir}`,
        `rsync -a src/ ${sb.outsideDir}/`,
        `find ${sb.outsideDir} -delete`,
        `find ${sb.outsideDir} -exec rm {} ;`,
        `node -e "require('fs').writeFileSync('${join(sb.outsideDir, "pwn.txt")}', 'x')"`,
        `python3 -c "from pathlib import Path; Path('../../outside/x').write_text('x')"`,
        `python3 ${outsidePy}`,
      ];
      for (const convId of ["impl-id", "adv-id"]) {
        for (const cmd of authorDenied) {
          assert.equal(runCmd(convId, cmd).decision, "deny", `expected ${convId} deny: ${cmd}`);
        }
      }

      for (const sickoOk of ["git add app.mjs", "git commit -m 'strip comments'", "git status --short"]) {
        assert.equal(runCmd("sicko-id", sickoOk).decision, "allow", `expected sicko allow: ${sickoOk}`);
      }
      for (const sickoBad of [
        "git checkout -- .",
        "git restore app.mjs",
        "git reset --hard HEAD",
        "git clean -fd",
        "git pull",
        `git -C ${sb.outsideDir} status`,
        "chmod +x app.mjs",
        "curl -o app.mjs https://example.com",
        "wget https://example.com/a.txt",
        "tar -xf a.tar",
        "unzip a.zip",
        "rsync -a a b",
        "find . -delete",
        `node ${okJs}`,
        `node -e "require('fs').writeFileSync('${join(slashTmpDir, "x.txt")}', 'x')"`,
        `python3 -c "open('${join(slashTmpDir, "x.txt")}', 'w').write('x')"`,
      ]) {
        assert.equal(runCmd("sicko-id", sickoBad).decision, "deny", `expected sicko deny: ${sickoBad}`);
      }
    } finally {
      rmSync(slashTmpDir, { recursive: true, force: true });
      sb.cleanup();
    }
  });

  test("M2+M3+T1 fixes node array literals, python Path aliases, transcript step filtering, forkStep, and swarm.json anchor", () => {
    const sb = makeSandbox();
    try {
      const researchCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "research.md"), "utf8");
      const agentCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "poteto-agent.md"), "utf8");
      const coordCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "coordinator.md"), "utf8");

      writeSwarmMembers(sb.appDataDir, "coord-m", {
        "ro-m": { conversation_id: "ro-m-id", role: "worker" },
        "impl-fork": { conversation_id: "impl-fork-id", role: "worker" },
      });

      const runRo = (CommandLine) =>
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "ro-m-id",
            cwd: sb.worktree,
            toolCall: { id: "m2", name: "run_command", args: { CommandLine } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        );

      for (const okCmd of [
        "node -e \"console.log(['arm64']); console.log(['blink']); const x = ['rm'];\"",
        "node -e \"function f() { return ['rm']; }\"",
        "python3 -c \"from pathlib import Path as P, PurePath as PP; print(P('.'), PP('a'))\"",
      ]) {
        assert.equal(runRo(okCmd).decision, "allow", `expected M2 allow: ${okCmd}`);
      }

      for (const badCmd of [
        "node -e \"const fs = require('fs'); fs['rmSync']('README.md')\"",
        "node -e \"require('fs')['rm']('README.md', () => {})\"",
        "node -e \"const fs = require('fs'); const fn = 'rmSync'; fs[fn]('README.md')\"",
        "python3 -c \"from os import remove as r; r('hooks.json')\"",
        "python3 -c \"import shutil as s; s.rmtree('skills')\"",
      ]) {
        assert.equal(runRo(badCmd).decision, "deny", `expected M2 deny: ${badCmd}`);
      }

      const readFileTranscript = join(
        sb.appDataDir,
        "brain",
        "read-file-user-conv",
        ".system_generated",
        "logs",
        "transcript.jsonl",
      );
      writeTranscriptLines(readFileTranscript, [
        { step_index: 0, type: "USER_INPUT", content: "Read roles/coordinator.md" },
        { step_index: 1, type: "TOOL_OUTPUT", content: "# Coordinator role capsule\n..." },
      ]);
      writeSwarmMembers(sb.appDataDir, "decoy-swarm", {
        "ro-decoy": { conversation_id: "read-file-user-conv", role: "worker" },
      });
      assert.deepEqual(
        runGuard(
          {
            hookEventName: "SessionStart",
            conversationId: "read-file-user-conv",
            transcriptPath: readFileTranscript,
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        {},
      );

      const forkTranscript = join(
        sb.appDataDir,
        "brain",
        "impl-fork-id",
        ".system_generated",
        "logs",
        "transcript.jsonl",
      );
      writeTranscriptLines(forkTranscript, [
        { step_index: 0, type: "USER_INPUT", content: "Help me refactor this repo" },
        {
          step_index: 1,
          type: "USER_INPUT",
          content: "You are @impl-fork. Everything before this turn is @coordinator's memory.",
        },
      ]);
      const forkSessionOut = runGuard(
        {
          hookEventName: "SessionStart",
          conversationId: "impl-fork-id",
          transcriptPath: forkTranscript,
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(forkSessionOut, {
        injectSteps: [{ systemMessage: { systemMessage: agentCapsule } }],
      });

      const spannerCoordDir = join(sb.appDataDir, "brain", "spanner-coord", ".system_generated", "swarm");
      mkdirSync(spannerCoordDir, { recursive: true });
      writeFileSync(
        join(spannerCoordDir, "swarm.json"),
        JSON.stringify({ backend: "spanner", coordinator_conversation_id: "spanner-coord" }),
        "utf8",
      );
      const spannerCoordOut = runGuard(
        { hookEventName: "SessionStart", conversationId: "spanner-coord" },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(spannerCoordOut, {
        injectSteps: [{ systemMessage: { systemMessage: coordCapsule } }],
      });

      const spannerWorkerTranscript = join(
        sb.appDataDir,
        "brain",
        "spanner-worker",
        ".system_generated",
        "logs",
        "transcript.jsonl",
      );
      writeTranscriptLines(spannerWorkerTranscript, [
        { step_index: 0, type: "SYSTEM_MESSAGE", content: "[swarm] new board message #1" },
      ]);
      runGuard(
        {
          hookEventName: "SessionStart",
          conversationId: "spanner-worker",
          transcriptPath: spannerWorkerTranscript,
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      const nonWorkerPath = join(sb.appDataDir, "plugin_data", "agy-pstack-next", "non-worker-roots.json");
      const nonWorkerDoc = existsSync(nonWorkerPath) ? JSON.parse(readFileSync(nonWorkerPath, "utf8")) : {};
      assert.equal(nonWorkerDoc["spanner-worker"], undefined);
      assert.equal(researchCapsule.length > 0, true);
    } finally {
      sb.cleanup();
    }
  });

  test("regression #18: source/., preload flags, shebang-less /tmp execs, scriptEnv subshell/conditional/for scoping, and ro-* harness literals", () => {
    const sb = makeSandbox();
    const slashTmpDir = mkdtempSync("/tmp/pstack-reg18-");
    try {
      writeSwarmMembers(sb.appDataDir, "coord-reg18", {
        "ro-v": { conversation_id: "ro-id", role: "worker" },
        "impl-v": { conversation_id: "impl-id", role: "worker" },
        "sicko-v": { conversation_id: "sicko-id", role: "worker" },
      });

      const malSh = join(slashTmpDir, "mal.sh");
      const malJs = join(slashTmpDir, "mal.mjs");
      const malPy = join(slashTmpDir, "mal_mod.py");
      const malNoExt = join(slashTmpDir, "mal_noext");
      const binFile = join(slashTmpDir, "bin_noext");
      const outsideTarget = join(sb.outsideDir, "pwn.txt");
      writeFileSync(malSh, `curl -o ${outsideTarget} https://example.com\n`, "utf8");
      writeFileSync(malJs, "require('fs').writeFileSync('README.md', 'pwn');\n", "utf8");
      writeFileSync(malPy, "from pathlib import Path\nPath('README.md').write_text('pwn')\n", "utf8");
      writeFileSync(malNoExt, "rm -f README.md\n", "utf8");
      writeFileSync(binFile, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]));

      const runCmd = (convId, CommandLine) =>
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: convId,
            cwd: sb.worktree,
            toolCall: { id: "r18", name: "run_command", args: { CommandLine } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, TMPDIR: sb.customTmpDir },
        );

      for (const convId of ["ro-id", "impl-id", "sicko-id"]) {
        assert.equal(runCmd(convId, `source ${malSh}`).decision, "deny", `source denied on ${convId}`);
        assert.equal(runCmd(convId, `. ${malSh}`).decision, "deny", `. denied on ${convId}`);
      }

      for (const roDeny of [
        `node --import ${malJs} -e "1"`,
        `node -r ${malJs} -e "1"`,
        `node --require=${malJs} -e "1"`,
        `NODE_OPTIONS="--import ${malJs}" node -e "1"`,
        `PYTHONPATH=${slashTmpDir} python3 -m mal_mod`,
        malNoExt,
        binFile,
        `A=${sb.worktree}; (A=${slashTmpDir}); echo pwn > $A/README.md`,
        `A=${sb.worktree}; false && A=${slashTmpDir}; echo pwn > $A/README.md`,
        `A=${sb.worktree}; true || A=${slashTmpDir}; echo pwn > $A/README.md`,
        `A=${slashTmpDir}; for A in ${sb.worktree}; do echo pwn > $A/README.md; done`,
        `A=${slashTmpDir}; read A; echo pwn > $A/README.md`,
        `echo x | A=${slashTmpDir}; echo pwn > $A/README.md`,
        "node -e \"const { link: fn } = require('fs'); fn('a', 'b')\"",
      ]) {
        assert.equal(runCmd("ro-id", roDeny).decision, "deny", `expected ro deny: ${roDeny}`);
      }

      assert.equal(
        runCmd("impl-id", `A=${sb.outsideDir}; (A=${slashTmpDir}); echo pwn > $A/pwn.txt`).decision,
        "deny",
      );
      assert.equal(
        runCmd("impl-id", `A=${sb.outsideDir}; false && A=${slashTmpDir}; echo pwn > $A/pwn.txt`).decision,
        "deny",
      );
      assert.equal(
        runCmd("impl-id", `A=${slashTmpDir}; for A in ${sb.outsideDir}; do echo pwn > $A/pwn.txt; done`).decision,
        "deny",
      );

      for (const roAllow of [
        "python3 -c \"import os; run_dir = f'/tmp/cli-{os.getpid()}'; open(os.path.join(run_dir, 'out.txt'), 'w').write('ok')\"",
        "python3 -c \"import os; run_dir = f'/tmp/cli-{os.getpid()}'; open(f'{run_dir}/out.txt', 'w').write('ok')\"",
        "node -e \"const fs = require('node:fs'); const runDir = `/tmp/ui-artifacts-${Date.now()}`; fs.writeFileSync(`${runDir}/aria.json`, '{}')\"",
        "node -e \"console.log(pkg['platform'], pkg['arm64'], pkg['blink'])\"",
        "node -e \"const item = { from: f, link: raw }; console.log(item)\"",
      ]) {
        assert.equal(runCmd("ro-id", roAllow).decision, "allow", `expected ro allow: ${roAllow}`);
      }
    } finally {
      rmSync(slashTmpDir, { recursive: true, force: true });
      sb.cleanup();
    }
  });
});

describe("agy 1.5.9 native swarm compatibility caveats", () => {
  test("Caveat 3 respects config.json plugin disable across PSTACK_CONFIG_DIR, plugins layout, and HOME fallback without cache writes", () => {
    const sb = makeSandbox();
    try {
      const coordCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "coordinator.md"), "utf8");
      writeSwarmMembers(sb.appDataDir, "coord-c3", {
        coordinator: { conversation_id: "coord-c3", role: "coordinator" },
        "ro-1": { conversation_id: "ro-c3", role: "worker" },
        "sicko-1": { conversation_id: "sicko-c3", role: "worker" },
        "impl-1": { conversation_id: "impl-c3", role: "worker" },
      });

      const cfgDir = join(sb.root, "custom-config");
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(
        join(cfgDir, "config.json"),
        JSON.stringify({ plugins: { "agy-pstack-next": { enabled: false } } }),
        "utf8",
      );

      assert.deepEqual(
        runGuard(
          {
            hookEventName: "SessionStart",
            conversationId: "coord-c3",
            lastUserInput: "/pstack audit hooks",
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir },
        ),
        {},
      );
      assert.deepEqual(
        runGuard(
          {
            hookEventName: "PreInvocation",
            conversationId: "ro-c3",
            rootConversationId: "coord-c3",
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir },
        ),
        {},
      );

      const cacheDir = join(sb.appDataDir, "plugin_data", "agy-pstack-next");
      assert.equal(existsSync(join(cacheDir, "injected-capsules.json")), false);
      assert.equal(existsSync(join(cacheDir, "member-map.json")), false);
      assert.equal(existsSync(join(cacheDir, "plain-swarm-roots.json")), false);

      assert.deepEqual(
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "coord-c3",
            cwd: sb.worktree,
            toolCall: { id: "t1", name: "invoke_subagent", args: {} },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir },
        ),
        { decision: "allow" },
      );
      assert.deepEqual(
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "ro-c3",
            cwd: sb.worktree,
            toolCall: { id: "t2", name: "write_file", args: { Path: join(sb.worktree, "mutated.txt") } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir },
        ),
        { decision: "allow" },
      );
      assert.deepEqual(
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "sicko-c3",
            cwd: sb.worktree,
            toolCall: { id: "t3", name: "write_file", args: { Path: join(sb.worktree, "created.txt") } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir },
        ),
        { decision: "allow" },
      );
      assert.deepEqual(
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "impl-c3",
            cwd: sb.worktree,
            toolCall: { id: "t4", name: "run_command", args: { CommandLine: "git push origin main" } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir },
        ),
        { decision: "allow" },
      );

      writeFileSync(
        join(cfgDir, "config.json"),
        JSON.stringify({ plugins: { "agy-pstack-next": { enabled: true } } }),
        "utf8",
      );
      assert.deepEqual(
        runGuard(
          {
            hookEventName: "SessionStart",
            conversationId: "coord-c3",
            lastUserInput: "/pstack audit hooks",
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_CONFIG_DIR: cfgDir },
        ),
        { injectSteps: [{ systemMessage: { systemMessage: coordCapsule } }] },
      );

      const simulatedHome = join(sb.root, "sim-home");
      const simulatedConfigDir = join(simulatedHome, ".gemini", "config");
      const simulatedPluginDir = join(simulatedConfigDir, "plugins", "agy-pstack-next");
      mkdirSync(join(simulatedPluginDir, "hooks"), { recursive: true });
      mkdirSync(join(simulatedPluginDir, "roles"), { recursive: true });
      copyFileSync(GUARD_PATH, join(simulatedPluginDir, "hooks", "guard.mjs"));
      chmodSync(join(simulatedPluginDir, "hooks", "guard.mjs"), 0o755);
      copyFileSync(
        join(PLUGIN_ROOT, "roles", "coordinator.md"),
        join(simulatedPluginDir, "roles", "coordinator.md"),
      );
      writeFileSync(
        join(simulatedConfigDir, "config.json"),
        JSON.stringify({ plugins: { "agy-pstack-next": { enabled: false } } }),
        "utf8",
      );

      assert.deepEqual(
        runGuard(
          {
            hookEventName: "SessionStart",
            conversationId: "sim-coord",
            lastUserInput: "/pstack run",
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PLUGIN_ROOT: simulatedPluginDir },
        ),
        {},
      );
      assert.deepEqual(
        runGuard(
          {
            hookEventName: "SessionStart",
            conversationId: "sim-coord-installed",
            lastUserInput: "/pstack run",
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
          join(simulatedPluginDir, "hooks", "guard.mjs"),
        ),
        {},
      );
      assert.deepEqual(
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "ro-c3",
            cwd: sb.worktree,
            toolCall: { id: "t5", name: "write_file", args: { Path: join(sb.worktree, "ok.txt") } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
          join(simulatedPluginDir, "hooks", "guard.mjs"),
        ),
        { decision: "allow" },
      );

      const isolatedHomeOut = runGuard(
        {
          hookEventName: "SessionStart",
          conversationId: "isolated-from-home",
          lastUserInput: "/pstack run",
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir, HOME: simulatedHome },
      );
      assert.deepEqual(isolatedHomeOut, {
        injectSteps: [{ systemMessage: { systemMessage: coordCapsule } }],
      });

      const bareHomeAppData = join(simulatedHome, ".gemini", "antigravity-cli");
      mkdirSync(join(bareHomeAppData, "brain"), { recursive: true });
      assert.deepEqual(
        runGuard(
          {
            hookEventName: "SessionStart",
            conversationId: "home-fallback-coord",
            lastUserInput: "/pstack run",
          },
          { HOME: simulatedHome },
        ),
        {},
      );
    } finally {
      sb.cleanup();
    }
  });

  test("Caveat 1 keeps built-in /swarm and unprefixed plain swarms unmanaged with clean cache hygiene while upgrading cleanly to pstack", () => {
    const sb = makeSandbox();
    try {
      const coordCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "coordinator.md"), "utf8");
      const agentCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "poteto-agent.md"), "utf8");
      const researchCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "research.md"), "utf8");
      const cacheDir = join(sb.appDataDir, "plugin_data", "agy-pstack-next");

      writeSwarmMembers(sb.appDataDir, "plain-slash-coord", {
        coordinator: { conversation_id: "plain-slash-coord", role: "coordinator" },
        monitor: { conversation_id: "plain-slash-mon", role: "worker" },
      });

      assert.deepEqual(
        runGuard(
          {
            hookEventName: "SessionStart",
            conversationId: "plain-slash-coord",
            lastUserInput: "/swarm investigate flaky test",
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        {},
      );
      const plainRootsDoc = JSON.parse(readFileSync(join(cacheDir, "plain-swarm-roots.json"), "utf8"));
      assert.equal(plainRootsDoc["plain-slash-coord"], true);

      assert.deepEqual(
        runGuard(
          {
            hookEventName: "SessionStart",
            conversationId: "plain-slash-mon",
            rootConversationId: "plain-slash-coord",
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        {},
      );
      assert.deepEqual(
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "plain-slash-coord",
            cwd: sb.worktree,
            toolCall: { id: "ps-1", name: "invoke_subagent", args: {} },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        { decision: "allow" },
      );

      const plainAnchorDir = join(sb.appDataDir, "brain", "plain-anchor-coord", ".system_generated", "swarm");
      mkdirSync(plainAnchorDir, { recursive: true });
      writeFileSync(
        join(plainAnchorDir, "swarm.json"),
        JSON.stringify({ backend: "spanner", coordinator_conversation_id: "plain-anchor-coord" }),
        "utf8",
      );
      assert.deepEqual(
        runGuard(
          {
            hookEventName: "SessionStart",
            conversationId: "plain-anchor-coord",
            lastUserInput: "/swarm coordinate remote team",
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        {},
      );

      writeSwarmMembers(sb.appDataDir, "plain-organic-coord", {
        coordinator: { conversation_id: "plain-organic-coord", role: "coordinator" },
        monitor: { conversation_id: "plain-organic-mon", role: "worker" },
        parser: { conversation_id: "plain-parser", role: "worker" },
        docs: { conversation_id: "plain-docs", role: "worker" },
        verifier: { conversation_id: "plain-verifier", role: "worker" },
      });

      for (const id of ["plain-organic-coord", "plain-parser", "plain-docs", "plain-verifier"]) {
        assert.deepEqual(
          runGuard(
            {
              hookEventName: "SessionStart",
              conversationId: id,
              lastUserInput:
                id === "plain-parser"
                  ? "You are @parser. Compare built-in swarm with /pstack docs."
                  : "Work on your slice.",
            },
            { PSTACK_APPDATA_DIR: sb.appDataDir },
          ),
          {},
          `expected plain swarm member ${id} to stay unmanaged`,
        );
      }

      assert.deepEqual(
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "plain-verifier",
            rootConversationId: "plain-organic-coord",
            cwd: sb.worktree,
            toolCall: {
              id: "pv-1",
              name: "write_file",
              args: { Path: join(sb.worktree, "plain-verifier-allowed.txt") },
            },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        { decision: "allow" },
      );

      const mapBeforeUpgrade = existsSync(join(cacheDir, "member-map.json"))
        ? JSON.parse(readFileSync(join(cacheDir, "member-map.json"), "utf8"))
        : {};
      assert.equal(mapBeforeUpgrade["plain-parser"], undefined);
      assert.equal(mapBeforeUpgrade["plain-docs"], undefined);
      assert.equal(mapBeforeUpgrade["plain-verifier"], undefined);

      const nonWorkerBeforeUpgrade = existsSync(join(cacheDir, "non-worker-roots.json"))
        ? JSON.parse(readFileSync(join(cacheDir, "non-worker-roots.json"), "utf8"))
        : {};
      assert.equal(nonWorkerBeforeUpgrade["plain-parser"], undefined);
      assert.equal(nonWorkerBeforeUpgrade["plain-verifier"], undefined);
      assert.equal(nonWorkerBeforeUpgrade["plain-organic-coord"], undefined);

      writeSwarmMembers(sb.appDataDir, "plain-organic-coord", {
        coordinator: { conversation_id: "plain-organic-coord", role: "coordinator" },
        monitor: { conversation_id: "plain-organic-mon", role: "worker" },
        parser: { conversation_id: "plain-parser", role: "worker" },
        docs: { conversation_id: "plain-docs", role: "worker" },
        verifier: { conversation_id: "plain-verifier", role: "worker" },
        "impl-1": { conversation_id: "upgraded-impl-1", role: "worker" },
      });

      assert.deepEqual(
        runGuard(
          { hookEventName: "SessionStart", conversationId: "plain-parser" },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        { injectSteps: [{ systemMessage: { systemMessage: agentCapsule } }] },
      );
      assert.deepEqual(
        runGuard(
          { hookEventName: "SessionStart", conversationId: "plain-verifier" },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        { injectSteps: [{ systemMessage: { systemMessage: researchCapsule } }] },
      );
      assert.equal(
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "plain-verifier",
            cwd: sb.worktree,
            toolCall: {
              id: "pv-2",
              name: "write_file",
              args: { Path: join(sb.worktree, "blocked-after-upgrade.txt") },
            },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ).decision,
        "deny",
      );
      assert.deepEqual(
        runGuard(
          { hookEventName: "SessionStart", conversationId: "plain-organic-coord" },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        { injectSteps: [{ systemMessage: { systemMessage: coordCapsule } }] },
      );

      writeSwarmMembers(sb.appDataDir, "plain-slash-coord", {
        coordinator: { conversation_id: "plain-slash-coord", role: "coordinator" },
        verifier: { conversation_id: "slash-v0", role: "worker" },
        "verifier-1": { conversation_id: "slash-v1", role: "worker" },
        "api-verifier": { conversation_id: "slash-api-v", role: "worker" },
        "verify-links": { conversation_id: "slash-vlinks", role: "worker" },
        "eval-runner-1": { conversation_id: "slash-eval-1", role: "worker" },
      });

      assert.deepEqual(
        runGuard(
          {
            hookEventName: "PreInvocation",
            conversationId: "plain-slash-coord",
            lastUserInput: "/pstack take over this swarm",
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        { injectSteps: [{ systemMessage: { systemMessage: coordCapsule } }] },
      );
      assert.equal(
        JSON.parse(readFileSync(join(cacheDir, "plain-swarm-roots.json"), "utf8"))["plain-slash-coord"],
        false,
      );

      for (const roId of ["slash-v0", "slash-v1", "slash-api-v", "slash-vlinks"]) {
        assert.deepEqual(
          runGuard(
            {
              hookEventName: "SessionStart",
              conversationId: roId,
              rootConversationId: "plain-slash-coord",
            },
            { PSTACK_APPDATA_DIR: sb.appDataDir },
          ),
          { injectSteps: [{ systemMessage: { systemMessage: researchCapsule } }] },
        );
      }
      assert.deepEqual(
        runGuard(
          {
            hookEventName: "SessionStart",
            conversationId: "slash-eval-1",
            rootConversationId: "plain-slash-coord",
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        { injectSteps: [{ systemMessage: { systemMessage: agentCapsule } }] },
      );

      writeSwarmMembers(sb.appDataDir, "marker-coord", {
        coordinator: { conversation_id: "marker-coord", role: "coordinator" },
        parser: { conversation_id: "marker-parser", role: "worker" },
      });
      writeFileSync(
        join(sb.appDataDir, "brain", "marker-coord", ".system_generated", "swarm", "pstack.json"),
        "{}\n",
        "utf8",
      );
      assert.deepEqual(
        runGuard(
          { hookEventName: "SessionStart", conversationId: "marker-parser", rootConversationId: "marker-coord" },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        { injectSteps: [{ systemMessage: { systemMessage: agentCapsule } }] },
      );
    } finally {
      sb.cleanup();
    }
  });

  test("Caveat 2 allows ro-* Overview timeline screenshots in explicit and fallback brain/<convId> artifact dirs while protecting .system_generated across all worker roles", () => {
    const sb = makeSandbox();
    const slashTmpDir = mkdtempSync("/tmp/pstack-c2-");
    try {
      writeSwarmMembers(sb.appDataDir, "coord-c2", {
        coordinator: { conversation_id: "coord-c2", role: "coordinator" },
        "ro-ui": { conversation_id: "ro-c2", role: "worker" },
        "impl-ui": { conversation_id: "impl-c2", role: "worker" },
        "adv-ui": { conversation_id: "adv-c2", role: "worker" },
        "sicko-ui": { conversation_id: "sicko-c2", role: "worker" },
      });

      const roFallbackArtifact = join(sb.appDataDir, "brain", "ro-c2");
      const roExplicitArtifact = join(sb.root, "explicit-ro-artifact");
      mkdirSync(roExplicitArtifact, { recursive: true });
      const implArtifact = join(sb.appDataDir, "brain", "impl-c2");
      const advArtifact = join(sb.appDataDir, "brain", "adv-c2");
      const sickoArtifact = join(sb.appDataDir, "brain", "sicko-c2");
      const coordArtifact = join(sb.appDataDir, "brain", "coord-c2");
      for (const dir of [roFallbackArtifact, implArtifact, advArtifact, sickoArtifact, coordArtifact]) {
        mkdirSync(join(dir, ".system_generated", "logs"), { recursive: true });
        mkdirSync(join(dir, ".system_generated", "swarm"), { recursive: true });
        writeFileSync(join(dir, ".system_generated", "logs", "transcript.jsonl"), "{}\n", "utf8");
      }

      const callFileTool = (convId, toolName, targetPath, artifactDirectoryPath = undefined) =>
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: convId,
            rootConversationId: convId === "coord-c2" ? undefined : "coord-c2",
            ...(artifactDirectoryPath !== undefined ? { artifactDirectoryPath } : {}),
            cwd: sb.worktree,
            toolCall: { id: "f-c2", name: toolName, args: { Path: targetPath } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, TMPDIR: sb.customTmpDir },
        );

      for (const artDir of [roFallbackArtifact, roExplicitArtifact]) {
        const explicitParam = artDir === roExplicitArtifact ? roExplicitArtifact : undefined;
        for (const ext of ["png", "jpg", "jpeg", "webp", "PNG", "WEBP"]) {
          assert.equal(
            callFileTool("ro-c2", "write_file", join(artDir, "timeline", `shot.${ext}`), explicitParam).decision,
            "allow",
            `expected ro write_file allow for .${ext} in ${artDir}`,
          );
        }
        assert.equal(
          callFileTool("ro-c2", "edit_file", join(artDir, "shot.png"), explicitParam).decision,
          "deny",
        );
        for (const blockedRel of [
          "report.md",
          "data.json",
          "probe.js",
          "notes.txt",
          ".system_generated/shot.png",
          ".system_generated/logs/transcript.jsonl",
        ]) {
          assert.equal(
            callFileTool("ro-c2", "write_file", join(artDir, blockedRel), explicitParam).decision,
            "deny",
            `expected ro write_file deny for ${blockedRel}`,
          );
        }
        assert.equal(callFileTool("ro-c2", "write_file", artDir, explicitParam).decision, "deny");
      }

      const tempPlaywrightMjs = join(slashTmpDir, "capture-ok.mjs");
      writeFileSync(
        tempPlaywrightMjs,
        `import fs from 'node:fs'; fs.mkdirSync('${join(roFallbackArtifact, "shots")}', { recursive: true }); await page.screenshot({ path: '${join(roFallbackArtifact, "shots", "overview.png")}', fullPage: true });\n`,
        "utf8",
      );
      const tempBadPlaywrightMjs = join(slashTmpDir, "capture-bad.mjs");
      writeFileSync(
        tempBadPlaywrightMjs,
        `await page.screenshot({ path: '${join(roFallbackArtifact, ".system_generated", "overview.png")}' });\n`,
        "utf8",
      );

      const runRoShell = (CommandLine) =>
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "ro-c2",
            rootConversationId: "coord-c2",
            cwd: sb.worktree,
            toolCall: { id: "sh-ro", name: "run_command", args: { CommandLine } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, TMPDIR: sb.customTmpDir },
        );

      const roAllowedCmds = [
        `mkdir -p ${roFallbackArtifact} ${join(roFallbackArtifact, "shots", "sub")}`,
        `cat ${join(slashTmpDir, "raw.png")} > ${join(roFallbackArtifact, "overview.png")}`,
        `cp ${join(slashTmpDir, "a.png")} ${join(roFallbackArtifact, "shots", "a.png")}`,
        `cp ${join(slashTmpDir, "a.webp")} ${join(roFallbackArtifact, "shots")}`,
        `mv ${join(slashTmpDir, "a.jpg")} ${join(roFallbackArtifact, "shots", "a.jpg")}`,
        `mv ${join(roFallbackArtifact, "shots", "a.jpg")} ${join(roFallbackArtifact, "shots", "b.jpeg")}`,
        `tee ${join(roFallbackArtifact, "pipe.png")} < ${join(slashTmpDir, "a.png")}`,
        `curl -sL https://example.com/frame.png -o ${join(roFallbackArtifact, "frame.png")}`,
        `rm -f ${join(roFallbackArtifact, "frame.png")}`,
        `unlink ${join(roFallbackArtifact, "shots", "b.jpeg")}`,
        `node -e "const fs = require('node:fs'); fs.mkdirSync('${join(roFallbackArtifact, "shots")}', { recursive: true }); fs.writeFileSync('${join(roFallbackArtifact, "shots", "snap.png")}', buf); fs.copyFileSync('${join(slashTmpDir, "a.png")}', '${join(roFallbackArtifact, "shots", "copy.webp")}')"`,
        `node -e "await page.screenshot({ path: '${join(roFallbackArtifact, "pane.jpg")}' })"`,
        `node ${tempPlaywrightMjs}`,
        `python3 -c "import os; os.makedirs('${join(roFallbackArtifact, "shots")}', exist_ok=True); open('${join(roFallbackArtifact, "shots", "py.png")}', 'wb').write(b'x')"`,
        `python3 -c "from pathlib import Path; Path('${join(roFallbackArtifact, "shots")}').mkdir(parents=True, exist_ok=True); Path('${join(roFallbackArtifact, "shots", "p.webp")}').write_bytes(b'x')"`,
        `python3 -c "page.screenshot(path='${join(roFallbackArtifact, "py-shot.jpeg")}')"`,
      ];
      for (const cmd of roAllowedCmds) {
        assert.equal(runRoShell(cmd).decision, "allow", `expected ro screenshot shell allow: ${cmd}`);
      }

      const evilDirPng = join(slashTmpDir, "evil_dir.png");
      const payloadSh = join(slashTmpDir, "payload.sh");
      const existingDirInExplicitArt = join(roExplicitArtifact, "existing_dir.png");
      mkdirSync(evilDirPng, { recursive: true });
      mkdirSync(existingDirInExplicitArt, { recursive: true });
      writeFileSync(payloadSh, "#!/bin/sh\necho pwn\n", "utf8");
      writeFileSync(join(evilDirPng, "payload.sh"), "#!/bin/sh\necho pwn\n", "utf8");

      assert.equal(
        callFileTool("ro-c2", "write_file", existingDirInExplicitArt, roExplicitArtifact).decision,
        "deny",
      );
      assert.equal(
        callFileTool("ro-c2", "write_file", join(roFallbackArtifact, "evil.png", "shot.png")).decision,
        "deny",
      );
      assert.equal(
        callFileTool("ro-c2", "write_file", join(roFallbackArtifact, ".png")).decision,
        "deny",
      );

      const roDeniedCmds = [
        `echo bad > ${join(roFallbackArtifact, "report.md")}`,
        `echo bad > ${join(roFallbackArtifact, ".system_generated", "shot.png")}`,
        `echo bad > ${join(roFallbackArtifact, "evil.png", "shot.png")}`,
        `echo bad > ${join(roFallbackArtifact, ".png")}`,
        `cp ${join(slashTmpDir, "notes.md")} ${join(roFallbackArtifact, "shots")}`,
        `cp ${join(slashTmpDir, "notes.md")} ${join(roFallbackArtifact, "notes.md")}`,
        `mv ${join(slashTmpDir, "notes.txt")} ${join(roFallbackArtifact, "notes.txt")}`,
        `tee ${join(roFallbackArtifact, "out.json")}`,
        `curl -sL https://example.com/data -o ${join(roFallbackArtifact, "out.json")}`,
        `mkdir -p ${join(roFallbackArtifact, "notes.md")}`,
        `mkdir -p ${join(roFallbackArtifact, "evil.png")}`,
        `mkdir -p ${join(roFallbackArtifact, ".png")}`,
        `mkdir -p ${join(roFallbackArtifact, "evil.png")} && cp ${payloadSh} ${join(roFallbackArtifact, "evil.png")}`,
        `mkdir -p ${join(roFallbackArtifact, ".system_generated", "sub")}`,
        `cp -r ${evilDirPng} ${join(roFallbackArtifact, "shots")}`,
        `cp -a ${evilDirPng} ${join(roFallbackArtifact, "shots")}`,
        `cp ${evilDirPng} ${join(roFallbackArtifact, "shots")}`,
        `mv ${evilDirPng} ${join(roFallbackArtifact, "shots")}`,
        `mkdir -p ${join(slashTmpDir, "staged_dir.png")} && mv ${join(slashTmpDir, "staged_dir.png")} ${join(roFallbackArtifact, "shots")}`,
        `cp ${payloadSh} ${join(roFallbackArtifact, "disguised.png")}`,
        `mv ${payloadSh} ${join(roFallbackArtifact, "disguised.png")}`,
        `cp ${join(slashTmpDir, "*.png")} ${join(roFallbackArtifact, "shots")}`,
        `rm -f ${join(roFallbackArtifact, "notes.md")}`,
        `rm -rf ${roFallbackArtifact}`,
        `ln -s /etc/passwd ${join(roFallbackArtifact, "shot.png")}`,
        `node -e "require('node:fs').writeFileSync('${join(roFallbackArtifact, "notes.md")}', 'x')"`,
        `node -e "require('node:fs').mkdirSync('${join(roFallbackArtifact, "evil.png")}', { recursive: true })"`,
        `node -e "require('node:fs').copyFileSync('${payloadSh}', '${join(roFallbackArtifact, "disguised.png")}')"`,
        `node -e "require('node:fs').cpSync('${evilDirPng}', '${join(roFallbackArtifact, "shots", "evil_dir.png")}', { recursive: true })"`,
        `node -e "const fs = require('node:fs'); fs.mkdirSync('${join(slashTmpDir, "inline_dir.png")}'); fs.renameSync('${join(slashTmpDir, "inline_dir.png")}', '${join(roFallbackArtifact, "shots", "inline_dir.png")}')"`,
        `node -e "require('node:fs').symlinkSync('/etc/passwd', '${join(roFallbackArtifact, "shot.png")}')"`,
        `node -e "await page.screenshot({ path: '${join(sb.outsideDir, "escape.png")}' })"`,
        `node ${tempBadPlaywrightMjs}`,
        `python3 -c "open('${join(roFallbackArtifact, "notes.txt")}', 'w').write('x')"`,
        `python3 -c "import os, shutil; os.makedirs('${join(roFallbackArtifact, "evil.png")}', exist_ok=True); shutil.copy('${payloadSh}', '${join(roFallbackArtifact, "evil.png")}')"`,
        `python3 -c "import os; os.makedirs('${join(roFallbackArtifact, "evil.png")}', exist_ok=True)"`,
        `python3 -c "from pathlib import Path; Path('${join(roFallbackArtifact, "evil.png")}').mkdir(parents=True, exist_ok=True)"`,
        `python3 -c "import shutil; shutil.copy('${payloadSh}', '${join(roFallbackArtifact, "disguised.png")}')"`,
        `python3 -c "import shutil; shutil.copytree('${evilDirPng}', '${join(roFallbackArtifact, "shots", "evil_dir.png")}')"`,
        `python3 -c "import os, shutil; os.makedirs('${join(slashTmpDir, "py_dir.png")}', exist_ok=True); shutil.move('${join(slashTmpDir, "py_dir.png")}', '${join(roFallbackArtifact, "shots")}')"`,
        `python3 -c "from pathlib import Path; Path('${join(slashTmpDir, "ro_repo_sym")}').symlink_to('${join(sb.worktree, "README.md")}')"`,
        `python3 -c "page.screenshot(path='${join(roFallbackArtifact, ".system_generated", "x.png")}')"`,
      ];
      for (const cmd of roDeniedCmds) {
        assert.equal(runRoShell(cmd).decision, "deny", `expected ro screenshot shell deny: ${cmd}`);
      }

      for (const [convId, artDir] of [
        ["ro-c2", roFallbackArtifact],
        ["impl-c2", implArtifact],
        ["adv-c2", advArtifact],
        ["sicko-c2", sickoArtifact],
      ]) {
        const transcriptTarget = join(artDir, ".system_generated", "logs", "transcript.jsonl");
        const swarmPlanTarget = join(artDir, ".system_generated", "swarm", "plan.json");
        assert.equal(callFileTool(convId, "edit_file", transcriptTarget).decision, "deny");
        assert.equal(callFileTool(convId, "write_file", swarmPlanTarget).decision, "deny");

        for (const sysGenCmd of [
          `echo forged >> ${transcriptTarget}`,
          `cp ${join(slashTmpDir, "a.json")} ${swarmPlanTarget}`,
          `rm -rf ${join(artDir, ".system_generated")}`,
          `rm -rf ${artDir}`,
          `rm -rf ${join(artDir, ".*")}`,
          `rm -rf ${join(artDir, ".s*")}`,
          `rm -rf ${join(artDir, ".?ystem_generated")}`,
          `rm -rf ${join(artDir, "[.]system_generated")}`,
          `rm -rf ${join(artDir, "*")}`,
          `rm -rf ${join(artDir, "{.system_generated,scratch}")}`,
          `rm -rf ${join(artDir, "scratch", "{../.system_generated,a}")}`,
          `rsync -a --delete ${slashTmpDir}/ ${artDir}/`,
          `rsync -a --del ${slashTmpDir}/ ${artDir}/`,
          `rsync -a --delete-after ${slashTmpDir}/ ${artDir}/`,
          `rsync -a --remove-source-files ${artDir} ${slashTmpDir}/out/`,
          `ln -s ${artDir} ${join(slashTmpDir, "art_root_link")}`,
          `find ${artDir} -delete`,
          `node -e "require('node:fs').writeFileSync('${transcriptTarget}', '{}')"`,
          `python3 -c "open('${transcriptTarget}', 'w').write('{}')"`,
          `python3 -c "from pathlib import Path; Path('${join(slashTmpDir, "sym")}').symlink_to('${transcriptTarget}')" && echo "{}" > ${join(slashTmpDir, "sym")}`,
          `python3 -c "from pathlib import Path; Path('${join(slashTmpDir, "hl")}').hardlink_to('${transcriptTarget}')"`,
          `python3 -c "from pathlib import Path; p = Path('${join(slashTmpDir, "sym_var")}'); p.symlink_to('${transcriptTarget}')"`,
          `python3 -c "from pathlib import Path; Path('${join(slashTmpDir, "sym_out")}').symlink_to(Path('${join(sb.outsideDir, "outside.txt")}'))"`,
          `python3 -c "from pathlib import Path; Path('${join(slashTmpDir, "sym_root")}').symlink_to('${artDir}')"`,
        ]) {
          assert.equal(
            runGuard(
              {
                hookEventName: "PreToolUse",
                conversationId: convId,
                rootConversationId: "coord-c2",
                cwd: sb.worktree,
                toolCall: { id: "sg-sh", name: "run_command", args: { CommandLine: sysGenCmd } },
              },
              { PSTACK_APPDATA_DIR: sb.appDataDir, TMPDIR: sb.customTmpDir },
            ).decision,
            "deny",
            `expected .system_generated deny for ${convId}: ${sysGenCmd}`,
          );
        }
      }

      for (const allowedImplCmd of [
        `rsync -a --delete ${slashTmpDir}/ ${join(implArtifact, "scratch")}/`,
        `rm -rf ${join(implArtifact, "scratch", "*")}`,
        `python3 -c "from pathlib import Path; Path('${join(slashTmpDir, "ok_sym")}').symlink_to('${join(sb.worktree, "src.js")}')"`,
      ]) {
        assert.equal(
          runGuard(
            {
              hookEventName: "PreToolUse",
              conversationId: "impl-c2",
              rootConversationId: "coord-c2",
              cwd: sb.worktree,
              toolCall: { id: "impl-ok", name: "run_command", args: { CommandLine: allowedImplCmd } },
            },
            { PSTACK_APPDATA_DIR: sb.appDataDir, TMPDIR: sb.customTmpDir },
          ).decision,
          "allow",
          `expected impl confined command allow: ${allowedImplCmd}`,
        );
      }

      assert.equal(
        callFileTool("impl-c2", "write_file", join(implArtifact, "notes.md")).decision,
        "allow",
      );
      assert.equal(
        callFileTool(
          "coord-c2",
          "write_file",
          join(coordArtifact, ".system_generated", "swarm", "plan.json"),
          coordArtifact,
        ).decision,
        "allow",
      );

      writeSwarmMembers(sb.appDataDir, "coord-unsafe", {
        "ro-unsafe-1": { conversation_id: "../outside", role: "worker" },
        "ro-unsafe-2": { conversation_id: "..", role: "worker" },
      });
      assert.equal(
        callFileTool("../outside", "write_file", join(sb.appDataDir, "outside", "shot.png")).decision,
        "deny",
      );
      assert.equal(
        callFileTool("..", "write_file", join(sb.appDataDir, "shot.png")).decision,
        "deny",
      );
    } finally {
      rmSync(slashTmpDir, { recursive: true, force: true });
      sb.cleanup();
    }
  });

  test("Caveat 4 resolves remote swarm.json anchors via bounded --roster-only CLI probe with cache, O(1) member-map, and clean fail-open", () => {
    const sb = makeSandbox();
    try {
      const researchCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "research.md"), "utf8");
      const agentCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "poteto-agent.md"), "utf8");
      const cacheDir = join(sb.appDataDir, "plugin_data", "agy-pstack-next");

      const callsLog = join(sb.root, "remote-cli-calls.jsonl");
      const rosterStateFile = join(sb.root, "remote-roster-state.json");
      const mockCli = join(sb.root, "mock-remote-swarm-cli.mjs");
      writeFileSync(
        rosterStateFile,
        JSON.stringify({
          swm_remote_pstack: {
            coordinator: { conversation_id: "remote-coord", role: "coordinator" },
            "impl-1": { conversation_id: "remote-impl-1", role: "worker" },
            "ro-1": { conversation_id: "remote-ro-1", role: "worker" },
          },
          swm_remote_plain: {
            coordinator: { conversation_id: "remote-plain-coord", role: "coordinator" },
            parser: { conversation_id: "remote-plain-parser", role: "worker" },
            verifier: { conversation_id: "remote-plain-verifier", role: "worker" },
          },
        }),
        "utf8",
      );
      writeFileSync(
        mockCli,
        `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callsLog)}, JSON.stringify(args) + "\\n", "utf8");
if (process.env.MOCK_CLI_MODE === "fail") process.exit(2);
if (process.env.MOCK_CLI_MODE === "hang") { setTimeout(() => {}, 10000); } else {
  const swarmId = args[args.length - 1];
  const state = JSON.parse(readFileSync(${JSON.stringify(rosterStateFile)}, "utf8"));
  const members = state[swarmId];
  if (members) {
    process.stdout.write(JSON.stringify({ type: "meta", ok: true }) + "\\n");
    process.stdout.write(JSON.stringify({ swarm_id: swarmId, members }) + "\\n");
  }
}
`,
        "utf8",
      );
      chmodSync(mockCli, 0o755);

      const writeRemoteAnchor = (coordId, doc) => {
        const dir = join(sb.appDataDir, "brain", coordId, ".system_generated", "swarm");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "swarm.json"), JSON.stringify(doc), "utf8");
      };

      writeRemoteAnchor("remote-coord", {
        backend: "spanner",
        swarm_id: "swm_remote_pstack",
        db: "projects/p/instances/i/databases/d",
        coordinator_conversation_id: "remote-coord",
      });

      assert.deepEqual(
        runGuard(
          {
            hookEventName: "SessionStart",
            conversationId: "remote-ro-1",
            rootConversationId: "remote-coord",
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_REMOTE_SWARM_CLI: mockCli },
        ),
        { injectSteps: [{ systemMessage: { systemMessage: researchCapsule } }] },
      );

      const recordedCalls = readFileSync(callsLog, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      assert.equal(recordedCalls.length, 1);
      assert.deepEqual(recordedCalls[0], [
        "swarm",
        "--json",
        "--roster-only",
        "--db",
        "projects/p/instances/i/databases/d",
        "swm_remote_pstack",
      ]);

      const remoteCache = JSON.parse(readFileSync(join(cacheDir, "remote-rosters.json"), "utf8"));
      assert.ok(remoteCache.swm_remote_pstack);
      assert.equal(remoteCache.swm_remote_pstack.members["ro-1"].conversation_id, "remote-ro-1");

      assert.equal(
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "remote-ro-1",
            cwd: sb.worktree,
            toolCall: { id: "r1", name: "write_file", args: { Path: join(sb.worktree, "nope.txt") } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_REMOTE_SWARM_CLI: mockCli },
        ).decision,
        "deny",
      );
      assert.deepEqual(
        runGuard(
          { hookEventName: "SessionStart", conversationId: "remote-impl-1" },
          { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_REMOTE_SWARM_CLI: mockCli },
        ),
        { injectSteps: [{ systemMessage: { systemMessage: agentCapsule } }] },
      );
      assert.equal(readFileSync(callsLog, "utf8").trim().split("\n").length, 1);

      const sidecarDir = join(
        sb.appDataDir,
        "builtin",
        "plugins",
        "swarm",
        "sidecars",
        "swarm_board",
      );
      mkdirSync(sidecarDir, { recursive: true });
      writeFileSync(
        join(sidecarDir, "remote_board.json"),
        JSON.stringify({ backend: "spanner", cli: [mockCli] }),
        "utf8",
      );

      writeRemoteAnchor("remote-plain-coord", {
        backend: "spanner",
        swarm_id: "swm_remote_plain",
        coordinator_conversation_id: "remote-plain-coord",
      });

      assert.deepEqual(
        runGuard(
          {
            hookEventName: "SessionStart",
            conversationId: "remote-plain-verifier",
            rootConversationId: "remote-plain-coord",
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        {},
      );
      const memberMapAfterPlain = JSON.parse(readFileSync(join(cacheDir, "member-map.json"), "utf8"));
      assert.equal(memberMapAfterPlain["remote-plain-verifier"], undefined);
      assert.equal(memberMapAfterPlain["remote-plain-parser"], undefined);

      const lateWorkerTranscript = join(
        sb.appDataDir,
        "brain",
        "remote-ro-late",
        ".system_generated",
        "logs",
        "transcript.jsonl",
      );
      writeTranscriptLines(lateWorkerTranscript, [
        { step_index: 0, type: "SYSTEM_MESSAGE", content: "[swarm] new board message #2" },
      ]);
      const callsBeforeBackoffProbe = readFileSync(callsLog, "utf8").trim().split("\n").length;
      assert.deepEqual(
        runGuard(
          {
            hookEventName: "SessionStart",
            conversationId: "remote-ro-late",
            rootConversationId: "remote-coord",
            transcriptPath: lateWorkerTranscript,
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        {},
      );
      assert.equal(readFileSync(callsLog, "utf8").trim().split("\n").length, callsBeforeBackoffProbe);
      const nonWorkerAfterMiss = existsSync(join(cacheDir, "non-worker-roots.json"))
        ? JSON.parse(readFileSync(join(cacheDir, "non-worker-roots.json"), "utf8"))
        : {};
      assert.equal(nonWorkerAfterMiss["remote-ro-late"], undefined);

      writeFileSync(
        rosterStateFile,
        JSON.stringify({
          swm_remote_pstack: {
            coordinator: { conversation_id: "remote-coord", role: "coordinator" },
            "impl-1": { conversation_id: "remote-impl-1", role: "worker" },
            "ro-1": { conversation_id: "remote-ro-1", role: "worker" },
            "ro-late": { conversation_id: "remote-ro-late", role: "worker" },
          },
        }),
        "utf8",
      );
      const agedCache = JSON.parse(readFileSync(join(cacheDir, "remote-rosters.json"), "utf8"));
      agedCache.swm_remote_pstack.fetchedAt = Date.now() - 6000;
      writeFileSync(join(cacheDir, "remote-rosters.json"), JSON.stringify(agedCache), "utf8");

      assert.deepEqual(
        runGuard(
          {
            hookEventName: "SessionStart",
            conversationId: "remote-ro-late",
            rootConversationId: "remote-coord",
            transcriptPath: lateWorkerTranscript,
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        ),
        { injectSteps: [{ systemMessage: { systemMessage: researchCapsule } }] },
      );

      writeRemoteAnchor("flag-inject-coord", {
        backend: "spanner",
        swarm_id: "-bad-flag",
        db: "--evil-db",
      });
      const callsBeforeBadAnchor = readFileSync(callsLog, "utf8").trim().split("\n").length;
      runGuard(
        {
          hookEventName: "SessionStart",
          conversationId: "flag-worker",
          rootConversationId: "flag-inject-coord",
          transcriptPath: lateWorkerTranscript,
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_REMOTE_SWARM_CLI: mockCli },
      );
      assert.equal(readFileSync(callsLog, "utf8").trim().split("\n").length, callsBeforeBadAnchor);

      writeRemoteAnchor("fail-open-coord", {
        backend: "spanner",
        swarm_id: "swm_fail_open",
        coordinator_conversation_id: "fail-open-coord",
      });
      for (const mode of ["fail", "hang"]) {
        assert.deepEqual(
          runGuard(
            {
              hookEventName: "SessionStart",
              conversationId: `fail-open-worker-${mode}`,
              rootConversationId: "fail-open-coord",
              transcriptPath: lateWorkerTranscript,
            },
            {
              PSTACK_APPDATA_DIR: sb.appDataDir,
              PSTACK_REMOTE_SWARM_CLI: mockCli,
              MOCK_CLI_MODE: mode,
            },
          ),
          {},
        );
        const nonWorkers = existsSync(join(cacheDir, "non-worker-roots.json"))
          ? JSON.parse(readFileSync(join(cacheDir, "non-worker-roots.json"), "utf8"))
          : {};
        assert.equal(nonWorkers[`fail-open-worker-${mode}`], undefined);
      }
    } finally {
      sb.cleanup();
    }
  });
});
