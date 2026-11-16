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
import { fileURLToPath, pathToFileURL } from "node:url";

function wordSet(text) {
  return new Set(text.split(" ").filter(Boolean));
}

const LEGACY_SUBAGENT_TOOLS = wordSet(
  "invoke_subagent define_subagent manage_subagents send_message run_workflow",
);
const SWARM_BOARD_TOOLS = wordSet(
  "post_message read_board swarm_wait swarm list_resources read_resource",
);
const MUTATING_MCP_VERBS = wordSet(
  "create update delete remove set post reply resolve merge close push write edit append restore upload generate install uninstall send modify patch drop insert",
);
const COORDINATOR_SLASH_COMMANDS = wordSet(
  "pstack understand crucible interrogate reflect verify-gen ketchup",
);
const RO_BLOCKED_GIT_SUBCOMMANDS = wordSet(
  "add stage commit push pull merge rebase cherry-pick reset clean am apply mv rm checkout switch revert restore init clone update-ref",
);
const SICKO_BLOCKED_GIT_SUBCOMMANDS = wordSet(
  "push pull fetch checkout switch restore reset clean rebase merge cherry-pick revert stash worktree init clone am apply rm mv",
);
const GH_MUTATING_ACTIONS = {
  pr: wordSet("create merge close reopen edit ready comment review"),
  issue: wordSet("create edit close delete reopen comment"),
  release: wordSet("create delete edit upload"),
  repo: wordSet("create delete edit fork archive rename"),
};
const SCREENSHOT_EXTENSIONS = wordSet(".png .jpg .jpeg .webp");
const SHELL_KEYWORDS = wordSet("if then else elif fi while until do done { } !");
const ROLE_OVERRIDE_NOTICE =
  "> **Role override.** Your active swarm role has changed. The role capsule below supersedes every earlier role capsule in this conversation history, including rules inherited through `fork`.\n\n";

function isDigit(code) {
  return code >= 48 && code <= 57;
}

function isAlpha(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isIdentPart(code) {
  return isAlpha(code) || code === 95 || isDigit(code);
}

function isWhitespaceChar(ch) {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isAllDigits(text) {
  if (text.length === 0) {
    return false;
  }
  for (let i = 0; i < text.length; i += 1) {
    if (!isDigit(text.charCodeAt(i))) {
      return false;
    }
  }
  return true;
}

function isShellIdent(text) {
  if (text.length === 0) {
    return false;
  }
  const first = text.charCodeAt(0);
  if (!isAlpha(first) && first !== 95) {
    return false;
  }
  for (let i = 1; i < text.length; i += 1) {
    if (!isIdentPart(text.charCodeAt(i))) {
      return false;
    }
  }
  return true;
}

function isSafeConvId(conversationId) {
  return (
    typeof conversationId === "string" &&
    conversationId.length > 0 &&
    !conversationId.includes("/") &&
    !conversationId.includes("\\") &&
    conversationId !== "." &&
    conversationId !== ".."
  );
}

function parseJsonObjectSafe(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function readJsonObject(filePath) {
  try {
    if (!existsSync(filePath)) {
      return {};
    }
    return parseJsonObjectSafe(readFileSync(filePath, "utf8")) || {};
  } catch {
    return {};
  }
}

function writeJsonAtomically(filePath, obj) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  const tmpPath = join(dir, `.${basename(filePath)}.${suffix}`);
  const serialized = `${JSON.stringify(obj, null, 2)}\n`;
  try {
    writeFileSync(tmpPath, serialized, "utf8");
    renameSync(tmpPath, filePath);
  } catch {
    try {
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath);
      }
    } catch {}
    writeFileSync(filePath, serialized, "utf8");
  }
}

function updateJsonKeys(filePath, entries) {
  const keys = Object.keys(entries);
  if (keys.length === 0) {
    return;
  }
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

function safeConvFilename(conversationId) {
  if (typeof conversationId !== "string" || !conversationId) {
    return "__unknown__";
  }
  if (conversationId === "." || conversationId === "..") {
    return "__dot__";
  }
  let out = "";
  for (let i = 0; i < conversationId.length; i += 1) {
    const c = conversationId.charCodeAt(i);
    if (isAlpha(c) || isDigit(c) || c === 46 || c === 95 || c === 45) {
      out += conversationId[i];
    } else {
      out += "_";
    }
  }
  return out;
}

function capsuleStatePath(cacheDir, conversationId) {
  return join(cacheDir, "capsules", `${safeConvFilename(conversationId)}.json`);
}

function readCapsuleState(cacheDir, conversationId) {
  if (!conversationId) {
    return {};
  }
  return readJsonObject(capsuleStatePath(cacheDir, conversationId));
}

function updateCapsuleState(cacheDir, conversationId, patch) {
  const current = readCapsuleState(cacheDir, conversationId);
  const next = { ...current };
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      if (Object.prototype.hasOwnProperty.call(next, key)) {
        delete next[key];
        changed = true;
      }
    } else if (next[key] !== value) {
      next[key] = value;
      changed = true;
    }
  }
  if (changed) {
    writeJsonAtomically(capsuleStatePath(cacheDir, conversationId), next);
  }
  return next;
}

function resolveAppDataDir(payload, env) {
  if (typeof env.PSTACK_APPDATA_DIR === "string" && env.PSTACK_APPDATA_DIR) {
    return env.PSTACK_APPDATA_DIR;
  }
  for (const candidate of [payload.transcriptPath, payload.artifactDirectoryPath]) {
    if (typeof candidate !== "string" || !candidate) {
      continue;
    }
    const norm = candidate.replaceAll("\\", "/");
    const brainIdx = norm.indexOf("/brain/");
    if (brainIdx > 0) {
      return candidate.slice(0, brainIdx);
    }
    if (norm.endsWith("/brain") && norm.length > 6) {
      return candidate.slice(0, norm.length - 6);
    }
    const marker = "/.gemini/antigravity";
    const markerIdx = norm.indexOf(marker);
    if (markerIdx >= 0) {
      let end = markerIdx + marker.length;
      if (norm[end] === "-") {
        const start = end + 1;
        end = start;
        while (end < norm.length && (isIdentPart(norm.charCodeAt(end)) || norm[end] === "-")) {
          end += 1;
        }
        if (end === start) {
          end = -1;
        }
      }
      if (end > 0 && (end === norm.length || norm[end] === "/")) {
        return candidate.slice(0, end);
      }
    }
  }
  if (typeof env.ANTIGRAVITY_APP_DATA_DIR === "string" && env.ANTIGRAVITY_APP_DATA_DIR) {
    return env.ANTIGRAVITY_APP_DATA_DIR;
  }
  if (typeof env.PLUGIN_DATA === "string" && env.PLUGIN_DATA) {
    if (basename(dirname(env.PLUGIN_DATA)) === "plugin_data") {
      return dirname(dirname(env.PLUGIN_DATA));
    }
  }
  return null;
}

function resolveCacheDir(appDataDir, env) {
  if (typeof env.PSTACK_CACHE_DIR === "string" && env.PSTACK_CACHE_DIR) {
    return env.PSTACK_CACHE_DIR;
  }
  if (typeof env.PLUGIN_DATA === "string" && env.PLUGIN_DATA) {
    return env.PLUGIN_DATA;
  }
  if (appDataDir) {
    return join(appDataDir, "plugin_data", "agy-pstack-next");
  }
  return join(tmpdir(), "pstack-swarm-guard");
}

function resolvePluginRoot(env) {
  if (typeof env.PSTACK_PLUGIN_ROOT === "string" && env.PSTACK_PLUGIN_ROOT) {
    return env.PSTACK_PLUGIN_ROOT;
  }
  if (typeof env.PLUGIN_ROOT === "string" && env.PLUGIN_ROOT) {
    return env.PLUGIN_ROOT;
  }
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function resolveConfigDir(env) {
  if (typeof env.PSTACK_CONFIG_DIR === "string" && env.PSTACK_CONFIG_DIR) {
    return env.PSTACK_CONFIG_DIR;
  }
  const pluginRoot = resolvePluginRoot(env);
  if (pluginRoot && basename(dirname(pluginRoot)) === "plugins") {
    return dirname(dirname(pluginRoot));
  }
  if (typeof env.HOME === "string" && env.HOME && env.HOME !== homedir()) {
    return join(env.HOME, ".gemini", "config");
  }
  if (!env.PSTACK_APPDATA_DIR && !env.PSTACK_PLUGIN_ROOT && !env.PLUGIN_ROOT) {
    const home = typeof env.HOME === "string" && env.HOME ? env.HOME : homedir();
    return join(home, ".gemini", "config");
  }
  return null;
}

function isPluginDisabled(env) {
  const configDir = resolveConfigDir(env);
  if (!configDir) {
    return false;
  }
  const configPath = join(configDir, "config.json");
  if (!existsSync(configPath)) {
    return false;
  }
  return readJsonObject(configPath)?.plugins?.["agy-pstack-next"]?.enabled === false;
}

function resolveRealTargetPath(targetPath, baseDir, depth = 0) {
  if (depth > 16) {
    return null;
  }
  const absTarget = resolve(baseDir, targetPath);
  const tail = [];
  let cur = absTarget;
  while (true) {
    try {
      const st = lstatSync(cur);
      if (st.isSymbolicLink()) {
        try {
          const real = realpathSync(cur);
          return tail.length > 0 ? join(real, ...tail) : real;
        } catch {
          const nextTarget = resolve(dirname(cur), readlinkSync(cur));
          const combined = tail.length > 0 ? join(nextTarget, ...tail) : nextTarget;
          return resolveRealTargetPath(combined, dirname(cur), depth + 1);
        }
      }
      const real = realpathSync(cur);
      return tail.length > 0 ? join(real, ...tail) : real;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) {
        return absTarget;
      }
      tail.unshift(basename(cur));
      cur = parent;
    }
  }
}

