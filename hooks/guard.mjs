#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LEGACY_SUBAGENT_TOOLS = new Set([
  "invoke_subagent",
  "define_subagent",
  "manage_subagents",
  "send_message",
  "run_workflow",
]);

const SWARM_BOARD_TOOLS = new Set([
  "post_message",
  "read_board",
  "swarm_wait",
  "swarm",
]);

const PSTACK_SLASH_COMMAND_RE =
  /(?:^|\s)\/(?:agy-pstack-next:)?(?:pstack|setup-pstack|understand|crucible|interrogate|reflect|ketchup|verify-gen|control-ui|control-cli|statechart|technical-writing|make-bot-ui)\b/i;

const BUILTIN_SWARM_SLASH_RE = /(?:^|\s)\/swarm\b/i;

const PSTACK_WORKER_PREFIX_RE = /^(?:impl|cand|lead|ro|adv|sicko)-/i;

const BUILTIN_SUPPORT_MEMBER_RE = /^(?:coordinator|monitor(?:-\d+)?|narrator(?:-\d+)?)$/i;

const REMOTE_SWARM_ID_RE = /^[A-Za-z0-9._-]{4,128}$/;

const REMOTE_ROSTER_TTL_MS = 15000;

const REMOTE_MISS_BACKOFF_MS = 5000;

const ROLE_CAPSULE_HEADING_RE = /(?:^|\r?\n|\\n)# [^\r\n\\]+ role capsule(?:\r?\n|\\n|$)/i;

const FORK_MEMORY_MARKER_RE = /Everything before this turn is @[A-Za-z0-9_-]+'s memory/;

const ROLE_OVERRIDE_NOTICE =
  "> **Role override.** Your active swarm role has changed. The role capsule below supersedes every earlier role capsule in this conversation history, including rules inherited through `fork`.\n\n";

const MUTATING_MCP_PATTERN =
  /(^|_)(create|update|delete|remove|set|post|reply|resolve|merge|close|push|write|edit|append|restore|upload|generate|install|uninstall|send|modify|patch|drop|insert)(_|$)/i;

const MUTATING_GIT_SUBCOMMANDS = new Set([
  "add",
  "stage",
  "commit",
  "push",
  "pull",
  "merge",
  "rebase",
  "cherry-pick",
  "reset",
  "clean",
  "am",
  "apply",
  "mv",
  "rm",
  "checkout",
  "switch",
  "revert",
  "restore",
  "init",
  "clone",
  "update-ref",
]);

const GIT_GLOBAL_VALUE_FLAGS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--config-env",
]);

const HARD_BLOCKED_RO_FS_COMMANDS = new Set([
  "rmdir",
  "chown",
  "chgrp",
  "patch",
  "ln",
]);

const SICKO_BLOCKED_FS_COMMANDS = new Set([
  "cp",
  "mv",
  "rm",
  "rmdir",
  "unlink",
  "ln",
  "install",
  "mkdir",
  "touch",
  "truncate",
  "dd",
  "patch",
  "chmod",
  "chown",
  "chgrp",
]);

const NPM_INSTALL_SUBCOMMANDS = new Set([
  "install",
  "i",
  "add",
  "ci",
  "uninstall",
  "remove",
  "rm",
  "un",
  "update",
  "up",
  "link",
  "unlink",
  "dedupe",
  "prune",
  "rebuild",
  "publish",
  "init",
  "dlx",
]);

const PIP_INSTALL_SUBCOMMANDS = new Set([
  "install",
  "uninstall",
  "download",
  "wheel",
]);

const NODE_SINGLE_PATH_FS_APIS = new Set([
  "writeFileSync",
  "writeFile",
  "appendFileSync",
  "appendFile",
  "unlinkSync",
  "unlink",
  "rmSync",
  "rm",
  "rmdirSync",
  "rmdir",
  "mkdirSync",
  "mkdir",
  "mkdtempSync",
  "mkdtemp",
  "chmodSync",
  "chmod",
  "chownSync",
  "chown",
  "truncateSync",
  "truncate",
  "createWriteStream",
]);

const NODE_TWO_PATH_FS_APIS = new Set([
  "renameSync",
  "rename",
  "symlinkSync",
  "symlink",
  "linkSync",
  "link",
]);

const NODE_COPY_FS_APIS = new Set([
  "copyFileSync",
  "copyFile",
  "cpSync",
  "cp",
]);

function normalizeToolName(rawName) {
  const name = typeof rawName === "string" ? rawName : String(rawName || "");
  return name.startsWith("default_api:") ? name.slice("default_api:".length) : name;
}

function readJsonObject(filePath) {
  try {
    if (!existsSync(filePath)) return {};
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonAtomically(filePath, obj) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const tmpPath = join(dir, `.${basename(filePath)}.${suffix}.tmp`);
  const serialized = JSON.stringify(obj, null, 2) + "\n";
  try {
    writeFileSync(tmpPath, serialized, "utf8");
    renameSync(tmpPath, filePath);
  } catch {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {}
    writeFileSync(filePath, serialized, "utf8");
  }
}

function updateJsonKey(filePath, key, value) {
  const current = readJsonObject(filePath);
  if (current[key] === value) return;
  current[key] = value;
  writeJsonAtomically(filePath, current);
}

function updateJsonKeys(filePath, entries) {
  const keys = Object.keys(entries);
  if (keys.length === 0) return;
  const current = readJsonObject(filePath);
  let changed = false;
  for (const key of keys) {
    if (current[key] !== entries[key]) {
      current[key] = entries[key];
      changed = true;
    }
  }
  if (changed) {
    writeJsonAtomically(filePath, current);
  }
}

function resolveAppDataDir(payload, env) {
  if (typeof env.PSTACK_APPDATA_DIR === "string" && env.PSTACK_APPDATA_DIR.length > 0) {
    return env.PSTACK_APPDATA_DIR;
  }
  const candidates = [payload.transcriptPath, payload.artifactDirectoryPath];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    const normalized = candidate.replace(/\\/g, "/");
    const brainIdx = normalized.indexOf("/brain/");
    if (brainIdx > 0) {
      return candidate.slice(0, brainIdx);
    }
    if (normalized.endsWith("/brain") && normalized.length > 6) {
      return candidate.slice(0, normalized.length - 6);
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    const match = candidate.match(/^(.*?[/\\]\.gemini[/\\]antigravity(?:-[a-zA-Z0-9_-]+)?)(?:[/\\]|$)/);
    if (match) return match[1];
  }
  if (typeof env.ANTIGRAVITY_APP_DATA_DIR === "string" && env.ANTIGRAVITY_APP_DATA_DIR.length > 0) {
    return env.ANTIGRAVITY_APP_DATA_DIR;
  }
  if (typeof env.PLUGIN_DATA === "string" && env.PLUGIN_DATA.length > 0) {
    const parent = dirname(env.PLUGIN_DATA);
    if (basename(parent) === "plugin_data") {
      return dirname(parent);
    }
  }
  return null;
}

function resolveCacheDir(appDataDir, env) {
  if (typeof env.PSTACK_CACHE_DIR === "string" && env.PSTACK_CACHE_DIR.length > 0) {
    return env.PSTACK_CACHE_DIR;
  }
  if (typeof env.PLUGIN_DATA === "string" && env.PLUGIN_DATA.length > 0) {
    return env.PLUGIN_DATA;
  }
  return appDataDir
    ? join(appDataDir, "plugin_data", "agy-pstack-next")
    : join(tmpdir(), "pstack-swarm-guard");
}

function resolvePluginRoot(env) {
  if (typeof env.PSTACK_PLUGIN_ROOT === "string" && env.PSTACK_PLUGIN_ROOT.length > 0) {
    return env.PSTACK_PLUGIN_ROOT;
  }
  if (typeof env.PLUGIN_ROOT === "string" && env.PLUGIN_ROOT.length > 0) {
    return env.PLUGIN_ROOT;
  }
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function resolveConfigJsonPath(env) {
  if (typeof env.PSTACK_CONFIG_DIR === "string" && env.PSTACK_CONFIG_DIR.length > 0) {
    return join(env.PSTACK_CONFIG_DIR, "config.json");
  }
  const pluginRoot = resolvePluginRoot(env);
  if (pluginRoot && basename(dirname(pluginRoot)) === "plugins") {
    return join(dirname(dirname(pluginRoot)), "config.json");
  }
  if (!env.PSTACK_APPDATA_DIR && !env.PSTACK_PLUGIN_ROOT && !env.PLUGIN_ROOT) {
    const home = typeof env.HOME === "string" && env.HOME.length > 0 ? env.HOME : homedir();
    return join(home, ".gemini", "config", "config.json");
  }
  return null;
}

function isPluginDisabled(env) {
  const configPath = resolveConfigJsonPath(env);
  if (!configPath || !existsSync(configPath)) return false;
  const parsed = readJsonObject(configPath);
  return parsed?.plugins?.["agy-pstack-next"]?.enabled === false;
}

function resolveOwnTranscriptPath(payload, appDataDir) {
  if (typeof payload.transcriptPath === "string" && payload.transcriptPath.length > 0) {
    return payload.transcriptPath;
  }
  if (appDataDir && typeof payload.conversationId === "string" && payload.conversationId.length > 0) {
    const stdPath = join(
      appDataDir,
      "brain",
      payload.conversationId,
      ".system_generated",
      "logs",
      "transcript.jsonl",
    );
    if (existsSync(stdPath)) return stdPath;
    const flatPath = join(appDataDir, "brain", payload.conversationId, "transcript.jsonl");
    if (existsSync(flatPath)) return flatPath;
  }
  return null;
}

function isSystemRoleCapsuleStep(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  if (parsed.type !== "SYSTEM_MESSAGE" && parsed.source !== "SYSTEM_SDK") {
    return false;
  }
  return typeof parsed.content === "string" && ROLE_CAPSULE_HEADING_RE.test(parsed.content);
}

function transcriptIsUnforkedUserRoot(transcriptPath, hasPriorInjectedCapsule) {
  if (!transcriptPath || !existsSync(transcriptPath)) return false;
  try {
    const content = readFileSync(transcriptPath, "utf8");
    if (
      /\[swarm\] new board message|Your assignment \(recorded on the board/.test(content) ||
      FORK_MEMORY_MARKER_RE.test(content)
    ) {
      return false;
    }
    let sawFirstStep = false;
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== "object") return false;
      if (!sawFirstStep) {
        if (parsed.type !== "USER_INPUT") return false;
        sawFirstStep = true;
      }
      if (typeof parsed.content === "string" && FORK_MEMORY_MARKER_RE.test(parsed.content)) {
        return false;
      }
      if (!hasPriorInjectedCapsule && isSystemRoleCapsuleStep(parsed)) {
        return false;
      }
    }
    return sawFirstStep;
  } catch {
    return false;
  }
}

function transcriptContainsRoleCapsule(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return false;
  try {
    const content = readFileSync(transcriptPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (isSystemRoleCapsuleStep(parsed)) {
          return true;
        }
      } catch {}
    }
  } catch {
    return false;
  }
  return false;
}

function extractMembersFromDoc(doc, targetConversationId, fallbackCoordId = null) {
  const workerEntries = {};
  let matchedCoordinator = false;
  let coordId =
    typeof fallbackCoordId === "string" && fallbackCoordId.length > 0 ? fallbackCoordId : null;
  let hasPstackPrefixedWorker = false;
  let hasTaskWorker = false;
  const members = doc && typeof doc === "object" ? doc.members : null;
  if (!members || typeof members !== "object") {
    return {
      hasMembers: false,
      workerEntries,
      matchedCoordinator,
      coordId,
      hasPstackPrefixedWorker,
      hasTaskWorker,
    };
  }
  for (const [memberName, info] of Object.entries(members)) {
    if (!info || typeof info !== "object") continue;
    const cid = info.conversation_id || info.conversationId;
    if (memberName === "coordinator" || info.role === "coordinator") {
      if (typeof cid === "string" && cid.length > 0) {
        coordId = cid;
        if (cid === targetConversationId) matchedCoordinator = true;
      }
      continue;
    }
    if (PSTACK_WORKER_PREFIX_RE.test(memberName)) {
      hasPstackPrefixedWorker = true;
    }
    if (!BUILTIN_SUPPORT_MEMBER_RE.test(memberName)) {
      hasTaskWorker = true;
    }
    if (typeof cid === "string" && cid.length > 0) {
      workerEntries[cid] = memberName;
    }
  }
  return {
    hasMembers: true,
    workerEntries,
    matchedCoordinator,
    coordId,
    hasPstackPrefixedWorker,
    hasTaskWorker,
  };
}

function isManagedPstackSwarm({
  swarmDir,
  coordId,
  hasPstackPrefixedWorker,
  hasTaskWorker,
  injectedMap,
  plainSwarmRoots,
}) {
  const hasPstackMarker = Boolean(swarmDir && existsSync(join(swarmDir, "pstack.json")));
  const coordAlreadyManaged = Boolean((coordId && injectedMap[coordId]) || hasPstackMarker);
  if (hasPstackPrefixedWorker || coordAlreadyManaged) {
    return true;
  }
  if (coordId && plainSwarmRoots[coordId]) {
    return false;
  }
  if (hasTaskWorker) {
    return false;
  }
  return true;
}

function getAnchorCoordinatorId(doc, ownerDirId) {
  const explicitCoord =
    doc.coordinator_conversation_id ||
    doc.coordinatorConversationId ||
    doc.coordinator_id ||
    doc.coordinatorId;
  if (typeof explicitCoord === "string" && explicitCoord.length > 0) {
    return explicitCoord;
  }
  return ownerDirId;
}

function parseRemoteSwarmAnchor(doc) {
  if (!doc || typeof doc !== "object") return null;
  if (typeof doc.backend !== "string" || doc.backend.length === 0) return null;
  if (
    typeof doc.swarm_id !== "string" ||
    doc.swarm_id.startsWith("-") ||
    !REMOTE_SWARM_ID_RE.test(doc.swarm_id)
  ) {
    return null;
  }
  let db = "";
  if (doc.db !== undefined && doc.db !== null && doc.db !== "") {
    if (typeof doc.db !== "string" || doc.db.startsWith("-")) {
      return null;
    }
    db = doc.db;
  }
  return { backend: doc.backend, swarmId: doc.swarm_id, db };
}

