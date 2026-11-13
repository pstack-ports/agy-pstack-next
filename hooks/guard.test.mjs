import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  mkdirSync(join(appDataDir, "brain"), { recursive: true });
  mkdirSync(worktree, { recursive: true });
  mkdirSync(siblingWorktree, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });

  return {
    root,
    appDataDir,
    worktree,
    siblingWorktree,
    outsideDir,
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

function runGuard(payload, envOverrides = {}) {
  const env = { ...process.env };
  delete env.PSTACK_APPDATA_DIR;
  delete env.PLUGIN_DATA;
  delete env.PLUGIN_ROOT;
  delete env.PSTACK_ALLOW_PUSH;
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

describe("hooks.json and guard.mjs packaging", () => {
  test("places hooks.json at plugin root with required event structure and executable script", () => {
    assert.equal(existsSync(HOOKS_JSON_PATH), true);
    assert.equal(existsSync( join(PLUGIN_ROOT, "hooks", "hooks.json") ), false);

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
      "(invoke|define)_subagent|manage_subagents|send_message",
    );
    assert.equal(
      guardSpec.PreToolUse[1].matcher,
      "(edit|write)_file|run_command|call_mcp_tool|mcp_.*",
    );

    const mode = statSync(GUARD_PATH).mode;
    assert.notEqual(mode & 0o111, 0, "hooks/guard.mjs must have +x permission");
  });
});

describe("Global legacy subagent ban", () => {
  test("denies all 4 legacy subagent tools across coordinator, builtin, and every worker role", () => {
    const sb = makeSandbox();
    try {
      writeSwarmMembers(sb.appDataDir, "coord-conv", {
        coordinator: { conversation_id: "coord-conv", role: "coordinator" },
        monitor: { conversation_id: "mon-conv", role: "worker" },
        "impl-1": { conversation_id: "impl-conv", role: "worker" },
        "ro-1": { conversation_id: "ro-conv", role: "worker" },
        "adv-1": { conversation_id: "adv-conv", role: "worker" },
        "sicko-1": { conversation_id: "sicko-conv", role: "worker" },
      });

      const bannedTools = [
        "invoke_subagent",
        "define_subagent",
        "manage_subagents",
        "send_message",
      ];
      const convIds = [
        "unlisted-conv",
        "coord-conv",
        "mon-conv",
        "impl-conv",
        "ro-conv",
        "adv-conv",
        "sicko-conv",
      ];

      for (const convId of convIds) {
        for (const toolName of bannedTools) {
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
    } finally {
      sb.cleanup();
    }
  });
});

describe("appDataDir product slicing, member-map caching, and capsule lifecycle", () => {
  test("slices appDataDir before /brain/ across antigravity-cli, antigravity, and antigravity-ide", () => {
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

      const ideAppData = join(root, ".gemini", "antigravity-ide");
      writeSwarmMembers(ideAppData, "coord-2", {
        "sicko-clean": { conversationId: "conv-artifact-only", role: "worker" },
      });
      const viaArtifact = runGuard({
        hookEventName: "SessionStart",
        conversationId: "conv-artifact-only",
        artifactDirectoryPath: join(ideAppData, "brain", "conv-artifact-only"),
      });
      const expectedSicko = readFileSync(join(PLUGIN_ROOT, "roles", "comment-sicko.md"), "utf8");
      assert.deepEqual(viaArtifact, {
        injectSteps: [{ systemMessage: { systemMessage: expectedSicko } }],
      });

      const customPluginRoot = join(root, "custom-plugin");
      const customPluginData = join(root, "custom-plugin-data");
      mkdirSync(join(customPluginRoot, "roles"), { recursive: true });
      writeFileSync(join(customPluginRoot, "roles", "coordinator.md"), "custom-coord-capsule\n", "utf8");
      const viaOverrides = runGuard(
        { hookEventName: "SessionStart", conversationId: "override-conv" },
        {
          PSTACK_APPDATA_DIR: ideAppData,
          PLUGIN_ROOT: customPluginRoot,
          PLUGIN_DATA: customPluginData,
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
            { hookEventName, conversationId: id },
            { PSTACK_APPDATA_DIR: sb.appDataDir },
          );
          assert.deepEqual(out, {});
        }
      }
    } finally {
      sb.cleanup();
    }
  });

  test("injects each role capsule once, deduplicates repeat invocations, caches workers, and upgrades late members", () => {
    const sb = makeSandbox();
    try {
      const coordCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "coordinator.md"), "utf8");
      const agentCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "poteto-agent.md"), "utf8");
      const researchCapsule = readFileSync(join(PLUGIN_ROOT, "roles", "research.md"), "utf8");

      const firstBeforeMembers = runGuard(
        { hookEventName: "SessionStart", conversationId: "late-ro-id" },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(firstBeforeMembers, {
        injectSteps: [{ systemMessage: { systemMessage: coordCapsule } }],
      });

      const cacheDir = join(sb.appDataDir, "pstack-swarm-guard");
      const mapBefore = existsSync(join(cacheDir, "member-map.json"))
        ? JSON.parse(readFileSync(join(cacheDir, "member-map.json"), "utf8"))
        : {};
      assert.equal(mapBefore["late-ro-id"], undefined);

      const repeatCoord = runGuard(
        { hookEventName: "PreInvocation", conversationId: "late-ro-id" },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(repeatCoord, {});

      writeSwarmMembers(sb.appDataDir, "coord-root", {
        coordinator: { conversation_id: "coord-root", role: "coordinator" },
        "ro-1": { conversation_id: "late-ro-id", role: "worker" },
        "impl-slice": { conversation_id: "impl-id", role: "worker" },
        "cand-a": { conversation_id: "cand-id", role: "worker" },
        "lead-api": { conversation_id: "lead-id", role: "worker" },
        "adv-fuzz": { conversation_id: "adv-id", role: "worker" },
        "eval-runner-1": { conversation_id: "custom-id", role: "worker" },
      });

      const upgraded = runGuard(
        { hookEventName: "PreInvocation", conversationId: "late-ro-id" },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(upgraded, {
        injectSteps: [{ systemMessage: { systemMessage: researchCapsule } }],
      });

      const dedupedAfterUpgrade = runGuard(
        { hookEventName: "PreInvocation", conversationId: "late-ro-id" },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(dedupedAfterUpgrade, {});

      for (const id of ["impl-id", "cand-id", "lead-id", "adv-id", "custom-id"]) {
        const first = runGuard(
          { hookEventName: "SessionStart", conversationId: id },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        );
        assert.deepEqual(first, {
          injectSteps: [{ systemMessage: { systemMessage: agentCapsule } }],
        });
        const second = runGuard(
          { hookEventName: "PreInvocation", conversationId: id },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        );
        assert.deepEqual(second, {});
      }

      const coordEntryFirst = runGuard(
        { hookEventName: "SessionStart", conversationId: "coord-root" },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.deepEqual(coordEntryFirst, {
        injectSteps: [{ systemMessage: { systemMessage: coordCapsule } }],
      });

      const mapAfter = JSON.parse(readFileSync(join(cacheDir, "member-map.json"), "utf8"));
      assert.equal(mapAfter["late-ro-id"], "ro-1");
      assert.equal(mapAfter["impl-id"], "impl-slice");
      assert.equal(mapAfter["custom-id"], "eval-runner-1");
      assert.equal(mapAfter["coord-root"], undefined);

      rmSync(join(sb.appDataDir, "brain", "coord-root"), { recursive: true, force: true });
      const roEditFromCache = runGuard(
        {
          hookEventName: "PreToolUse",
          conversationId: "late-ro-id",
          cwd: sb.worktree,
          toolCall: { id: "t1", name: "write_file", args: { Path: join(sb.worktree, "a.txt") } },
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir },
      );
      assert.equal(roEditFromCache.decision, "deny");
    } finally {
      sb.cleanup();
    }
  });
});

describe("Worktree realpathSync path confinement", () => {
  test("allows writes in cwd (including missing nested dirs) and artifact dir while blocking ../ and symlink escapes", () => {
    const sb = makeSandbox();
    try {
      const artifactDir = join(sb.appDataDir, "brain", "impl-conv");
      mkdirSync(artifactDir, { recursive: true });
      writeSwarmMembers(sb.appDataDir, "coord-1", {
        "impl-auth": { conversation_id: "impl-conv", role: "worker" },
        "adv-sec": { conversation_id: "adv-conv", role: "worker" },
        "custom-helper": { conversation_id: "helper-conv", role: "worker" },
      });

      const outsideExistingFile = join(sb.outsideDir, "secret.txt");
      writeFileSync(outsideExistingFile, "secret", "utf8");
      symlinkSync(sb.outsideDir, join(sb.worktree, "linked-outside-dir"));
      symlinkSync(outsideExistingFile, join(sb.worktree, "linked-outside-file.txt"));
      symlinkSync(join(sb.outsideDir, "nonexistent-victim.txt"), join(sb.worktree, "dangling-escape.txt"));

      const internalRealDir = join(sb.worktree, "packages", "core");
      mkdirSync(internalRealDir, { recursive: true });
      symlinkSync(internalRealDir, join(sb.worktree, "internal-link"));

      const checkPath = (convId, toolName, targetPath) =>
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: convId,
            artifactDirectoryPath: artifactDir,
            cwd: sb.worktree,
            toolCall: { id: "tc", name: toolName, args: { Path: targetPath } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
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
        checkPath("helper-conv", "write_file", join(sb.worktree, "dangling-escape.txt")).decision,
        "deny",
      );

      const coordOutside = checkPath("coord-1", "write_file", join(sb.outsideDir, "pstack-models.md"));
      assert.equal(coordOutside.decision, "allow");
    } finally {
      sb.cleanup();
    }
  });
});

describe("ro-* Read-Only Guard", () => {
  test("blocks file edits, mutating shell commands, package installs, and non-tmp redirects while allowing probes", () => {
    const sb = makeSandbox();
    try {
      writeSwarmMembers(sb.appDataDir, "coord-1", {
        "ro-verify": { conversation_id: "ro-id", role: "worker" },
      });

      for (const toolName of ["edit_file", "write_file"]) {
        const res = runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "ro-id",
            cwd: sb.worktree,
            toolCall: { id: "t1", name: toolName, args: { Path: join(sb.worktree, "f.txt") } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        );
        assert.equal(res.decision, "deny");
      }

      const runCmd = (CommandLine) =>
        runGuard(
          {
            hookEventName: "PreToolUse",
            conversationId: "ro-id",
            cwd: sb.worktree,
            toolCall: { id: "t2", name: "run_command", args: { CommandLine } },
          },
          { PSTACK_APPDATA_DIR: sb.appDataDir },
        );

      const allowedCommands = [
        "git status --short",
        "git -C /tmp/repo diff 051c56d -- skills/statechart/scripts",
        "git log --oneline -n 10 2>/dev/null",
        "git show HEAD:hooks.json",
        "node --test hooks/guard.test.mjs 2>&1",
        "grep -rn 'git push|rm -rf' hooks/",
        "sed -n '1,20p' README.md",
        "npm test",
        "echo probe-result > /tmp/pstack-probe.txt",
        "git status | tee /dev/null",
        "git log -n 3 | tee -a /tmp/pstack-git.log",
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
        "git tag v2.0.0",
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
        "rmdir empty-dir",
        "mv a.txt b.txt",
        "cp a.txt b.txt",
        "chmod +x script.sh",
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
        "echo appended >> notes.md",
        "git status | tee status.txt",
        "git status | tee /tmp/../outside.txt",
        "sh -c 'rm -f secret.txt'",
        "echo $(touch pwned.txt)",
      ];
      for (const cmd of deniedCommands) {
        assert.equal(runCmd(cmd).decision, "deny", `expected deny for: ${cmd}`);
      }
    } finally {
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
  test("enforces sicko-* write_file ban, edit_file confinement, and unconditional git push block", () => {
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

      const pushEvenWithAllow = runGuard(
        {
          hookEventName: "PreToolUse",
          conversationId: "sicko-id",
          cwd: sb.worktree,
          toolCall: {
            id: "s4",
            name: "run_command",
            args: { CommandLine: "PSTACK_ALLOW_PUSH=1 git push origin feat" },
          },
        },
        { PSTACK_APPDATA_DIR: sb.appDataDir, PSTACK_ALLOW_PUSH: "1" },
      );
      assert.equal(pushEvenWithAllow.decision, "deny");
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