function isStrictlyInside(targetPath, rootDir) {
  const rel = relative(rootDir, targetPath);
  return (
    rel.length > 0 &&
    rel !== ".." &&
    !rel.startsWith("../") &&
    !rel.startsWith("..\\") &&
    !isAbsolute(rel)
  );
}

function isInsideOrEqual(targetPath, rootDir) {
  return targetPath === rootDir || isStrictlyInside(targetPath, rootDir);
}

function getCanonicalTempRoots(env) {
  const roots = new Set(["/tmp", "/private/tmp"]);
  for (const candidate of ["/tmp", "/private/tmp", env.TMPDIR, tmpdir()]) {
    if (typeof candidate !== "string" || !candidate) {
      continue;
    }
    try {
      roots.add(realpathSync(candidate));
    } catch {
      roots.add(resolve(candidate));
    }
  }
  return [...roots];
}

function isInsideCanonicalTempRoots(
  realTarget,
  canonicalTempRoots,
  realCwd,
  { allowRootEqual = false, excludeRealCwd = false } = {},
) {
  if (!realTarget || (excludeRealCwd && realCwd && isInsideOrEqual(realTarget, realCwd))) {
    return false;
  }
  if (realCwd) {
    for (const tempRoot of canonicalTempRoots) {
      if (!isStrictlyInside(realCwd, tempRoot)) {
        continue;
      }
      const parts = relative(tempRoot, realCwd).replaceAll("\\", "/").split("/").filter(Boolean);
      if (parts.length >= 2) {
        const container = join(tempRoot, parts[0]);
        if (isInsideOrEqual(realTarget, container) && !isInsideOrEqual(realTarget, join(container, "tmp"))) {
          return false;
        }
      }
    }
  }
  return canonicalTempRoots.some((root) => {
    return allowRootEqual ? isInsideOrEqual(realTarget, root) : isStrictlyInside(realTarget, root);
  });
}

function isSystemGeneratedArtifactPath(resolvedPath, realArtifact) {
  if (!resolvedPath || !realArtifact) {
    return false;
  }
  if (isInsideOrEqual(resolvedPath, join(realArtifact, ".system_generated"))) {
    return true;
  }
  if (!isStrictlyInside(resolvedPath, realArtifact)) {
    return false;
  }
  const relParts = relative(realArtifact, resolvedPath).replaceAll("\\", "/").split("/");
  return relParts.includes(".system_generated");
}

function isAllowedReadOnlyArtifactImage(resolvedPath, realArtifact, realCwd) {
  if (!resolvedPath || !realArtifact || !isStrictlyInside(resolvedPath, realArtifact)) {
    return false;
  }
  if (isSystemGeneratedArtifactPath(resolvedPath, realArtifact)) {
    return false;
  }
  if (realCwd && isInsideOrEqual(resolvedPath, realCwd)) {
    return false;
  }
  const segments = relative(realArtifact, resolvedPath).replaceAll("\\", "/").split("/").filter(Boolean);
  if (segments.length === 0) {
    return false;
  }
  let cur = realArtifact;
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (!segments[i] || segments[i].startsWith(".")) {
      return false;
    }
    cur = join(cur, segments[i]);
    try {
      if (!lstatSync(cur).isDirectory()) {
        return false;
      }
    } catch {}
  }
  const leaf = segments[segments.length - 1];
  if (!leaf || leaf.startsWith(".") || !SCREENSHOT_EXTENSIONS.has(extname(leaf).toLowerCase())) {
    return false;
  }
  try {
    const st = lstatSync(resolvedPath);
    if (st.isSymbolicLink() || st.isDirectory()) {
      return false;
    }
  } catch {}
  return true;
}

function isValidRemoteSwarmId(id) {
  if (typeof id !== "string" || id.length < 4 || id.length > 128 || id.startsWith("-")) {
    return false;
  }
  for (let i = 0; i < id.length; i += 1) {
    const c = id.charCodeAt(i);
    if (!isAlpha(c) && !isDigit(c) && c !== 46 && c !== 95 && c !== 45) {
      return false;
    }
  }
  return true;
}

function stripTrailingNumericSuffix(name) {
  const dash = name.lastIndexOf("-");
  if (dash > 0 && dash < name.length - 1 && isAllDigits(name.slice(dash + 1))) {
    return name.slice(0, dash);
  }
  return name;
}

function classifyLeadingSlash(lastUserInput) {
  if (typeof lastUserInput !== "string" || !lastUserInput) {
    return { isPstackSlash: false, isBuiltinSwarmSlash: false };
  }
  let body = lastUserInput.trimStart();
  while (body.startsWith("<")) {
    const closeIdx = body.indexOf(">");
    if (closeIdx <= 1) {
      break;
    }
    const tagBody = body.slice(1, closeIdx);
    const firstCode = tagBody.startsWith("/") ? tagBody.charCodeAt(1) : tagBody.charCodeAt(0);
    if (tagBody.includes("\n") || (!isAlpha(firstCode) && firstCode !== 95)) {
      break;
    }
    body = body.slice(closeIdx + 1).trimStart();
  }
  if (!body.startsWith("/")) {
    return { isPstackSlash: false, isBuiltinSwarmSlash: false };
  }
  let end = 1;
  while (end < body.length && !isWhitespaceChar(body[end]) && body[end] !== "<") {
    end += 1;
  }
  let cmd = body.slice(1, end).toLowerCase();
  if (cmd.startsWith("agy-pstack-next:") || cmd.startsWith("agy-pstack-next/")) {
    cmd = cmd.slice(16);
  }
  if (cmd === "swarm") {
    return { isPstackSlash: false, isBuiltinSwarmSlash: true };
  }
  if (!COORDINATOR_SLASH_COMMANDS.has(cmd)) {
    return { isPstackSlash: false, isBuiltinSwarmSlash: false };
  }
  if (cmd === "ketchup") {
    let i = end;
    while (i < body.length) {
      while (i < body.length && isWhitespaceChar(body[i])) {
        i += 1;
      }
      if (i >= body.length) {
        break;
      }
      if (body[i] === "<") {
        const close = body.indexOf(">", i + 1);
        if (close > i) {
          i = close + 1;
          continue;
        }
      }
      let tEnd = i;
      while (tEnd < body.length && !isWhitespaceChar(body[tEnd]) && body[tEnd] !== "<") {
        tEnd += 1;
      }
      if (body.slice(i, tEnd) === "--plain") {
        return { isPstackSlash: false, isBuiltinSwarmSlash: false };
      }
      i = tEnd;
    }
  }
  return { isPstackSlash: true, isBuiltinSwarmSlash: false };
}

function resolveOwnTranscriptPath(payload, appDataDir) {
  if (typeof payload.transcriptPath === "string" && payload.transcriptPath) {
    return payload.transcriptPath;
  }
  if (!appDataDir || !isSafeConvId(payload.conversationId)) {
    return null;
  }
  const candidates = [
    join(appDataDir, "brain", payload.conversationId, ".system_generated", "logs", "transcript.jsonl"),
    join(appDataDir, "brain", payload.conversationId, "transcript.jsonl"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function hasForkMemoryMarker(text) {
  if (typeof text !== "string") {
    return false;
  }
  const prefix = "Everything before this turn is @";
  const suffix = "'s memory";
  let idx = text.indexOf(prefix);
  while (idx !== -1) {
    let pos = idx + prefix.length;
    while (pos < text.length && (isIdentPart(text.charCodeAt(pos)) || text[pos] === "-")) {
      pos += 1;
    }
    if (pos > idx + prefix.length && text.startsWith(suffix, pos)) {
      return true;
    }
    idx = text.indexOf(prefix, idx + 1);
  }
  return false;
}

function isSystemRoleCapsuleStep(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return false;
  }
  if (parsed.type !== "SYSTEM_MESSAGE" && parsed.source !== "SYSTEM_SDK") {
    return false;
  }
  if (typeof parsed.content !== "string") {
    return false;
  }
  const suffix = " role capsule";
  return parsed.content.split("\n").some((raw) => {
    const line = (raw.endsWith("\r") ? raw.slice(0, -1) : raw).toLowerCase();
    return line.startsWith("# ") && line.endsWith(suffix) && line.length > 2 + suffix.length;
  });
}

function transcriptIsUnforkedUserRoot(transcriptPath, hasPriorCapsule) {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return false;
  }
  try {
    const content = readFileSync(transcriptPath, "utf8");
    if (
      content.includes("[swarm] new board message") ||
      content.includes("Your assignment (recorded on the board") ||
      hasForkMemoryMarker(content)
    ) {
      return false;
    }
    let sawFirst = false;
    for (const rawLine of content.split("\n")) {
      const trimmed = rawLine.trim();
      if (!trimmed) {
        continue;
      }
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== "object") {
        return false;
      }
      if (!sawFirst) {
        if (parsed.type !== "USER_INPUT") {
          return false;
        }
        sawFirst = true;
      }
      if (hasForkMemoryMarker(parsed.content)) {
        return false;
      }
      if (!hasPriorCapsule && isSystemRoleCapsuleStep(parsed)) {
        return false;
      }
    }
    return sawFirst;
  } catch {
    return false;
  }
}