function isExecutableFile(filePath) {
  try {
    accessSync(filePath, fsConstants.X_OK);
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveRemoteBoardCli(anchor, appDataDir, env) {
  if (typeof env.PSTACK_REMOTE_SWARM_CLI === "string" && env.PSTACK_REMOTE_SWARM_CLI.length > 0) {
    return env.PSTACK_REMOTE_SWARM_CLI;
  }
  const cfgPath =
    typeof env.PSTACK_REMOTE_BOARD_CONFIG === "string" && env.PSTACK_REMOTE_BOARD_CONFIG.length > 0
      ? env.PSTACK_REMOTE_BOARD_CONFIG
      : appDataDir
        ? join(
            appDataDir,
            "builtin",
            "plugins",
            "swarm",
            "sidecars",
            "swarm_board",
            "remote_board.json",
          )
        : null;
  if (!cfgPath || !existsSync(cfgPath)) return null;
  const cfg = readJsonObject(cfgPath);
  if (typeof cfg.backend !== "string" || cfg.backend.length === 0 || cfg.backend !== anchor.backend) {
    return null;
  }
  const cliEnvName = typeof cfg.cli_env === "string" ? cfg.cli_env : "";
  const envOverride = cliEnvName ? env[cliEnvName] : "";
  if (
    typeof envOverride === "string" &&
    envOverride.length > 0 &&
    (!envOverride.includes("/") || isExecutableFile(envOverride))
  ) {
    return envOverride;
  }
  const cliList = Array.isArray(cfg.cli)
    ? cfg.cli.filter((c) => typeof c === "string" && c.length > 0)
    : [];
  if (cliList.length === 0) return null;
  const pathDirs = String(env.PATH || process.env.PATH || "")
    .split(":")
    .filter(Boolean);
  for (const candidate of cliList) {
    const hits = candidate.includes("/")
      ? [candidate]
      : pathDirs.map((dir) => join(dir, candidate));
    const found = hits.find(isExecutableFile);
    if (found) return found;
  }
  return cliList[cliList.length - 1];
}

function rosterContainsConversation(members, targetConversationId) {
  if (!members || typeof members !== "object" || !targetConversationId) return false;
  for (const info of Object.values(members)) {
    if (!info || typeof info !== "object") continue;
    const cid = info.conversation_id || info.conversationId;
    if (cid === targetConversationId) return true;
  }
  return false;
}

function resolveRemoteSwarmRoster(anchorDoc, appDataDir, cacheDir, env, targetConversationId) {
  const anchor = parseRemoteSwarmAnchor(anchorDoc);
  if (!anchor) return null;
  const cliBin = resolveRemoteBoardCli(anchor, appDataDir, env);
  if (!cliBin) return null;

  const rostersPath = join(cacheDir, "remote-rosters.json");
  const rostersCache = readJsonObject(rostersPath);
  const cachedEntry = rostersCache[anchor.swarmId];
  const now = Date.now();
  const hasValidCache =
    Boolean(cachedEntry) &&
    typeof cachedEntry === "object" &&
    typeof cachedEntry.fetchedAt === "number" &&
    Boolean(cachedEntry.members) &&
    typeof cachedEntry.members === "object" &&
    !Array.isArray(cachedEntry.members);

  if (hasValidCache) {
    const age = now - cachedEntry.fetchedAt;
    const inRoster = rosterContainsConversation(cachedEntry.members, targetConversationId);
    if (
      (inRoster && age >= 0 && age < REMOTE_ROSTER_TTL_MS) ||
      (!inRoster && age >= 0 && age < REMOTE_MISS_BACKOFF_MS)
    ) {
      return { members: cachedEntry.members };
    }
  }

  try {
    const cliArgs = [
      "swarm",
      "--json",
      "--roster-only",
      ...(anchor.db ? ["--db", anchor.db] : []),
      anchor.swarmId,
    ];
    const stdout = execFileSync(cliBin, cliArgs, {
      encoding: "utf8",
      timeout: 2500,
      env: { ...env, TERM: "dumb" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let matchedMembers = null;
    for (const line of String(stdout || "").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const doc = JSON.parse(trimmed);
        if (
          doc &&
          typeof doc === "object" &&
          doc.swarm_id === anchor.swarmId &&
          doc.members &&
          typeof doc.members === "object" &&
          !Array.isArray(doc.members)
        ) {
          matchedMembers = doc.members;
        }
      } catch {}
    }
    if (!matchedMembers) return null;
    updateJsonKey(rostersPath, anchor.swarmId, {
      fetchedAt: Date.now(),
      members: matchedMembers,
    });
    return { members: matchedMembers };
  } catch {
    return null;
  }
}

function inspectSwarmDirectory(swarmDir, ownerDirId, targetConversationId, context) {
  const { appDataDir, cacheDir, env, injectedMap, plainSwarmRoots, isOwnSwarmDir } = context;
  const membersPath = join(swarmDir, "members.json");
  if (existsSync(membersPath)) {
    const extracted = extractMembersFromDoc(
      readJsonObject(membersPath),
      targetConversationId,
      ownerDirId,
    );
    const managed = isManagedPstackSwarm({
      swarmDir,
      coordId: extracted.coordId,
      hasPstackPrefixedWorker: extracted.hasPstackPrefixedWorker,
      hasTaskWorker: extracted.hasTaskWorker,
      injectedMap,
      plainSwarmRoots,
    });
    if (!managed) {
      const targetIsWorker = Boolean(extracted.workerEntries[targetConversationId]);
      const targetInSwarm = Boolean(
        targetIsWorker ||
          extracted.matchedCoordinator ||
          extracted.coordId === targetConversationId ||
          isOwnSwarmDir,
      );
      return {
        kind: "unmanaged_swarm",
        targetInSwarm,
        targetIsWorker,
        hasUnmatchedAnchor: false,
      };
    }
    return {
      kind: "managed_roster",
      workerEntries: extracted.workerEntries,
      matchedCoordinator: extracted.matchedCoordinator || isOwnSwarmDir,
      hasUnmatchedAnchor: false,
    };
  }

  const anchorPath = join(swarmDir, "swarm.json");
  if (!existsSync(anchorPath)) {
    return { kind: "none" };
  }

  const anchorDoc = readJsonObject(anchorPath);
  const anchorCoordId = getAnchorCoordinatorId(anchorDoc, ownerDirId);
  const remoteRoster = resolveRemoteSwarmRoster(
    anchorDoc,
    appDataDir,
    cacheDir,
    env,
    targetConversationId,
  );
  if (remoteRoster) {
    const extracted = extractMembersFromDoc(remoteRoster, targetConversationId, anchorCoordId);
    const managed = isManagedPstackSwarm({
      swarmDir,
      coordId: extracted.coordId,
      hasPstackPrefixedWorker: extracted.hasPstackPrefixedWorker,
      hasTaskWorker: extracted.hasTaskWorker,
      injectedMap,
      plainSwarmRoots,
    });
    const matchesCoord = extracted.matchedCoordinator || anchorCoordId === targetConversationId;
    const targetIsWorker = Boolean(extracted.workerEntries[targetConversationId]);
    const targetInSwarm = Boolean(
      targetIsWorker ||
        matchesCoord ||
        extracted.coordId === targetConversationId,
    );
    if (!managed) {
      return {
        kind: "unmanaged_swarm",
        targetInSwarm,
        targetIsWorker,
        hasUnmatchedAnchor: !targetInSwarm,
      };
    }
    return {
      kind: "managed_roster",
      workerEntries: extracted.workerEntries,
      matchedCoordinator: matchesCoord,
      hasUnmatchedAnchor: !targetInSwarm,
    };
  }

  if (anchorCoordId === targetConversationId) {
    const suppressedByPlainSwarm = Boolean(
      plainSwarmRoots[anchorCoordId] &&
        !injectedMap[anchorCoordId] &&
        !existsSync(join(swarmDir, "pstack.json")),
    );
    if (suppressedByPlainSwarm) {
      return {
        kind: "unmanaged_swarm",
        targetInSwarm: true,
        targetIsWorker: false,
        hasUnmatchedAnchor: false,
      };
    }
    return { kind: "anchor_coordinator" };
  }

  return { kind: "anchor_unresolved" };
}

function resolveWorkerOrCoordinatorFromSwarm(
  conversationId,
  payload,
  appDataDir,
  cacheDir,
  hasPriorInjectedCapsule,
  env,
  injectedMap,
  plainSwarmRoots,
) {
  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return { workerName: null, isKnownCoordinator: false, isUnmanagedSwarmWorker: false };
  }

  const mapPath = join(cacheDir, "member-map.json");
  const cachedMap = readJsonObject(mapPath);
  const cachedName = cachedMap[conversationId];
  if (typeof cachedName === "string" && cachedName.length > 0 && cachedName !== "coordinator") {
    return { workerName: cachedName, isKnownCoordinator: false, isUnmanagedSwarmWorker: false };
  }

  if (!appDataDir) {
    return { workerName: null, isKnownCoordinator: false, isUnmanagedSwarmWorker: false };
  }

  const candidateRoots = [payload.rootConversationId, payload.parentConversationId];
  const checkedRoots = new Set();
  let hasAnchorWithoutMembers = false;
  let skipNonWorkerCache = false;
  for (const rootId of candidateRoots) {
    if (
      typeof rootId !== "string" ||
      rootId.length === 0 ||
      rootId === conversationId ||
      checkedRoots.has(rootId)
    ) {
      continue;
    }
    checkedRoots.add(rootId);
    const swarmDir = join(appDataDir, "brain", rootId, ".system_generated", "swarm");
    const res = inspectSwarmDirectory(swarmDir, rootId, conversationId, {
      appDataDir,
      cacheDir,
      env,
      injectedMap,
      plainSwarmRoots,
      isOwnSwarmDir: false,
    });
    if (res.kind === "managed_roster") {
      updateJsonKeys(mapPath, res.workerEntries);
      if (res.workerEntries[conversationId]) {
        return {
          workerName: res.workerEntries[conversationId],
          isKnownCoordinator: false,
          isUnmanagedSwarmWorker: false,
        };
      }
      if (res.matchedCoordinator) {
        return { workerName: null, isKnownCoordinator: true, isUnmanagedSwarmWorker: false };
      }
      if (res.hasUnmatchedAnchor) hasAnchorWithoutMembers = true;
    } else if (res.kind === "anchor_coordinator") {
      return { workerName: null, isKnownCoordinator: true, isUnmanagedSwarmWorker: false };
    } else if (res.kind === "anchor_unresolved") {
      hasAnchorWithoutMembers = true;
    } else if (res.kind === "unmanaged_swarm") {
      if (res.targetInSwarm) {
        return {
          workerName: null,
          isKnownCoordinator: false,
          isUnmanagedSwarmWorker: Boolean(res.targetIsWorker),
        };
      }
      skipNonWorkerCache = true;
      if (res.hasUnmatchedAnchor) hasAnchorWithoutMembers = true;
    }
  }

  const ownSwarmDir = join(appDataDir, "brain", conversationId, ".system_generated", "swarm");
  const ownRes = inspectSwarmDirectory(ownSwarmDir, conversationId, conversationId, {
    appDataDir,
    cacheDir,
    env,
    injectedMap,
    plainSwarmRoots,
    isOwnSwarmDir: true,
  });
  if (ownRes.kind === "managed_roster") {
    updateJsonKeys(mapPath, ownRes.workerEntries);
    if (ownRes.workerEntries[conversationId]) {
      return {
        workerName: ownRes.workerEntries[conversationId],
        isKnownCoordinator: false,
        isUnmanagedSwarmWorker: false,
      };
    }
    if (ownRes.matchedCoordinator) {
      return { workerName: null, isKnownCoordinator: true, isUnmanagedSwarmWorker: false };
    }
    if (ownRes.hasUnmatchedAnchor) hasAnchorWithoutMembers = true;
  } else if (ownRes.kind === "anchor_coordinator") {
    return { workerName: null, isKnownCoordinator: true, isUnmanagedSwarmWorker: false };
  } else if (ownRes.kind === "unmanaged_swarm") {
    return {
      workerName: null,
      isKnownCoordinator: false,
      isUnmanagedSwarmWorker: Boolean(ownRes.targetIsWorker),
    };
  } else if (ownRes.kind === "anchor_unresolved") {
    hasAnchorWithoutMembers = true;
  }

  const nonWorkerRootsPath = join(cacheDir, "non-worker-roots.json");
  const nonWorkerRoots = readJsonObject(nonWorkerRootsPath);
  if (nonWorkerRoots[conversationId]) {
    return { workerName: null, isKnownCoordinator: false, isUnmanagedSwarmWorker: false };
  }

  const ownTranscriptPath = resolveOwnTranscriptPath(payload, appDataDir);
  if (transcriptIsUnforkedUserRoot(ownTranscriptPath, hasPriorInjectedCapsule)) {
    return { workerName: null, isKnownCoordinator: false, isUnmanagedSwarmWorker: false };
  }

  const brainDir = join(appDataDir, "brain");
  if (!existsSync(brainDir)) {
    return { workerName: null, isKnownCoordinator: false, isUnmanagedSwarmWorker: false };
  }

  let entries = [];
  try {
    entries = readdirSync(brainDir, { withFileTypes: true });
  } catch {
    return { workerName: null, isKnownCoordinator: false, isUnmanagedSwarmWorker: false };
  }

  const discoveredWorkers = {};
  let matchedCoordinator = false;
  let matchedUnmanagedSwarm = false;
  let matchedUnmanagedWorker = false;
  for (const entry of entries) {
    if (
      (!entry.isDirectory() && !entry.isSymbolicLink()) ||
      entry.name === conversationId ||
      checkedRoots.has(entry.name)
    ) {
      continue;
    }
    const swarmDir = join(brainDir, entry.name, ".system_generated", "swarm");
    const res = inspectSwarmDirectory(swarmDir, entry.name, conversationId, {
      appDataDir,
      cacheDir,
      env,
      injectedMap,
      plainSwarmRoots,
      isOwnSwarmDir: false,
    });
    if (res.kind === "managed_roster") {
      Object.assign(discoveredWorkers, res.workerEntries);
      if (res.matchedCoordinator) matchedCoordinator = true;
      if (res.hasUnmatchedAnchor) hasAnchorWithoutMembers = true;
    } else if (res.kind === "anchor_coordinator") {
      matchedCoordinator = true;
    } else if (res.kind === "anchor_unresolved") {
      hasAnchorWithoutMembers = true;
    } else if (res.kind === "unmanaged_swarm") {
      if (res.targetInSwarm) {
        matchedUnmanagedSwarm = true;
        if (res.targetIsWorker) matchedUnmanagedWorker = true;
      }
      if (res.hasUnmatchedAnchor) hasAnchorWithoutMembers = true;
    }
  }

  updateJsonKeys(mapPath, discoveredWorkers);
  if (discoveredWorkers[conversationId]) {
    return {
      workerName: discoveredWorkers[conversationId],
      isKnownCoordinator: false,
      isUnmanagedSwarmWorker: false,
    };
  }
  if (matchedCoordinator) {
    return { workerName: null, isKnownCoordinator: true, isUnmanagedSwarmWorker: false };
  }
  if (matchedUnmanagedSwarm) {
    return {
      workerName: null,
      isKnownCoordinator: false,
      isUnmanagedSwarmWorker: matchedUnmanagedWorker,
    };
  }

  if (!hasAnchorWithoutMembers && !skipNonWorkerCache) {
    updateJsonKey(nonWorkerRootsPath, conversationId, true);
  }
  return { workerName: null, isKnownCoordinator: false, isUnmanagedSwarmWorker: false };
}

function classifyWorkerMember(memberName) {
  if (
    memberName === "narrator" ||
    memberName.startsWith("narrator-") ||
    memberName === "monitor" ||
    memberName.startsWith("monitor-")
  ) {
    return { kind: "builtin", capsule: null };
  }
  if (
    memberName.startsWith("impl-") ||
    memberName.startsWith("cand-") ||
    memberName.startsWith("lead-")
  ) {
    return { kind: "author", capsule: "roles/poteto-agent.md" };
  }
  if (memberName.startsWith("adv-")) {
    return { kind: "adversary", capsule: "roles/poteto-agent.md" };
  }
  if (memberName.startsWith("ro-")) {
    return { kind: "readonly", capsule: "roles/research.md" };
  }
  if (memberName.startsWith("sicko-")) {
    return { kind: "sicko", capsule: "roles/comment-sicko.md" };
  }
  const baseMemberName = memberName.replace(/-\d+$/, "");
  if (
    baseMemberName === "verifier" ||
    memberName.startsWith("verifier-") ||
    baseMemberName.endsWith("-verifier") ||
    memberName.startsWith("verify-")
  ) {
    return { kind: "readonly", capsule: "roles/research.md" };
  }
  return { kind: "author", capsule: "roles/poteto-agent.md" };
}

function classifySession(payload, env) {
  const appDataDir = resolveAppDataDir(payload, env);
  const cacheDir = resolveCacheDir(appDataDir, env);
  const conversationId = typeof payload.conversationId === "string" ? payload.conversationId : "";
  const injectedPath = join(cacheDir, "injected-capsules.json");
  const injectedMap = readJsonObject(injectedPath);
  const alreadyInjected =
    conversationId.length > 0 &&
    typeof injectedMap[conversationId] === "string" &&
    injectedMap[conversationId].length > 0;

  const matchesSlashCommand =
    typeof payload.lastUserInput === "string" && PSTACK_SLASH_COMMAND_RE.test(payload.lastUserInput);
  const forcedCoordinator = env.PSTACK_FORCE_COORDINATOR === "1";
  const matchesBuiltinSwarmSlash =
    typeof payload.lastUserInput === "string" && BUILTIN_SWARM_SLASH_RE.test(payload.lastUserInput);

  const plainSwarmRootsPath = join(cacheDir, "plain-swarm-roots.json");
  const plainSwarmRoots = readJsonObject(plainSwarmRootsPath);
  if (conversationId.length > 0) {
    if (matchesSlashCommand || forcedCoordinator) {
      if (plainSwarmRoots[conversationId]) {
        plainSwarmRoots[conversationId] = false;
        updateJsonKey(plainSwarmRootsPath, conversationId, false);
      }
    } else if (matchesBuiltinSwarmSlash && !alreadyInjected) {
      if (!plainSwarmRoots[conversationId]) {
        plainSwarmRoots[conversationId] = true;
        updateJsonKey(plainSwarmRootsPath, conversationId, true);
      }
    }
  }

  const { workerName, isKnownCoordinator, isUnmanagedSwarmWorker } =
    resolveWorkerOrCoordinatorFromSwarm(
      conversationId,
      payload,
      appDataDir,
      cacheDir,
      alreadyInjected,
      env,
      injectedMap,
      plainSwarmRoots,
    );

  if (workerName) {
    const { kind, capsule } = classifyWorkerMember(workerName);
    return {
      sessionKind: "worker",
      kind,
      memberName: workerName,
      capsule,
      appDataDir,
      cacheDir,
      injectedMap,
    };
  }

  if (isUnmanagedSwarmWorker && !alreadyInjected && !forcedCoordinator) {
    return {
      sessionKind: "unmanaged",
      kind: "unmanaged",
      memberName: null,
      capsule: null,
      appDataDir,
      cacheDir,
      injectedMap,
    };
  }

  if (
    isKnownCoordinator ||
    alreadyInjected ||
    matchesSlashCommand ||
    forcedCoordinator
  ) {
    return {
      sessionKind: "coordinator",
      kind: "coordinator",
      memberName: "coordinator",
      capsule: "roles/coordinator.md",
      appDataDir,
      cacheDir,
      injectedMap,
    };
  }

  return {
    sessionKind: "unmanaged",
    kind: "unmanaged",
    memberName: null,
    capsule: null,
    appDataDir,
    cacheDir,
    injectedMap,
  };
}

function resolveRealTargetPath(targetPath, baseDir, depth = 0) {
  if (depth > 16) return null;
  const absTarget = resolve(baseDir, targetPath);
  const tailParts = [];
  let current = absTarget;

  while (true) {
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) {
        try {
          const resolvedReal = realpathSync(current);
          return tailParts.length > 0 ? join(resolvedReal, ...tailParts) : resolvedReal;
        } catch {
          const linkTarget = readlinkSync(current);
          const nextTarget = resolve(dirname(current), linkTarget);
          const combined = tailParts.length > 0 ? join(nextTarget, ...tailParts) : nextTarget;
          return resolveRealTargetPath(combined, dirname(current), depth + 1);
        }
      }
      const resolvedReal = realpathSync(current);
      return tailParts.length > 0 ? join(resolvedReal, ...tailParts) : resolvedReal;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return absTarget;
      }
      tailParts.unshift(basename(current));
      current = parent;
    }
  }
}

function isStrictlyInside(targetPath, rootDir) {
  const rel = relative(rootDir, targetPath);
  return rel.length > 0 && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\") && !isAbsolute(rel);
}

function isInsideOrEqual(targetPath, rootDir) {
  return targetPath === rootDir || isStrictlyInside(targetPath, rootDir);
}

function getCanonicalTempRoots(env) {
  const roots = new Set(["/tmp", "/private/tmp"]);
  for (const candidate of ["/tmp", "/private/tmp", env.TMPDIR, tmpdir()]) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    try {
      roots.add(realpathSync(candidate));
    } catch {
      roots.add(resolve(candidate));
    }
  }
  return [...roots];
}

function getSandboxContainerInTemp(realCwd, canonicalTempRoots) {
  if (!realCwd) return null;
  for (const tempRoot of canonicalTempRoots) {
    if (!isStrictlyInside(realCwd, tempRoot)) continue;
    const rel = relative(tempRoot, realCwd);
    const parts = rel.split(/[\\/]/).filter(Boolean);
    if (parts.length >= 2) {
      return join(tempRoot, parts[0]);
    }
  }
  return null;
}

function isInsideCanonicalTempRoots(realTarget, canonicalTempRoots, realCwd, options = {}) {
  const { allowRootEqual = false, excludeRealCwd = false } = options;
  if (!realTarget) return false;
  if (excludeRealCwd && realCwd && isInsideOrEqual(realTarget, realCwd)) {
    return false;
  }
  const sandboxContainer = getSandboxContainerInTemp(realCwd, canonicalTempRoots);
  if (sandboxContainer && isInsideOrEqual(realTarget, sandboxContainer)) {
    const sandboxTmp = join(sandboxContainer, "tmp");
    if (!isInsideOrEqual(realTarget, sandboxTmp)) {
      return false;
    }
  }
  return canonicalTempRoots.some((root) =>
    allowRootEqual ? isInsideOrEqual(realTarget, root) : isStrictlyInside(realTarget, root),
  );
}

function replaceSafeRuntimeTokens(input) {
  return input
    .replace(/\$\{\$\}|\$\$/g, "0")
    .replace(/\$\{(?:PPID|RANDOM|BASHPID)\}|\$(?:PPID|RANDOM|BASHPID)(?![A-Za-z0-9_])/g, "0")
    .replace(
      /\$\(\s*date\s+(?:-u\s+)?(?:\+[A-Za-z0-9_%:.-]+|"\+[A-Za-z0-9_%:.-]+"|'\+[A-Za-z0-9_%:.-]+')\s*\)/g,
      "0",
    )
    .replace(/\$\(\s*uuidgen\s*\)/g, "0");
}

function findMatchingBrace(str, openBraceIdx) {
  let depth = 1;
  let i = openBraceIdx + 1;
  let inSingle = false;
  let inDouble = false;
  while (i < str.length && depth > 0) {
    const ch = str[i];
    if (ch === "\\" && !inSingle) {
      i += 2;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      i += 1;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      i += 1;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    i += 1;
  }
  return -1;
}

function expandShellVarsOnce(input, envState) {
  let out = "";
  let changed = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (ch === "\\" && i + 1 < input.length && (input[i + 1] === "$" || input[i + 1] === "`" || input[i + 1] === "~")) {
      out += input.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch !== "$") {
      out += ch;
      i += 1;
      continue;
    }

    if (input[i + 1] === "{") {
      const closeIdx = findMatchingBrace(input, i + 1);
      if (closeIdx < 0) return { ok: false, value: "", changed: false };
      const body = input.slice(i + 2, closeIdx);
      const paramMatch = body.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-=])([\s\S]*))?$/);
      if (!paramMatch) return { ok: false, value: "", changed: false };
      const [, varName, op, fallbackVal = ""] = paramMatch;
      const rawVal = typeof envState[varName] === "string" ? envState[varName] : undefined;

      if (!op) {
        if (rawVal === undefined) return { ok: false, value: "", changed: false };
        out += rawVal;
      } else if (op === ":-" || op === ":=") {
        const chosen = rawVal !== undefined && rawVal.length > 0 ? rawVal : fallbackVal;
        if (op === ":=" && (rawVal === undefined || rawVal.length === 0)) {
          envState[varName] = chosen;
        }
        out += chosen;
      } else {
        const chosen = rawVal !== undefined ? rawVal : fallbackVal;
        if (op === "=" && rawVal === undefined) {
          envState[varName] = chosen;
        }
        out += chosen;
      }
      changed = true;
      i = closeIdx + 1;
      continue;
    }

    const bareMatch = input.slice(i + 1).match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    if (bareMatch) {
      const varName = bareMatch[1];
      const rawVal = typeof envState[varName] === "string" ? envState[varName] : undefined;
      if (rawVal === undefined) return { ok: false, value: "", changed: false };
      out += rawVal;
      changed = true;
      i += 1 + varName.length;
      continue;
    }

    out += ch;
    i += 1;
  }

  return { ok: true, value: out, changed };
}

function resolveShellTargetPath(rawToken, baseDir, mergedEnv = {}, options = {}) {
  const { requireAbsoluteAfterExpand = false } = options;
  if (typeof rawToken !== "string" || rawToken.length === 0) return null;
  if (rawToken === "/dev/null") return "/dev/null";

  const envState = mergedEnv && typeof mergedEnv === "object" ? { ...mergedEnv } : {};
  let expanded = rawToken;
  if (expanded.startsWith("\\~")) {
    expanded = expanded.slice(1);
  } else if (expanded === "~" || expanded.startsWith("~/")) {
    const home = envState.HOME || homedir();
    expanded = expanded === "~" ? home : join(home, expanded.slice(2));
  } else if (expanded.startsWith("~")) {
    return null;
  }

  for (let pass = 0; pass < 4; pass += 1) {
    expanded = replaceSafeRuntimeTokens(expanded);
    if (!expanded.includes("$")) break;
    const step = expandShellVarsOnce(expanded, envState);
    if (!step.ok) return null;
    expanded = step.value;
    if (!step.changed) break;
  }
  expanded = replaceSafeRuntimeTokens(expanded);

  if (!expanded || /[$`]/.test(expanded)) {
    return null;
  }
  if (requireAbsoluteAfterExpand && !isAbsolute(expanded)) {
    return null;
  }

  return resolveRealTargetPath(expanded, baseDir);
}

function preprocessHeredocs(command) {
  const lines = command.split("\n");
  const keptLines = [];
  const unquotedBodies = [];
  let lineIdx = 0;

  while (lineIdx < lines.length) {
    const line = lines[lineIdx];
    keptLines.push(line);
    const pendingHeredocs = [];
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === "\\" && !inSingle) {
        i += 1;
        continue;
      }
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        continue;
      }
      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        continue;
      }
      if (!inSingle && !inDouble && ch === "#" && (i === 0 || " \t;|(&".includes(line[i - 1]))) {
        break;
      }
      if (!inSingle && !inDouble && ch === "<" && line[i + 1] === "<" && line[i + 2] !== "<") {
        let j = i + 2;
        const stripTabs = line[j] === "-";
        if (stripTabs) j += 1;
        while (j < line.length && (line[j] === " " || line[j] === "\t")) j += 1;
        let delim = "";
        let quotedDelim = false;
        let delimSingle = false;
        let delimDouble = false;
        while (j < line.length) {
          const c = line[j];
          if (!delimSingle && !delimDouble && " \t;|()&<>".includes(c)) break;
          if (c === "\\" && !delimSingle) {
            quotedDelim = true;
            if (j + 1 < line.length) delim += line[j + 1];
            j += 2;
            continue;
          }
          if (c === "'" && !delimDouble) {
            quotedDelim = true;
            delimSingle = !delimSingle;
            j += 1;
            continue;
          }
          if (c === '"' && !delimSingle) {
            quotedDelim = true;
            delimDouble = !delimDouble;
            j += 1;
            continue;
          }
          delim += c;
          j += 1;
        }
        if (delim.length > 0) {
          pendingHeredocs.push({ delim, stripTabs, quotedDelim });
        }
        i = j - 1;
      }
    }

    lineIdx += 1;
    for (const h of pendingHeredocs) {
      const bodyLines = [];
      while (lineIdx < lines.length) {
        const rawBodyLine = lines[lineIdx];
        const cmpLine = h.stripTabs ? rawBodyLine.replace(/^\t+/, "") : rawBodyLine;
        lineIdx += 1;
        if (cmpLine === h.delim) break;
        bodyLines.push(rawBodyLine);
      }
      if (!h.quotedDelim && bodyLines.length > 0) {
        unquotedBodies.push(bodyLines.join("\n"));
      }
    }
  }

  return {
    strippedCommand: keptLines.join("\n"),
    unquotedBodies,
  };
}

function scanBalancedDollarSub(str, dollarIdx) {
  let depth = 1;
  let j = dollarIdx + 2;
  let subSingle = false;
  let subDouble = false;
  while (j < str.length && depth > 0) {
    const c = str[j];
    if (c === "\\" && !subSingle) {
      j += 2;
      continue;
    }
    if (c === "'" && !subDouble) subSingle = !subSingle;
    else if (c === '"' && !subSingle) subDouble = !subDouble;
    else if (!subSingle && !subDouble) {
      if (c === "(") depth += 1;
      else if (c === ")") depth -= 1;
    }
    j += 1;
  }
  return depth === 0 ? j : -1;
}

function extractCommandSubstitutions(command) {
  const subs = [];
  let i = 0;
  let inSingle = false;
  let inDouble = false;

  while (i < command.length) {
    const ch = command[i];
    if (ch === "\\" && !inSingle) {
      i += 2;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      i += 1;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      i += 1;
      continue;
    }
    if (!inSingle && ch === "$" && command[i + 1] === "(") {
      const endIdx = scanBalancedDollarSub(command, i);
      if (endIdx > 0) {
        subs.push(command.slice(i + 2, endIdx - 1));
        i = endIdx;
        continue;
      }
    }
    if (!inSingle && ch === "`") {
      let j = i + 1;
      while (j < command.length) {
        if (command[j] === "\\") {
          j += 2;
          continue;
        }
        if (command[j] === "`") break;
        j += 1;
      }
      if (j < command.length) {
        subs.push(command.slice(i + 1, j));
        i = j + 1;
        continue;
      }
    }
    i += 1;
  }
  return subs;
}

