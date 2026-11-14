#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
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

const ROLE_CAPSULE_HEADING_RE = /(?:^|\r?\n|\\n)# [^\r\n\\]+ role capsule(?:\r?\n|\\n|$)/i;

const ROLE_OVERRIDE_NOTICE =
  "> **Role override.** Your active swarm role has changed. The role capsule below supersedes every earlier role capsule in this conversation history, including rules inherited through `fork`.\n\n";

const MUTATING_MCP_PATTERN =
  /(^|_)(create|update|delete|remove|set|post|reply|resolve|merge|close|push|write|edit|append|restore|upload|generate|install|uninstall|send|modify|patch|drop|insert)(_|$)/i;

const MUTATING_GIT_SUBCOMMANDS = new Set([
  "commit",
  "push",
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
  "truncate",
  "dd",
  "patch",
  "ln",
  "install",
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
  if (typeof env.PLUGIN_DATA === "string" && env.PLUGIN_DATA.length > 0) {
    return env.PLUGIN_DATA;
  }
  return appDataDir
    ? join(appDataDir, "plugin_data", "agy-pstack-next")
    : join(tmpdir(), "pstack-swarm-guard");
}

function resolvePluginRoot(env) {
  if (typeof env.PLUGIN_ROOT === "string" && env.PLUGIN_ROOT.length > 0) {
    return env.PLUGIN_ROOT;
  }
  return dirname(dirname(fileURLToPath(import.meta.url)));
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

function transcriptIsUnforkedUserRoot(transcriptPath, hasPriorInjectedCapsule) {
  if (!transcriptPath || !existsSync(transcriptPath)) return false;
  try {
    const content = readFileSync(transcriptPath, "utf8");
    if (/\[swarm\] new board message|Your assignment \(recorded on the board/.test(content)) {
      return false;
    }
    if (!hasPriorInjectedCapsule && ROLE_CAPSULE_HEADING_RE.test(content)) {
      return false;
    }
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = JSON.parse(trimmed);
      return Boolean(parsed && typeof parsed === "object" && parsed.type === "USER_INPUT");
    }
  } catch {
    return false;
  }
  return false;
}

function transcriptContainsRoleCapsule(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return false;
  try {
    const content = readFileSync(transcriptPath, "utf8");
    if (ROLE_CAPSULE_HEADING_RE.test(content)) return true;
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof parsed.content === "string" &&
          ROLE_CAPSULE_HEADING_RE.test(parsed.content)
        ) {
          return true;
        }
      } catch {}
    }
  } catch {
    return false;
  }
  return false;
}

function extractMembersFromDoc(doc, targetConversationId) {
  const workerEntries = {};
  let matchedCoordinator = false;
  const members = doc && typeof doc === "object" ? doc.members : null;
  if (!members || typeof members !== "object") {
    return { hasMembers: false, workerEntries, matchedCoordinator };
  }
  for (const [memberName, info] of Object.entries(members)) {
    if (!info || typeof info !== "object") continue;
    const cid = info.conversation_id || info.conversationId;
    if (typeof cid !== "string" || cid.length === 0) continue;
    if (memberName === "coordinator" || info.role === "coordinator") {
      if (cid === targetConversationId) matchedCoordinator = true;
      continue;
    }
    workerEntries[cid] = memberName;
  }
  return { hasMembers: true, workerEntries, matchedCoordinator };
}