function transcriptContainsRoleCapsule(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return false;
  }
  try {
    for (const rawLine of readFileSync(transcriptPath, "utf8").split("\n")) {
      const parsed = parseJsonObjectSafe(rawLine);
      if (parsed && (isSystemRoleCapsuleStep(parsed) || hasForkMemoryMarker(parsed.content))) {
        return true;
      }
    }
  } catch {}
  return false;
}

function extractMembersFromDoc(doc, targetConvId, fallbackCoordId = null) {
  const workerEntries = {};
  let matchedCoordinator = false;
  let coordId = typeof fallbackCoordId === "string" && fallbackCoordId ? fallbackCoordId : null;
  let hasPstackPrefixedWorker = false;
  let hasTaskWorker = false;
  let hasActiveTaskWorker = false;
  const members = doc && typeof doc === "object" && doc.members && typeof doc.members === "object" ? doc.members : {};
  for (const [name, info] of Object.entries(members)) {
    if (!info || typeof info !== "object") {
      continue;
    }
    const cid = info.conversation_id || info.conversationId;
    if (name === "coordinator" || info.role === "coordinator") {
      if (typeof cid === "string" && cid) {
        coordId = cid;
        if (cid === targetConvId) {
          matchedCoordinator = true;
        }
      }
      continue;
    }
    const lower = name.toLowerCase();
    if (["impl-", "cand-", "lead-", "ro-", "adv-", "sicko-"].some((prefix) => lower.startsWith(prefix))) {
      hasPstackPrefixedWorker = true;
    }
    const base = stripTrailingNumericSuffix(lower);
    if (base !== "coordinator" && base !== "monitor" && base !== "narrator") {
      hasTaskWorker = true;
      if (info.killed !== true && info.state !== "killed") {
        hasActiveTaskWorker = true;
      }
    }
    if (typeof cid === "string" && cid) {
      workerEntries[cid] = name;
    }
  }
  return {
    workerEntries,
    matchedCoordinator,
    coordId,
    hasPstackPrefixedWorker,
    hasTaskWorker,
    hasActiveTaskWorker,
  };
}

function resolveRemoteBoardCli(anchor, appDataDir, env) {
  if (typeof env.PSTACK_REMOTE_SWARM_CLI === "string" && env.PSTACK_REMOTE_SWARM_CLI) {
    return env.PSTACK_REMOTE_SWARM_CLI;
  }
  let cfgPath = null;
  if (typeof env.PSTACK_REMOTE_BOARD_CONFIG === "string" && env.PSTACK_REMOTE_BOARD_CONFIG) {
    cfgPath = env.PSTACK_REMOTE_BOARD_CONFIG;
  } else if (appDataDir) {
    cfgPath = join(appDataDir, "builtin", "plugins", "swarm", "sidecars", "swarm_board", "remote_board.json");
  }
  if (!cfgPath || !existsSync(cfgPath)) {
    return null;
  }
  const cfg = readJsonObject(cfgPath);
  if (typeof cfg.backend !== "string" || cfg.backend !== anchor.backend) {
    return null;
  }
  const isExecutable = (filePath) => {
    try {
      accessSync(filePath, fsConstants.X_OK);
      return statSync(filePath).isFile();
    } catch {
      return false;
    }
  };
  const envOverride = typeof cfg.cli_env === "string" && cfg.cli_env ? env[cfg.cli_env] : "";
  if (typeof envOverride === "string" && envOverride) {
    if (!envOverride.includes("/") || isExecutable(envOverride)) {
      return envOverride;
    }
  }
  const cliList = Array.isArray(cfg.cli) ? cfg.cli.filter((c) => typeof c === "string" && c) : [];
  const pathDirs = String(env.PATH || process.env.PATH || "").split(":").filter(Boolean);
  for (const candidate of cliList) {
    const locations = candidate.includes("/") ? [candidate] : pathDirs.map((dir) => join(dir, candidate));
    const found = locations.find(isExecutable);
    if (found) {
      return found;
    }
  }
  return cliList[cliList.length - 1] || null;
}