function readNextShellToken(str, startIdx, options = {}) {
  const { preserveLiteralEscapes = false } = options;
  let i = startIdx;
  while (i < str.length && (str[i] === " " || str[i] === "\t")) {
    i += 1;
  }
  if (i >= str.length) return { token: "", nextIdx: i };
  let token = "";
  let inSingle = false;
  let inDouble = false;
  let sawAnyChar = false;

  while (i < str.length) {
    const ch = str[i];
    if (!inSingle && !inDouble && " \t\r\n|&;()<>".includes(ch)) {
      break;
    }
    if (!inSingle && ch === "$" && str[i + 1] === "(") {
      const endIdx = scanBalancedDollarSub(str, i);
      if (endIdx > 0) {
        token += str.slice(i, endIdx);
        sawAnyChar = true;
        i = endIdx;
        continue;
      }
    }
    if (!inSingle && ch === "$" && str[i + 1] === "{") {
      const closeIdx = findMatchingBrace(str, i + 1);
      if (closeIdx > 0) {
        token += str.slice(i, closeIdx + 1);
        sawAnyChar = true;
        i = closeIdx + 1;
        continue;
      }
    }
    if (!inSingle && ch === "`") {
      let j = i + 1;
      while (j < str.length) {
        if (str[j] === "\\") {
          j += 2;
          continue;
        }
        if (str[j] === "`") break;
        j += 1;
      }
      if (j < str.length) {
        token += str.slice(i, j + 1);
        sawAnyChar = true;
        i = j + 1;
        continue;
      }
    }
    if (ch === "\\" && !inSingle) {
      if (i + 1 < str.length) {
        const next = str[i + 1];
        if (preserveLiteralEscapes && (next === "$" || next === "`" || (!sawAnyChar && next === "~"))) {
          token += "\\" + next;
        } else {
          token += next;
        }
      }
      sawAnyChar = true;
      i += 2;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      if (preserveLiteralEscapes && !sawAnyChar && str[i + 1] === "~") {
        token += "\\~";
        sawAnyChar = true;
        i += 2;
        continue;
      }
      sawAnyChar = true;
      i += 1;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      if (preserveLiteralEscapes && !sawAnyChar && str[i + 1] === "~") {
        token += "\\~";
        sawAnyChar = true;
        i += 2;
        continue;
      }
      sawAnyChar = true;
      i += 1;
      continue;
    }
    if (preserveLiteralEscapes && inSingle && (ch === "$" || ch === "`")) {
      token += "\\" + ch;
      sawAnyChar = true;
      i += 1;
      continue;
    }
    token += ch;
    sawAnyChar = true;
    i += 1;
  }
  return { token, nextIdx: i };
}

function splitRawShellSegments(command) {
  const items = [];
  let start = 0;
  let inSingle = false;
  let inDouble = false;
  let atTokenBoundary = true;
  let connectorBefore = "";
  let i = 0;

  const pushSlice = (endIdx, connectorAfter = "") => {
    const sub = command.slice(start, endIdx);
    if (sub.trim().length > 0) {
      items.push({ type: "segment", text: sub, connectorBefore, connectorAfter });
    }
  };

  while (i < command.length) {
    const ch = command[i];
    if (ch === "\\" && !inSingle) {
      if (command[i + 1] !== "\n") atTokenBoundary = false;
      i += 2;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      atTokenBoundary = false;
      i += 1;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      atTokenBoundary = false;
      i += 1;
      continue;
    }
    if (!inSingle && ch === "$" && command[i + 1] === "(") {
      const endIdx = scanBalancedDollarSub(command, i);
      if (endIdx > 0) {
        atTokenBoundary = false;
        i = endIdx;
        continue;
      }
    }
    if (!inSingle && ch === "$" && command[i + 1] === "{") {
      const closeIdx = findMatchingBrace(command, i + 1);
      if (closeIdx > 0) {
        atTokenBoundary = false;
        i = closeIdx + 1;
        continue;
      }
    }
    if (!inSingle && ch === "`") {
      let j = i + 1;
      while (j < command.length) {
        if (command[j] === "\\") {
          j += 2;
          continue;
        }
        if (command[j] === "`") break;
        j += 1;
      }
      if (j < command.length) {
        atTokenBoundary = false;
        i = j + 1;
        continue;
      }
    }
    if (!inSingle && !inDouble) {
      if (ch === " " || ch === "\t" || ch === "\r") {
        atTokenBoundary = true;
        i += 1;
        continue;
      }
      if (ch === "#" && atTokenBoundary) {
        while (i < command.length && command[i] !== "\n") i += 1;
        continue;
      }
      if (ch === "(" || ch === ")") {
        pushSlice(i, ch);
        items.push({ type: "paren", dir: ch });
        i += 1;
        start = i;
        connectorBefore = ch;
        atTokenBoundary = true;
        continue;
      }
      if (ch === "\n" || ch === ";") {
        pushSlice(i, ch);
        i += 1;
        start = i;
        connectorBefore = ch;
        atTokenBoundary = true;
        continue;
      }
      if (ch === "&" && command[i + 1] === ">") {
        const opLen = command[i + 2] === ">" ? 3 : 2;
        const { nextIdx } = readNextShellToken(command, i + opLen);
        i = nextIdx;
        atTokenBoundary = true;
        continue;
      }
      if (ch === ">" && command[i + 1] === "&") {
        const fdMatch = command.slice(i + 2).match(/^(?:\d+|-)(?=$|[\s|&;()<>])/);
        if (fdMatch) {
          i += 2 + fdMatch[0].length;
          atTokenBoundary = true;
          continue;
        }
        const { nextIdx } = readNextShellToken(command, i + 2);
        i = nextIdx;
        atTokenBoundary = true;
        continue;
      }
      if (ch === "<" && command[i + 1] === "&") {
        const fdMatch = command.slice(i + 2).match(/^(?:\d+|-)(?=$|[\s|&;()<>])/);
        if (fdMatch) {
          i += 2 + fdMatch[0].length;
          atTokenBoundary = true;
          continue;
        }
        const { nextIdx } = readNextShellToken(command, i + 2);
        i = nextIdx;
        atTokenBoundary = true;
        continue;
      }
      if (ch === "|" || ch === "&") {
        const op = command[i + 1] === ch ? ch + ch : ch;
        pushSlice(i, op);
        i += op.length;
        start = i;
        connectorBefore = op;
        atTokenBoundary = true;
        continue;
      }
    }
    atTokenBoundary = false;
    i += 1;
  }
  pushSlice(command.length, "");
  return items;
}

function extractOutputRedirectTargets(command, activeEnv = {}) {
  const targets = [];
  const envSnapshot = { ...activeEnv };
  let i = 0;
  let inSingle = false;
  let inDouble = false;

  while (i < command.length) {
    const ch = command[i];
    if (ch === "\\" && !inSingle) {
      i += 2;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      i += 1;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      i += 1;
      continue;
    }
    if (!inSingle && ch === "$" && command[i + 1] === "(") {
      const endIdx = scanBalancedDollarSub(command, i);
      if (endIdx > 0) {
        i = endIdx;
        continue;
      }
    }
    if (!inSingle && ch === "$" && command[i + 1] === "{") {
      const closeIdx = findMatchingBrace(command, i + 1);
      if (closeIdx > 0) {
        i = closeIdx + 1;
        continue;
      }
    }
    if (!inSingle && ch === "`") {
      let j = i + 1;
      while (j < command.length) {
        if (command[j] === "\\") {
          j += 2;
          continue;
        }
        if (command[j] === "`") break;
        j += 1;
      }
      if (j < command.length) {
        i = j + 1;
        continue;
      }
    }
    if (!inSingle && !inDouble && ch === "#" && (i === 0 || " \t\r\n;|(&".includes(command[i - 1]))) {
      while (i < command.length && command[i] !== "\n") i += 1;
      continue;
    }
    if (!inSingle && !inDouble && ch === "&" && command[i + 1] === ">") {
      const opLen = command[i + 2] === ">" ? 3 : 2;
      const { token, nextIdx } = readNextShellToken(command, i + opLen, { preserveLiteralEscapes: true });
      targets.push({ target: token, env: envSnapshot });
      i = nextIdx;
      continue;
    }
    if (!inSingle && !inDouble && ch === "<" && command[i + 1] === ">") {
      const { token, nextIdx } = readNextShellToken(command, i + 2, { preserveLiteralEscapes: true });
      targets.push({ target: token, env: envSnapshot });
      i = nextIdx;
      continue;
    }
    if (!inSingle && !inDouble && ch === ">") {
      if (command[i + 1] === "&") {
        const fdMatch = command.slice(i + 2).match(/^(?:\d+|-)(?=$|[\s|&;()<>])/);
        if (fdMatch) {
          i += 2 + fdMatch[0].length;
          continue;
        }
        const { token, nextIdx } = readNextShellToken(command, i + 2, { preserveLiteralEscapes: true });
        targets.push({ target: token, env: envSnapshot });
        i = nextIdx;
        continue;
      }
      const opLen = command[i + 1] === ">" || command[i + 1] === "|" ? 2 : 1;
      const { token, nextIdx } = readNextShellToken(command, i + opLen, { preserveLiteralEscapes: true });
      targets.push({ target: token, env: envSnapshot });
      i = nextIdx;
      continue;
    }
    i += 1;
  }
  return targets;
}

function tokenizeSingleSegment(segment) {
  const tokens = [];
  let token = "";
  let hasTokenChars = false;
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  const flushToken = () => {
    if (hasTokenChars) {
      tokens.push(token);
      token = "";
      hasTokenChars = false;
    }
  };

  while (i < segment.length) {
    const ch = segment[i];
    if (ch === "\\" && !inSingle) {
      if (i + 1 < segment.length && segment[i + 1] === "\n") {
        i += 2;
        continue;
      }
      hasTokenChars = true;
      if (i + 1 < segment.length) token += segment[i + 1];
      i += 2;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      hasTokenChars = true;
      i += 1;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      hasTokenChars = true;
      i += 1;
      continue;
    }
    if (!inSingle && ch === "$" && segment[i + 1] === "(") {
      const endIdx = scanBalancedDollarSub(segment, i);
      if (endIdx > 0) {
        hasTokenChars = true;
        token += segment.slice(i, endIdx);
        i = endIdx;
        continue;
      }
    }
    if (!inSingle && ch === "$" && segment[i + 1] === "{") {
      const closeIdx = findMatchingBrace(segment, i + 1);
      if (closeIdx > 0) {
        hasTokenChars = true;
        token += segment.slice(i, closeIdx + 1);
        i = closeIdx + 1;
        continue;
      }
    }
    if (!inSingle && ch === "`") {
      let j = i + 1;
      while (j < segment.length) {
        if (segment[j] === "\\") {
          j += 2;
          continue;
        }
        if (segment[j] === "`") break;
        j += 1;
      }
      if (j < segment.length) {
        hasTokenChars = true;
        token += segment.slice(i, j + 1);
        i = j + 1;
        continue;
      }
    }
    if (!inSingle && !inDouble) {
      if (ch === " " || ch === "\t" || ch === "\r") {
        flushToken();
        i += 1;
        continue;
      }
      if (ch === "#" && !hasTokenChars) {
        while (i < segment.length && segment[i] !== "\n") i += 1;
        continue;
      }
      if (ch === "&" && segment[i + 1] === ">") {
        flushToken();
        const opLen = segment[i + 2] === ">" ? 3 : 2;
        const { nextIdx } = readNextShellToken(segment, i + opLen);
        i = nextIdx;
        continue;
      }
      if (ch === ">" || ch === "<") {
        if (hasTokenChars && /^\d+$/.test(token)) {
          token = "";
          hasTokenChars = false;
        } else {
          flushToken();
        }
        if (ch === "<" && segment[i + 1] === "<" && segment[i + 2] === "<") {
          const { nextIdx } = readNextShellToken(segment, i + 3);
          i = nextIdx;
          continue;
        }
        if (ch === "<" && segment[i + 1] === "<") {
          const opLen = segment[i + 2] === "-" ? 3 : 2;
          const { nextIdx } = readNextShellToken(segment, i + opLen);
          i = nextIdx;
          continue;
        }
        if ((ch === ">" || ch === "<") && segment[i + 1] === "&") {
          const fdMatch = segment.slice(i + 2).match(/^(?:\d+|-)/);
          if (fdMatch) {
            i += 2 + fdMatch[0].length;
            continue;
          }
          const { nextIdx } = readNextShellToken(segment, i + 2);
          i = nextIdx;
          continue;
        }
        const opLen =
          segment[i + 1] === ch || segment[i + 1] === "|" || segment[i + 1] === "&" || segment[i + 1] === ">"
            ? 2
            : 1;
        const { nextIdx } = readNextShellToken(segment, i + opLen);
        i = nextIdx;
        continue;
      }
    }
    hasTokenChars = true;
    token += ch;
    i += 1;
  }

  flushToken();
  return tokens;
}

function assignEnvVar(envObj, outerEnv, key, rawVal) {
  const priorVal =
    typeof envObj[key] === "string"
      ? envObj[key]
      : outerEnv && typeof outerEnv[key] === "string"
        ? outerEnv[key]
        : undefined;
  if (priorVal !== undefined && rawVal.includes("$")) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const selfExpanded = rawVal
      .replace(new RegExp(`\\$\\{${escapedKey}\\}`, "g"), priorVal)
      .replace(new RegExp(`\\$${escapedKey}(?![A-Za-z0-9_])`, "g"), priorVal);
    envObj[key] = selfExpanded;
    return;
  }
  envObj[key] = rawVal;
}

const SHELL_KEYWORD_PREFIXES = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "while",
  "until",
  "do",
  "done",
  "esac",
  "{",
  "}",
  "!",
]);

const READ_VALUE_FLAGS = new Set(["-p", "-t", "-n", "-N", "-d", "-u", "-i", "-a"]);

function unwrapCommandSegment(tokens, inheritedEnv = {}, outerEnv = {}) {
  const env = { ...inheritedEnv };
  const assignedKeys = [];
  const taintedVars = [];
  let idx = 0;

  while (idx < tokens.length) {
    const tok = tokens[idx];
    if (SHELL_KEYWORD_PREFIXES.has(tok)) {
      idx += 1;
      continue;
    }
    if ((tok === "for" || tok === "select") && idx === 0) {
      if (idx + 1 < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*$/.test(tokens[idx + 1])) {
        taintedVars.push(tokens[idx + 1]);
      }
      return { cmd: "", rawCmd: "", args: [], env, assignedKeys, taintedVars };
    }
    if (tok === "case" && idx === 0) {
      return { cmd: "", rawCmd: "", args: [], env, assignedKeys, taintedVars };
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
      const eq = tok.indexOf("=");
      const key = tok.slice(0, eq);
      assignEnvVar(env, outerEnv, key, tok.slice(eq + 1));
      assignedKeys.push(key);
      idx += 1;
      continue;
    }
    const base = basename(tok);
    if (
      (base === "export" || base === "local" || base === "readonly" || base === "declare" || base === "typeset") &&
      tok === base
    ) {
      for (let j = idx + 1; j < tokens.length; j += 1) {
        const arg = tokens[j];
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) {
          const eq = arg.indexOf("=");
          const key = arg.slice(0, eq);
          assignEnvVar(env, outerEnv, key, arg.slice(eq + 1));
          assignedKeys.push(key);
        }
      }
      return { cmd: "export", rawCmd: tok, args: tokens.slice(idx + 1), env, assignedKeys, taintedVars };
    }
    if (base === "unset" && tok === "unset") {
      for (let j = idx + 1; j < tokens.length; j += 1) {
        const arg = tokens[j];
        if (!arg.startsWith("-")) delete env[arg];
      }
      return { cmd: "unset", rawCmd: tok, args: tokens.slice(idx + 1), env, assignedKeys, taintedVars };
    }
    if (base === "read" && tok === "read") {
      for (let j = idx + 1; j < tokens.length; j += 1) {
        const arg = tokens[j];
        if (arg.startsWith("-") && arg.length > 1) {
          if (READ_VALUE_FLAGS.has(arg)) j += 1;
          continue;
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(arg)) {
          taintedVars.push(arg);
        }
      }
      return { cmd: "read", rawCmd: tok, args: tokens.slice(idx + 1), env, assignedKeys, taintedVars };
    }
    if (base === "env") {
      idx += 1;
      while (idx < tokens.length) {
        const envArg = tokens[idx];
        if (envArg === "-i" || envArg === "-") {
          idx += 1;
          continue;
        }
        if (envArg === "-u") {
          if (idx + 1 < tokens.length) delete env[tokens[idx + 1]];
          idx += 2;
          continue;
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(envArg)) {
          const eq = envArg.indexOf("=");
          assignEnvVar(env, outerEnv, envArg.slice(0, eq), envArg.slice(eq + 1));
          idx += 1;
          continue;
        }
        break;
      }
      continue;
    }
    if (base === "command" || base === "builtin" || base === "nohup" || base === "time") {
      idx += 1;
      while (idx < tokens.length && tokens[idx].startsWith("-") && tokens[idx] !== "--") {
        idx += 1;
      }
      if (tokens[idx] === "--") idx += 1;
      continue;
    }
    if (base === "sudo") {
      idx += 1;
      while (idx < tokens.length && tokens[idx].startsWith("-")) {
        const flag = tokens[idx];
        idx += 1;
        if (flag === "-u" || flag === "-g" || flag === "-C" || flag === "-h" || flag === "-p") {
          idx += 1;
        }
      }
      continue;
    }
    if (base === "xargs") {
      idx += 1;
      while (idx < tokens.length && tokens[idx].startsWith("-")) {
        const flag = tokens[idx];
        idx += 1;
        if (["-I", "-L", "-n", "-P", "-s", "-d", "-E", "-a"].includes(flag)) {
          idx += 1;
        }
      }
      continue;
    }
    break;
  }

  if (idx >= tokens.length) {
    return { cmd: "", rawCmd: "", args: [], env, assignedKeys, taintedVars };
  }
  return {
    cmd: basename(tokens[idx]),
    rawCmd: tokens[idx],
    args: tokens.slice(idx + 1),
    env,
    assignedKeys,
    taintedVars,
  };
}

function replaceObjectKeys(target, source) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, source);
}