function resolveWorkerOrCoordinatorFromSwarm(
  conversationId,
  payload,
  appDataDir,
  cacheDir,
  hasPriorInjectedCapsule,
) {
  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return { workerName: null, isKnownCoordinator: false };
  }

  const mapPath = join(cacheDir, "member-map.json");
  const cachedMap = readJsonObject(mapPath);
  const cachedName = cachedMap[conversationId];
  if (typeof cachedName === "string" && cachedName.length > 0 && cachedName !== "coordinator") {
    return { workerName: cachedName, isKnownCoordinator: false };
  }

  if (!appDataDir) {
    return { workerName: null, isKnownCoordinator: false };
  }

  const candidateRoots = [payload.rootConversationId, payload.parentConversationId];
  const checkedRoots = new Set();
  for (const rootId of candidateRoots) {
    if (typeof rootId !== "string" || rootId.length === 0 || rootId === conversationId || checkedRoots.has(rootId)) {
      continue;
    }
    checkedRoots.add(rootId);
    const membersPath = join(appDataDir, "brain", rootId, ".system_generated", "swarm", "members.json");
    if (!existsSync(membersPath)) continue;
    const { workerEntries, matchedCoordinator } = extractMembersFromDoc(
      readJsonObject(membersPath),
      conversationId,
    );
    updateJsonKeys(mapPath, workerEntries);
    if (workerEntries[conversationId]) {
      return { workerName: workerEntries[conversationId], isKnownCoordinator: false };
    }
    if (matchedCoordinator) {
      return { workerName: null, isKnownCoordinator: true };
    }
  }

  const ownMembersPath = join(appDataDir, "brain", conversationId, ".system_generated", "swarm", "members.json");
  if (existsSync(ownMembersPath)) {
    const { workerEntries } = extractMembersFromDoc(readJsonObject(ownMembersPath), conversationId);
    updateJsonKeys(mapPath, workerEntries);
    if (workerEntries[conversationId]) {
      return { workerName: workerEntries[conversationId], isKnownCoordinator: false };
    }
    return { workerName: null, isKnownCoordinator: true };
  }

  const nonWorkerRootsPath = join(cacheDir, "non-worker-roots.json");
  const nonWorkerRoots = readJsonObject(nonWorkerRootsPath);
  if (nonWorkerRoots[conversationId]) {
    return { workerName: null, isKnownCoordinator: false };
  }

  const ownTranscriptPath = resolveOwnTranscriptPath(payload, appDataDir);
  if (transcriptIsUnforkedUserRoot(ownTranscriptPath, hasPriorInjectedCapsule)) {
    return { workerName: null, isKnownCoordinator: false };
  }

  const brainDir = join(appDataDir, "brain");
  if (!existsSync(brainDir)) {
    return { workerName: null, isKnownCoordinator: false };
  }

  let entries = [];
  try {
    entries = readdirSync(brainDir, { withFileTypes: true });
  } catch {
    return { workerName: null, isKnownCoordinator: false };
  }

  const discoveredWorkers = {};
  let matchedCoordinator = false;
  for (const entry of entries) {
    if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name === conversationId || checkedRoots.has(entry.name)) {
      continue;
    }
    const membersPath = join(brainDir, entry.name, ".system_generated", "swarm", "members.json");
    if (!existsSync(membersPath)) continue;
    const extracted = extractMembersFromDoc(readJsonObject(membersPath), conversationId);
    Object.assign(discoveredWorkers, extracted.workerEntries);
    if (extracted.matchedCoordinator) matchedCoordinator = true;
  }

  updateJsonKeys(mapPath, discoveredWorkers);
  if (discoveredWorkers[conversationId]) {
    return { workerName: discoveredWorkers[conversationId], isKnownCoordinator: false };
  }
  if (matchedCoordinator) {
    return { workerName: null, isKnownCoordinator: true };
  }

  updateJsonKey(nonWorkerRootsPath, conversationId, true);
  return { workerName: null, isKnownCoordinator: false };
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
  if (
    memberName === "verifier" ||
    memberName.startsWith("verifier-") ||
    memberName.endsWith("-verifier") ||
    memberName.startsWith("verify-")
  ) {
    return { kind: "readonly", capsule: "roles/research.md" };
  }
  return { kind: "author", capsule: "roles/poteto-agent.md" };
}