function resolveRemoteSwarmRoster(anchorDoc, appDataDir, cacheDir, env, targetConvId) {
  if (!anchorDoc || typeof anchorDoc !== "object") {
    return null;
  }
  if (typeof anchorDoc.backend !== "string" || !anchorDoc.backend || anchorDoc.backend === "local") {
    return null;
  }
  if (!isValidRemoteSwarmId(anchorDoc.swarm_id)) {
    return null;
  }
  if (anchorDoc.db !== undefined && anchorDoc.db !== null && anchorDoc.db !== "") {
    if (typeof anchorDoc.db !== "string" || anchorDoc.db.startsWith("-")) {
      return null;
    }
  }
  const anchor = { backend: anchorDoc.backend, swarmId: anchorDoc.swarm_id, db: anchorDoc.db || "" };
  const cliBin = resolveRemoteBoardCli(anchor, appDataDir, env);
  if (!cliBin) {
    return null;
  }
  const rostersPath = join(cacheDir, "remote-rosters.json");
  const cached = readJsonObject(rostersPath)[anchor.swarmId];
  if (
    cached &&
    typeof cached === "object" &&
    typeof cached.fetchedAt === "number" &&
    cached.members &&
    typeof cached.members === "object" &&
    !Array.isArray(cached.members)
  ) {
    const age = Date.now() - cached.fetchedAt;
    const inRoster = Boolean(
      targetConvId &&
        Object.values(cached.members).some((info) => {
          return info && typeof info === "object" && (info.conversation_id || info.conversationId) === targetConvId;
        }),
    );
    const ttlMs = inRoster ? 15000 : 5000;
    if (age >= 0 && age < ttlMs) {
      return { members: cached.members };
    }
  }
  try {
    const cliArgs = ["swarm", "--json", "--roster-only"];
    if (anchor.db) {
      cliArgs.push("--db", anchor.db);
    }
    cliArgs.push(anchor.swarmId);
    const stdout = execFileSync(cliBin, cliArgs, {
      encoding: "utf8",
      timeout: 2500,
      env: { ...env, TERM: "dumb" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let matchedMembers = null;
    for (const rawLine of String(stdout || "").split("\n")) {
      const doc = parseJsonObjectSafe(rawLine);
      if (doc && doc.swarm_id === anchor.swarmId && doc.members && typeof doc.members === "object" && !Array.isArray(doc.members)) {
        matchedMembers = doc.members;
      }
    }
    if (!matchedMembers) {
      return null;
    }
    updateJsonKeys(rostersPath, { [anchor.swarmId]: { fetchedAt: Date.now(), members: matchedMembers } });
    return { members: matchedMembers };
  } catch {
    return null;
  }
}

function inspectSwarmDirectory(swarmDir, ownerDirId, targetConvId, opts) {
  function classifyRoster(doc, fallbackCoordId, ownMatch) {
    const ext = extractMembersFromDoc(doc, targetConvId, fallbackCoordId);
    const coordState = ext.coordId ? readCapsuleState(opts.cacheDir, ext.coordId) : {};
    const hasCoordCapsule = typeof coordState.capsule === "string" && coordState.capsule.length > 0;
    const hasMarkerFile = existsSync(join(swarmDir, "pstack.json"));
    const managed = ext.hasPstackPrefixedWorker || hasCoordCapsule || hasMarkerFile || (!coordState.plainSwarm && !ext.hasTaskWorker);
    const matchedCoordinator = ext.matchedCoordinator || ownMatch;
    if (!managed) {
      const targetIsWorker = Boolean(ext.workerEntries[targetConvId]);
      const targetInSwarm = Boolean(targetIsWorker || matchedCoordinator || ext.coordId === targetConvId);
      return { kind: "unmanaged_swarm", targetInSwarm, targetIsWorker };
    }
    const finishedCoordinator = matchedCoordinator && ext.hasTaskWorker && !ext.hasActiveTaskWorker;
    const activeCoordinator = matchedCoordinator && !finishedCoordinator;
    return {
      kind: "managed_roster",
      workerEntries: ext.workerEntries,
      matchedCoordinator: activeCoordinator,
      finishedCoordinator,
    };
  }

  const membersPath = join(swarmDir, "members.json");
  if (existsSync(membersPath)) {
    return classifyRoster(readJsonObject(membersPath), ownerDirId, opts.isOwnSwarmDir);
  }
  const anchorPath = join(swarmDir, "swarm.json");
  if (!existsSync(anchorPath)) {
    return { kind: "none" };
  }
  const anchorDoc = readJsonObject(anchorPath);
  const explicit =
    anchorDoc.coordinator_conversation_id ||
    anchorDoc.coordinatorConversationId ||
    anchorDoc.coordinator_id ||
    anchorDoc.coordinatorId;
  let anchorCoordId = ownerDirId;
  if (typeof explicit === "string" && explicit) {
    anchorCoordId = explicit;
  } else if (anchorDoc.backend === "local" && isValidRemoteSwarmId(anchorDoc.swarm_id)) {
    anchorCoordId = anchorDoc.swarm_id;
  }
  const remoteRoster = resolveRemoteSwarmRoster(anchorDoc, opts.appDataDir, opts.cacheDir, opts.env, targetConvId);
  if (remoteRoster) {
    return classifyRoster(remoteRoster, anchorCoordId, anchorCoordId === targetConvId);
  }
  if (anchorCoordId !== targetConvId) {
    return { kind: "none" };
  }
  const coordState = readCapsuleState(opts.cacheDir, anchorCoordId);
  if (coordState.plainSwarm && !coordState.capsule && !existsSync(join(swarmDir, "pstack.json"))) {
    return { kind: "unmanaged_swarm", targetInSwarm: true, targetIsWorker: false };
  }
  return { kind: "anchor_coordinator" };
}

function resolveWorkerOrCoordinatorFromSwarm(convId, payload, appDataDir, cacheDir, hasPriorCapsule, env, capsuleState = {}) {
  const empty = {
    workerName: null,
    isKnownActiveCoordinator: false,
    isFinishedCoordinator: false,
    isUnmanagedSwarmWorker: false,
  };
  if (typeof convId !== "string" || !convId) {
    return empty;
  }
  const mapPath = join(cacheDir, "member-map.json");
  const cachedName = readJsonObject(mapPath)[convId];
  if (typeof cachedName === "string" && cachedName && cachedName !== "coordinator") {
    return { ...empty, workerName: cachedName };
  }
  if (!appDataDir) {
    return empty;
  }

  const checkedRoots = new Set();
  function checkDirs(dirs) {
    const discovered = {};
    let matchedCoord = false;
    let matchedFinishedCoord = false;
    let matchedUnmanaged = false;
    let matchedUnmanagedWorker = false;
    for (const { dirId, isOwnSwarmDir } of dirs) {
      const swarmDir = join(appDataDir, "brain", dirId, ".system_generated", "swarm");
      const res = inspectSwarmDirectory(swarmDir, dirId, convId, { appDataDir, cacheDir, env, isOwnSwarmDir });
      if (res.kind === "managed_roster") {
        Object.assign(discovered, res.workerEntries);
        if (res.matchedCoordinator) {
          matchedCoord = true;
        }
        if (res.finishedCoordinator) {
          matchedFinishedCoord = true;
        }
      } else if (res.kind === "anchor_coordinator") {
        matchedCoord = true;
      } else if (res.kind === "unmanaged_swarm" && res.targetInSwarm) {
        matchedUnmanaged = true;
        if (res.targetIsWorker) {
          matchedUnmanagedWorker = true;
        }
      }
      if (discovered[convId] || matchedCoord || matchedFinishedCoord || matchedUnmanaged) {
        break;
      }
    }
    updateJsonKeys(mapPath, discovered);
    if (discovered[convId]) {
      return { ...empty, workerName: discovered[convId] };
    }
    if (matchedCoord) {
      return { ...empty, isKnownActiveCoordinator: true };
    }
    if (matchedFinishedCoord) {
      return { ...empty, isFinishedCoordinator: true };
    }
    if (matchedUnmanaged) {
      return { ...empty, isUnmanagedSwarmWorker: matchedUnmanagedWorker };
    }
    return null;
  }

  const priorityDirs = [];
  for (const rootId of [payload.rootConversationId, payload.parentConversationId]) {
    if (typeof rootId === "string" && rootId && rootId !== convId && !checkedRoots.has(rootId)) {
      checkedRoots.add(rootId);
      priorityDirs.push({ dirId: rootId, isOwnSwarmDir: false });
    }
  }
  priorityDirs.push({ dirId: convId, isOwnSwarmDir: true });
  const directHit = checkDirs(priorityDirs);
  if (directHit) {
    return directHit;
  }
  if (capsuleState.unforkedRoot === true) {
    return empty;
  }
  if (transcriptIsUnforkedUserRoot(resolveOwnTranscriptPath(payload, appDataDir), hasPriorCapsule)) {
    updateCapsuleState(cacheDir, convId, { unforkedRoot: true });
    return { ...empty, unforkedRoot: true };
  }
  try {
    const brainDir = join(appDataDir, "brain");
    if (!existsSync(brainDir)) {
      return empty;
    }
    const otherDirs = readdirSync(brainDir, { withFileTypes: true })
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && entry.name !== convId && !checkedRoots.has(entry.name))
      .map((entry) => ({ dirId: entry.name, isOwnSwarmDir: false }));
    return checkDirs(otherDirs) || empty;
  } catch {
    return empty;
  }
}

function classifyWorkerMember(memberName) {
  const lower = memberName.toLowerCase();
  const base = stripTrailingNumericSuffix(lower);
  if (base === "monitor" || base === "narrator" || lower.startsWith("monitor-") || lower.startsWith("narrator-")) {
    return { kind: "support", capsule: null };
  }
  if (lower.startsWith("adv-")) {
    return { kind: "adversary", capsule: "roles/poteto-agent.md" };
  }
  if (lower.startsWith("sicko-")) {
    return { kind: "sicko", capsule: "roles/comment-sicko.md" };
  }
  if (
    lower.startsWith("ro-") ||
    base === "verifier" ||
    lower.startsWith("verifier-") ||
    base.endsWith("-verifier") ||
    lower.startsWith("verify-")
  ) {
    return { kind: "readonly", capsule: "roles/research.md" };
  }
  return { kind: "author", capsule: "roles/poteto-agent.md" };
}

function classifySession(payload, env) {
  const appDataDir = resolveAppDataDir(payload, env);
  const cacheDir = resolveCacheDir(appDataDir, env);
  const convId = typeof payload.conversationId === "string" ? payload.conversationId : "";
  let capsuleState = readCapsuleState(cacheDir, convId);
  const alreadyInjected = typeof capsuleState.capsule === "string" && capsuleState.capsule.length > 0;
  const { isPstackSlash, isBuiltinSwarmSlash } = classifyLeadingSlash(payload.lastUserInput);
  const forcedCoord = env.PSTACK_FORCE_COORDINATOR === "1";
  if (convId) {
    if ((isPstackSlash || forcedCoord) && capsuleState.plainSwarm) {
      capsuleState = updateCapsuleState(cacheDir, convId, { plainSwarm: false });
    } else if (isBuiltinSwarmSlash && !alreadyInjected && !capsuleState.plainSwarm) {
      capsuleState = updateCapsuleState(cacheDir, convId, { plainSwarm: true });
    }
  }
  const {
    workerName,
    isKnownActiveCoordinator,
    isFinishedCoordinator,
    isUnmanagedSwarmWorker,
    unforkedRoot,
  } = resolveWorkerOrCoordinatorFromSwarm(
    convId,
    payload,
    appDataDir,
    cacheDir,
    alreadyInjected,
    env,
    capsuleState,
  );
  if (unforkedRoot) {
    capsuleState = { ...capsuleState, unforkedRoot: true };
  }
  if (workerName) {
    return {
      sessionKind: "worker",
      ...classifyWorkerMember(workerName),
      memberName: workerName,
      appDataDir,
      cacheDir,
      capsuleState,
    };
  }
  if (isUnmanagedSwarmWorker && !alreadyInjected && !forcedCoord) {
    return {
      sessionKind: "unmanaged",
      kind: "unmanaged",
      memberName: null,
      capsule: null,
      appDataDir,
      cacheDir,
      capsuleState,
    };
  }
  const hasActivePrompt = typeof capsuleState.activePrompt === "string" && capsuleState.activePrompt.length > 0;
  const matchesActivePromptTurn =
    hasActivePrompt &&
    !isFinishedCoordinator &&
    (!payload.lastUserInput || payload.lastUserInput === capsuleState.activePrompt);
  if (isPstackSlash || forcedCoord || isKnownActiveCoordinator || matchesActivePromptTurn) {
    if (convId && isPstackSlash && typeof payload.lastUserInput === "string" && payload.lastUserInput) {
      capsuleState = updateCapsuleState(cacheDir, convId, { activePrompt: payload.lastUserInput });
    }
    return {
      sessionKind: "coordinator",
      kind: "coordinator",
      memberName: "coordinator",
      capsule: "roles/coordinator.md",
      appDataDir,
      cacheDir,
      capsuleState,
    };
  }
  if (convId && hasActivePrompt) {
    capsuleState = updateCapsuleState(cacheDir, convId, { activePrompt: undefined });
  }
  return {
    sessionKind: "unmanaged",
    kind: "unmanaged",
    memberName: null,
    capsule: null,
    appDataDir,
    cacheDir,
    capsuleState,
  };
}

function parseCommandSegments(commandLine) {
  const segments = [];
  let tokens = [];
  let token = "";
  let hasToken = false;
  let inSingle = false;
  let inDouble = false;
  let parenDepth = 0;
  let skipNext = false;

  function flushToken() {
    if (!hasToken) {
      return;
    }
    if (skipNext) {
      skipNext = false;
    } else {
      tokens.push(token);
    }
    token = "";
    hasToken = false;
    parenDepth = 0;
  }

  function flushSegment() {
    flushToken();
    if (tokens.length > 0) {
      segments.push(tokens);
      tokens = [];
    }
    skipNext = false;
  }

  for (let i = 0; i < commandLine.length; i += 1) {
    const ch = commandLine[i];
    const next = commandLine[i + 1];
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        token += ch;
      }
      hasToken = true;
      continue;
    }
    if (inDouble) {
      if (ch === "\\" && i + 1 < commandLine.length) {
        if (next === "\n") {
          i += 1;
          continue;
        }
        if (next === '"' || next === "\\" || next === "$" || next === "`") {
          token += next;
          i += 1;
          hasToken = true;
          continue;
        }
      }
      if (ch === '"') {
        inDouble = false;
      } else {
        token += ch;
      }
      hasToken = true;
      continue;
    }
    if (ch === "\\" && i + 1 < commandLine.length) {
      if (next !== "\n") {
        token += next;
        hasToken = true;
      }
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      hasToken = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      hasToken = true;
      continue;
    }
    if (ch === "#" && !hasToken) {
      while (i + 1 < commandLine.length && commandLine[i + 1] !== "\n") {
        i += 1;
      }
      continue;
    }
    if (ch === ";" || ch === "\n") {
      flushSegment();
      continue;
    }
    if (ch === "&" && next === ">") {
      flushToken();
      i += commandLine[i + 2] === ">" ? 2 : 1;
      skipNext = true;
      continue;
    }
    if (ch === "&" || ch === "|") {
      if (next === ch) {
        i += 1;
      }
      flushSegment();
      continue;
    }
    if (isWhitespaceChar(ch)) {
      flushToken();
      continue;
    }
    if (ch === "(") {
      if (hasToken) {
        parenDepth += 1;
        token += ch;
      }
      continue;
    }
    if (ch === ")") {
      if (parenDepth > 0) {
        parenDepth -= 1;
        token += ch;
      } else {
        flushToken();
      }
      continue;
    }
    if (ch === ">" || ch === "<") {
      if (hasToken && isAllDigits(token)) {
        token = "";
        hasToken = false;
      } else {
        flushToken();
      }
      if (ch === "<" && next === "<" && commandLine[i + 2] === "<") {
        i += 2;
        skipNext = true;
      } else if ((ch === ">" && (next === ">" || next === "|")) || (ch === "<" && (next === "<" || next === ">"))) {
        i += 1;
        skipNext = true;
      } else if (next === "&") {
        i += 1;
        if (isDigit(commandLine.charCodeAt(i + 1))) {
          while (isDigit(commandLine.charCodeAt(i + 1))) {
            i += 1;
          }
        } else if (commandLine[i + 1] === "-") {
          i += 1;
        } else {
          skipNext = true;
        }
      } else {
        skipNext = true;
      }
      continue;
    }
    token += ch;
    hasToken = true;
  }
  flushSegment();
  return segments;
}