function collectInvocations(command, depth = 0, inheritedEnv = {}, outerEnv = {}) {
  if (depth > 8 || !command) return { invocations: [], redirectTargets: [] };
  const { strippedCommand, unquotedBodies } = preprocessHeredocs(command);
  const redirectTargets = [];
  const invocations = [];
  const scriptEnv = { ...inheritedEnv };
  const envStack = [];

  const rawItems = splitRawShellSegments(strippedCommand);
  for (const item of rawItems) {
    if (item.type === "paren") {
      if (item.dir === "(") {
        envStack.push({ ...scriptEnv });
      } else if (envStack.length > 0) {
        replaceObjectKeys(scriptEnv, envStack.pop());
      }
      continue;
    }

    const rawSeg = item.text;
    const isPipelineStage = item.connectorBefore === "|" || item.connectorAfter === "|";
    const isConditional = item.connectorBefore === "&&" || item.connectorBefore === "||";
    const tokens = tokenizeSingleSegment(rawSeg);
    const parsed = unwrapCommandSegment(tokens, scriptEnv, outerEnv);

    for (const sub of extractCommandSubstitutions(rawSeg)) {
      const subRes = collectInvocations(sub, depth + 1, parsed.env, outerEnv);
      redirectTargets.push(...subRes.redirectTargets);
      invocations.push(...subRes.invocations);
    }

    redirectTargets.push(...extractOutputRedirectTargets(rawSeg, parsed.env));

    for (const tv of parsed.taintedVars) {
      if (!isPipelineStage) {
        parsed.env[tv] = "$__TAINTED__";
        scriptEnv[tv] = "$__TAINTED__";
      }
    }

    if (!parsed.cmd) {
      if (!isPipelineStage) {
        if (isConditional) {
          for (const key of parsed.assignedKeys) {
            scriptEnv[key] = "$__TAINTED__";
          }
        } else {
          Object.assign(scriptEnv, parsed.env);
        }
      }
      continue;
    }
    if (parsed.cmd === "export" || parsed.cmd === "unset" || parsed.cmd === "read") {
      if (!isPipelineStage) {
        if (isConditional) {
          for (const key of parsed.assignedKeys) {
            scriptEnv[key] = "$__TAINTED__";
          }
        } else {
          replaceObjectKeys(scriptEnv, parsed.env);
        }
      }
      continue;
    }
    invocations.push(parsed);

    if (["sh", "bash", "zsh", "dash", "ksh"].includes(parsed.cmd)) {
      for (let i = 0; i < parsed.args.length; i += 1) {
        const arg = parsed.args[i];
        if (arg === "--") break;
        if (/^-[a-zA-Z]*c$/.test(arg) && i + 1 < parsed.args.length) {
          const inner = collectInvocations(parsed.args[i + 1], depth + 1, parsed.env, outerEnv);
          redirectTargets.push(...inner.redirectTargets);
          invocations.push(...inner.invocations);
          break;
        }
      }
    } else if (parsed.cmd === "eval" && parsed.args.length > 0) {
      const inner = collectInvocations(parsed.args.join(" "), depth + 1, parsed.env, outerEnv);
      redirectTargets.push(...inner.redirectTargets);
      invocations.push(...inner.invocations);
    }
  }

  for (const body of unquotedBodies) {
    for (const sub of extractCommandSubstitutions(body)) {
      const subRes = collectInvocations(sub, depth + 1, scriptEnv, outerEnv);
      redirectTargets.push(...subRes.redirectTargets);
      invocations.push(...subRes.invocations);
    }
  }

  return { invocations, redirectTargets };
}

function extractPositionalPaths(args) {
  const paths = [];
  let afterDoubleDash = false;
  for (const arg of args) {
    if (!afterDoubleDash && arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && arg.startsWith("-") && arg.length > 1) {
      continue;
    }
    paths.push(arg);
  }
  return paths;
}

function extractChmodTargets(args) {
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--") {
      i += 1;
      break;
    }
    if (arg === "--reference") {
      i += 2;
      continue;
    }
    if (arg.startsWith("--reference=")) {
      return args.slice(i + 1).filter((a) => a !== "--");
    }
    if (
      ["-R", "-v", "-c", "-f", "-h", "-H", "-L", "-P", "--recursive", "--changes", "--silent", "--quiet", "--verbose"].includes(
        arg,
      ) ||
      /^-[RvcfhHLP]+$/.test(arg)
    ) {
      i += 1;
      continue;
    }
    break;
  }
  if (i >= args.length) return [];
  return args.slice(i + 1).filter((a) => a !== "--");
}

function extractCpOrMvSpec(args) {
  let targetDir = null;
  const positionals = [];
  let afterDoubleDash = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!afterDoubleDash && arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && arg.startsWith("-") && arg.length > 1) {
      if (arg === "-t" || arg === "--target-directory") {
        if (i + 1 >= args.length) return { valid: false, sources: [], destinations: [] };
        targetDir = args[i + 1];
        i += 1;
        continue;
      }
      if (arg.startsWith("--target-directory=")) {
        targetDir = arg.slice("--target-directory=".length);
        continue;
      }
      if (arg.startsWith("-t") && arg.length > 2) {
        targetDir = arg.slice(2);
        continue;
      }
      if (arg === "-S" || arg === "--suffix") {
        i += 1;
        continue;
      }
      continue;
    }
    positionals.push(arg);
  }

  if (targetDir !== null) {
    if (positionals.length === 0) return { valid: false, sources: [], destinations: [] };
    return { valid: true, sources: positionals, destinations: [targetDir] };
  }
  if (positionals.length < 2) {
    return { valid: false, sources: [], destinations: [] };
  }
  return {
    valid: true,
    sources: positionals.slice(0, -1),
    destinations: [positionals[positionals.length - 1]],
  };
}

function extractLnSpec(args) {
  let isSymbolic = false;
  let targetDir = null;
  const positionals = [];
  let afterDoubleDash = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!afterDoubleDash && arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && arg.startsWith("-") && arg.length > 1) {
      if (arg === "--symbolic" || (!arg.startsWith("--") && /^-[a-zA-Z]*s/.test(arg))) {
        isSymbolic = true;
      }
      if (arg === "-t" || arg === "--target-directory") {
        if (i + 1 >= args.length) return { valid: false, isSymbolic, sources: [], linkPaths: [] };
        targetDir = args[i + 1];
        i += 1;
        continue;
      }
      if (arg.startsWith("--target-directory=")) {
        targetDir = arg.slice("--target-directory=".length);
        continue;
      }
      if (arg === "-S" || arg === "--suffix") {
        i += 1;
        continue;
      }
      continue;
    }
    positionals.push(arg);
  }

  if (targetDir !== null) {
    if (positionals.length === 0) return { valid: false, isSymbolic, sources: [], linkPaths: [] };
    return { valid: true, isSymbolic, sources: positionals, linkPaths: [targetDir], linkIsDir: true };
  }
  if (positionals.length === 1) {
    return { valid: true, isSymbolic, sources: [positionals[0]], linkPaths: ["."], linkIsDir: true };
  }
  if (positionals.length >= 2) {
    return {
      valid: true,
      isSymbolic,
      sources: positionals.slice(0, -1),
      linkPaths: [positionals[positionals.length - 1]],
      linkIsDir: positionals.length > 2,
    };
  }
  return { valid: false, isSymbolic, sources: [], linkPaths: [], linkIsDir: false };
}

function extractPatchTargets(args) {
  const dirTargets = [];
  const fileTargets = [];
  const positionals = [];
  let afterDoubleDash = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!afterDoubleDash && arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && arg.startsWith("-") && arg.length > 1) {
      if (arg === "-d" || arg === "--directory") {
        if (i + 1 >= args.length) return { valid: false, dirTargets: [], fileTargets: [] };
        dirTargets.push(args[i + 1]);
        i += 1;
        continue;
      }
      if (arg.startsWith("--directory=")) {
        dirTargets.push(arg.slice("--directory=".length));
        continue;
      }
      if (arg.startsWith("-d") && arg.length > 2) {
        dirTargets.push(arg.slice(2));
        continue;
      }
      if (arg === "-o" || arg === "--output" || arg === "-r" || arg === "--reject-file") {
        if (i + 1 >= args.length) return { valid: false, dirTargets: [], fileTargets: [] };
        fileTargets.push(args[i + 1]);
        i += 1;
        continue;
      }
      if (arg.startsWith("--output=")) {
        fileTargets.push(arg.slice("--output=".length));
        continue;
      }
      if (arg.startsWith("--reject-file=")) {
        fileTargets.push(arg.slice("--reject-file=".length));
        continue;
      }
      if (
        ["-i", "--input", "-p", "--strip", "-F", "--fuzz", "-V", "--version-control", "-B", "--prefix", "-Y", "--basename-prefix", "-z", "--suffix", "-D", "--ifdef", "-g", "--get"].includes(
          arg,
        )
      ) {
        i += 1;
        continue;
      }
      continue;
    }
    positionals.push(arg);
  }

  if (positionals.length >= 1) {
    fileTargets.push(positionals[0]);
  }
  return { valid: true, dirTargets, fileTargets };
}

function extractSedInPlaceTargets(args) {
  let hasInPlace = false;
  let hasExplicitScript = false;
  let afterDoubleDash = false;
  const positionals = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!afterDoubleDash && arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash) {
      if (arg === "-e" || arg === "--expression" || arg === "-f" || arg === "--file") {
        hasExplicitScript = true;
        i += 1;
        continue;
      }
      if (
        (arg.startsWith("-e") && arg.length > 2) ||
        arg.startsWith("--expression=") ||
        (arg.startsWith("-f") && arg.length > 2) ||
        arg.startsWith("--file=")
      ) {
        hasExplicitScript = true;
        continue;
      }
      if (arg === "-i") {
        hasInPlace = true;
        if (i + 1 < args.length && (args[i + 1] === "" || args[i + 1].startsWith("."))) {
          i += 1;
        }
        continue;
      }
      if (arg === "--in-place" || arg.startsWith("--in-place=") || (!arg.startsWith("--") && /^-[a-zA-Z]*i/.test(arg))) {
        hasInPlace = true;
        if (!arg.startsWith("--") && arg.endsWith("i") && i + 1 < args.length && args[i + 1] === "") {
          i += 1;
        }
        continue;
      }
      if (arg.startsWith("-") && arg.length > 1) {
        continue;
      }
    }
    positionals.push(arg);
  }

  if (!hasInPlace) return null;
  return hasExplicitScript ? positionals : positionals.slice(1);
}

function extractPerlRubyInPlaceTargets(args) {
  let hasInPlace = false;
  let hasInlineScript = false;
  let afterDoubleDash = false;
  const positionals = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!afterDoubleDash && arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && arg.startsWith("-") && arg.length > 1) {
      if (!arg.startsWith("--") && /^-[a-zA-Z]*i/.test(arg)) {
        hasInPlace = true;
      }
      if (arg === "-e" || arg === "-E" || (!arg.startsWith("--") && /^-[a-zA-Z.]*[eE]$/.test(arg))) {
        hasInlineScript = true;
        i += 1;
        continue;
      }
      continue;
    }
    positionals.push(arg);
  }

  if (!hasInPlace) return null;
  return hasInlineScript ? positionals : positionals.slice(1);
}

function parseCallArguments(code, openParenIdx) {
  const args = [];
  let current = "";
  let depth = 1;
  let i = openParenIdx + 1;
  let quote = null;

  while (i < code.length && depth > 0) {
    const ch = code[i];
    if (quote) {
      current += ch;
      if (ch === "\\" && i + 1 < code.length) {
        current += code[i + 1];
        i += 2;
        continue;
      }
      if (quote.length === 3) {
        if (code.slice(i, i + 3) === quote) {
          current += code.slice(i + 1, i + 3);
          quote = null;
          i += 3;
          continue;
        }
      } else if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }

    if (code.slice(i, i + 3) === "'''" || code.slice(i, i + 3) === '"""') {
      quote = code.slice(i, i + 3);
      current += quote;
      i += 3;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) break;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === "," && depth === 1) {
      args.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }

  if (depth !== 0) return null;
  if (current.trim().length > 0 || args.length > 0) {
    args.push(current.trim());
  }
  return args;
}

function unescapeSimpleLiteral(inner, isRaw = false) {
  if (isRaw) return inner;
  let out = "";
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === "\\" && i + 1 < inner.length) {
      const next = inner[i + 1];
      if (next === "n") out += "\n";
      else if (next === "r") out += "\r";
      else if (next === "t") out += "\t";
      else out += next;
      i += 1;
      continue;
    }
    out += inner[i];
  }
  return out;
}

function parseStaticJsString(expr) {
  if (typeof expr !== "string") return { ok: false, value: "" };
  const trimmed = expr.trim();
  if (trimmed.length < 2) return { ok: false, value: "" };
  const q = trimmed[0];
  if (q !== "'" && q !== '"' && q !== "`") return { ok: false, value: "" };
  if (trimmed[trimmed.length - 1] !== q) return { ok: false, value: "" };
  const inner = trimmed.slice(1, -1);
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === "\\") {
      i += 1;
      continue;
    }
    if (inner[i] === q) return { ok: false, value: "" };
    if (q === "`" && inner[i] === "$" && inner[i + 1] === "{") {
      return { ok: false, value: "" };
    }
  }
  return { ok: true, value: unescapeSimpleLiteral(inner, false) };
}