function classifySession(payload, env, normalizedToolName = "") {
  const appDataDir = resolveAppDataDir(payload, env);
  const cacheDir = resolveCacheDir(appDataDir, env);
  const conversationId = typeof payload.conversationId === "string" ? payload.conversationId : "";
  const injectedPath = join(cacheDir, "injected-capsules.json");
  const injectedMap = readJsonObject(injectedPath);
  const alreadyInjected =
    conversationId.length > 0 &&
    typeof injectedMap[conversationId] === "string" &&
    injectedMap[conversationId].length > 0;

  const { workerName, isKnownCoordinator } = resolveWorkerOrCoordinatorFromSwarm(
    conversationId,
    payload,
    appDataDir,
    cacheDir,
    alreadyInjected,
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

  const matchesSlashCommand =
    typeof payload.lastUserInput === "string" && PSTACK_SLASH_COMMAND_RE.test(payload.lastUserInput);
  const matchesSwarmBoardTool = SWARM_BOARD_TOOLS.has(normalizedToolName);
  const forcedCoordinator = env.PSTACK_FORCE_COORDINATOR === "1";

  if (
    isKnownCoordinator ||
    alreadyInjected ||
    matchesSlashCommand ||
    matchesSwarmBoardTool ||
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

function resolveShellTargetPath(rawToken, baseDir, env) {
  if (typeof rawToken !== "string" || rawToken.length === 0) return null;
  if (rawToken === "/dev/null") return "/dev/null";

  let expanded = rawToken;
  if (expanded === "~" || expanded.startsWith("~/")) {
    const home = env.HOME || homedir();
    expanded = expanded === "~" ? home : join(home, expanded.slice(2));
  } else if (expanded.startsWith("~")) {
    return null;
  }

  if (/^\$(?:TMPDIR|\{TMPDIR\})(?=\/|$)/.test(expanded)) {
    const tmpVal = env.TMPDIR || tmpdir();
    expanded = expanded.replace(/^\$(?:TMPDIR|\{TMPDIR\})/, tmpVal);
  }

  if (/[$`]/.test(expanded)) {
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
      let depth = 1;
      let j = i + 2;
      let subSingle = false;
      let subDouble = false;
      while (j < command.length && depth > 0) {
        const c = command[j];
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
      if (depth === 0) {
        subs.push(command.slice(i + 2, j - 1));
        i = j;
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

function readNextShellToken(str, startIdx) {
  let i = startIdx;
  while (i < str.length && (str[i] === " " || str[i] === "\t")) {
    i += 1;
  }
  if (i >= str.length) return { token: "", nextIdx: i };
  let token = "";
  let inSingle = false;
  let inDouble = false;

  while (i < str.length) {
    const ch = str[i];
    if (!inSingle && !inDouble && " \t\r\n|&;()<>".includes(ch)) {
      break;
    }
    if (ch === "\\" && !inSingle) {
      if (i + 1 < str.length) token += str[i + 1];
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
    token += ch;
    i += 1;
  }
  return { token, nextIdx: i };
}

function extractOutputRedirectTargets(command) {
  const targets = [];
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
    if (!inSingle && !inDouble && ch === "#" && (i === 0 || " \t\r\n;|(&".includes(command[i - 1]))) {
      while (i < command.length && command[i] !== "\n") i += 1;
      continue;
    }
    if (!inSingle && !inDouble && ch === "&" && command[i + 1] === ">") {
      const opLen = command[i + 2] === ">" ? 3 : 2;
      const { token, nextIdx } = readNextShellToken(command, i + opLen);
      targets.push(token);
      i = nextIdx;
      continue;
    }
    if (!inSingle && !inDouble && ch === "<" && command[i + 1] === ">") {
      const { token, nextIdx } = readNextShellToken(command, i + 2);
      targets.push(token);
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
        const { token, nextIdx } = readNextShellToken(command, i + 2);
        targets.push(token);
        i = nextIdx;
        continue;
      }
      const opLen = command[i + 1] === ">" || command[i + 1] === "|" ? 2 : 1;
      const { token, nextIdx } = readNextShellToken(command, i + opLen);
      targets.push(token);
      i = nextIdx;
      continue;
    }
    i += 1;
  }
  return targets;
}

function tokenizeShellSegments(command) {
  const segments = [];
  let current = [];
  let token = "";
  let hasTokenChars = false;
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  const flushToken = () => {
    if (hasTokenChars) {
      current.push(token);
      token = "";
      hasTokenChars = false;
    }
  };

  const flushSegment = () => {
    flushToken();
    if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  };

  while (i < command.length) {
    const ch = command[i];
    if (ch === "\\" && !inSingle) {
      if (i + 1 < command.length && command[i + 1] === "\n") {
        i += 2;
        continue;
      }
      hasTokenChars = true;
      if (i + 1 < command.length) token += command[i + 1];
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
    if (!inSingle && !inDouble) {
      if (ch === " " || ch === "\t" || ch === "\r") {
        flushToken();
        i += 1;
        continue;
      }
      if (ch === "#" && !hasTokenChars) {
        while (i < command.length && command[i] !== "\n") i += 1;
        continue;
      }
      if (ch === "\n" || ch === ";" || ch === "(" || ch === ")") {
        flushSegment();
        i += 1;
        continue;
      }
      if (ch === "|" || ch === "&") {
        if (ch === "&" && command[i + 1] === ">") {
          flushToken();
          const opLen = command[i + 2] === ">" ? 3 : 2;
          const { nextIdx } = readNextShellToken(command, i + opLen);
          i = nextIdx;
          continue;
        }
        flushSegment();
        if (command[i + 1] === ch) i += 2;
        else i += 1;
        continue;
      }
      if (ch === ">" || ch === "<") {
        if (hasTokenChars && /^\d+$/.test(token)) {
          token = "";
          hasTokenChars = false;
        } else {
          flushToken();
        }
        if (ch === "<" && command[i + 1] === "<" && command[i + 2] === "<") {
          const { nextIdx } = readNextShellToken(command, i + 3);
          i = nextIdx;
          continue;
        }
        if (ch === "<" && command[i + 1] === "<") {
          const opLen = command[i + 2] === "-" ? 3 : 2;
          const { nextIdx } = readNextShellToken(command, i + opLen);
          i = nextIdx;
          continue;
        }
        if (ch === ">" && command[i + 1] === "&") {
          const fdMatch = command.slice(i + 2).match(/^(?:\d+|-)/);
          if (fdMatch) {
            i += 2 + fdMatch[0].length;
            continue;
          }
          const { nextIdx } = readNextShellToken(command, i + 2);
          i = nextIdx;
          continue;
        }
        const opLen = command[i + 1] === ch || command[i + 1] === "|" || command[i + 1] === "&" || command[i + 1] === ">" ? 2 : 1;
        const { nextIdx } = readNextShellToken(command, i + opLen);
        i = nextIdx;
        continue;
      }
    }
    hasTokenChars = true;
    token += ch;
    i += 1;
  }

  flushSegment();
  return segments;
}

function unwrapCommandSegment(tokens, inheritedEnv = {}) {
  const env = { ...inheritedEnv };
  let idx = 0;

  while (idx < tokens.length) {
    const tok = tokens[idx];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
      const eq = tok.indexOf("=");
      env[tok.slice(0, eq)] = tok.slice(eq + 1);
      idx += 1;
      continue;
    }
    const base = basename(tok);
    if (base === "export" && idx === 0) {
      for (let j = 1; j < tokens.length; j += 1) {
        const arg = tokens[j];
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) {
          const eq = arg.indexOf("=");
          env[arg.slice(0, eq)] = arg.slice(eq + 1);
        }
      }
      return { cmd: "export", args: tokens.slice(1), env };
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
          idx += 2;
          continue;
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(envArg)) {
          const eq = envArg.indexOf("=");
          env[envArg.slice(0, eq)] = envArg.slice(eq + 1);
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
    return { cmd: "", args: [], env };
  }
  return {
    cmd: basename(tokens[idx]),
    args: tokens.slice(idx + 1),
    env,
  };
}

function collectInvocations(command, depth = 0) {
  if (depth > 8 || !command) return { invocations: [], redirectTargets: [] };
  const { strippedCommand, unquotedBodies } = preprocessHeredocs(command);
  const redirectTargets = [...extractOutputRedirectTargets(strippedCommand)];
  const invocations = [];
  const scriptEnv = {};

  const substitutions = [...extractCommandSubstitutions(strippedCommand)];
  for (const body of unquotedBodies) {
    substitutions.push(...extractCommandSubstitutions(body));
  }

  for (const sub of substitutions) {
    const subRes = collectInvocations(sub, depth + 1);
    redirectTargets.push(...subRes.redirectTargets);
    invocations.push(...subRes.invocations);
  }

  const rawSegments = tokenizeShellSegments(strippedCommand);
  for (const seg of rawSegments) {
    const parsed = unwrapCommandSegment(seg, scriptEnv);
    if (!parsed.cmd) {
      Object.assign(scriptEnv, parsed.env);
      continue;
    }
    if (parsed.cmd === "export") {
      Object.assign(scriptEnv, parsed.env);
      continue;
    }
    invocations.push(parsed);

    if (["sh", "bash", "zsh", "dash", "ksh"].includes(parsed.cmd)) {
      for (let i = 0; i < parsed.args.length; i += 1) {
        const arg = parsed.args[i];
        if (arg === "--") break;
        if (/^-[a-zA-Z]*c$/.test(arg) && i + 1 < parsed.args.length) {
          const inner = collectInvocations(parsed.args[i + 1], depth + 1);
          redirectTargets.push(...inner.redirectTargets);
          for (const inv of inner.invocations) {
            invocations.push({ ...inv, env: { ...parsed.env, ...inv.env } });
          }
          break;
        }
      }
    } else if (parsed.cmd === "eval" && parsed.args.length > 0) {
      const inner = collectInvocations(parsed.args.join(" "), depth + 1);
      redirectTargets.push(...inner.redirectTargets);
      for (const inv of inner.invocations) {
        invocations.push({ ...inv, env: { ...parsed.env, ...inv.env } });
      }
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

function checkInlineNodeFs(code, allowReadOnlyTempPath) {
  if (/\[[^\]]*(?:writeFile|appendFile|unlink|rm|rmdir|rename|copyFile|cp|mkdir|mkdtemp|chmod|chown|truncate|symlink|link|createWriteStream|openSync)/.test(code)) {
    return "Dynamic fs mutation via inline Node script is blocked for read-only ro-* workers.";
  }

  if (
    /\.\s*(writeFileSync|writeFile|appendFileSync|appendFile|unlinkSync|unlink|rmSync|rm|rmdirSync|rmdir|renameSync|rename|copyFileSync|copyFile|cpSync|cp|mkdirSync|mkdir|mkdtempSync|mkdtemp|chmodSync|chmod|chownSync|chown|truncateSync|truncate|symlinkSync|symlink|linkSync|link|createWriteStream|openSync)\b(?!\s*\()/.test(
      code,
    ) ||
    /\b(writeFileSync|writeFile|appendFileSync|appendFile|unlinkSync|unlink|rmSync|rm|rmdirSync|rmdir|renameSync|rename|copyFileSync|copyFile|cpSync|cp|mkdirSync|mkdir|mkdtempSync|mkdtemp|chmodSync|chmod|chownSync|chown|truncateSync|truncate|symlinkSync|symlink|linkSync|link|createWriteStream|openSync)\s*(?::|\bas\b)/.test(
      code,
    )
  ) {
    return "Aliased fs mutation API in inline Node script is blocked for read-only ro-* workers.";
  }

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
      return `Unparseable fs.${fnName} call in inline Node script is blocked for read-only ro-* workers.`;
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
      const pathLit = parseStaticJsString(callArgs[0] || "");
      if (!pathLit.ok || !allowReadOnlyTempPath(pathLit.value, { allowRootEqual: false, allowDevNull: true })) {
        return `Inline Node fs.${fnName} write outside canonical temp roots is blocked for read-only ro-* workers.`;
      }
      continue;
    }

    if (NODE_SINGLE_PATH_FS_APIS.has(fnName)) {
      const pathLit = parseStaticJsString(callArgs[0] || "");
      const allowRoot = fnName === "mkdirSync" || fnName === "mkdir";
      const allowNull = fnName === "writeFileSync" || fnName === "writeFile" || fnName === "appendFileSync" || fnName === "appendFile" || fnName === "createWriteStream";
      if (!pathLit.ok || !allowReadOnlyTempPath(pathLit.value, { allowRootEqual: allowRoot, allowDevNull: allowNull })) {
        return `Inline Node fs.${fnName} outside canonical temp roots is blocked for read-only ro-* workers.`;
      }
      continue;
    }

    if (NODE_COPY_FS_APIS.has(fnName)) {
      const dstLit = parseStaticJsString(callArgs[1] || "");
      if (!dstLit.ok || !allowReadOnlyTempPath(dstLit.value, { allowRootEqual: true, allowDevNull: true })) {
        return `Inline Node fs.${fnName} destination outside canonical temp roots is blocked for read-only ro-* workers.`;
      }
      continue;
    }

    if (NODE_TWO_PATH_FS_APIS.has(fnName)) {
      const firstLit = parseStaticJsString(callArgs[0] || "");
      const secondLit = parseStaticJsString(callArgs[1] || "");
      if (
        !firstLit.ok ||
        !secondLit.ok ||
        !allowReadOnlyTempPath(firstLit.value, { allowRootEqual: false, allowDevNull: false }) ||
        !allowReadOnlyTempPath(secondLit.value, { allowRootEqual: true, allowDevNull: false })
      ) {
        return `Inline Node fs.${fnName} outside canonical temp roots is blocked for read-only ro-* workers.`;
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

function checkInlinePythonFs(code, allowReadOnlyTempPath) {
  if (
    /\.\s*(write_text|write_bytes|unlink|rmdir|mkdir|touch|chmod|lchmod|rename|replace|symlink_to|hardlink_to|remove|removedirs|makedirs|chown|truncate|renames|rmtree|move|copy|copy2|copyfile|copytree|symlink|link)\b(?!\s*\()/.test(
      code,
    ) ||
    /\bfrom\s+(?:os|posix|shutil|pathlib)\s+import\b[^\n;]*\bas\b/.test(code) ||
    /(?:^|[^\w.])=\s*(?:builtins\s*\.\s*|io\s*\.\s*)?open\b(?!\s*\()/.test(code)
  ) {
    return "Aliased filesystem mutation API in inline Python script is blocked for read-only ro-* workers.";
  }

  const pathMethodRe =
    /\.\s*(write_text|write_bytes|unlink|rmdir|mkdir|touch|chmod|lchmod|rename|replace|symlink_to|hardlink_to|open)\s*\(/g;
  let match;
  while ((match = pathMethodRe.exec(code)) !== null) {
    const method = match[1];
    const openParenIdx = match.index + match[0].length - 1;
    const methodArgs = parseCallArguments(code, openParenIdx);
    if (!methodArgs) {
      return `Unparseable .${method}() call in inline Python script is blocked for read-only ro-* workers.`;
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
      return `Inline Python Path.${method}() on non-literal receiver is blocked for read-only ro-* workers.`;
    }
    const ctorArgs = parseCallArguments(`(${ctorMatch[1]})`, 0);
    const receiverLit = ctorArgs && ctorArgs.length === 1 ? parseStaticPyString(ctorArgs[0]) : { ok: false, value: "" };
    const allowRoot = method === "mkdir";
    if (!receiverLit.ok || !allowReadOnlyTempPath(receiverLit.value, { allowRootEqual: allowRoot, allowDevNull: false })) {
      return `Inline Python Path.${method}() outside canonical temp roots is blocked for read-only ro-* workers.`;
    }
    if (method === "rename" || method === "replace") {
      const dstLit = parseStaticPyString(methodArgs[0] || "");
      if (!dstLit.ok || !allowReadOnlyTempPath(dstLit.value, { allowRootEqual: true, allowDevNull: false })) {
        return `Inline Python Path.${method}() target outside canonical temp roots is blocked for read-only ro-* workers.`;
      }
    }
  }

  const openRe = /(?:^|[^\w.])(?:io\s*\.\s*|builtins\s*\.\s*)?open\s*\(/g;
  while ((match = openRe.exec(code)) !== null) {
    const openParenIdx = match.index + match[0].length - 1;
    const openArgs = parseCallArguments(code, openParenIdx);
    if (!openArgs) {
      return "Unparseable open() call in inline Python script is blocked for read-only ro-* workers.";
    }
    const { positionals, kwargs } = splitPythonCallArgs(openArgs);
    const modeExpr = positionals[1] ?? kwargs.mode ?? null;
    if (modeExpr === null) continue;
    const modeLit = parseStaticPyString(modeExpr);
    if (modeLit.ok && /^[rbtU]+$/.test(modeLit.value) && modeLit.value.includes("r")) {
      continue;
    }
    const pathExpr = positionals[0] ?? kwargs.file ?? "";
    const pathLit = parseStaticPyString(pathExpr);
    if (!pathLit.ok || !allowReadOnlyTempPath(pathLit.value, { allowRootEqual: false, allowDevNull: true })) {
      return "Inline Python open() for write outside canonical temp roots is blocked for read-only ro-* workers.";
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
      return `Unparseable ${fnName}() call in inline Python script is blocked for read-only ro-* workers.`;
    }
    const { positionals } = splitPythonCallArgs(callArgs);
    if (["copy", "copy2", "copyfile", "copytree"].includes(fnName)) {
      if (!qualifier && !/\bshutil\b/.test(code)) continue;
      const dstLit = parseStaticPyString(positionals[1] || "");
      if (!dstLit.ok || !allowReadOnlyTempPath(dstLit.value, { allowRootEqual: true, allowDevNull: true })) {
        return `Inline Python ${fnName}() destination outside canonical temp roots is blocked for read-only ro-* workers.`;
      }
      continue;
    }
    if (["rename", "renames", "replace", "move", "symlink", "link"].includes(fnName)) {
      const srcLit = parseStaticPyString(positionals[0] || "");
      const dstLit = parseStaticPyString(positionals[1] || "");
      if (
        !srcLit.ok ||
        !dstLit.ok ||
        !allowReadOnlyTempPath(srcLit.value, { allowRootEqual: false, allowDevNull: false }) ||
        !allowReadOnlyTempPath(dstLit.value, { allowRootEqual: true, allowDevNull: false })
      ) {
        return `Inline Python ${fnName}() outside canonical temp roots is blocked for read-only ro-* workers.`;
      }
      continue;
    }
    const pathLit = parseStaticPyString(positionals[0] || "");
    const allowRoot = fnName === "mkdir" || fnName === "makedirs";
    if (!pathLit.ok || !allowReadOnlyTempPath(pathLit.value, { allowRootEqual: allowRoot, allowDevNull: false })) {
      return `Inline Python ${fnName}() outside canonical temp roots is blocked for read-only ro-* workers.`;
    }
  }

  return null;
}

function parseGitCommand(args) {
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (GIT_GLOBAL_VALUE_FLAGS.has(arg)) {
      i += 2;
      continue;
    }
    if (
      arg.startsWith("-C") ||
      arg.startsWith("-c") ||
      arg.startsWith("--git-dir=") ||
      arg.startsWith("--work-tree=") ||
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
    return { subcmd: arg, subArgs: args.slice(i + 1) };
  }
  return { subcmd: "", subArgs: [] };
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

function isMutatingReadOnlyInvocation(inv, allowReadOnlyTempPath) {
  const { cmd, args } = inv;
  if (!cmd) return null;

  if (HARD_BLOCKED_RO_FS_COMMANDS.has(cmd)) {
    return `Filesystem mutation command '${cmd}' is blocked for read-only ro-* workers.`;
  }

  if (cmd === "rm" || cmd === "unlink" || cmd === "touch" || cmd === "mkdir") {
    const paths = extractPositionalPaths(args);
    const allowRoot = cmd === "mkdir";
    if (
      paths.length === 0 ||
      paths.some((p) => !allowReadOnlyTempPath(p, { allowRootEqual: allowRoot, allowDevNull: false }))
    ) {
      return `Filesystem command '${cmd}' outside canonical temp roots is blocked for read-only ro-* workers.`;
    }
    return null;
  }

  if (cmd === "chmod") {
    const paths = extractChmodTargets(args);
    if (
      paths.length === 0 ||
      paths.some((p) => !allowReadOnlyTempPath(p, { allowRootEqual: false, allowDevNull: false }))
    ) {
      return "Filesystem command 'chmod' outside canonical temp roots is blocked for read-only ro-* workers.";
    }
    return null;
  }

  if (cmd === "cp") {
    const cpSpec = extractCpOrMvSpec(args);
    if (
      !cpSpec.valid ||
      cpSpec.destinations.some((d) => !allowReadOnlyTempPath(d, { allowRootEqual: true, allowDevNull: true }))
    ) {
      return "Filesystem command 'cp' targeting paths outside canonical temp roots is blocked for read-only ro-* workers.";
    }
    return null;
  }

  if (cmd === "mv") {
    const mvSpec = extractCpOrMvSpec(args);
    if (
      !mvSpec.valid ||
      mvSpec.sources.some((s) => !allowReadOnlyTempPath(s, { allowRootEqual: false, allowDevNull: false })) ||
      mvSpec.destinations.some((d) => !allowReadOnlyTempPath(d, { allowRootEqual: true, allowDevNull: false }))
    ) {
      return "Filesystem command 'mv' outside canonical temp roots is blocked for read-only ro-* workers.";
    }
    return null;
  }

  if (cmd === "tee") {
    const files = extractPositionalPaths(args);
    if (files.some((f) => !allowReadOnlyTempPath(f, { allowRootEqual: false, allowDevNull: true }))) {
      return "Command 'tee' targeting paths outside /dev/null or canonical temp roots is blocked for read-only ro-* workers.";
    }
    return null;
  }

  if (cmd === "sed" && extractSedInPlaceTargets(args) !== null) {
    return "In-place 'sed -i' is blocked for read-only ro-* workers.";
  }

  if ((cmd === "perl" || cmd === "ruby") && extractPerlRubyInPlaceTargets(args) !== null) {
    return `In-place '${cmd} -i' is blocked for read-only ro-* workers.`;
  }

  if (cmd === "node" || cmd === "nodejs" || cmd === "bun") {
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === "--") break;
      if ((arg === "-e" || arg === "--eval" || arg === "-p" || arg === "--print") && i + 1 < args.length) {
        const deny = checkInlineNodeFs(args[i + 1], allowReadOnlyTempPath);
        if (deny) return deny;
        i += 1;
        continue;
      }
      if (arg.startsWith("--eval=")) {
        const deny = checkInlineNodeFs(arg.slice("--eval=".length), allowReadOnlyTempPath);
        if (deny) return deny;
      } else if (arg.startsWith("--print=")) {
        const deny = checkInlineNodeFs(arg.slice("--print=".length), allowReadOnlyTempPath);
        if (deny) return deny;
      }
    }
  }

  if (/^python(?:\d+(?:\.\d+)?)?$/.test(cmd)) {
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === "--" || arg === "-m") break;
      if ((arg === "-c" || /^-[A-Za-z]+c$/.test(arg)) && i + 1 < args.length) {
        const deny = checkInlinePythonFs(args[i + 1], allowReadOnlyTempPath);
        if (deny) return deny;
        break;
      }
      if (!arg.startsWith("-")) break;
    }
  }

  if (cmd === "git") {
    const { subcmd, subArgs } = parseGitCommand(args);
    if (subcmd === "tag") {
      if (!isReadOnlyGitTagArgs(subArgs)) {
        return "Mutating git command 'git tag' is blocked for read-only ro-* workers.";
      }
      return null;
    }
    if (subcmd === "stash") {
      if (!isReadOnlyGitStashArgs(subArgs)) {
        return "Mutating git command 'git stash' is blocked for read-only ro-* workers.";
      }
      return null;
    }
    if (MUTATING_GIT_SUBCOMMANDS.has(subcmd)) {
      return `Mutating git command 'git ${subcmd}' is blocked for read-only ro-* workers.`;
    }
    if (subcmd === "branch") {
      if (subArgs.some((a) => ["-d", "-D", "-m", "-M", "-c", "-C", "--delete", "--move", "--copy"].includes(a))) {
        return "Mutating 'git branch' flag is blocked for read-only ro-* workers.";
      }
    }
    if (subcmd === "worktree") {
      const action = subArgs.find((a) => !a.startsWith("-")) || "";
      if (action && action !== "list") {
        return `Mutating 'git worktree ${action}' is blocked for read-only ro-* workers.`;
      }
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

function checkAuthorShellConfinement(inv, allowAuthorShellPath, resolveForBase) {
  const { cmd, args } = inv;
  if (!cmd) return null;

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
    if (
      paths.length === 0 ||
      paths.some((p) => !allowAuthorShellPath(p, { allowRootEqual: false, allowDevNull: false }))
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

  return null;
}

function checkSickoShellInvocation(inv) {
  const { cmd, args } = inv;
  if (!cmd) return null;

  if (SICKO_BLOCKED_FS_COMMANDS.has(cmd)) {
    return `Filesystem mutation command '${cmd}' is blocked for comment-sicko workers; use edit_file on existing files only.`;
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

function resolveWorkerConfinementRoots(payload, env) {
  const hasValidCwd =
    typeof payload.cwd === "string" && payload.cwd.length > 0 && existsSync(payload.cwd);
  const realCwd = hasValidCwd ? realpathSync(payload.cwd) : null;
  const fallbackBaseDir = realCwd || process.cwd();
  const realArtifact =
    typeof payload.artifactDirectoryPath === "string" &&
    payload.artifactDirectoryPath.length > 0 &&
    existsSync(payload.artifactDirectoryPath)
      ? realpathSync(payload.artifactDirectoryPath)
      : typeof payload.artifactDirectoryPath === "string" && payload.artifactDirectoryPath.length > 0
        ? resolveRealTargetPath(payload.artifactDirectoryPath, fallbackBaseDir)
        : null;
  const canonicalTempRoots = getCanonicalTempRoots(env);
  return { hasValidCwd, realCwd, fallbackBaseDir, realArtifact, canonicalTempRoots };
}

function handlePreToolUse(payload, env) {
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
    resolveWorkerConfinementRoots(payload, env);

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
      if (
        !realTarget ||
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
      const { invocations, redirectTargets } = collectInvocations(commandLine);

      const allowReadOnlyTempPath = (rawToken, opts = {}) => {
        const { allowRootEqual = false, allowDevNull = false } = opts;
        const resolved = resolveShellTargetPath(rawToken, fallbackBaseDir, env);
        if (!resolved) return false;
        if (allowDevNull && resolved === "/dev/null") return true;
        return isInsideCanonicalTempRoots(resolved, canonicalTempRoots, realCwd, {
          allowRootEqual,
          excludeRealCwd: true,
        });
      };

      for (const redirectTarget of redirectTargets) {
        if (!allowReadOnlyTempPath(redirectTarget, { allowRootEqual: false, allowDevNull: true })) {
          return {
            decision: "deny",
            reason:
              "Output file redirection outside /dev/null or canonical temp roots is blocked for read-only ro-* workers.",
          };
        }
      }

      for (const inv of invocations) {
        const mergedEnv = { ...env, ...inv.env };
        const allowInvTempPath = (rawToken, opts = {}) => {
          const { allowRootEqual = false, allowDevNull = false } = opts;
          const resolved = resolveShellTargetPath(rawToken, fallbackBaseDir, mergedEnv);
          if (!resolved) return false;
          if (allowDevNull && resolved === "/dev/null") return true;
          return isInsideCanonicalTempRoots(resolved, canonicalTempRoots, realCwd, {
            allowRootEqual,
            excludeRealCwd: true,
          });
        };
        const denyReason = isMutatingReadOnlyInvocation(inv, allowInvTempPath);
        if (denyReason) {
          return { decision: "deny", reason: denyReason };
        }
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
    const { invocations, redirectTargets } = collectInvocations(commandLine);

    if (kind === "sicko") {
      for (const redirectTarget of redirectTargets) {
        if (redirectTarget !== "/dev/null") {
          return {
            decision: "deny",
            reason:
              "Shell file redirection outside /dev/null is blocked for comment-sicko workers; use edit_file on existing files only.",
          };
        }
      }
      for (const inv of invocations) {
        const sickoDeny = checkSickoShellInvocation(inv);
        if (sickoDeny) {
          return { decision: "deny", reason: sickoDeny };
        }
      }
    }

    if (kind === "author" || kind === "adversary") {
      const checkConfinedShellPath = (rawToken, mergedEnv, opts = {}) => {
        const { allowRootEqual = false, allowDevNull = false, customBaseDir = null } = opts;
        const activeBase = customBaseDir || realCwd;
        if (!activeBase && !isAbsolute(rawToken) && !rawToken.startsWith("~") && !rawToken.startsWith("$TMPDIR") && !rawToken.startsWith("${TMPDIR}")) {
          return false;
        }
        const resolved = resolveShellTargetPath(rawToken, activeBase || fallbackBaseDir, mergedEnv);
        if (!resolved) return false;
        if (allowDevNull && resolved === "/dev/null") return true;
        if (realCwd && (allowRootEqual ? isInsideOrEqual(resolved, realCwd) : isStrictlyInside(resolved, realCwd))) {
          return true;
        }
        if (
          realArtifact &&
          (allowRootEqual ? isInsideOrEqual(resolved, realArtifact) : isStrictlyInside(resolved, realArtifact))
        ) {
          return true;
        }
        return isInsideCanonicalTempRoots(resolved, canonicalTempRoots, realCwd, {
          allowRootEqual,
          excludeRealCwd: false,
        });
      };

      for (const redirectTarget of redirectTargets) {
        if (!checkConfinedShellPath(redirectTarget, env, { allowRootEqual: false, allowDevNull: true })) {
          return {
            decision: "deny",
            reason:
              "Shell output redirection outside confined worker worktree, artifact directory, /dev/null, or canonical temp roots is blocked.",
          };
        }
      }

      for (const inv of invocations) {
        const mergedEnv = { ...env, ...inv.env };
        const allowInvPath = (rawToken, opts = {}) => checkConfinedShellPath(rawToken, mergedEnv, opts);
        const resolveForBase = (rawToken) =>
          resolveShellTargetPath(rawToken, realCwd || fallbackBaseDir, mergedEnv);
        const authorDeny = checkAuthorShellConfinement(inv, allowInvPath, resolveForBase);
        if (authorDeny) {
          return { decision: "deny", reason: authorDeny };
        }
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
