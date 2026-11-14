import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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

function runGuard(payload, envOverrides = {}) {
  const env = { ...process.env };
  delete env.PSTACK_APPDATA_DIR;
  delete env.ANTIGRAVITY_APP_DATA_DIR;
  delete env.PLUGIN_DATA;
  delete env.PLUGIN_ROOT;
  delete env.PSTACK_ALLOW_PUSH;
  delete env.PSTACK_FORCE_COORDINATOR;
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined || v === null) delete env[k];
    else env[k] = v;
  }

  const res = spawnSync(process.execPath, [GUARD_PATH], {
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