function parseStaticPyString(expr) {
  if (typeof expr !== "string") return { ok: false, value: "" };
  let trimmed = expr.trim();
  let isRaw = false;
  let isFormat = false;
  const prefixMatch = trimmed.match(/^([rRbBuUfF]{1,2})(?=['"])/);
  if (prefixMatch) {
    const p = prefixMatch[1].toLowerCase();
    isRaw = p.includes("r");
    isFormat = p.includes("f");
    trimmed = trimmed.slice(prefixMatch[1].length);
  }
  let quote = "";
  if (trimmed.startsWith("'''") && trimmed.endsWith("'''") && trimmed.length >= 6) {
    quote = "'''";
  } else if (trimmed.startsWith('"""') && trimmed.endsWith('"""') && trimmed.length >= 6) {
    quote = '"""';
  } else if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    if (trimmed.length >= 2) quote = trimmed[0];
  }
  if (!quote) return { ok: false, value: "" };
  const inner = trimmed.slice(quote.length, trimmed.length - quote.length);
  if (isFormat && /[{}]/.test(inner)) return { ok: false, value: "" };
  if (quote.length === 1) {
    for (let i = 0; i < inner.length; i += 1) {
      if (inner[i] === "\\") {
        i += 1;
        continue;
      }
      if (inner[i] === quote) return { ok: false, value: "" };
    }
  }
  return { ok: true, value: unescapeSimpleLiteral(inner, isRaw) };
}

const JS_NON_MEMBER_PREFIX_KEYWORDS = new Set([
  "return",
  "typeof",
  "await",
  "yield",
  "throw",
  "delete",
  "void",
  "case",
  "in",
  "of",
  "else",
  "new",
]);

const NODE_MUTATION_NAME_RE =
  /\b(?:writeFileSync|writeFile|appendFileSync|appendFile|unlinkSync|unlink|rmSync|rm|rmdirSync|rmdir|renameSync|rename|copyFileSync|copyFile|cpSync|cp|mkdirSync|mkdir|mkdtempSync|mkdtemp|chmodSync|chmod|chownSync|chown|truncateSync|truncate|symlinkSync|symlink|linkSync|link|createWriteStream|openSync)\b/;

const PYTHON_MUTATION_NAME_RE =
  /\b(?:remove|unlink|rmdir|removedirs|mkdir|makedirs|chmod|chown|truncate|rename|renames|replace|rmtree|move|copy|copy2|copyfile|copytree|symlink|link|write_text|write_bytes|touch|lchmod|symlink_to|hardlink_to)\b/;

function isVarBoundToVerifiedTmpRoot(varName, code) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) return false;
  const varEsc = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const assignRe = new RegExp(
    `(?:^|[\\n;])\\s*(?:(?:const|let|var)\\s+)?${varEsc}\\s*=\\s*([^\\n;]+)`,
    "g",
  );
  let lastRhs = null;
  let m;
  while ((m = assignRe.exec(code)) !== null) {
    lastRhs = m[1].trim();
  }
  if (!lastRhs || lastRhs.includes("..")) return false;
  return /^(?:[fFrRuUbB]{0,2}['"`](?:\/private)?\/tmp(?:\/|['"`\b])|[^\n;]*(?:mkdtemp|mkdtempSync|gettempdir|tmpdir)\s*\(|os\.environ\.get\(\s*['"]TMPDIR['"])/.test(
    lastRhs,
  );
}

function isSafeTmpTemplateOrJoin(expr, code, allowPath) {
  if (!allowPath("/tmp/__pstack_probe__", { allowRootEqual: false, allowDevNull: false })) {
    return false;
  }
  const trimmed = expr.trim();
  if (trimmed.includes("..")) return false;
  if (/^`(?:\/private)?\/tmp\/[^`]+`$/.test(trimmed)) {
    return true;
  }
  const jsVarTemplate = trimmed.match(/^`\$\{([A-Za-z_][A-Za-z0-9_]*)\}(?:\/[^`]*)?`$/);
  if (jsVarTemplate && isVarBoundToVerifiedTmpRoot(jsVarTemplate[1], code)) {
    return true;
  }
  if (
    /^[fF](?:'''[\s\S]*'''|"""[\s\S]*"""|'[^']*'|"[^"]*")$/.test(trimmed) &&
    /^[fF]['"]{1,3}(?:\/private)?\/tmp\//.test(trimmed)
  ) {
    return true;
  }
  const pyVarTemplate = trimmed.match(/^[fF](?:'''|"""|'|\")\{([A-Za-z_][A-Za-z0-9_]*)\}(?:\/[^'"]*)?(?:'''|"""|'|\")$/);
  if (pyVarTemplate && isVarBoundToVerifiedTmpRoot(pyVarTemplate[1], code)) {
    return true;
  }
  const joinMatch = trimmed.match(/^(?:path\s*\.\s*join|os\s*\.\s*path\s*\.\s*join|join)\s*\(([\s\S]*)\)$/);
  if (joinMatch) {
    const innerArgs = parseCallArguments(`(${joinMatch[1]})`, 0);
    if (innerArgs && innerArgs.length >= 1) {
      if (innerArgs.some((a) => a.includes(".."))) return false;
      const rootArg = innerArgs[0].trim();
      if (
        /^['"`](?:\/private)?\/tmp(?:\/|['"`]$)/.test(rootArg) ||
        /\b(?:mkdtemp|mkdtempSync|gettempdir|tmpdir)\s*\(/.test(rootArg)
      ) {
        return true;
      }
      if (isVarBoundToVerifiedTmpRoot(rootArg, code)) {
        return true;
      }
    }
  }
  return false;
}

function resolveSimpleVarBinding(code, expr, isPython) {
  const trimmed = expr.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) return null;
  const varEsc = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const assignRe = new RegExp(`(?:^|[\\n;])\\s*(?:(?:const|let|var)\\s+)?${varEsc}\\s*=\\s*([^\\n;]+)`, "g");
  let lastRhs = null;
  let m;
  while ((m = assignRe.exec(code)) !== null) {
    lastRhs = m[1].trim();
  }
  if (!lastRhs) return null;
  return isPython ? parseStaticPyString(lastRhs) : parseStaticJsString(lastRhs);
}

function resolveStaticArgValue(argExpr, code, isPython) {
  const lit = isPython ? parseStaticPyString(argExpr || "") : parseStaticJsString(argExpr || "");
  if (lit.ok) return lit.value;
  const bound = resolveSimpleVarBinding(code, argExpr || "", isPython);
  if (bound && bound.ok) return bound.value;
  return null;
}

function resolveStaticJoinOrTemplate(expr, code, isPython) {
  const trimmed = String(expr || "").trim();
  if (!trimmed || trimmed.includes("..")) return null;

  const joinMatch = trimmed.match(
    /^(?:path\s*\.\s*join|os\s*\.\s*path\s*\.\s*join|join)\s*\(([\s\S]*)\)$/,
  );
  if (joinMatch) {
    const innerArgs = parseCallArguments(`(${joinMatch[1]})`, 0);
    if (!innerArgs || innerArgs.length === 0) return null;
    const rootVal = resolveStaticArgValue(innerArgs[0], code, isPython);
    if (rootVal === null) return null;
    const parts = [rootVal];
    for (let i = 1; i < innerArgs.length; i += 1) {
      const staticPart = resolveStaticArgValue(innerArgs[i], code, isPython);
      if (staticPart !== null) {
        parts.push(staticPart);
        continue;
      }
      const subTemplate = resolveStaticJoinOrTemplate(innerArgs[i], code, isPython);
      if (subTemplate !== null && !isAbsolute(subTemplate)) {
        parts.push(subTemplate);
        continue;
      }
      return null;
    }
    return join(...parts);
  }

  if (!isPython && trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length >= 2) {
    const inner = trimmed.slice(1, -1);
    let out = "";
    let i = 0;
    while (i < inner.length) {
      if (inner[i] === "\\" && i + 1 < inner.length) {
        out += inner.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (inner[i] === "`") return null;
      if (inner[i] === "$" && inner[i + 1] === "{") {
        const closeIdx = findMatchingBrace(inner, i + 1);
        if (closeIdx < 0) return null;
        const slot = inner.slice(i + 2, closeIdx).trim();
        const bound = resolveSimpleVarBinding(code, slot, false);
        if (bound && bound.ok) {
          out += bound.value;
        } else if (
          out.length > 0 &&
          !out.endsWith("/") &&
          !out.endsWith("\\") &&
          !out.endsWith(".") &&
          !/[/\\]/.test(slot)
        ) {
          out += "0";
        } else {
          return null;
        }
        i = closeIdx + 1;
        continue;
      }
      out += inner[i];
      i += 1;
    }
    return unescapeSimpleLiteral(out, false);
  }

  if (isPython && /^[fF](?:'''[\s\S]*'''|"""[\s\S]*"""|'[^']*'|"[^"]*")$/.test(trimmed)) {
    const body = trimmed.slice(1);
    const quote = body.startsWith("'''") || body.startsWith('"""') ? body.slice(0, 3) : body[0];
    const inner = body.slice(quote.length, body.length - quote.length);
    let out = "";
    let i = 0;
    while (i < inner.length) {
      if (inner[i] === "\\" && i + 1 < inner.length) {
        out += inner.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (inner[i] === "{") {
        const closeIdx = findMatchingBrace(inner, i);
        if (closeIdx < 0) return null;
        const slot = inner.slice(i + 1, closeIdx).trim();
        const bound = resolveSimpleVarBinding(code, slot, true);
        if (bound && bound.ok) {
          out += bound.value;
        } else if (
          out.length > 0 &&
          !out.endsWith("/") &&
          !out.endsWith("\\") &&
          !out.endsWith(".") &&
          !/[/\\]/.test(slot)
        ) {
          out += "0";
        } else {
          return null;
        }
        i = closeIdx + 1;
        continue;
      }
      out += inner[i];
      i += 1;
    }
    return unescapeSimpleLiteral(out, false);
  }

  return null;
}

function extractJsObjectProperty(objExpr, propName) {
  const trimmed = String(objExpr || "").trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const props = parseCallArguments(`(${trimmed.slice(1, -1)})`, 0);
  if (!props) return null;
  const propEsc = propName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const kvRe = new RegExp(`^(?:['"]${propEsc}['"]|${propEsc})\\s*:\\s*([\\s\\S]+)$`);
  for (const prop of props) {
    if (prop === propName) return propName;
    const m = prop.match(kvRe);
    if (m) return m[1].trim();
  }
  return null;
}

function checkInlineNodeFs(code, allowPath, options = {}) {
  const { allowDynamicPaths = false, roleLabel = "read-only ro-* workers" } = options;

  const bracketRe = /(?:([A-Za-z_$][A-Za-z0-9_$]*)|([)\]'"]))\s*\[([^\]]*)\]/g;
  let bm;
  while ((bm = bracketRe.exec(code)) !== null) {
    const ident = bm[1] || "";
    const bracketBody = bm[3] || "";
    if (ident && JS_NON_MEMBER_PREFIX_KEYWORDS.has(ident)) continue;
    const afterBracket = code.slice(bm.index + bm[0].length);
    const isFsReceiver =
      ident === "fs" ||
      ident === "fsp" ||
      ident === "promises" ||
      /require\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)\s*$/.test(code.slice(0, bm.index + (bm[2] ? 1 : 0)));
    if (NODE_MUTATION_NAME_RE.test(bracketBody) || (isFsReceiver && /^\s*\(/.test(afterBracket))) {
      if (!allowDynamicPaths) {
        return `Dynamic fs mutation via inline Node script is blocked for ${roleLabel}.`;
      }
    }
  }

  if (
    !allowDynamicPaths &&
    (/\.\s*(writeFileSync|writeFile|appendFileSync|appendFile|unlinkSync|unlink|rmSync|rm|rmdirSync|rmdir|renameSync|rename|copyFileSync|copyFile|cpSync|cp|mkdirSync|mkdir|mkdtempSync|mkdtemp|chmodSync|chmod|chownSync|chown|truncateSync|truncate|symlinkSync|symlink|linkSync|link|createWriteStream|openSync)\b(?!\s*\()/.test(
      code,
    ) ||
      /\b(writeFileSync|writeFile|appendFileSync|appendFile|unlinkSync|unlink|rmSync|rm|rmdirSync|rmdir|renameSync|rename|copyFileSync|copyFile|cpSync|cp|mkdirSync|mkdir|mkdtempSync|mkdtemp|chmodSync|chmod|chownSync|chown|truncateSync|truncate|symlinkSync|symlink|linkSync|link|createWriteStream|openSync)\s*\bas\b/.test(
        code,
      ) ||
      /(?:const|let|var|\(|^|[;\n,])\s*\{[^}]*\b(?:writeFileSync|writeFile|appendFileSync|appendFile|unlinkSync|unlink|rmSync|rm|rmdirSync|rmdir|renameSync|rename|copyFileSync|copyFile|cpSync|cp|mkdirSync|mkdir|mkdtempSync|mkdtemp|chmodSync|chmod|chownSync|chown|truncateSync|truncate|symlinkSync|symlink|linkSync|link|createWriteStream|openSync)\s*:[^}]*\}\s*=/.test(
        code,
      ))
  ) {
    return `Aliased fs mutation API in inline Node script is blocked for ${roleLabel}.`;
  }

  const checkNodePathArg = (argExpr, opts) => {
    const rawExpr = String(argExpr || "");
    if (/\.system_generated(?:[/\\'"`]|$)/.test(rawExpr)) {
      return false;
    }
    const lit = parseStaticJsString(rawExpr);
    if (lit.ok) {
      return allowPath(lit.value, opts);
    }
    const bound = resolveSimpleVarBinding(code, rawExpr, false);
    if (bound && bound.ok) {
      return allowPath(bound.value, opts);
    }
    const joined = resolveStaticJoinOrTemplate(rawExpr, code, false);
    if (joined !== null) {
      return allowPath(joined, opts);
    }
    if (isSafeTmpTemplateOrJoin(rawExpr, code, allowPath)) {
      return true;
    }
    return allowDynamicPaths;
  };

  const callRe =
    /\b(writeFileSync|writeFile|appendFileSync|appendFile|unlinkSync|unlink|rmSync|rm|rmdirSync|rmdir|renameSync|rename|copyFileSync|copyFile|cpSync|cp|mkdirSync|mkdir|mkdtempSync|mkdtemp|chmodSync|chmod|chownSync|chown|truncateSync|truncate|symlinkSync|symlink|linkSync|link|createWriteStream|openSync|open)\s*\(/g;

  let match;
  while ((match = callRe.exec(code)) !== null) {
    const fnName = match[1];
    if ((fnName === "open" || fnName === "openSync") && !/\bfs\b|node:fs/.test(code)) {
      continue;
    }
    const openParenIdx = match.index + match[0].length - 1;
    const callArgs = parseCallArguments(code, openParenIdx);
    if (!callArgs) {
      return `Unparseable fs.${fnName} call in inline Node script is blocked for ${roleLabel}.`;
    }

    if (fnName === "open" || fnName === "openSync") {
      if (callArgs.length >= 2) {
        const modeLit = parseStaticJsString(callArgs[1]);
        if (modeLit.ok && (modeLit.value === "r" || modeLit.value === "rs")) {
          continue;
        }
      } else {
        continue;
      }
      if (!checkNodePathArg(callArgs[0], { allowRootEqual: false, allowDevNull: true })) {
        return `Inline Node fs.${fnName} write outside allowed roots is blocked for ${roleLabel}.`;
      }
      continue;
    }

    if (NODE_SINGLE_PATH_FS_APIS.has(fnName)) {
      const isMkdir = fnName === "mkdirSync" || fnName === "mkdir";
      const forbidRoArtifact =
        fnName === "rmdirSync" ||
        fnName === "rmdir" ||
        fnName === "mkdtempSync" ||
        fnName === "mkdtemp" ||
        fnName === "chmodSync" ||
        fnName === "chmod" ||
        fnName === "chownSync" ||
        fnName === "chown";
      const allowNull =
        fnName === "writeFileSync" ||
        fnName === "writeFile" ||
        fnName === "appendFileSync" ||
        fnName === "appendFile" ||
        fnName === "createWriteStream";
      if (
        !checkNodePathArg(callArgs[0], {
          allowRootEqual: isMkdir,
          allowDevNull: allowNull,
          allowArtifactDir: isMkdir,
          allowArtifactRoot: isMkdir,
          forbidReadOnlyArtifact: forbidRoArtifact,
        })
      ) {
        return `Inline Node fs.${fnName} outside allowed roots is blocked for ${roleLabel}.`;
      }
      continue;
    }

    if (NODE_COPY_FS_APIS.has(fnName)) {
      const forbidRoArtifact = fnName === "cpSync" || fnName === "cp";
      const srcVal = resolveStaticArgValue(callArgs[0] || "", code, false);
      const srcIsImg = Boolean(srcVal && /\.(?:png|jpe?g|webp)$/i.test(srcVal));
      if (
        !checkNodePathArg(callArgs[1], {
          allowRootEqual: true,
          allowDevNull: true,
          allowArtifactDir: false,
          forbidReadOnlyArtifact: forbidRoArtifact && !srcIsImg,
        })
      ) {
        return `Inline Node fs.${fnName} destination outside allowed roots is blocked for ${roleLabel}.`;
      }
      continue;
    }

    if (NODE_TWO_PATH_FS_APIS.has(fnName)) {
      const isLink =
        fnName === "symlinkSync" ||
        fnName === "symlink" ||
        fnName === "linkSync" ||
        fnName === "link";
      if (
        !checkNodePathArg(callArgs[0], {
          allowRootEqual: false,
          allowDevNull: false,
          forbidReadOnlyArtifact: isLink,
        }) ||
        !checkNodePathArg(callArgs[1], {
          allowRootEqual: true,
          allowDevNull: false,
          allowArtifactDir: false,
          forbidReadOnlyArtifact: isLink,
        })
      ) {
        return `Inline Node fs.${fnName} outside allowed roots is blocked for ${roleLabel}.`;
      }
    }
  }

  const screenshotRe = /\.\s*screenshot\s*\(/g;
  while ((match = screenshotRe.exec(code)) !== null) {
    const openParenIdx = match.index + match[0].length - 1;
    const callArgs = parseCallArguments(code, openParenIdx);
    if (!callArgs) {
      if (!allowDynamicPaths) {
        return `Unparseable .screenshot() call in inline Node script is blocked for ${roleLabel}.`;
      }
      continue;
    }
    if (callArgs.length >= 1) {
      const pathProp = extractJsObjectProperty(callArgs[0], "path");
      if (
        pathProp !== null &&
        !checkNodePathArg(pathProp, { allowRootEqual: false, allowDevNull: false })
      ) {
        return `Inline Node .screenshot() path outside allowed roots is blocked for ${roleLabel}.`;
      }
    }
  }

  return null;
}

function splitPythonCallArgs(callArgs) {
  const positionals = [];
  const kwargs = {};
  for (const arg of callArgs) {
    const kwMatch = arg.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*([\s\S]*)$/);
    if (kwMatch) {
      kwargs[kwMatch[1]] = kwMatch[2].trim();
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, kwargs };
}

function hasDisallowedPythonAlias(code) {
  if (
    /\.\s*(write_text|write_bytes|unlink|rmdir|mkdir|touch|chmod|lchmod|rename|replace|symlink_to|hardlink_to|remove|removedirs|makedirs|chown|truncate|renames|rmtree|move|copy|copy2|copyfile|copytree|symlink|link)\b(?!\s*\()/.test(
      code,
    ) ||
    /(?:^|[^\w.])=\s*(?:builtins\s*\.\s*|io\s*\.\s*)?open\b(?!\s*\()/.test(code)
  ) {
    return true;
  }
  const importRe = /\bimport\s+(?:os|posix|shutil)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let im;
  while ((im = importRe.exec(code)) !== null) {
    const alias = im[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${alias}\\s*\\.\\s*${PYTHON_MUTATION_NAME_RE.source}`).test(code)) {
      return true;
    }
  }
  const fromImportRe = /\bfrom\s+(os|posix|shutil|pathlib)\s+import\s+([^\n;]+)/g;
  while ((im = fromImportRe.exec(code)) !== null) {
    const mod = im[1];
    const clause = im[2];
    if (!/\bas\b/.test(clause)) continue;
    if (mod === "pathlib") {
      if (PYTHON_MUTATION_NAME_RE.test(clause)) return true;
      continue;
    }
    if (PYTHON_MUTATION_NAME_RE.test(clause)) return true;
  }
  return false;
}

function checkInlinePythonFs(code, allowPath, options = {}) {
  const { allowDynamicPaths = false, roleLabel = "read-only ro-* workers" } = options;

  if (!allowDynamicPaths && hasDisallowedPythonAlias(code)) {
    return `Aliased filesystem mutation API in inline Python script is blocked for ${roleLabel}.`;
  }

  const checkPyPathArg = (argExpr, opts) => {
    const rawExpr = String(argExpr || "");
    if (/\.system_generated(?:[/\\'"`]|$)/.test(rawExpr)) {
      return false;
    }
    const lit = parseStaticPyString(rawExpr);
    if (lit.ok) {
      return allowPath(lit.value, opts);
    }
    const bound = resolveSimpleVarBinding(code, rawExpr, true);
    if (bound && bound.ok) {
      return allowPath(bound.value, opts);
    }
    const joined = resolveStaticJoinOrTemplate(rawExpr, code, true);
    if (joined !== null) {
      return allowPath(joined, opts);
    }
    if (isSafeTmpTemplateOrJoin(rawExpr, code, allowPath)) {
      return true;
    }
    return allowDynamicPaths;
  };

  const pathMethodRe =
    /\.\s*(write_text|write_bytes|unlink|rmdir|mkdir|touch|chmod|lchmod|rename|replace|symlink_to|hardlink_to|open)\s*\(/g;
  let match;
  while ((match = pathMethodRe.exec(code)) !== null) {
    const method = match[1];
    const openParenIdx = match.index + match[0].length - 1;
    const methodArgs = parseCallArguments(code, openParenIdx);
    if (!methodArgs) {
      return `Unparseable .${method}() call in inline Python script is blocked for ${roleLabel}.`;
    }
    if (method === "open") {
      const { positionals, kwargs } = splitPythonCallArgs(methodArgs);
      const modeExpr = positionals[0] ?? kwargs.mode ?? null;
      if (modeExpr === null) continue;
      const modeLit = parseStaticPyString(modeExpr);
      if (modeLit.ok && /^[rbtU]+$/.test(modeLit.value) && modeLit.value.includes("r")) {
        continue;
      }
    }
    const prefix = code.slice(0, match.index);
    const ctorMatch = prefix.match(/(?:pathlib\s*\.\s*)?Path\s*\(\s*([^()]*)\s*\)\s*$/);
    if (!ctorMatch) {
      if (!allowDynamicPaths) {
        return `Inline Python Path.${method}() on non-literal receiver is blocked for ${roleLabel}.`;
      }
      continue;
    }
    const ctorArgs = parseCallArguments(`(${ctorMatch[1]})`, 0);
    const isMkdir = method === "mkdir";
    const forbidRo =
      method === "symlink_to" ||
      method === "hardlink_to" ||
      method === "rmdir" ||
      method === "chmod" ||
      method === "lchmod";
    if (
      !ctorArgs ||
      ctorArgs.length !== 1 ||
      !checkPyPathArg(ctorArgs[0], {
        allowRootEqual: isMkdir,
        allowDevNull: false,
        allowArtifactDir: isMkdir,
        allowArtifactRoot: isMkdir,
        forbidReadOnlyArtifact: forbidRo,
      })
    ) {
      return `Inline Python Path.${method}() outside allowed roots is blocked for ${roleLabel}.`;
    }
    if (method === "rename" || method === "replace") {
      if (
        !checkPyPathArg(methodArgs[0] || "", {
          allowRootEqual: true,
          allowDevNull: false,
          allowArtifactDir: false,
        })
      ) {
        return `Inline Python Path.${method}() target outside allowed roots is blocked for ${roleLabel}.`;
      }
    }
  }

  const openRe = /(?:^|[^\w.])(?:io\s*\.\s*|builtins\s*\.\s*)?open\s*\(/g;
  while ((match = openRe.exec(code)) !== null) {
    const openParenIdx = match.index + match[0].length - 1;
    const openArgs = parseCallArguments(code, openParenIdx);
    if (!openArgs) {
      return `Unparseable open() call in inline Python script is blocked for ${roleLabel}.`;
    }
    const { positionals, kwargs } = splitPythonCallArgs(openArgs);
    const modeExpr = positionals[1] ?? kwargs.mode ?? null;
    if (modeExpr === null) continue;
    const modeLit = parseStaticPyString(modeExpr);
    if (modeLit.ok && /^[rbtU]+$/.test(modeLit.value) && modeLit.value.includes("r")) {
      continue;
    }
    const pathExpr = positionals[0] ?? kwargs.file ?? "";
    if (!checkPyPathArg(pathExpr, { allowRootEqual: false, allowDevNull: true })) {
      return `Inline Python open() for write outside allowed roots is blocked for ${roleLabel}.`;
    }
  }

  const hasFsImport = /\b(?:os|posix|shutil)\b/.test(code);
  const osShutilRe =
    /(?:(os|posix|shutil)\s*\.\s*|\b)(remove|unlink|rmdir|removedirs|mkdir|makedirs|chmod|chown|truncate|rename|renames|replace|rmtree|move|copy|copy2|copyfile|copytree|symlink|link)\s*\(/g;
  while ((match = osShutilRe.exec(code)) !== null) {
    const qualifier = match[1] || "";
    const fnName = match[2];
    const beforeChar = match.index > 0 ? code[match.index - 1] : "";
    if (!qualifier && (beforeChar === "." || !hasFsImport)) {
      continue;
    }
    const openParenIdx = match.index + match[0].length - 1;
    const callArgs = parseCallArguments(code, openParenIdx);
    if (!callArgs) {
      return `Unparseable ${fnName}() call in inline Python script is blocked for ${roleLabel}.`;
    }
    const { positionals } = splitPythonCallArgs(callArgs);
    if (["copy", "copy2", "copyfile", "copytree"].includes(fnName)) {
      if (!qualifier && !/\bshutil\b/.test(code)) continue;
      const srcVal = resolveStaticArgValue(positionals[0] || "", code, true);
      const srcIsImg = Boolean(srcVal && /\.(?:png|jpe?g|webp)$/i.test(srcVal));
      const allowImgDir = srcIsImg && (fnName === "copy" || fnName === "copy2");
      if (
        !checkPyPathArg(positionals[1] || "", {
          allowRootEqual: true,
          allowDevNull: true,
          allowArtifactDir: allowImgDir,
          allowArtifactRoot: allowImgDir,
          forbidReadOnlyArtifact: fnName === "copytree",
        })
      ) {
        return `Inline Python ${fnName}() destination outside allowed roots is blocked for ${roleLabel}.`;
      }
      continue;
    }
    if (["rename", "renames", "replace", "move", "symlink", "link"].includes(fnName)) {
      const isLink = fnName === "symlink" || fnName === "link";
      if (
        !checkPyPathArg(positionals[0] || "", {
          allowRootEqual: false,
          allowDevNull: false,
          forbidReadOnlyArtifact: isLink,
        }) ||
        !checkPyPathArg(positionals[1] || "", {
          allowRootEqual: true,
          allowDevNull: false,
          allowArtifactDir: false,
          forbidReadOnlyArtifact: isLink,
        })
      ) {
        return `Inline Python ${fnName}() outside allowed roots is blocked for ${roleLabel}.`;
      }
      continue;
    }
    const isMkdir = fnName === "mkdir" || fnName === "makedirs";
    const forbidRo = ["rmdir", "removedirs", "rmtree", "chmod", "chown"].includes(fnName);
    if (
      !checkPyPathArg(positionals[0] || "", {
        allowRootEqual: isMkdir,
        allowDevNull: false,
        allowArtifactDir: isMkdir,
        allowArtifactRoot: isMkdir,
        forbidReadOnlyArtifact: forbidRo,
      })
    ) {
      return `Inline Python ${fnName}() outside allowed roots is blocked for ${roleLabel}.`;
    }
  }

  const screenshotRe = /\.\s*screenshot\s*\(/g;
  while ((match = screenshotRe.exec(code)) !== null) {
    const openParenIdx = match.index + match[0].length - 1;
    const callArgs = parseCallArguments(code, openParenIdx);
    if (!callArgs) {
      if (!allowDynamicPaths) {
        return `Unparseable .screenshot() call in inline Python script is blocked for ${roleLabel}.`;
      }
      continue;
    }
    const { positionals, kwargs } = splitPythonCallArgs(callArgs);
    const pathExpr = kwargs.path ?? positionals[0] ?? null;
    if (
      pathExpr !== null &&
      pathExpr !== "None" &&
      !checkPyPathArg(pathExpr, { allowRootEqual: false, allowDevNull: false })
    ) {
      return `Inline Python .screenshot() path outside allowed roots is blocked for ${roleLabel}.`;
    }
  }

  return null;
}

function parseGitCommand(args) {
  const globalDirs = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "-C" || arg === "--git-dir" || arg === "--work-tree") {
      if (i + 1 < args.length) globalDirs.push(args[i + 1]);
      i += 2;
      continue;
    }
    if (arg.startsWith("-C") && arg.length > 2) {
      globalDirs.push(arg.slice(2));
      i += 1;
      continue;
    }
    if (arg.startsWith("--git-dir=")) {
      globalDirs.push(arg.slice("--git-dir=".length));
      i += 1;
      continue;
    }
    if (arg.startsWith("--work-tree=")) {
      globalDirs.push(arg.slice("--work-tree=".length));
      i += 1;
      continue;
    }
    if (GIT_GLOBAL_VALUE_FLAGS.has(arg)) {
      i += 2;
      continue;
    }
    if (
      arg.startsWith("-c") ||
      arg.startsWith("--namespace=") ||
      arg.startsWith("--config-env=")
    ) {
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      i += 1;
      continue;
    }
    return { subcmd: arg, subArgs: args.slice(i + 1), globalDirs };
  }
  return { subcmd: "", subArgs: [], globalDirs };
}

function isReadOnlyGitTagArgs(subArgs) {
  if (subArgs.length === 0) return true;
  let hasReadOnlyFlag = false;
  for (let i = 0; i < subArgs.length; i += 1) {
    const arg = subArgs[i];
    if (arg === "--") break;
    if (
      ["-d", "--delete", "-a", "--annotate", "-s", "--sign", "-f", "--force", "-m", "--message", "-F", "--file", "-u", "--local-user", "--create-reflog"].includes(
        arg,
      ) ||
      arg.startsWith("--message=") ||
      arg.startsWith("--file=") ||
      arg.startsWith("--local-user=") ||
      (!arg.startsWith("--") && /^-[a-zA-Z]*[dasfmuF]/.test(arg))
    ) {
      return false;
    }
    if (
      arg === "-l" ||
      arg === "--list" ||
      arg === "-v" ||
      arg === "--verify" ||
      arg === "--contains" ||
      arg.startsWith("--contains=") ||
      arg === "--points-at" ||
      arg.startsWith("--points-at=")
    ) {
      hasReadOnlyFlag = true;
      if (arg === "--contains" || arg === "--points-at") {
        i += 1;
      }
    }
  }
  return hasReadOnlyFlag;
}

function isReadOnlyGitStashArgs(subArgs) {
  return subArgs.length > 0 && (subArgs[0] === "list" || subArgs[0] === "show");
}

function isMutatingGitAction(subcmd, subArgs) {
  if (MUTATING_GIT_SUBCOMMANDS.has(subcmd)) return true;
  if (subcmd === "tag") return !isReadOnlyGitTagArgs(subArgs);
  if (subcmd === "stash") return !isReadOnlyGitStashArgs(subArgs);
  if (subcmd === "branch") {
    return subArgs.some((a) => ["-d", "-D", "-m", "-M", "-c", "-C", "--delete", "--move", "--copy"].includes(a));
  }
  if (subcmd === "worktree") {
    const action = subArgs.find((a) => !a.startsWith("-")) || "";
    return Boolean(action && action !== "list");
  }
  if (subcmd === "notes") {
    const action = subArgs.find((a) => !a.startsWith("-")) || "";
    return Boolean(action && action !== "list" && action !== "show");
  }
  if (subcmd === "replace") {
    return subArgs.length > 0 && !subArgs.some((a) => a === "-l" || a === "--list");
  }
  if (subcmd === "submodule") {
    const action = subArgs.find((a) => !a.startsWith("-")) || "";
    return Boolean(action && action !== "status" && action !== "summary");
  }
  if (subcmd === "symbolic-ref") {
    if (subArgs.some((a) => a === "-d" || a === "--delete")) return true;
    const positionals = extractPositionalPaths(subArgs);
    return positionals.length >= 2;
  }
  return false;
}

function isMutatingGitFetchForReadOnly(subArgs) {
  const positionals = [];
  let afterDoubleDash = false;
  for (let i = 0; i < subArgs.length; i += 1) {
    const arg = subArgs[i];
    if (!afterDoubleDash && arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && arg.startsWith("-")) {
      if (
        ["-p", "--prune", "-f", "--force", "-u", "--update-head-ok"].includes(arg) ||
        (!arg.startsWith("--") && /^-[a-zA-Z]*[pfu]/.test(arg))
      ) {
        return true;
      }
      if (["--depth", "--deepen", "--shallow-since", "--shallow-exclude", "--negotiation-tip", "-o", "--server-option", "--upload-pack", "--refmap", "-j", "--jobs"].includes(arg)) {
        i += 1;
      }
      continue;
    }
    positionals.push(arg);
  }
  return positionals.slice(1).some((refspec) => refspec.includes(":"));
}

function isForcePushToProtectedBranch(subArgs) {
  let hasForceOrDeleteFlag = false;
  const positionals = [];
  let afterDoubleDash = false;

  for (let i = 0; i < subArgs.length; i += 1) {
    const arg = subArgs[i];
    if (!afterDoubleDash && arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && arg.startsWith("-")) {
      if (
        arg === "--force" ||
        arg.startsWith("--force=") ||
        arg === "--force-with-lease" ||
        arg.startsWith("--force-with-lease=") ||
        arg === "--force-if-includes" ||
        arg === "--delete" ||
        (!arg.startsWith("--") && /^-[a-zA-Z]*[fd]/.test(arg))
      ) {
        hasForceOrDeleteFlag = true;
      }
      if (["-o", "--push-option", "--repo", "--receive-pack", "--exec"].includes(arg)) {
        i += 1;
      }
      continue;
    }
    positionals.push(arg);
  }

  const refspecs = positionals.length >= 2 ? positionals.slice(1) : positionals;
  for (const spec of refspecs) {
    const plusForced = spec.startsWith("+");
    const colonDelete = spec.startsWith(":");
    const clean = plusForced ? spec.slice(1) : spec;
    const dst = clean.includes(":") ? clean.split(":").pop() : clean;
    const branch = dst.replace(/^refs\/heads\//, "");
    if ((branch === "main" || branch === "master") && (hasForceOrDeleteFlag || plusForced || colonDelete)) {
      return true;
    }
  }
  return false;
}

function extractPathsSkippingValueFlags(args, valueFlags) {
  const paths = [];
  let afterDoubleDash = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!afterDoubleDash && arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && arg.startsWith("-") && arg.length > 1) {
      if (valueFlags.has(arg)) {
        i += 1;
      }
      continue;
    }
    paths.push(arg);
  }
  return paths;
}

function extractInstallTargets(args) {
  let dirMode = false;
  let targetDir = null;
  const positionals = [];
  let afterDoubleDash = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!afterDoubleDash && arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && arg.startsWith("-") && arg.length > 1) {
      if (arg === "-d" || arg === "--directory" || (!arg.startsWith("--") && /^-[a-zA-Z]*d/.test(arg))) {
        dirMode = true;
      }
      if (arg === "-t" || arg === "--target-directory") {
        if (i + 1 >= args.length) return { valid: false, targets: [] };
        targetDir = args[i + 1];
        i += 1;
        continue;
      }
      if (arg.startsWith("--target-directory=")) {
        targetDir = arg.slice("--target-directory=".length);
        continue;
      }
      if (["-m", "--mode", "-o", "--owner", "-g", "--group", "-S", "--suffix"].includes(arg)) {
        i += 1;
      }
      continue;
    }
    positionals.push(arg);
  }
  if (dirMode) {
    return positionals.length > 0 ? { valid: true, targets: positionals } : { valid: false, targets: [] };
  }
  if (targetDir !== null) {
    return positionals.length > 0 ? { valid: true, targets: [targetDir] } : { valid: false, targets: [] };
  }
  if (positionals.length < 2) return { valid: false, targets: [] };
  return { valid: true, targets: [positionals[positionals.length - 1]] };
}

function extractCurlWriteTargets(args) {
  const fileTargets = [];
  let usesRemoteName = false;
  let outputDir = ".";
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") break;
    if (arg === "-o" || arg === "--output") {
      if (i + 1 < args.length) {
        if (args[i + 1] !== "-") fileTargets.push(args[i + 1]);
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("--output=")) {
      const v = arg.slice("--output=".length);
      if (v !== "-") fileTargets.push(v);
      continue;
    }
    if (arg.startsWith("-o") && arg.length > 2) {
      const v = arg.slice(2);
      if (v !== "-") fileTargets.push(v);
      continue;
    }
    if (arg === "--output-dir" && i + 1 < args.length) {
      outputDir = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      outputDir = arg.slice("--output-dir=".length);
      continue;
    }
    if (arg === "-O" || arg === "--remote-name" || arg === "--remote-name-all" || (!arg.startsWith("--") && /^-[a-zA-Z]*O/.test(arg))) {
      usesRemoteName = true;
    }
  }
  return { fileTargets, dirTargets: usesRemoteName ? [outputDir] : [] };
}

function extractWgetWriteTargets(args) {
  let isSpider = false;
  let outputDoc = null;
  let dirPrefix = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") break;
    if (arg === "--spider") {
      isSpider = true;
      continue;
    }
    if (arg === "-O" || arg === "--output-document") {
      if (i + 1 < args.length) {
        outputDoc = args[i + 1];
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("--output-document=")) {
      outputDoc = arg.slice("--output-document=".length);
      continue;
    }
    if (arg.startsWith("-O") && arg.length > 2) {
      outputDoc = arg.slice(2);
      continue;
    }
    if (arg === "-P" || arg === "--directory-prefix") {
      if (i + 1 < args.length) {
        dirPrefix = args[i + 1];
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("--directory-prefix=")) {
      dirPrefix = arg.slice("--directory-prefix=".length);
      continue;
    }
    if (arg.startsWith("-P") && arg.length > 2) {
      dirPrefix = arg.slice(2);
      continue;
    }
  }
  if (isSpider) return { fileTargets: [], dirTargets: [] };
  if (outputDoc !== null) {
    return outputDoc === "-" ? { fileTargets: [], dirTargets: [] } : { fileTargets: [outputDoc], dirTargets: [] };
  }
  return { fileTargets: [], dirTargets: [dirPrefix || "."] };
}

function extractTarWriteTargets(args) {
  let isExtract = false;
  let isCreateOrUpdate = false;
  let toStdout = false;
  let targetDir = ".";
  let archiveFile = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") break;
    if (arg === "-O" || arg === "--to-stdout") toStdout = true;
    if (arg === "-x" || arg === "--extract" || arg === "--get") isExtract = true;
    if (arg === "-c" || arg === "--create" || arg === "-r" || arg === "--append" || arg === "-u" || arg === "--update") {
      isCreateOrUpdate = true;
    }
    if (!arg.startsWith("--") && (arg.startsWith("-") || i === 0)) {
      const flags = arg.startsWith("-") ? arg.slice(1) : arg;
      if (flags.includes("x")) isExtract = true;
      if (/[cru]/.test(flags)) isCreateOrUpdate = true;
      if (flags.includes("O")) toStdout = true;
      if (flags.endsWith("f") && i + 1 < args.length) {
        archiveFile = args[i + 1];
        i += 1;
        continue;
      }
      if (flags.endsWith("C") && i + 1 < args.length) {
        targetDir = args[i + 1];
        i += 1;
        continue;
      }
    }
    if (arg === "-C" || arg === "--directory") {
      if (i + 1 < args.length) {
        targetDir = args[i + 1];
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("--directory=")) {
      targetDir = arg.slice("--directory=".length);
      continue;
    }
    if (arg === "-f" || arg === "--file") {
      if (i + 1 < args.length) {
        archiveFile = args[i + 1];
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("--file=")) {
      archiveFile = arg.slice("--file=".length);
    }
  }
  const fileTargets = [];
  const dirTargets = [];
  if (isExtract && !toStdout) dirTargets.push(targetDir);
  if (isCreateOrUpdate && archiveFile && archiveFile !== "-" && archiveFile !== "/dev/null") {
    fileTargets.push(archiveFile);
  }
  return { fileTargets, dirTargets };
}

function extractUnzipWriteTargets(args) {
  let readOnly = false;
  let targetDir = ".";
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") break;
    if (["-l", "-v", "-t", "-p", "-c", "-Z"].includes(arg) || (!arg.startsWith("--") && /^-[a-zA-Z]*[lvtpcZ]/.test(arg))) {
      readOnly = true;
    }
    if (arg === "-d" && i + 1 < args.length) {
      targetDir = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("-d") && arg.length > 2) {
      targetDir = arg.slice(2);
    }
  }
  return readOnly ? [] : [targetDir];
}

function extractRsyncWriteSpec(args) {
  let dryRun = false;
  const positionals = [];
  let afterDoubleDash = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!afterDoubleDash && arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && arg.startsWith("-") && arg.length > 1) {
      if (arg === "-n" || arg === "--dry-run" || arg === "--list-only" || (!arg.startsWith("--") && /^-[a-zA-Z]*n/.test(arg))) {
        dryRun = true;
      }
      if (["-e", "--rsh", "--exclude", "--include", "--filter", "--files-from", "--log-file", "--out-format", "--compare-dest", "--copy-dest", "--link-dest"].includes(arg)) {
        i += 1;
      }
      continue;
    }
    positionals.push(arg);
  }
  if (dryRun || positionals.length < 2) return { dryRun: true, destination: null };
  return { dryRun: false, destination: positionals[positionals.length - 1] };
}

function extractFindEffects(args) {
  const roots = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "-H" || arg === "-L" || arg === "-P" || arg === "-O" || arg === "-D") {
      if (arg === "-D") i += 1;
      i += 1;
      continue;
    }
    if (arg.startsWith("-") || arg === "!" || arg === "(" || arg === ",") break;
    roots.push(arg);
    i += 1;
  }
  const searchRoots = roots.length > 0 ? roots : ["."];
  let hasDelete = false;
  const fprintTargets = [];
  const execCommands = [];

  for (; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-delete") {
      hasDelete = true;
      continue;
    }
    if (arg === "-fprint" || arg === "-fprint0" || arg === "-fls" || arg === "-fprintf") {
      if (i + 1 < args.length) {
        fprintTargets.push(args[i + 1]);
        i += arg === "-fprintf" ? 2 : 1;
      }
      continue;
    }
    if (arg === "-exec" || arg === "-execdir" || arg === "-ok" || arg === "-okdir") {
      const innerTokens = [];
      let j = i + 1;
      while (j < args.length && args[j] !== ";" && args[j] !== "+") {
        innerTokens.push(args[j]);
        j += 1;
      }
      if (innerTokens.length > 0) {
        execCommands.push(innerTokens);
      }
      i = j;
    }
  }
  return { searchRoots, hasDelete, fprintTargets, execCommands };
}

function checkSharedTargetConfinement(inv, allowPath, roleLabel, validateInnerTokens) {
  const { cmd, args } = inv;
  if (cmd === "mkdir") {
    const paths = extractPathsSkippingValueFlags(args, new Set(["-m", "--mode"]));
    if (
      paths.length === 0 ||
      paths.some(
        (p) =>
          !allowPath(p, {
            allowRootEqual: true,
            allowDevNull: false,
            allowArtifactDir: true,
            allowArtifactRoot: true,
          }),
      )
    ) {
      return `Command 'mkdir' outside allowed paths is blocked for ${roleLabel}.`;
    }
    return null;
  }
  if (cmd === "touch") {
    const paths = extractPathsSkippingValueFlags(args, new Set(["-d", "--date", "-r", "--reference", "-t"]));
    if (
      paths.length === 0 ||
      paths.some((p) => !allowPath(p, { allowRootEqual: false, allowDevNull: false, forbidReadOnlyArtifact: true }))
    ) {
      return `Command 'touch' outside allowed paths is blocked for ${roleLabel}.`;
    }
    return null;
  }
  if (cmd === "chmod") {
    const paths = extractChmodTargets(args);
    if (
      paths.length === 0 ||
      paths.some((p) => !allowPath(p, { allowRootEqual: false, allowDevNull: false, forbidReadOnlyArtifact: true }))
    ) {
      return `Command 'chmod' outside allowed paths is blocked for ${roleLabel}.`;
    }
    return null;
  }
  if (cmd === "truncate") {
    const paths = extractPathsSkippingValueFlags(args, new Set(["-s", "--size", "-r", "--reference"]));
    if (
      paths.length === 0 ||
      paths.some((p) => !allowPath(p, { allowRootEqual: false, allowDevNull: false, forbidReadOnlyArtifact: true }))
    ) {
      return `Command 'truncate' outside allowed paths is blocked for ${roleLabel}.`;
    }
    return null;
  }
  if (cmd === "dd") {
    const ofArg = args.find((a) => a.startsWith("of="));
    if (ofArg) {
      const target = ofArg.slice(3);
      if (!allowPath(target, { allowRootEqual: false, allowDevNull: true })) {
        return `Command 'dd' output target outside allowed paths is blocked for ${roleLabel}.`;
      }
    }
    return null;
  }
  if (cmd === "install") {
    const spec = extractInstallTargets(args);
    if (
      !spec.valid ||
      spec.targets.some((t) => !allowPath(t, { allowRootEqual: true, allowDevNull: false, forbidReadOnlyArtifact: true }))
    ) {
      return `Command 'install' targeting outside allowed paths is blocked for ${roleLabel}.`;
    }
    return null;
  }
  if (cmd === "curl") {
    const { fileTargets, dirTargets } = extractCurlWriteTargets(args);
    if (
      fileTargets.some((f) => !allowPath(f, { allowRootEqual: false, allowDevNull: true })) ||
      dirTargets.some((d) => !allowPath(d, { allowRootEqual: true, allowDevNull: false, forbidReadOnlyArtifact: true }))
    ) {
      return `Command 'curl' writing outside allowed paths is blocked for ${roleLabel}.`;
    }
    return null;
  }
  if (cmd === "wget") {
    const { fileTargets, dirTargets } = extractWgetWriteTargets(args);
    if (
      fileTargets.some((f) => !allowPath(f, { allowRootEqual: false, allowDevNull: true })) ||
      dirTargets.some((d) => !allowPath(d, { allowRootEqual: true, allowDevNull: false, forbidReadOnlyArtifact: true }))
    ) {
      return `Command 'wget' writing outside allowed paths is blocked for ${roleLabel}.`;
    }
    return null;
  }
  if (cmd === "tar") {
    const { fileTargets, dirTargets } = extractTarWriteTargets(args);
    if (
      fileTargets.some((f) => !allowPath(f, { allowRootEqual: false, allowDevNull: true, forbidReadOnlyArtifact: true })) ||
      dirTargets.some((d) => !allowPath(d, { allowRootEqual: true, allowDevNull: false, forbidReadOnlyArtifact: true }))
    ) {
      return `Command 'tar' writing outside allowed paths is blocked for ${roleLabel}.`;
    }
    return null;
  }
  if (cmd === "unzip") {
    const dirTargets = extractUnzipWriteTargets(args);
    if (dirTargets.some((d) => !allowPath(d, { allowRootEqual: true, allowDevNull: false, forbidReadOnlyArtifact: true }))) {
      return `Command 'unzip' extracting outside allowed paths is blocked for ${roleLabel}.`;
    }
    return null;
  }
  if (cmd === "rsync") {
    const spec = extractRsyncWriteSpec(args);
    if (!spec.dryRun && spec.destination) {
      if (/^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+:/.test(spec.destination) || spec.destination.startsWith("rsync://")) {
        return `Command 'rsync' to remote destination is blocked for ${roleLabel}.`;
      }
      if (!allowPath(spec.destination, { allowRootEqual: true, allowDevNull: false, forbidReadOnlyArtifact: true })) {
        return `Command 'rsync' targeting outside allowed paths is blocked for ${roleLabel}.`;
      }
    }
    return null;
  }
  if (cmd === "find") {
    const { searchRoots, hasDelete, fprintTargets, execCommands } = extractFindEffects(args);
    if (
      hasDelete &&
      searchRoots.some(
        (r) =>
          !allowPath(r, {
            allowRootEqual: true,
            allowDevNull: false,
            forbidReadOnlyArtifact: true,
            isRecursiveDelete: true,
          }),
      )
    ) {
      return `Command 'find -delete' outside allowed paths is blocked for ${roleLabel}.`;
    }
    if (fprintTargets.some((f) => !allowPath(f, { allowRootEqual: false, allowDevNull: true, forbidReadOnlyArtifact: true }))) {
      return `Command 'find -fprint/-fls' outside allowed paths is blocked for ${roleLabel}.`;
    }
    for (const innerTokens of execCommands) {
      const innerDeny = validateInnerTokens(innerTokens, searchRoots);
      if (innerDeny) return innerDeny;
    }
    return null;
  }
  return undefined;
}

function extractNodePreloadTargets(args, mergedEnv) {
  const targets = [];
  const scanArgs = (list) => {
    for (let i = 0; i < list.length; i += 1) {
      const arg = list[i];
      if (arg === "--") break;
      if (
        (arg === "-r" || arg === "--require" || arg === "--import" || arg === "--loader" || arg === "--experimental-loader") &&
        i + 1 < list.length
      ) {
        targets.push(list[i + 1]);
        i += 1;
        continue;
      }
      for (const prefix of ["--require=", "--import=", "--loader=", "--experimental-loader="]) {
        if (arg.startsWith(prefix)) {
          targets.push(arg.slice(prefix.length));
          break;
        }
      }
    }
  };
  scanArgs(args);
  if (typeof mergedEnv.NODE_OPTIONS === "string" && mergedEnv.NODE_OPTIONS.trim().length > 0) {
    scanArgs(tokenizeSingleSegment(mergedEnv.NODE_OPTIONS));
  }
  return targets;
}

function findInterpreterScriptArg(cmd, args) {
  const isNode = cmd === "node" || cmd === "nodejs" || cmd === "bun";
  const isPy = /^python(?:\d+(?:\.\d+)?)?$/.test(cmd);
  const isShell = ["sh", "bash", "zsh", "dash", "ksh"].includes(cmd);
  const isPerlRuby = cmd === "perl" || cmd === "ruby";
  if (!isNode && !isPy && !isShell && !isPerlRuby) return null;

  const valueFlags = isNode
    ? new Set(["-e", "--eval", "-p", "--print", "-r", "--require", "--import", "--loader", "--experimental-loader", "--conditions", "-C"])
    : isPy
      ? new Set(["-c", "-m", "-W", "-X", "-Q"])
      : isShell
        ? new Set(["-c", "-o"])
        : new Set(["-e", "-E", "-I", "-M", "-m", "-C"]);

  let hasTestFlag = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      return i + 1 < args.length ? { scriptToken: args[i + 1], hasTestFlag } : null;
    }
    if (isNode && arg === "--test") {
      hasTestFlag = true;
      continue;
    }
    if (isNode && (arg === "-e" || arg === "--eval" || arg === "-p" || arg === "--print" || arg.startsWith("--eval=") || arg.startsWith("--print="))) {
      return null;
    }
    if (isPy && (arg === "-c" || /^-[A-Za-z]+c$/.test(arg) || arg === "-m")) {
      return null;
    }
    if (isShell && /^-[a-zA-Z]*c$/.test(arg)) {
      return null;
    }
    if (isPerlRuby && (arg === "-e" || arg === "-E" || /^-[a-zA-Z.]*[eE]$/.test(arg))) {
      return null;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      if (valueFlags.has(arg)) i += 1;
      continue;
    }
    return { scriptToken: arg, hasTestFlag };
  }
  return null;
}

function inspectSingleTempFile(scriptToken, modeHint, context) {
  const {
    allowPath,
    nodePyOptions,
    canonicalTempRoots,
    realCwd,
    fallbackBaseDir,
    mergedEnv,
    outerEnv,
    roleLabel,
    kind,
    validateShellCode,
  } = context;

  const resolved = resolveShellTargetPath(scriptToken, fallbackBaseDir, mergedEnv);
  if (!resolved) return null;

  const inTemp = isInsideCanonicalTempRoots(resolved, canonicalTempRoots, realCwd, {
    allowRootEqual: false,
    excludeRealCwd: false,
  });
  if (!inTemp) return null;

  if (kind === "sicko") {
    return `Executing temporary script '${scriptToken}' is blocked for comment-sicko workers.`;
  }

  if (!existsSync(resolved)) {
    return `Temporary script '${scriptToken}' must exist on disk before execution for ${roleLabel}.`;
  }

  let rawBuf;
  try {
    if (!statSync(resolved).isFile()) {
      return `Temporary script '${scriptToken}' is not a readable file for ${roleLabel}.`;
    }
    rawBuf = readFileSync(resolved);
  } catch {
    return `Temporary script '${scriptToken}' could not be read for ${roleLabel}.`;
  }

  if (rawBuf.includes(0)) {
    if (kind === "readonly" || kind === "sicko") {
      return `Executing binary file '${scriptToken}' in canonical temp roots is blocked for ${roleLabel}.`;
    }
    return null;
  }

  const code = rawBuf.toString("utf8");
  const ext = extname(resolved).toLowerCase();
  const firstLine = code.split(/\r?\n/, 1)[0] || "";
  const isNode =
    modeHint === "node" ||
    [".js", ".mjs", ".cjs"].includes(ext) ||
    /#!\s*\/.*\bnode\b/.test(firstLine);
  const isPy =
    modeHint === "python" ||
    ext === ".py" ||
    /#!\s*\/.*\bpython/.test(firstLine);
  const isPerlRuby =
    modeHint === "perl" ||
    modeHint === "ruby" ||
    ext === ".pl" ||
    ext === ".rb" ||
    /#!\s*\/.*\b(?:perl|ruby)\b/.test(firstLine);
  const isShell =
    modeHint === "shell" ||
    [".sh", ".bash", ".zsh"].includes(ext) ||
    /#!\s*\/.*\b(?:sh|bash|zsh|dash|ksh)\b/.test(firstLine);

  if (isPerlRuby) {
    if (kind === "readonly" || kind === "sicko") {
      return `Executing temporary ${modeHint || "perl/ruby"} script '${scriptToken}' is blocked for ${roleLabel}.`;
    }
    return null;
  }
  if (isNode) {
    return checkInlineNodeFs(code, allowPath, nodePyOptions);
  }
  if (isPy) {
    return checkInlinePythonFs(code, allowPath, nodePyOptions);
  }
  if (isShell) {
    return validateShellCode(code, mergedEnv, outerEnv);
  }
  return validateShellCode(code, mergedEnv, outerEnv);
}

function inspectTempScriptFile(inv, context) {
  const { canonicalTempRoots, realCwd, fallbackBaseDir, mergedEnv, roleLabel, kind } = context;

  if (inv.cmd === "node" || inv.cmd === "nodejs" || inv.cmd === "bun") {
    for (const preloadTarget of extractNodePreloadTargets(inv.args, mergedEnv)) {
      const preloadDeny = inspectSingleTempFile(preloadTarget, "node", context);
      if (preloadDeny) return preloadDeny;
    }
  }

  if (/^python(?:\d+(?:\.\d+)?)?$/.test(inv.cmd)) {
    const mIdx = inv.args.indexOf("-m");
    if (mIdx >= 0 && mIdx + 1 < inv.args.length && typeof mergedEnv.PYTHONPATH === "string") {
      const modName = inv.args[mIdx + 1];
      const modRel = modName.replace(/\./g, "/");
      for (const pyRoot of mergedEnv.PYTHONPATH.split(/[:;]/).filter(Boolean)) {
        const resolvedRoot = resolveShellTargetPath(pyRoot, fallbackBaseDir, mergedEnv);
        if (
          resolvedRoot &&
          isInsideCanonicalTempRoots(resolvedRoot, canonicalTempRoots, realCwd, {
            allowRootEqual: true,
            excludeRealCwd: false,
          })
        ) {
          if (kind === "sicko") {
            return `Executing Python module '${modName}' from PYTHONPATH in canonical temp roots is blocked for ${roleLabel}.`;
          }
          const modFile = join(resolvedRoot, `${modRel}.py`);
          const modInit = join(resolvedRoot, modRel, "__init__.py");
          const candidate = existsSync(modFile) ? modFile : existsSync(modInit) ? modInit : null;
          if (candidate) {
            const modDeny = inspectSingleTempFile(candidate, "python", context);
            if (modDeny) return modDeny;
          } else if (kind === "readonly") {
            return `Unresolvable Python module '${modName}' with PYTHONPATH in canonical temp roots is blocked for ${roleLabel}.`;
          }
        }
      }
    }
  }

  if (inv.cmd === "source" || inv.cmd === ".") {
    const sourced = inv.args[0];
    if (sourced) {
      return inspectSingleTempFile(sourced, "shell", context);
    }
    return null;
  }

  let scriptToken = null;
  let modeHint = "";
  const interp = findInterpreterScriptArg(inv.cmd, inv.args);
  if (interp) {
    scriptToken = interp.scriptToken;
    if (inv.cmd === "node" || inv.cmd === "nodejs" || inv.cmd === "bun") modeHint = "node";
    else if (/^python/.test(inv.cmd)) modeHint = "python";
    else if (inv.cmd === "perl" || inv.cmd === "ruby") modeHint = inv.cmd;
    else modeHint = "shell";
  } else if (inv.rawCmd && (inv.rawCmd.includes("/") || inv.rawCmd.startsWith(".") || inv.rawCmd.startsWith("~"))) {
    scriptToken = inv.rawCmd;
  }

  if (!scriptToken) return null;
  return inspectSingleTempFile(scriptToken, modeHint, context);
}

function extractInlineCodeCheck(inv, allowPath, nodePyOptions) {
  const { cmd, args } = inv;
  if (cmd === "node" || cmd === "nodejs" || cmd === "bun") {
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === "--") break;
      if ((arg === "-e" || arg === "--eval" || arg === "-p" || arg === "--print") && i + 1 < args.length) {
        const deny = checkInlineNodeFs(args[i + 1], allowPath, nodePyOptions);
        if (deny) return deny;
        i += 1;
        continue;
      }
      if (arg.startsWith("--eval=")) {
        const deny = checkInlineNodeFs(arg.slice("--eval=".length), allowPath, nodePyOptions);
        if (deny) return deny;
      } else if (arg.startsWith("--print=")) {
        const deny = checkInlineNodeFs(arg.slice("--print=".length), allowPath, nodePyOptions);
        if (deny) return deny;
      }
    }
  }
  if (/^python(?:\d+(?:\.\d+)?)?$/.test(cmd)) {
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === "--" || arg === "-m") break;
      if ((arg === "-c" || /^-[A-Za-z]+c$/.test(arg)) && i + 1 < args.length) {
        const deny = checkInlinePythonFs(args[i + 1], allowPath, nodePyOptions);
        if (deny) return deny;
        break;
      }
      if (!arg.startsWith("-")) break;
    }
  }
  return null;
}