function unwrapCommandSegment(tokens) {
  const inlineEnv = {};
  let idx = 0;
  while (idx < tokens.length) {
    const tok = tokens[idx];
    if (SHELL_KEYWORDS.has(tok)) {
      idx += 1;
      continue;
    }
    const eq = tok.indexOf("=");
    if (eq > 0 && isShellIdent(tok.slice(0, eq))) {
      inlineEnv[tok.slice(0, eq)] = tok.slice(eq + 1);
      idx += 1;
      continue;
    }
    const base = basename(tok);
    if (base === "env") {
      idx += 1;
      while (idx < tokens.length) {
        const arg = tokens[idx];
        if (arg === "-u" || arg === "--unset" || arg === "-C" || arg === "-S") {
          idx += 2;
          continue;
        }
        if (arg.startsWith("-")) {
          idx += 1;
          continue;
        }
        const envEq = arg.indexOf("=");
        if (envEq > 0 && isShellIdent(arg.slice(0, envEq))) {
          inlineEnv[arg.slice(0, envEq)] = arg.slice(envEq + 1);
          idx += 1;
          continue;
        }
        break;
      }
      continue;
    }
    if (base === "command" || base === "nohup" || base === "time") {
      idx += 1;
      while (idx < tokens.length && tokens[idx].startsWith("-") && tokens[idx] !== "--") {
        idx += 1;
      }
      if (tokens[idx] === "--") {
        idx += 1;
      }
      continue;
    }
    return { cmd: base, args: tokens.slice(idx + 1), inlineEnv };
  }
  return { cmd: "", args: [], inlineEnv };
}

function parseGitCommand(args) {
  const globalDirs = [];
  const valueFlags = wordSet("-c --namespace --super-prefix --config-env");
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-C" || arg === "--git-dir" || arg === "--work-tree") {
      if (i + 1 < args.length) {
        globalDirs.push({ flag: arg, dir: args[i + 1] });
      }
      i += 1;
    } else if (arg.startsWith("-C") && arg.length > 2) {
      globalDirs.push({ flag: "-C", dir: arg.slice(2) });
    } else if (arg.startsWith("--git-dir=")) {
      globalDirs.push({ flag: "--git-dir", dir: arg.slice(10) });
    } else if (arg.startsWith("--work-tree=")) {
      globalDirs.push({ flag: "--work-tree", dir: arg.slice(12) });
    } else if (valueFlags.has(arg)) {
      i += 1;
    } else if (!arg.startsWith("-")) {
      return { subcmd: arg, subArgs: args.slice(i + 1), globalDirs };
    }
  }
  return { subcmd: "", subArgs: [], globalDirs };
}

