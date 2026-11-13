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
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LEGACY_SUBAGENT_TOOLS = new Set([
  "invoke_subagent",
  "define_subagent",
  "manage_subagents",
  "send_message",
]);

const SWARM_ALLOWED_MCP_TOOLS = new Set([
  "post_message",
  "read_board",
  "swarm_wait",
  "swarm",
]);

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
  "stash",
  "tag",
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

const MUTATING_FS_COMMANDS = new Set([
  "rm",
  "rmdir",
  "mv",
  "cp",
  "chmod",
  "chown",
  "chgrp",
  "truncate",
  "dd",
  "patch",
  "ln",
  "unlink",
  "install",
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

function readJsonObject(filePath) {
  try {
    if (!existsSync(filePath)) return {};
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function updateJsonKey(filePath, key, value) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const current = readJsonObject(filePath);
  current[key] = value;
  const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const tmpPath = join(dir, `.${basename(filePath)}.${suffix}.tmp`);
  const serialized = JSON.stringify(current, null, 2) + "\n";
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
  return null;
}

function resolveCacheDir(appDataDir, env) {
  if (typeof env.PLUGIN_DATA === "string" && env.PLUGIN_DATA.length > 0) {
    return env.PLUGIN_DATA;
  }
  return appDataDir ? join(appDataDir, "pstack-swarm-guard") : join(tmpdir(), "pstack-swarm-guard");
}

function resolvePluginRoot(env) {
  if (typeof env.PLUGIN_ROOT === "string" && env.PLUGIN_ROOT.length > 0) {
    return env.PLUGIN_ROOT;
  }
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function lookupMemberName(conversationId, appDataDir, cacheDir) {
  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return null;
  }
  const mapPath = join(cacheDir, "member-map.json");
  const cachedMap = readJsonObject(mapPath);
  const cachedName = cachedMap[conversationId];
  if (typeof cachedName === "string" && cachedName.length > 0 && cachedName !== "coordinator") {
    return cachedName;
  }
  if (!appDataDir) return null;
  const brainDir = join(appDataDir, "brain");
  if (!existsSync(brainDir)) return null;

  let entries = [];
  try {
    entries = readdirSync(brainDir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const membersPath = join(brainDir, entry.name, ".system_generated", "swarm", "members.json");
    const doc = readJsonObject(membersPath);
    const members = doc.members;
    if (!members || typeof members !== "object") continue;
    for (const [memberName, info] of Object.entries(members)) {
      if (!info || typeof info !== "object") continue;
      const cid = info.conversation_id || info.conversationId;
      if (cid !== conversationId) continue;
      if (memberName === "coordinator" || info.role === "coordinator") continue;
      updateJsonKey(mapPath, conversationId, memberName);
      return memberName;
    }
  }

  return null;
}

function classifyMember(memberName) {
  if (!memberName || memberName === "coordinator") {
    return { kind: "coordinator", capsule: "roles/coordinator.md" };
  }
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
  return { kind: "author", capsule: "roles/poteto-agent.md" };
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

function isAllowedTempTarget(target) {
  if (!target || !target.startsWith("/")) return false;
  const clean = posix.normalize(target);
  return (
    clean === "/dev/null" ||
    clean === "/tmp" ||
    clean.startsWith("/tmp/") ||
    clean === "/private/tmp" ||
    clean.startsWith("/private/tmp/")
  );
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

function hasDisallowedOutputRedirect(command) {
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
    if (!inSingle && !inDouble && ch === ">") {
      if (command[i + 1] === "&") {
        const fdMatch = command.slice(i + 2).match(/^(?:\d+|-)(?=$|[\s|&;()<>])/);
        if (fdMatch) {
          i += 2 + fdMatch[0].length;
          continue;
        }
        const { token, nextIdx } = readNextShellToken(command, i + 2);
        if (!isAllowedTempTarget(token)) return true;
        i = nextIdx;
        continue;
      }
      let opLen = 1;
      if (command[i + 1] === ">" || command[i + 1] === "|") {
        opLen = 2;
      }
      const { token, nextIdx } = readNextShellToken(command, i + opLen);
      if (!isAllowedTempTarget(token)) return true;
      i = nextIdx;
      continue;
    }
    i += 1;
  }
  return false;
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
        const opLen = command[i + 1] === ch || command[i + 1] === "|" || command[i + 1] === "&" ? 2 : 1;
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
  if (depth > 8 || !command) return { invocations: [], hasBadRedirect: false };
  let hasBadRedirect = hasDisallowedOutputRedirect(command);
  const invocations = [];
  const scriptEnv = {};

  for (const sub of extractCommandSubstitutions(command)) {
    const subRes = collectInvocations(sub, depth + 1);
    if (subRes.hasBadRedirect) hasBadRedirect = true;
    invocations.push(...subRes.invocations);
  }

  const rawSegments = tokenizeShellSegments(command);
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
          if (inner.hasBadRedirect) hasBadRedirect = true;
          for (const inv of inner.invocations) {
            invocations.push({ ...inv, env: { ...parsed.env, ...inv.env } });
          }
          break;
        }
      }
    } else if (parsed.cmd === "eval" && parsed.args.length > 0) {
      const inner = collectInvocations(parsed.args.join(" "), depth + 1);
      if (inner.hasBadRedirect) hasBadRedirect = true;
      for (const inv of inner.invocations) {
        invocations.push({ ...inv, env: { ...parsed.env, ...inv.env } });
      }
    }
  }

  return { invocations, hasBadRedirect };
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

function isMutatingReadOnlyInvocation(inv) {
  const { cmd, args } = inv;
  if (!cmd) return null;

  if (MUTATING_FS_COMMANDS.has(cmd)) {
    return `Filesystem mutation command '${cmd}' is blocked for read-only ro-* workers.`;
  }

  if (cmd === "mkdir" || cmd === "touch") {
    const paths = args.filter((a) => !a.startsWith("-"));
    if (paths.length === 0 || paths.some((p) => !isAllowedTempTarget(p))) {
      return `Filesystem command '${cmd}' outside /tmp is blocked for read-only ro-* workers.`;
    }
  }

  if (cmd === "tee") {
    const files = args.filter((a) => !a.startsWith("-"));
    if (files.some((f) => !isAllowedTempTarget(f))) {
      return "Command 'tee' targeting paths outside /dev/null or /tmp is blocked for read-only ro-* workers.";
    }
  }

  if (cmd === "sed") {
    for (const arg of args) {
      if (arg === "--") break;
      if (arg === "--in-place" || arg.startsWith("--in-place=") || /^-[a-zA-Z]*i/.test(arg)) {
        return "In-place 'sed -i' is blocked for read-only ro-* workers.";
      }
    }
  }

  if (cmd === "perl" || cmd === "ruby") {
    for (const arg of args) {
      if (arg === "--") break;
      if (/^-[a-zA-Z]*i/.test(arg)) {
        return `In-place '${cmd} -i' is blocked for read-only ro-* workers.`;
      }
    }
  }

  if (cmd === "git") {
    const { subcmd, subArgs } = parseGitCommand(args);
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
  const appDataDir = resolveAppDataDir(payload, env);
  const cacheDir = resolveCacheDir(appDataDir, env);
  const memberName = lookupMemberName(payload.conversationId, appDataDir, cacheDir);
  const { capsule } = classifyMember(memberName);

  if (!capsule) {
    return {};
  }

  const convKey = payload.conversationId || "__unknown__";
  const injectedPath = join(cacheDir, "injected-capsules.json");
  const injectedMap = readJsonObject(injectedPath);
  if (injectedMap[convKey] === capsule) {
    return {};
  }

  const pluginRoot = resolvePluginRoot(env);
  const capsuleAbsPath = join(pluginRoot, capsule);
  if (!existsSync(capsuleAbsPath)) {
    return {};
  }

  const capsuleText = readFileSync(capsuleAbsPath, "utf8");
  updateJsonKey(injectedPath, convKey, capsule);

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

function handlePreToolUse(payload, env) {
  const toolCall = payload.toolCall && typeof payload.toolCall === "object" ? payload.toolCall : {};
  const toolName = String(toolCall.name || "");
  const args = parseToolArgs(toolCall.args);

  if (LEGACY_SUBAGENT_TOOLS.has(toolName)) {
    return {
      decision: "deny",
      reason: "Legacy subagent tools are disabled in Swarm-Centric Pstack v2. Use native swarm.",
    };
  }

  const appDataDir = resolveAppDataDir(payload, env);
  const cacheDir = resolveCacheDir(appDataDir, env);
  const memberName = lookupMemberName(payload.conversationId, appDataDir, cacheDir);
  const { kind } = classifyMember(memberName);

  if (kind === "readonly") {
    if (toolName === "edit_file" || toolName === "write_file") {
      return {
        decision: "deny",
        reason: `Read-only worker (${memberName || "ro-*"}) cannot call ${toolName}.`,
      };
    }

    if (toolName === "run_command") {
      const commandLine = String(args.CommandLine ?? args.command ?? args.commandLine ?? "");
      const { invocations, hasBadRedirect } = collectInvocations(commandLine);
      if (hasBadRedirect) {
        return {
          decision: "deny",
          reason: "Output file redirection outside /dev/null or /tmp is blocked for read-only ro-* workers.",
        };
      }
      for (const inv of invocations) {
        const denyReason = isMutatingReadOnlyInvocation(inv);
        if (denyReason) {
          return { decision: "deny", reason: denyReason };
        }
      }
    }

    if (toolName === "call_mcp_tool" || toolName.startsWith("mcp_")) {
      const mcpToolName = extractMcpToolName(toolName, args);
      if (!SWARM_ALLOWED_MCP_TOOLS.has(mcpToolName)) {
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
    if (typeof payload.cwd !== "string" || payload.cwd.length === 0 || !existsSync(payload.cwd)) {
      return { decision: "deny", reason: "Missing or non-existent worker cwd for path confinement." };
    }

    const realCwd = realpathSync(payload.cwd);
    const realArtifact =
      typeof payload.artifactDirectoryPath === "string" &&
      payload.artifactDirectoryPath.length > 0 &&
      existsSync(payload.artifactDirectoryPath)
        ? realpathSync(payload.artifactDirectoryPath)
        : typeof payload.artifactDirectoryPath === "string" && payload.artifactDirectoryPath.length > 0
          ? resolveRealTargetPath(payload.artifactDirectoryPath, realCwd)
          : null;

    const realTarget = resolveRealTargetPath(rawTarget, realCwd);
    if (!realTarget) {
      return { decision: "deny", reason: "Target file path failed symlink resolution." };
    }

    const insideCwd = isStrictlyInside(realTarget, realCwd);
    const insideArtifact = realArtifact ? isStrictlyInside(realTarget, realArtifact) : false;

    if (!insideCwd && !insideArtifact) {
      return {
        decision: "deny",
        reason: `Path '${rawTarget}' escapes confined worker worktree '${realCwd}'.`,
      };
    }
  }

  if (toolName === "run_command") {
    const commandLine = String(args.CommandLine ?? args.command ?? args.commandLine ?? "");
    const { invocations } = collectInvocations(commandLine);

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