function isMutatingReadOnlyInvocation(inv, allowReadOnlyTempPath, validateInnerTokens) {
  const { cmd, args } = inv;
  if (!cmd) return null;

  if (HARD_BLOCKED_RO_FS_COMMANDS.has(cmd)) {
    return `Filesystem mutation command '${cmd}' is blocked for read-only ro-* workers.`;
  }

  const sharedDeny = checkSharedTargetConfinement(inv, allowReadOnlyTempPath, "read-only ro-* workers", validateInnerTokens);
  if (sharedDeny !== undefined) return sharedDeny;

  if (cmd === "rm" || cmd === "unlink") {
    const paths = extractPositionalPaths(args);
    if (
      paths.length === 0 ||
      paths.some((p) => !allowReadOnlyTempPath(p, { allowRootEqual: false, allowDevNull: false }))
    ) {
      return `Filesystem command '${cmd}' outside canonical temp roots or allowed artifact screenshot paths is blocked for read-only ro-* workers.`;
    }
    return null;
  }

  if (cmd === "cp") {
    const cpSpec = extractCpOrMvSpec(args);
    const allSourcesImages =
      cpSpec.sources.length > 0 && cpSpec.sources.every((s) => /\.(?:png|jpe?g|webp)$/i.test(s));
    if (
      !cpSpec.valid ||
      cpSpec.destinations.some(
        (d) =>
          !allowReadOnlyTempPath(d, {
            allowRootEqual: true,
            allowDevNull: true,
            allowArtifactDir: allSourcesImages,
            allowArtifactRoot: allSourcesImages,
          }),
      )
    ) {
      return "Filesystem command 'cp' targeting paths outside canonical temp roots or allowed artifact screenshot paths is blocked for read-only ro-* workers.";
    }
    return null;
  }

  if (cmd === "mv") {
    const mvSpec = extractCpOrMvSpec(args);
    const allSourcesImages =
      mvSpec.sources.length > 0 && mvSpec.sources.every((s) => /\.(?:png|jpe?g|webp)$/i.test(s));
    if (
      !mvSpec.valid ||
      mvSpec.sources.some((s) => !allowReadOnlyTempPath(s, { allowRootEqual: false, allowDevNull: false })) ||
      mvSpec.destinations.some(
        (d) =>
          !allowReadOnlyTempPath(d, {
            allowRootEqual: true,
            allowDevNull: false,
            allowArtifactDir: allSourcesImages,
            allowArtifactRoot: allSourcesImages,
          }),
      )
    ) {
      return "Filesystem command 'mv' outside canonical temp roots or allowed artifact screenshot paths is blocked for read-only ro-* workers.";
    }
    return null;
  }

  if (cmd === "tee") {
    const files = extractPositionalPaths(args);
    if (files.some((f) => !allowReadOnlyTempPath(f, { allowRootEqual: false, allowDevNull: true }))) {
      return "Command 'tee' targeting paths outside /dev/null, canonical temp roots, or allowed artifact screenshot paths is blocked for read-only ro-* workers.";
    }
    return null;
  }

  if (cmd === "sed" && extractSedInPlaceTargets(args) !== null) {
    return "In-place 'sed -i' is blocked for read-only ro-* workers.";
  }

  if ((cmd === "perl" || cmd === "ruby") && extractPerlRubyInPlaceTargets(args) !== null) {
    return `In-place '${cmd} -i' is blocked for read-only ro-* workers.`;
  }

  const inlineDeny = extractInlineCodeCheck(inv, allowReadOnlyTempPath, {
    allowDynamicPaths: false,
    roleLabel: "read-only ro-* workers",
  });
  if (inlineDeny) return inlineDeny;

  if (cmd === "git") {
    const { subcmd, subArgs } = parseGitCommand(args);
    if (subcmd === "fetch" && isMutatingGitFetchForReadOnly(subArgs)) {
      return "Mutating 'git fetch' with colon refspec or prune/force/update flags is blocked for read-only ro-* workers.";
    }
    if (isMutatingGitAction(subcmd, subArgs)) {
      return `Mutating git command 'git ${subcmd}' is blocked for read-only ro-* workers.`;
    }
  }

  if (cmd === "npm" || cmd === "pnpm" || cmd === "bun") {
    const sub = args.find((a) => !a.startsWith("-")) || "";
    if (NPM_INSTALL_SUBCOMMANDS.has(sub)) {
      return `Package manager command '${cmd} ${sub}' is blocked for read-only ro-* workers.`;
    }
  }

  if (cmd === "yarn") {
    const sub = args.find((a) => !a.startsWith("-")) || "";
    if (!sub || NPM_INSTALL_SUBCOMMANDS.has(sub) || sub === "upgrade") {
      return `Package manager command 'yarn ${sub || "install"}' is blocked for read-only ro-* workers.`;
    }
  }

  if (cmd === "pip" || cmd === "pip3") {
    const sub = args.find((a) => !a.startsWith("-")) || "";
    if (PIP_INSTALL_SUBCOMMANDS.has(sub)) {
      return `Package install command '${cmd} ${sub}' is blocked for read-only ro-* workers.`;
    }
  }

  if (cmd === "uv") {
    const nonFlags = args.filter((a) => !a.startsWith("-"));
    if (
      ["add", "remove", "sync", "lock"].includes(nonFlags[0] || "") ||
      (nonFlags[0] === "pip" && PIP_INSTALL_SUBCOMMANDS.has(nonFlags[1] || ""))
    ) {
      return "Package mutation via 'uv' is blocked for read-only ro-* workers.";
    }
  }

  if ((cmd === "python" || cmd === "python3") && args[0] === "-m" && args[1] === "pip") {
    const sub = args.slice(2).find((a) => !a.startsWith("-")) || "";
    if (PIP_INSTALL_SUBCOMMANDS.has(sub)) {
      return "Package install via 'python -m pip' is blocked for read-only ro-* workers.";
    }
  }

  if (cmd === "cargo" || cmd === "go" || cmd === "brew" || cmd === "gem" || cmd === "poetry") {
    const sub = args.find((a) => !a.startsWith("-")) || "";
    if (["install", "uninstall", "add", "remove", "upgrade", "update", "get"].includes(sub)) {
      return `Package command '${cmd} ${sub}' is blocked for read-only ro-* workers.`;
    }
  }

  if (cmd === "apt" || cmd === "apt-get" || cmd === "apk") {
    return `System package command '${cmd}' is blocked for read-only ro-* workers.`;
  }

  return null;
}