function resolveCheckedOutBranch(globalDirs, fallbackDir) {
  let curBase = fallbackDir || process.cwd();
  let explicitGitDir = null;
  for (const entry of globalDirs) {
    const resolved = resolveRealTargetPath(entry.dir, curBase);
    if (entry.flag === "-C") {
      curBase = resolved || resolve(curBase, entry.dir);
    } else if (entry.flag === "--git-dir") {
      explicitGitDir = resolved || resolve(curBase, entry.dir);
    }
  }
  const gitArgs = explicitGitDir
    ? ["--git-dir", explicitGitDir, "symbolic-ref", "--short", "-q", "HEAD"]
    : ["-C", curBase, "symbolic-ref", "--short", "-q", "HEAD"];
  try {
    return execFileSync("git", gitArgs, {
      encoding: "utf8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function isForcePushToProtectedBranch(subArgs, globalDirs, fallbackDir) {
  let hasForce = false;
  let afterDash = false;
  const pos = [];
  const valFlags = wordSet("-o --push-option --repo --receive-pack --exec");
  for (let i = 0; i < subArgs.length; i += 1) {
    const arg = subArgs[i];
    if (!afterDash && arg === "--") {
      afterDash = true;
      continue;
    }
    if (!afterDash && arg.startsWith("-")) {
      if (arg === "--force-with-lease" || arg.startsWith("--force-with-lease=") || arg === "--force-if-includes") {
        continue;
      }
      if (arg === "--force" || arg.startsWith("--force=") || (!arg.startsWith("--") && arg.includes("f"))) {
        hasForce = true;
      }
      if (valFlags.has(arg)) {
        i += 1;
      }
      continue;
    }
    pos.push(arg);
  }

  let checkCheckedOutHead = hasForce && pos.length <= 1;
  const refSpecs = pos.length >= 2 ? pos.slice(1) : pos;
  for (const spec of refSpecs) {
    const plusForced = spec.startsWith("+");
    const clean = plusForced ? spec.slice(1) : spec;
    const dst = clean.includes(":") ? clean.slice(clean.lastIndexOf(":") + 1) : clean;
    const branch = dst.startsWith("refs/heads/") ? dst.slice(11) : dst;
    if ((branch === "main" || branch === "master") && (hasForce || plusForced)) {
      return true;
    }
    if ((branch === "HEAD" || clean === "HEAD") && (hasForce || plusForced)) {
      checkCheckedOutHead = true;
    }
  }

  if (checkCheckedOutHead) {
    const headBranch = resolveCheckedOutBranch(globalDirs, fallbackDir);
    if (headBranch === "main" || headBranch === "master") {
      return true;
    }
  }
  return false;
}

function hasMutatingGitListArgs(subArgs, cfg) {
  let hasQuery = false;
  let afterDash = false;
  const pos = [];
  for (let i = 0; i < subArgs.length; i += 1) {
    const arg = subArgs[i];
    if (!afterDash && arg === "--") {
      afterDash = true;
      continue;
    }
    if (!afterDash && arg.startsWith("-")) {
      const hasShort =
        !arg.startsWith("--") &&
        !(cfg.allowNSkip && arg.startsWith("-n")) &&
        [...arg.slice(1)].some((ch) => cfg.mutShort.has(ch));
      if (cfg.mutExact.has(arg) || cfg.mutPfx.some((p) => arg.startsWith(p)) || hasShort) {
        return true;
      }
      if (cfg.qExact.has(arg) || cfg.qPfx.some((p) => arg.startsWith(p))) {
        hasQuery = true;
      }
      if (cfg.allowNSkip && arg === "-n" && i + 1 < subArgs.length && isAllDigits(subArgs[i + 1])) {
        i += 1;
      } else if (cfg.valFlags.has(arg)) {
        i += 1;
      }
      continue;
    }
    pos.push(arg);
  }
  return pos.length > 0 && !hasQuery;
}

const LIST_VAL_FLAGS = wordSet(
  "--sort --format --color --column --contains --no-contains --merged --no-merged --points-at",
);
const QUERY_PFX = ["--contains=", "--no-contains=", "--merged=", "--no-merged=", "--points-at="];
const TAG_CFG = {
  mutExact: wordSet("-d --delete -a --annotate -s --sign -f --force -m --message -F --file -u --local-user --create-reflog"),
  mutShort: wordSet("d a s f m F u"),
  mutPfx: ["--message=", "--file=", "--local-user="],
  qExact: wordSet("-l --list -v --verify --contains --no-contains --merged --no-merged --points-at"),
  qPfx: QUERY_PFX,
  valFlags: LIST_VAL_FLAGS,
  allowNSkip: true,
};
const BRANCH_CFG = {
  mutExact: wordSet("-d -D --delete -m -M --move -c -C --copy -u --set-upstream-to --unset-upstream --edit-description --create-reflog"),
  mutShort: wordSet("d D m M c C u"),
  mutPfx: ["--set-upstream-to="],
  qExact: wordSet("-l --list -a --all -r --remotes --contains --no-contains --merged --no-merged --points-at --show-current"),
  qPfx: QUERY_PFX,
  valFlags: LIST_VAL_FLAGS,
  allowNSkip: false,
};

function isMutatingGitActionForReadOnly(subcmd, subArgs) {
  if (RO_BLOCKED_GIT_SUBCOMMANDS.has(subcmd)) {
    return true;
  }
  if (subcmd === "worktree" || subcmd === "stash" || subcmd === "remote") {
    const first = subArgs.find((x) => !x.startsWith("-")) || "";
    if (subcmd === "worktree") {
      return Boolean(first && first !== "list");
    }
    if (subcmd === "stash") {
      return first !== "list" && first !== "show";
    }
    return Boolean(first && first !== "show" && first !== "get-url");
  }
  if (subcmd === "tag") {
    return hasMutatingGitListArgs(subArgs, TAG_CFG);
  }
  if (subcmd === "branch") {
    return hasMutatingGitListArgs(subArgs, BRANCH_CFG);
  }
  if (subcmd !== "config") {
    return false;
  }
  const writes = wordSet("--unset --unset-all --replace-all --add --remove-section --rename-section --edit -e");
  const reads = wordSet("--get --get-all --get-regexp --get-urlmatch --list -l");
  const vals = wordSet("-f --file --blob --type --default");
  let hasRead = false;
  let afterDash = false;
  const pos = [];
  for (let i = 0; i < subArgs.length; i += 1) {
    const arg = subArgs[i];
    if (!afterDash && arg === "--") {
      afterDash = true;
      continue;
    }
    if (!afterDash && arg.startsWith("-")) {
      if (writes.has(arg)) {
        return true;
      }
      if (reads.has(arg)) {
        hasRead = true;
      }
      if (vals.has(arg)) {
        i += 1;
      }
      continue;
    }
    pos.push(arg);
  }
  return !hasRead && pos.length >= 2;
}

function isEffectiveGitDirInsideTemp(globalDirs, fallbackBaseDir, tempRoots, realCwd) {
  const check = (dir) => isInsideCanonicalTempRoots(dir, tempRoots, realCwd);
  if (globalDirs.length === 0) {
    return check(realCwd || resolveRealTargetPath(fallbackBaseDir, process.cwd()));
  }
  let curBase = fallbackBaseDir;
  let sawC = false;
  for (const entry of globalDirs) {
    const resolved = resolveRealTargetPath(entry.dir, curBase);
    if (!resolved) {
      return false;
    }
    if (entry.flag === "-C") {
      curBase = resolved;
      sawC = true;
    } else if (!check(resolved)) {
      return false;
    }
  }
  return sawC ? check(curBase) : true;
}

function isMutatingGhCommand(args) {
  let idx = 0;
  while (idx < args.length) {
    const arg = args[idx];
    if (arg === "-R" || arg === "--repo" || arg === "--hostname") {
      idx += 2;
    } else if (arg.startsWith("-")) {
      idx += 1;
    } else {
      break;
    }
  }
  if (idx >= args.length) {
    return false;
  }
  const group = args[idx].toLowerCase();
  const rest = args.slice(idx + 1);
  if (group in GH_MUTATING_ACTIONS) {
    for (let i = 0; i < rest.length; i += 1) {
      if (rest[i] === "-R" || rest[i] === "--repo") {
        i += 1;
        continue;
      }
      if (!rest[i].startsWith("-")) {
        return GH_MUTATING_ACTIONS[group].has(rest[i].toLowerCase());
      }
    }
    return false;
  }
  if (group !== "api") {
    return false;
  }
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "-X" || arg === "--method") {
      if (String(rest[i + 1] || "").toUpperCase() !== "GET") {
        return true;
      }
      i += 1;
    } else if (arg.startsWith("-X") && arg.length > 2 && arg.slice(2).toUpperCase() !== "GET") {
      return true;
    } else if (arg.startsWith("--method=") && arg.slice(9).toUpperCase() !== "GET") {
      return true;
    } else if (
      ["-f", "-F", "--raw-field", "--field", "--input"].includes(arg) ||
      ["-f", "-F", "--raw-field=", "--field=", "--input="].some((p) => arg.startsWith(p))
    ) {
      return true;
    }
  }
  return false;
}

function checkRunCommand(commandLine, session, roots, env) {
  const { kind, memberName } = session;
  const { realCwd, fallbackBaseDir, canonicalTempRoots } = roots;
  for (const tokens of parseCommandSegments(commandLine)) {
    const { cmd, args, inlineEnv } = unwrapCommandSegment(tokens);
    if (cmd === "git") {
      const { subcmd, subArgs, globalDirs } = parseGitCommand(args);
      if (subcmd === "push") {
        if (isForcePushToProtectedBranch(subArgs, globalDirs, realCwd || fallbackBaseDir)) {
          return "Force-pushing to main or master is blocked across all swarm roles.";
        }
        if (kind === "readonly" || kind === "adversary" || kind === "sicko") {
          return `Role '${kind}' (${memberName || kind}) is never permitted to run git push.`;
        }
        if (kind === "author" && inlineEnv.PSTACK_ALLOW_PUSH !== "1" && env.PSTACK_ALLOW_PUSH !== "1") {
          return "Author workers cannot run git push without explicit PSTACK_ALLOW_PUSH=1 authorization.";
        }
      }
      if (
        kind === "readonly" &&
        !isEffectiveGitDirInsideTemp(globalDirs, fallbackBaseDir, canonicalTempRoots, realCwd) &&
        isMutatingGitActionForReadOnly(subcmd, subArgs)
      ) {
        return `Mutating git command 'git ${subcmd}' outside canonical temp roots is blocked for read-only workers.`;
      }
      if (kind === "sicko") {
        let curBase = realCwd || fallbackBaseDir;
        for (const entry of globalDirs) {
          const resolved = resolveRealTargetPath(entry.dir, curBase);
          if (!resolved || !realCwd || !isInsideOrEqual(resolved, realCwd)) {
            return "Git command targeting a directory outside the confined worktree is blocked for comment-sicko workers.";
          }
          if (entry.flag === "-C") {
            curBase = resolved;
          }
        }
        if (SICKO_BLOCKED_GIT_SUBCOMMANDS.has(subcmd)) {
          return `Git subcommand 'git ${subcmd}' is blocked for comment-sicko workers.`;
        }
      }
    } else if (cmd === "gh" && (kind === "readonly" || kind === "adversary" || kind === "sicko") && isMutatingGhCommand(args)) {
      return `Mutating gh command is blocked for '${kind}' workers.`;
    }
  }
  return null;
}

function readGitStatusPorcelain(dir) {
  try {
    const stdout = execFileSync("git", ["-C", dir, "status", "--porcelain"], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const lines = String(stdout || "")
      .split("\n")
      .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
      .filter(Boolean);
    return { ok: true, lines };
  } catch {
    return { ok: false, lines: [] };
  }
}

const DRIFT_WARNING_TEXT =
  "> **Global hooks drift detected.** Your global hooks configuration is out of date or missing required pstack-swarm-guard handlers. Run `skills/setup-pstack/scripts/sync-hooks.mjs` or `/setup-pstack` to sync it.";

function realpathIfExists(filePath) {
  if (typeof filePath !== "string" || !filePath || !existsSync(filePath)) {
    return null;
  }
  try {
    return realpathSync(filePath);
  } catch {
    return null;
  }
}

function commandTargetsGuard(command, expectedGuardReal, baseDir) {
  if (typeof command !== "string" || !command.trim() || !expectedGuardReal) {
    return false;
  }
  const resolveTarget = (p) => realpathIfExists(baseDir ? resolve(baseDir, p) : p);
  let sawExec = false;
  for (const tokens of parseCommandSegments(command)) {
    if (tokens.length === 0) {
      continue;
    }
    const head = basename(tokens[0]);
    if (head === "test" || head === "[") {
      const fIdx = tokens.indexOf("-f");
      if (fIdx >= 0 && fIdx + 1 < tokens.length) {
        if (resolveTarget(tokens[fIdx + 1]) !== expectedGuardReal) {
          return false;
        }
      }
      continue;
    }
    const { cmd, args } = unwrapCommandSegment(tokens);
    let scriptPath = null;
    if (cmd === "node") {
      for (const arg of args) {
        if (!arg.startsWith("-")) {
          scriptPath = arg;
          break;
        }
      }
    } else {
      for (const tok of tokens) {
        if (!tok.includes("=") && !SHELL_KEYWORDS.has(tok)) {
          scriptPath = tok;
          break;
        }
      }
    }
    if (!scriptPath || resolveTarget(scriptPath) !== expectedGuardReal) {
      return false;
    }
    sawExec = true;
  }
  return sawExec;
}

function handlerPointsToGuard(handler, expectedGuardReal, baseDir) {
  return Boolean(
    handler &&
      typeof handler === "object" &&
      handler.type === "command" &&
      commandTargetsGuard(handler.command, expectedGuardReal, baseDir),
  );
}

function splitTopLevelPipes(expr) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if (ch === "\\" && i + 1 < expr.length) {
      i += 1;
      continue;
    }
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")" && depth > 0) {
      depth -= 1;
    } else if (ch === "|" && depth === 0) {
      parts.push(expr.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(expr.slice(start));
  return parts;
}

function expandSimpleGroup(branch) {
  const open = branch.indexOf("(");
  if (open === -1) {
    return [branch];
  }
  let depth = 0;
  let close = -1;
  for (let i = open; i < branch.length; i += 1) {
    if (branch[i] === "(") {
      depth += 1;
    } else if (branch[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) {
    return [branch];
  }
  const prefix = branch.slice(0, open);
  const inner = branch.slice(open + 1, close);
  const suffix = branch.slice(close + 1);
  const out = [];
  for (const alt of splitTopLevelPipes(inner)) {
    for (const rest of expandSimpleGroup(suffix)) {
      out.push(prefix + alt + rest);
    }
  }
  return out;
}

function matcherCoversTool(matcher, toolName) {
  if (typeof matcher !== "string" || !matcher || matcher === "*" || matcher === ".*") {
    return true;
  }
  for (const branch of splitTopLevelPipes(matcher)) {
    for (const pattern of expandSimpleGroup(branch)) {
      if (pattern.endsWith(".*")) {
        if (toolName.startsWith(pattern.slice(0, -2))) {
          return true;
        }
      } else if (pattern === toolName) {
        return true;
      }
    }
  }
  return false;
}

function detectGlobalHooksDriftWarning(env) {
  const configDir = resolveConfigDir(env);
  if (!configDir) {
    return null;
  }
  const globalHooksPath = join(configDir, "hooks.json");
  if (!existsSync(globalHooksPath)) {
    return null;
  }
  const guardSpec = readJsonObject(globalHooksPath)["pstack-swarm-guard"];
  if (!guardSpec || typeof guardSpec !== "object" || Array.isArray(guardSpec) || guardSpec.enabled === false) {
    return null;
  }
  const pluginRoot = resolvePluginRoot(env);
  const pluginGuardSpec = readJsonObject(join(pluginRoot, "hooks.json"))["pstack-swarm-guard"];
  if (!pluginGuardSpec || typeof pluginGuardSpec !== "object") {
    return null;
  }
  const expectedGuardReal = realpathIfExists(join(pluginRoot, "hooks", "guard.mjs"));
  if (!expectedGuardReal) {
    return null;
  }
  for (const eventName of ["SessionStart", "PreInvocation", "Stop"]) {
    const handlers = guardSpec[eventName];
    if (!Array.isArray(handlers) || handlers.length === 0) {
      return DRIFT_WARNING_TEXT;
    }
    if (!handlers.every((h) => handlerPointsToGuard(h, expectedGuardReal, configDir))) {
      return DRIFT_WARNING_TEXT;
    }
  }
  const actualPreTool = guardSpec.PreToolUse;
  const expectedPreTool = Array.isArray(pluginGuardSpec.PreToolUse) ? pluginGuardSpec.PreToolUse : [];
  if (!Array.isArray(actualPreTool) || actualPreTool.length === 0) {
    return DRIFT_WARNING_TEXT;
  }
  for (const expectedBlock of expectedPreTool) {
    const matcher = String(expectedBlock?.matcher || "");
    const matchBlock = actualPreTool.find((b) => b && typeof b === "object" && b.matcher === matcher);
    if (!matchBlock || !Array.isArray(matchBlock.hooks) || matchBlock.hooks.length === 0) {
      return DRIFT_WARNING_TEXT;
    }
    if (!matchBlock.hooks.every((h) => handlerPointsToGuard(h, expectedGuardReal, configDir))) {
      return DRIFT_WARNING_TEXT;
    }
  }
  return null;
}

function resolveConfigDirForDualHook(env) {
  const direct = resolveConfigDir(env);
  if (direct) {
    return direct;
  }
  if (!env.PSTACK_APPDATA_DIR && !env.PSTACK_PLUGIN_ROOT) {
    const home = typeof env.HOME === "string" && env.HOME ? env.HOME : homedir();
    return join(home, ".gemini", "config");
  }
  return null;
}

function shouldShortCircuitDualHook(payload, env, eventName) {
  if (typeof env.PLUGIN_ROOT !== "string" || !env.PLUGIN_ROOT) {
    return false;
  }
  if (typeof env.PSTACK_PLUGIN_ROOT === "string" && env.PSTACK_PLUGIN_ROOT) {
    return false;
  }
  const configDir = resolveConfigDirForDualHook(env);
  if (!configDir) {
    return false;
  }
  const globalHooksPath = join(configDir, "hooks.json");
  if (!existsSync(globalHooksPath)) {
    return false;
  }
  const guardSpec = readJsonObject(globalHooksPath)["pstack-swarm-guard"];
  if (!guardSpec || typeof guardSpec !== "object" || Array.isArray(guardSpec) || guardSpec.enabled === false) {
    return false;
  }
  const expectedGuardReal = realpathIfExists(join(env.PLUGIN_ROOT, "hooks", "guard.mjs"));
  if (!expectedGuardReal) {
    return false;
  }
  if (eventName === "SessionStart" || eventName === "PreInvocation" || eventName === "Stop") {
    const handlers = guardSpec[eventName];
    return Array.isArray(handlers) && handlers.some((h) => handlerPointsToGuard(h, expectedGuardReal, configDir));
  }
  if (eventName === "PreToolUse" || payload.toolCall) {
    const blocks = guardSpec.PreToolUse;
    if (!Array.isArray(blocks) || blocks.length === 0) {
      return false;
    }
    const tc = payload.toolCall && typeof payload.toolCall === "object" ? payload.toolCall : {};
    const rawName = typeof tc.name === "string" ? tc.name : String(tc.name || "");
    const toolName = rawName.startsWith("default_api:") ? rawName.slice(12) : rawName;
    if (!toolName) {
      return blocks.some(
        (b) =>
          b &&
          typeof b === "object" &&
          Array.isArray(b.hooks) &&
          b.hooks.some((h) => handlerPointsToGuard(h, expectedGuardReal, configDir)),
      );
    }
    return blocks.some(
      (b) =>
        b &&
        typeof b === "object" &&
        matcherCoversTool(b.matcher, toolName) &&
        Array.isArray(b.hooks) &&
        b.hooks.some((h) => handlerPointsToGuard(h, expectedGuardReal, configDir)),
    );
  }
  return false;
}

function cleanupLegacyCacheFiles(cacheDir) {
  if (!cacheDir) {
    return;
  }
  for (const name of ["injected-capsules.json", "non-worker-roots.json"]) {
    const filePath = join(cacheDir, name);
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {}
    }
  }
}

function handleSessionOrInvocation(payload, env) {
  if (isPluginDisabled(env)) {
    return {};
  }
  const isSessionStart = payload.hookEventName === "SessionStart";
  const session = classifySession(payload, env);
  if (isSessionStart) {
    cleanupLegacyCacheFiles(session.cacheDir);
  }
  if (session.sessionKind === "unmanaged") {
    return {};
  }
  const convKey = typeof payload.conversationId === "string" && payload.conversationId ? payload.conversationId : "__unknown__";
  const nextState = { ...session.capsuleState };
  let stateDirty = false;
  if (
    (session.kind === "readonly" || session.kind === "sicko") &&
    nextState.baselineGitStatus === undefined &&
    typeof payload.cwd === "string" &&
    payload.cwd &&
    existsSync(payload.cwd)
  ) {
    const gitStatus = readGitStatusPorcelain(realpathSync(payload.cwd));
    if (gitStatus.ok) {
      nextState.baselineGitStatus = gitStatus.lines;
      stateDirty = true;
    }
  }
  const driftWarning =
    isSessionStart && session.sessionKind === "coordinator" && !nextState.driftWarningNotified
      ? detectGlobalHooksDriftWarning(env)
      : null;
  const capsuleAbsPath = session.capsule ? join(resolvePluginRoot(env), session.capsule) : "";
  const needsCapsule = Boolean(session.capsule && nextState.capsule !== session.capsule && existsSync(capsuleAbsPath));
  if (!needsCapsule) {
    if (driftWarning) {
      nextState.driftWarningNotified = true;
      writeJsonAtomically(capsuleStatePath(session.cacheDir, convKey), nextState);
      return {
        injectSteps: [{ systemMessage: { systemMessage: driftWarning } }],
      };
    }
    if (stateDirty) {
      writeJsonAtomically(capsuleStatePath(session.cacheDir, convKey), nextState);
    }
    return {};
  }
  const isUpgrade = typeof nextState.capsule === "string" && nextState.capsule.length > 0;
  const hasForkCapsule = !isUpgrade && transcriptContainsRoleCapsule(resolveOwnTranscriptPath(payload, session.appDataDir));
  nextState.capsule = session.capsule;
  delete nextState.plainSwarm;
  if (driftWarning) {
    nextState.driftWarningNotified = true;
  }
  writeJsonAtomically(capsuleStatePath(session.cacheDir, convKey), nextState);
  const prefix = isUpgrade || hasForkCapsule ? ROLE_OVERRIDE_NOTICE : "";
  const suffix = driftWarning ? `\n\n${driftWarning}` : "";
  return {
    injectSteps: [{ systemMessage: { systemMessage: prefix + readFileSync(capsuleAbsPath, "utf8") + suffix } }],
  };
}

function deny(reason) {
  return { decision: "deny", reason };
}

const ALLOW = { decision: "allow" };

function handlePreToolUse(payload, env) {
  if (isPluginDisabled(env)) {
    return ALLOW;
  }
  const tc = payload.toolCall && typeof payload.toolCall === "object" ? payload.toolCall : {};
  const rawName = typeof tc.name === "string" ? tc.name : String(tc.name || "");
  const toolName = rawName.startsWith("default_api:") ? rawName.slice(12) : rawName;
  const args = (typeof tc.args === "string" ? parseJsonObjectSafe(tc.args) : tc.args) || {};
  const session = classifySession(payload, env);
  if (session.sessionKind === "unmanaged") {
    return ALLOW;
  }

  if (LEGACY_SUBAGENT_TOOLS.has(toolName)) {
    const subType = String(args.TypeName ?? args.SubagentName ?? args.typeName ?? args.subagentName ?? "").trim().toLowerCase();
    if (toolName === "invoke_subagent" && subType === "image-generator") {
      return ALLOW;
    }
    return deny("Legacy subagent tools are disabled in Swarm-Centric Pstack v2. Use native swarm.");
  }

  const { kind, memberName } = session;
  const hasValidCwd = typeof payload.cwd === "string" && payload.cwd.length > 0 && existsSync(payload.cwd);
  const realCwd = hasValidCwd ? realpathSync(payload.cwd) : null;
  const fallbackBaseDir = realCwd || process.cwd();
  let rawArt = "";
  if (typeof payload.artifactDirectoryPath === "string" && payload.artifactDirectoryPath) {
    rawArt = payload.artifactDirectoryPath;
  } else if (typeof session.appDataDir === "string" && session.appDataDir && isSafeConvId(payload.conversationId)) {
    rawArt = join(session.appDataDir, "brain", payload.conversationId);
  }
  const realArtifact = rawArt
    ? existsSync(rawArt)
      ? realpathSync(rawArt)
      : resolveRealTargetPath(rawArt, fallbackBaseDir)
    : null;
  const canonicalTempRoots = getCanonicalTempRoots(env);

  if (kind === "readonly" && (toolName === "call_mcp_tool" || toolName.startsWith("mcp_"))) {
    let mcpName = "";
    if (toolName === "call_mcp_tool") {
      mcpName = String(args.ToolName || args.toolName || args.name || "");
    } else {
      const secondUnderscore = toolName.indexOf("_", 4);
      mcpName = secondUnderscore > 4 ? toolName.slice(secondUnderscore + 1) : toolName.slice(4);
    }
    const segments = mcpName.toLowerCase().replaceAll("-", "_").split("_");
    if (!SWARM_BOARD_TOOLS.has(mcpName) && segments.some((seg) => MUTATING_MCP_VERBS.has(seg))) {
      return deny(`Mutating MCP tool '${mcpName}' is blocked for read-only workers.`);
    }
  }

  if (toolName === "edit_file" || toolName === "write_file") {
    const rawTarget = args.Path ?? args.path ?? args.TargetFile ?? args.targetFile ?? args.file_path ?? "";
    if (kind === "readonly") {
      if (toolName === "edit_file") {
        return deny(`Read-only worker (${memberName || "ro-*"}) cannot call edit_file.`);
      }
      if (typeof rawTarget !== "string" || !rawTarget) {
        return deny(`Read-only worker (${memberName || "ro-*"}) cannot call write_file without a valid path.`);
      }
      const realTarget = resolveRealTargetPath(rawTarget, fallbackBaseDir);
      if (!realTarget || isSystemGeneratedArtifactPath(realTarget, realArtifact)) {
        return deny(`Read-only worker (${memberName || "ro-*"}) cannot write protected or unresolvable path '${rawTarget}'.`);
      }
      if (realArtifact && isInsideOrEqual(realTarget, realArtifact)) {
        if (isAllowedReadOnlyArtifactImage(realTarget, realArtifact, realCwd)) {
          return ALLOW;
        }
        return deny(`Read-only worker (${memberName || "ro-*"}) can only write screenshot images (.png, .jpg, .jpeg, .webp) inside its artifact directory.`);
      }
      if (isInsideCanonicalTempRoots(realTarget, canonicalTempRoots, realCwd, { excludeRealCwd: true })) {
        return ALLOW;
      }
      return deny(`Read-only worker (${memberName || "ro-*"}) can only call write_file inside canonical temp roots.`);
    }
    if (kind === "sicko" && toolName === "write_file") {
      return deny(`Comment-sicko worker (${memberName || "sicko-*"}) cannot call write_file; use edit_file on existing files only.`);
    }
    if (kind === "author" || kind === "adversary" || kind === "sicko") {
      if (typeof rawTarget !== "string" || !rawTarget) {
        return deny("Missing target file path.");
      }
      if (!hasValidCwd || !realCwd) {
        return deny("Missing or non-existent worker cwd for path confinement.");
      }
      const realTarget = resolveRealTargetPath(rawTarget, realCwd);
      if (!realTarget) {
        return deny("Target file path failed symlink resolution.");
      }
      if (isSystemGeneratedArtifactPath(realTarget, realArtifact)) {
        return deny(`Path '${rawTarget}' inside protected '.system_generated' artifact metadata is blocked.`);
      }
      const insideCwd = isStrictlyInside(realTarget, realCwd);
      const insideArtifact = kind !== "sicko" && realArtifact ? isStrictlyInside(realTarget, realArtifact) : false;
      const insideTemp = kind !== "sicko" && isInsideCanonicalTempRoots(realTarget, canonicalTempRoots, realCwd);
      if (!insideCwd && !insideArtifact && !insideTemp) {
        return deny(`Path '${rawTarget}' escapes confined worker worktree '${realCwd}'.`);
      }
    }
  }

  if (toolName === "run_command") {
    const commandLine = String(args.CommandLine ?? args.command ?? args.commandLine ?? "");
    const reason = checkRunCommand(commandLine, session, { realCwd, fallbackBaseDir, canonicalTempRoots }, env);
    if (reason) {
      return deny(reason);
    }
  }
  return ALLOW;
}

function handleStop(payload, env) {
  if (isPluginDisabled(env) || payload.continuationActive) {
    return {};
  }
  if (payload.terminationReason && payload.terminationReason !== "NO_TOOL_CALL") {
    return {};
  }
  const session = classifySession(payload, env);
  if (session.sessionKind === "unmanaged" || (session.kind !== "readonly" && session.kind !== "sicko")) {
    return {};
  }
  if (typeof payload.cwd !== "string" || !payload.cwd || !existsSync(payload.cwd)) {
    return {};
  }
  const realCwd = realpathSync(payload.cwd);
  if (session.kind === "readonly" && isInsideCanonicalTempRoots(realCwd, getCanonicalTempRoots(env), realCwd, { allowRootEqual: true })) {
    return {};
  }
  const gitStatus = readGitStatusPorcelain(realCwd);
  if (!gitStatus.ok) {
    return {};
  }
  const baseline = new Set(Array.isArray(session.capsuleState?.baselineGitStatus) ? session.capsuleState.baselineGitStatus : []);
  const unexpected = gitStatus.lines.filter((line) => {
    if (baseline.has(line)) {
      return false;
    }
    if (session.kind === "readonly") {
      return true;
    }
    return line.startsWith("?? ") || (line.length >= 2 && (line[0] === "D" || line[1] === "D"));
  });
  if (unexpected.length === 0) {
    return {};
  }
  const paths = unexpected.map((l) => (l.length > 3 ? l.slice(3) : l)).join(", ");
  return {
    decision: "continue",
    reason:
      session.kind === "readonly"
        ? `Read-only worker left unexpected git changes or untracked files: ${paths}. Clean them up before stopping.`
        : `Comment-sicko worker left unexpected untracked or deleted git entries: ${paths}. Clean them up before stopping.`,
  };
}

export function runGuard(payload, env = process.env) {
  const safePayload = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const eventName = String(safePayload.hookEventName || "");
  if (shouldShortCircuitDualHook(safePayload, env, eventName)) {
    return eventName === "PreToolUse" || safePayload.toolCall ? ALLOW : {};
  }
  if (eventName === "SessionStart" || eventName === "PreInvocation") {
    return handleSessionOrInvocation(safePayload, env);
  }
  if (eventName === "Stop") {
    return handleStop(safePayload, env);
  }
  if (eventName === "PreToolUse" || safePayload.toolCall) {
    return handlePreToolUse(safePayload, env);
  }
  return {};
}

export async function handleRawStdin(rawInput, env = process.env) {
  if (typeof env.PSTACK_PLUGIN_ROOT === "string" && env.PSTACK_PLUGIN_ROOT && env.PSTACK_GUARD_DELEGATED !== "1") {
    const targetGuard = join(env.PSTACK_PLUGIN_ROOT, "hooks", "guard.mjs");
    if (existsSync(targetGuard)) {
      let selfReal = null;
      let targetReal = null;
      try {
        selfReal = realpathSync(fileURLToPath(import.meta.url));
        targetReal = realpathSync(targetGuard);
      } catch {}
      if (selfReal && targetReal && selfReal !== targetReal) {
        const delegatedEnv = { ...env, PSTACK_GUARD_DELEGATED: "1" };
        const mod = await import(pathToFileURL(targetReal).href);
        if (typeof mod.handleRawStdin === "function") {
          return await mod.handleRawStdin(rawInput, delegatedEnv);
        }
        if (typeof mod.runGuard === "function") {
          return `${JSON.stringify(await mod.runGuard(parseJsonObjectSafe(rawInput) || {}, delegatedEnv))}\n`;
        }
      }
    }
  }
  return `${JSON.stringify(runGuard(parseJsonObjectSafe(rawInput) || {}, env))}\n`;
}

let isMain = false;
try {
  isMain = Boolean(
    process.argv[1] &&
      realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)),
  );
} catch {}
if (isMain) {
  let rawInput = "";
  try {
    rawInput = readFileSync(0, "utf8");
  } catch {}
  process.stdout.write(await handleRawStdin(rawInput, process.env));
}