function checkAuthorShellConfinement(inv, allowAuthorShellPath, resolveForBase, validateInnerTokens) {
  const { cmd, args } = inv;
  if (!cmd) return null;

  const sharedDeny = checkSharedTargetConfinement(
    inv,
    allowAuthorShellPath,
    "confined worker worktree, artifact directory, or canonical temp roots",
    validateInnerTokens,
  );
  if (sharedDeny !== undefined) return sharedDeny;

  if (cmd === "cp") {
    const cpSpec = extractCpOrMvSpec(args);
    if (
      !cpSpec.valid ||
      cpSpec.destinations.some((d) => !allowAuthorShellPath(d, { allowRootEqual: true, allowDevNull: true }))
    ) {
      return "Command 'cp' targeting a path outside confined worker worktree, artifact directory, or canonical temp roots is blocked.";
    }
  }

  if (cmd === "mv") {
    const mvSpec = extractCpOrMvSpec(args);
    if (
      !mvSpec.valid ||
      mvSpec.sources.some((s) => !allowAuthorShellPath(s, { allowRootEqual: false, allowDevNull: false })) ||
      mvSpec.destinations.some((d) => !allowAuthorShellPath(d, { allowRootEqual: true, allowDevNull: true }))
    ) {
      return "Command 'mv' targeting a path outside confined worker worktree, artifact directory, or canonical temp roots is blocked.";
    }
  }

  if (cmd === "ln") {
    const lnSpec = extractLnSpec(args);
    if (
      !lnSpec.valid ||
      lnSpec.linkPaths.some((l) => !allowAuthorShellPath(l, { allowRootEqual: true, allowDevNull: false }))
    ) {
      return "Command 'ln' creating a link outside confined worker worktree, artifact directory, or canonical temp roots is blocked.";
    }
    const resolvedLink = resolveForBase(lnSpec.linkPaths[0]);
    const linkBaseDir = resolvedLink ? (lnSpec.linkIsDir ? resolvedLink : dirname(resolvedLink)) : null;
    for (const src of lnSpec.sources) {
      if (!lnSpec.isSymbolic) {
        if (!allowAuthorShellPath(src, { allowRootEqual: false, allowDevNull: false })) {
          return "Command 'ln' hardlinking a source outside confined worker worktree, artifact directory, or canonical temp roots is blocked.";
        }
      } else if (linkBaseDir && !allowAuthorShellPath(src, { allowRootEqual: true, allowDevNull: false, customBaseDir: linkBaseDir })) {
        return "Command 'ln -s' pointing outside confined worker worktree, artifact directory, or canonical temp roots is blocked.";
      }
    }
  }

  if (cmd === "rm" || cmd === "unlink" || cmd === "rmdir") {
    const paths = extractPositionalPaths(args);
    const hasRecursiveFlag =
      cmd === "rm" &&
      args.some((a) => a === "--recursive" || (/^-[A-Za-z]+$/.test(a) && /[rR]/.test(a)));
    if (
      paths.length === 0 ||
      paths.some(
        (p) =>
          !allowAuthorShellPath(p, {
            allowRootEqual: false,
            allowDevNull: false,
            isRecursiveDelete: hasRecursiveFlag,
          }),
      )
    ) {
      return `Command '${cmd}' targeting a path outside confined worker worktree, artifact directory, or canonical temp roots is blocked.`;
    }
  }

  if (cmd === "patch") {
    const patchSpec = extractPatchTargets(args);
    if (
      !patchSpec.valid ||
      patchSpec.dirTargets.some((d) => !allowAuthorShellPath(d, { allowRootEqual: true, allowDevNull: false })) ||
      patchSpec.fileTargets.some((f) => !allowAuthorShellPath(f, { allowRootEqual: false, allowDevNull: true }))
    ) {
      return "Command 'patch' targeting a path outside confined worker worktree, artifact directory, or canonical temp roots is blocked.";
    }
  }

  if (cmd === "sed") {
    const sedTargets = extractSedInPlaceTargets(args);
    if (
      sedTargets !== null &&
      (sedTargets.length === 0 ||
        sedTargets.some((t) => !allowAuthorShellPath(t, { allowRootEqual: false, allowDevNull: false })))
    ) {
      return "Command 'sed -i' targeting a path outside confined worker worktree, artifact directory, or canonical temp roots is blocked.";
    }
  }

  if (cmd === "perl" || cmd === "ruby") {
    const editTargets = extractPerlRubyInPlaceTargets(args);
    if (
      editTargets !== null &&
      (editTargets.length === 0 ||
        editTargets.some((t) => !allowAuthorShellPath(t, { allowRootEqual: false, allowDevNull: false })))
    ) {
      return `Command '${cmd} -i' targeting a path outside confined worker worktree, artifact directory, or canonical temp roots is blocked.`;
    }
  }

  if (cmd === "tee") {
    const files = extractPositionalPaths(args);
    if (files.some((f) => !allowAuthorShellPath(f, { allowRootEqual: false, allowDevNull: true }))) {
      return "Command 'tee' targeting a path outside confined worker worktree, artifact directory, /dev/null, or canonical temp roots is blocked.";
    }
  }

  const inlineDeny = extractInlineCodeCheck(inv, allowAuthorShellPath, {
    allowDynamicPaths: true,
    roleLabel: "author/adversary workers",
  });
  if (inlineDeny) return inlineDeny;

  if (cmd === "git") {
    const { subcmd, subArgs, globalDirs } = parseGitCommand(args);
    if (isMutatingGitAction(subcmd, subArgs) && globalDirs.some((d) => !allowAuthorShellPath(d, { allowRootEqual: true, allowDevNull: false }))) {
      return `Mutating git command 'git ${subcmd}' targeting a repository outside confined worktree or canonical temp roots is blocked.`;
    }
  }

  return null;
}

function checkSickoShellInvocation(inv, allowSickoWritePath, resolveForBase, realCwd, validateInnerTokens) {
  const { cmd, args } = inv;
  if (!cmd) return null;

  if (SICKO_BLOCKED_FS_COMMANDS.has(cmd)) {
    return `Filesystem mutation command '${cmd}' is blocked for comment-sicko workers; use edit_file on existing files only.`;
  }

  if (cmd === "curl" || cmd === "wget" || cmd === "tar" || cmd === "unzip" || cmd === "rsync" || cmd === "find") {
    const sharedDeny = checkSharedTargetConfinement(inv, allowSickoWritePath, "comment-sicko workers", validateInnerTokens);
    if (sharedDeny) return sharedDeny;
  }

  if (cmd === "tee") {
    const files = extractPositionalPaths(args);
    if (files.some((f) => f !== "/dev/null")) {
      return "Command 'tee' writing to files is blocked for comment-sicko workers.";
    }
  }

  if (cmd === "sed" && extractSedInPlaceTargets(args) !== null) {
    return "In-place 'sed -i' is blocked for comment-sicko workers; use edit_file only.";
  }

  if ((cmd === "perl" || cmd === "ruby") && extractPerlRubyInPlaceTargets(args) !== null) {
    return `In-place '${cmd} -i' is blocked for comment-sicko workers; use edit_file only.`;
  }

  const inlineDeny = extractInlineCodeCheck(inv, allowSickoWritePath, {
    allowDynamicPaths: false,
    roleLabel: "comment-sicko workers",
  });
  if (inlineDeny) return inlineDeny;

  if (cmd === "git") {
    const { subcmd, subArgs, globalDirs } = parseGitCommand(args);
    for (const dir of globalDirs) {
      const resolved = resolveForBase(dir);
      if (!resolved || !realCwd || !isInsideOrEqual(resolved, realCwd)) {
        return "Git command targeting a directory outside the confined worktree is blocked for comment-sicko workers.";
      }
    }
    if (subcmd !== "add" && subcmd !== "commit" && isMutatingGitAction(subcmd, subArgs)) {
      return `Mutating or file-restoring git command 'git ${subcmd}' is blocked for comment-sicko workers.`;
    }
  }

  return null;
}

function extractMcpToolName(toolName, args) {
  if (toolName === "call_mcp_tool") {
    return String(args.ToolName || args.toolName || args.name || "");
  }
  if (toolName.startsWith("mcp_")) {
    return toolName.replace(/^mcp_[^_]+_/, "");
  }
  return "";
}

function handleSessionOrInvocation(payload, env) {
  if (isPluginDisabled(env)) {
    return {};
  }

  const session = classifySession(payload, env, "");
  if (session.sessionKind === "unmanaged" || !session.capsule) {
    return {};
  }

  const convKey = payload.conversationId || "__unknown__";
  const injectedPath = join(session.cacheDir, "injected-capsules.json");
  const injectedMap = session.injectedMap || readJsonObject(injectedPath);
  const priorCapsule = injectedMap[convKey];
  if (priorCapsule === session.capsule) {
    return {};
  }

  const pluginRoot = resolvePluginRoot(env);
  const capsuleAbsPath = join(pluginRoot, session.capsule);
  if (!existsSync(capsuleAbsPath)) {
    return {};
  }

  const rawCapsuleText = readFileSync(capsuleAbsPath, "utf8");
  const isUpgrade = typeof priorCapsule === "string" && priorCapsule.length > 0;
  const hasForkCapsule =
    !isUpgrade && transcriptContainsRoleCapsule(resolveOwnTranscriptPath(payload, session.appDataDir));
  const capsuleText = isUpgrade || hasForkCapsule ? ROLE_OVERRIDE_NOTICE + rawCapsuleText : rawCapsuleText;

  updateJsonKey(injectedPath, convKey, session.capsule);

  return {
    injectSteps: [
      {
        systemMessage: {
          systemMessage: capsuleText,
        },
      },
    ],
  };
}

function parseToolArgs(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs === "string") {
    try {
      const parsed = JSON.parse(rawArgs);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof rawArgs === "object" ? rawArgs : {};
}

function isSafeConversationId(id) {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    !/[/\\]/.test(id) &&
    id !== "." &&
    id !== ".."
  );
}

function resolveWorkerConfinementRoots(payload, env, appDataDir) {
  const hasValidCwd =
    typeof payload.cwd === "string" && payload.cwd.length > 0 && existsSync(payload.cwd);
  const realCwd = hasValidCwd ? realpathSync(payload.cwd) : null;
  const fallbackBaseDir = realCwd || process.cwd();
  const rawArtifactDir =
    typeof payload.artifactDirectoryPath === "string" && payload.artifactDirectoryPath.length > 0
      ? payload.artifactDirectoryPath
      : typeof appDataDir === "string" && appDataDir.length > 0 && isSafeConversationId(payload.conversationId)
        ? join(appDataDir, "brain", payload.conversationId)
        : "";
  const realArtifact =
    rawArtifactDir.length > 0
      ? existsSync(rawArtifactDir)
        ? realpathSync(rawArtifactDir)
        : resolveRealTargetPath(rawArtifactDir, fallbackBaseDir)
      : null;
  const canonicalTempRoots = getCanonicalTempRoots(env);
  return { hasValidCwd, realCwd, fallbackBaseDir, realArtifact, canonicalTempRoots };
}

function isSystemGeneratedArtifactPath(resolvedPath, realArtifact) {
  if (!resolvedPath || !realArtifact) return false;
  return isInsideOrEqual(resolvedPath, join(realArtifact, ".system_generated"));
}

function isAllowedReadOnlyArtifactPath(
  resolvedPath,
  realArtifact,
  realCwd,
  { allowDirectory = false } = {},
) {
  if (!resolvedPath || !realArtifact) return false;
  if (!isStrictlyInside(resolvedPath, realArtifact)) return false;
  if (isSystemGeneratedArtifactPath(resolvedPath, realArtifact)) return false;
  if (realCwd && isInsideOrEqual(resolvedPath, realCwd)) return false;
  if (/\.(?:png|jpe?g|webp)$/i.test(resolvedPath)) return true;
  if (allowDirectory === true && extname(resolvedPath) === "") return true;
  return false;
}

function handlePreToolUse(payload, env) {
  if (isPluginDisabled(env)) {
    return { decision: "allow" };
  }

  const toolCall = payload.toolCall && typeof payload.toolCall === "object" ? payload.toolCall : {};
  const toolName = normalizeToolName(toolCall.name);
  const args = parseToolArgs(toolCall.args);

  const session = classifySession(payload, env, toolName);
  if (session.sessionKind === "unmanaged") {
    return { decision: "allow" };
  }

  if (LEGACY_SUBAGENT_TOOLS.has(toolName)) {
    return {
      decision: "deny",
      reason: "Legacy subagent tools are disabled in Swarm-Centric Pstack v2. Use native swarm.",
    };
  }

  const { kind, memberName } = session;
  const { hasValidCwd, realCwd, fallbackBaseDir, realArtifact, canonicalTempRoots } =
    resolveWorkerConfinementRoots(payload, env, session.appDataDir);

  if (kind === "readonly") {
    if (toolName === "edit_file" || toolName === "write_file") {
      const rawTarget = args.Path ?? args.path ?? args.TargetFile ?? args.targetFile ?? args.file_path ?? "";
      if (typeof rawTarget !== "string" || rawTarget.length === 0) {
        return {
          decision: "deny",
          reason: `Read-only worker (${memberName || "ro-*"}) cannot call ${toolName} without a valid temp path.`,
        };
      }
      const realTarget = resolveRealTargetPath(rawTarget, fallbackBaseDir);
      if (!realTarget || isSystemGeneratedArtifactPath(realTarget, realArtifact)) {
        return {
          decision: "deny",
          reason: `Read-only worker (${memberName || "ro-*"}) cannot call ${toolName} on protected or unresolvable path '${rawTarget}'.`,
        };
      }
      if (realArtifact && isInsideOrEqual(realTarget, realArtifact)) {
        if (toolName === "write_file" && isAllowedReadOnlyArtifactPath(realTarget, realArtifact, realCwd)) {
          return { decision: "allow" };
        }
        return {
          decision: "deny",
          reason: `Read-only worker (${memberName || "ro-*"}) can only write screenshot image files (.png, .jpg, .jpeg, .webp) via write_file inside its artifact directory.`,
        };
      }
      if (
        !isInsideCanonicalTempRoots(realTarget, canonicalTempRoots, realCwd, {
          allowRootEqual: false,
          excludeRealCwd: true,
        })
      ) {
        return {
          decision: "deny",
          reason: `Read-only worker (${memberName || "ro-*"}) can only call ${toolName} inside canonical temp roots.`,
        };
      }
      return { decision: "allow" };
    }

    if (toolName === "run_command") {
      const commandLine = String(args.CommandLine ?? args.command ?? args.commandLine ?? "");

      const validateReadOnlyShell = (code, inheritedEnv = {}, outerEnv = env, depth = 0) => {
        if (depth > 4) return "Nested shell script depth limit exceeded for read-only ro-* workers.";
        const { invocations, redirectTargets } = collectInvocations(code, 0, inheritedEnv, outerEnv);

        const makeAllowInvTempPath = (mergedEnv) => (rawToken, opts = {}) => {
          const {
            allowRootEqual = false,
            allowDevNull = false,
            allowArtifactDir = false,
            allowArtifactRoot = false,
            forbidReadOnlyArtifact = false,
          } = opts;
          const resolved = resolveShellTargetPath(rawToken, fallbackBaseDir, mergedEnv);
          if (!resolved) return false;
          if (allowDevNull && resolved === "/dev/null") return true;
          if (isSystemGeneratedArtifactPath(resolved, realArtifact)) return false;
          if (realArtifact && isInsideOrEqual(resolved, realArtifact)) {
            if (forbidReadOnlyArtifact) return false;
            if (
              allowArtifactRoot &&
              resolved === realArtifact &&
              !(realCwd && isInsideOrEqual(resolved, realCwd))
            ) {
              return true;
            }
            return isAllowedReadOnlyArtifactPath(resolved, realArtifact, realCwd, {
              allowDirectory: Boolean(allowArtifactDir),
            });
          }
          return isInsideCanonicalTempRoots(resolved, canonicalTempRoots, realCwd, {
            allowRootEqual,
            excludeRealCwd: true,
          });
        };

        for (const redirectTarget of redirectTargets) {
          const mergedEnv = { ...outerEnv, ...redirectTarget.env };
          if (!makeAllowInvTempPath(mergedEnv)(redirectTarget.target, { allowRootEqual: false, allowDevNull: true })) {
            return "Output file redirection outside /dev/null, canonical temp roots, or allowed artifact screenshot paths is blocked for read-only ro-* workers.";
          }
        }

        for (const inv of invocations) {
          const mergedEnv = { ...outerEnv, ...inv.env };
          const allowInvTempPath = makeAllowInvTempPath(mergedEnv);
          const validateInnerTokens = (innerTokens, searchRoots) => {
            const innerInv = unwrapCommandSegment(innerTokens, inv.env, outerEnv);
            if (!innerInv.cmd) return null;
            const innerAllow = (rawToken, opts = {}) => {
              if (rawToken === "{}" || rawToken.includes("{}")) {
                return searchRoots.every((r) => allowInvTempPath(r, { allowRootEqual: true, allowDevNull: false }));
              }
              return allowInvTempPath(rawToken, opts);
            };
            return isMutatingReadOnlyInvocation(innerInv, innerAllow, validateInnerTokens);
          };
          const denyReason = isMutatingReadOnlyInvocation(inv, allowInvTempPath, validateInnerTokens);
          if (denyReason) return denyReason;

          const scriptDeny = inspectTempScriptFile(inv, {
            allowPath: allowInvTempPath,
            nodePyOptions: { allowDynamicPaths: false, roleLabel: "read-only ro-* workers" },
            canonicalTempRoots,
            realCwd,
            fallbackBaseDir,
            mergedEnv,
            outerEnv,
            roleLabel: "read-only ro-* workers",
            kind,
            validateShellCode: (scriptCode, scriptEnv, baseOuterEnv) =>
              validateReadOnlyShell(scriptCode, scriptEnv, baseOuterEnv, depth + 1),
          });
          if (scriptDeny) return scriptDeny;
        }
        return null;
      };

      const roDeny = validateReadOnlyShell(commandLine, {}, env, 0);
      if (roDeny) {
        return { decision: "deny", reason: roDeny };
      }
    }

    if (toolName === "call_mcp_tool" || toolName.startsWith("mcp_")) {
      const mcpToolName = extractMcpToolName(toolName, args);
      if (!SWARM_BOARD_TOOLS.has(mcpToolName)) {
        const normalized = mcpToolName.replace(/-/g, "_");
        if (MUTATING_MCP_PATTERN.test(normalized)) {
          return {
            decision: "deny",
            reason: `Mutating MCP tool '${mcpToolName}' is blocked for read-only ro-* workers.`,
          };
        }
      }
    }
  }

  if (kind === "sicko" && toolName === "write_file") {
    return {
      decision: "deny",
      reason: `Comment-sicko worker (${memberName || "sicko-*"}) cannot call write_file; use edit_file on existing files only.`,
    };
  }

  if (
    (kind === "author" || kind === "adversary" || kind === "sicko") &&
    (toolName === "edit_file" || toolName === "write_file")
  ) {
    const rawTarget = args.Path ?? args.path ?? args.TargetFile ?? args.targetFile ?? args.file_path ?? "";
    if (typeof rawTarget !== "string" || rawTarget.length === 0) {
      return { decision: "deny", reason: "Missing target file path." };
    }
    if (!hasValidCwd || !realCwd) {
      return { decision: "deny", reason: "Missing or non-existent worker cwd for path confinement." };
    }

    const realTarget = resolveRealTargetPath(rawTarget, realCwd);
    if (!realTarget) {
      return { decision: "deny", reason: "Target file path failed symlink resolution." };
    }

    if (isSystemGeneratedArtifactPath(realTarget, realArtifact)) {
      return {
        decision: "deny",
        reason: `Path '${rawTarget}' inside protected '.system_generated' artifact metadata is blocked for worker '${memberName || kind}'.`,
      };
    }

    const insideCwd = isStrictlyInside(realTarget, realCwd);
    const insideArtifact = realArtifact ? isStrictlyInside(realTarget, realArtifact) : false;
    const insideTemp =
      kind === "author" || kind === "adversary"
        ? isInsideCanonicalTempRoots(realTarget, canonicalTempRoots, realCwd, {
            allowRootEqual: false,
            excludeRealCwd: false,
          })
        : false;

    if (!insideCwd && !insideArtifact && !insideTemp) {
      return {
        decision: "deny",
        reason: `Path '${rawTarget}' escapes confined worker worktree '${realCwd}'.`,
      };
    }
  }

  if (toolName === "run_command") {
    const commandLine = String(args.CommandLine ?? args.command ?? args.commandLine ?? "");
    const { invocations, redirectTargets } = collectInvocations(commandLine, 0, {}, env);

    if (kind === "sicko") {
      for (const redirectTarget of redirectTargets) {
        if (redirectTarget.target !== "/dev/null") {
          return {
            decision: "deny",
            reason:
              "Shell file redirection outside /dev/null is blocked for comment-sicko workers; use edit_file on existing files only.",
          };
        }
      }
      const allowSickoWritePath = (_rawToken, opts = {}) => {
        if (opts.allowDevNull && _rawToken === "/dev/null") return true;
        return false;
      };
      for (const inv of invocations) {
        const mergedEnv = { ...env, ...inv.env };
        const resolveForBase = (rawToken) =>
          resolveShellTargetPath(rawToken, realCwd || fallbackBaseDir, mergedEnv);
        const validateInnerTokens = (innerTokens) => {
          const innerInv = unwrapCommandSegment(innerTokens, inv.env, env);
          if (!innerInv.cmd) return null;
          return checkSickoShellInvocation(innerInv, allowSickoWritePath, resolveForBase, realCwd, validateInnerTokens);
        };
        const sickoDeny = checkSickoShellInvocation(inv, allowSickoWritePath, resolveForBase, realCwd, validateInnerTokens);
        if (sickoDeny) {
          return { decision: "deny", reason: sickoDeny };
        }
        const scriptDeny = inspectTempScriptFile(inv, {
          allowPath: allowSickoWritePath,
          nodePyOptions: { allowDynamicPaths: false, roleLabel: "comment-sicko workers" },
          canonicalTempRoots,
          realCwd,
          fallbackBaseDir,
          mergedEnv,
          outerEnv: env,
          roleLabel: "comment-sicko workers",
          kind,
          validateShellCode: () => "Executing temporary shell script is blocked for comment-sicko workers.",
        });
        if (scriptDeny) {
          return { decision: "deny", reason: scriptDeny };
        }
      }
    }

    if (kind === "author" || kind === "adversary") {
      const checkConfinedShellPath = (rawToken, mergedEnv, opts = {}) => {
        const {
          allowRootEqual = false,
          allowDevNull = false,
          customBaseDir = null,
          isRecursiveDelete = false,
        } = opts;
        const activeBase = customBaseDir || realCwd;
        if (!activeBase && !isAbsolute(rawToken) && !rawToken.startsWith("~") && !rawToken.startsWith("$")) {
          return false;
        }
        const resolved = resolveShellTargetPath(rawToken, activeBase || fallbackBaseDir, mergedEnv);
        if (!resolved) return false;
        if (allowDevNull && resolved === "/dev/null") return true;
        if (isSystemGeneratedArtifactPath(resolved, realArtifact)) return false;
        if (
          isRecursiveDelete &&
          realArtifact &&
          isInsideOrEqual(join(realArtifact, ".system_generated"), resolved)
        ) {
          return false;
        }
        if (realCwd && (allowRootEqual ? isInsideOrEqual(resolved, realCwd) : isStrictlyInside(resolved, realCwd))) {
          return true;
        }
        if (realArtifact && isInsideOrEqual(resolved, realArtifact)) {
          return allowRootEqual ? true : isStrictlyInside(resolved, realArtifact);
        }
        return isInsideCanonicalTempRoots(resolved, canonicalTempRoots, realCwd, {
          allowRootEqual,
          excludeRealCwd: false,
        });
      };

      const validateAuthorShell = (code, inheritedEnv = {}, outerEnv = env, depth = 0) => {
        if (depth > 4) return "Nested shell script depth limit exceeded.";
        const shellData = depth === 0 ? { invocations, redirectTargets } : collectInvocations(code, 0, inheritedEnv, outerEnv);

        for (const redirectTarget of shellData.redirectTargets) {
          const mergedEnv = { ...outerEnv, ...redirectTarget.env };
          if (!checkConfinedShellPath(redirectTarget.target, mergedEnv, { allowRootEqual: false, allowDevNull: true })) {
            return "Shell output redirection outside confined worker worktree, artifact directory, /dev/null, or canonical temp roots is blocked.";
          }
        }

        for (const inv of shellData.invocations) {
          const mergedEnv = { ...outerEnv, ...inv.env };
          const allowInvPath = (rawToken, opts = {}) => checkConfinedShellPath(rawToken, mergedEnv, opts);
          const resolveForBase = (rawToken) =>
            resolveShellTargetPath(rawToken, realCwd || fallbackBaseDir, mergedEnv);
          const validateInnerTokens = (innerTokens, searchRoots) => {
            const innerInv = unwrapCommandSegment(innerTokens, inv.env, outerEnv);
            if (!innerInv.cmd) return null;
            const innerAllow = (rawToken, opts = {}) => {
              if (rawToken === "{}" || rawToken.includes("{}")) {
                return searchRoots.every((r) => allowInvPath(r, { allowRootEqual: true, allowDevNull: false }));
              }
              return allowInvPath(rawToken, opts);
            };
            return checkAuthorShellConfinement(innerInv, innerAllow, resolveForBase, validateInnerTokens);
          };
          const authorDeny = checkAuthorShellConfinement(inv, allowInvPath, resolveForBase, validateInnerTokens);
          if (authorDeny) return authorDeny;

          const scriptDeny = inspectTempScriptFile(inv, {
            allowPath: allowInvPath,
            nodePyOptions: { allowDynamicPaths: true, roleLabel: "author/adversary workers" },
            canonicalTempRoots,
            realCwd,
            fallbackBaseDir,
            mergedEnv,
            outerEnv,
            roleLabel: "author/adversary workers",
            kind,
            validateShellCode: (scriptCode, scriptEnv, baseOuterEnv) =>
              validateAuthorShell(scriptCode, scriptEnv, baseOuterEnv, depth + 1),
          });
          if (scriptDeny) return scriptDeny;
        }
        return null;
      };

      const authorDeny = validateAuthorShell(commandLine, {}, env, 0);
      if (authorDeny) {
        return { decision: "deny", reason: authorDeny };
      }
    }

    for (const inv of invocations) {
      if (inv.cmd !== "git") continue;
      const { subcmd, subArgs } = parseGitCommand(inv.args);
      if (subcmd !== "push") continue;

      if (isForcePushToProtectedBranch(subArgs)) {
        return {
          decision: "deny",
          reason: "Force-pushing to main or master is blocked across all swarm roles.",
        };
      }

      if (kind === "adversary" || kind === "sicko") {
        return {
          decision: "deny",
          reason: `Role '${kind}' (${memberName}) is never permitted to run git push.`,
        };
      }

      if (kind === "author") {
        const allowPush =
          inv.env.PSTACK_ALLOW_PUSH === "1" ||
          env.PSTACK_ALLOW_PUSH === "1";
        if (!allowPush) {
          return {
            decision: "deny",
            reason:
              "Author workers cannot run git push without explicit PSTACK_ALLOW_PUSH=1 authorization.",
          };
        }
      }
    }
  }

  return { decision: "allow" };
}

function main() {
  let rawInput = "";
  try {
    rawInput = readFileSync(0, "utf8");
  } catch {
    rawInput = "";
  }

  if (
    typeof process.env.PSTACK_PLUGIN_ROOT === "string" &&
    process.env.PSTACK_PLUGIN_ROOT.length > 0 &&
    process.env.PSTACK_GUARD_DELEGATED !== "1"
  ) {
    const targetGuard = join(process.env.PSTACK_PLUGIN_ROOT, "hooks", "guard.mjs");
    if (existsSync(targetGuard)) {
      let selfReal = null;
      let targetReal = null;
      try {
        selfReal = realpathSync(fileURLToPath(import.meta.url));
        targetReal = realpathSync(targetGuard);
      } catch {}
      if (selfReal && targetReal && selfReal !== targetReal) {
        const delegatedOut = execFileSync(process.execPath, [targetReal], {
          input: rawInput,
          env: { ...process.env, PSTACK_GUARD_DELEGATED: "1" },
          encoding: "utf8",
        });
        process.stdout.write(delegatedOut);
        return;
      }
    }
  }

  let payload = {};
  if (rawInput.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawInput);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed;
      }
    } catch {
      payload = {};
    }
  }

  const eventName = String(payload.hookEventName || "");
  let output = {};

  if (eventName === "SessionStart" || eventName === "PreInvocation") {
    output = handleSessionOrInvocation(payload, process.env);
  } else if (eventName === "PreToolUse" || payload.toolCall) {
    output = handlePreToolUse(payload, process.env);
  }

  process.stdout.write(JSON.stringify(output) + "\n");
}

main();
