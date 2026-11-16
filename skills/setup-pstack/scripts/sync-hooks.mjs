#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function isWhitespaceChar(ch) {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isDigit(code) {
  return code >= 48 && code <= 57;
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

function parseJsonObjectStrict(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a top-level JSON object");
  }
  return parsed;
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

function parseCommandSegments(commandLine) {
  const segments = [];
  let tokens = [];
  let token = "";
  let hasToken = false;
  let inSingle = false;
  let inDouble = false;

  function flushToken() {
    if (!hasToken) {
      return;
    }
    tokens.push(token);
    token = "";
    hasToken = false;
  }

  function flushSegment() {
    flushToken();
    if (tokens.length > 0) {
      segments.push(tokens);
      tokens = [];
    }
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
      if (ch === "\\" && i + 1 < commandLine.length && (next === '"' || next === "\\" || next === "$" || next === "`")) {
        token += next;
        i += 1;
        hasToken = true;
        continue;
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
    if (ch === ";" || ch === "\n") {
      flushSegment();
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
    if (ch === "(" || ch === ")") {
      flushToken();
      continue;
    }
    if (ch === ">" || ch === "<") {
      if (hasToken && isAllDigits(token)) {
        token = "";
        hasToken = false;
      } else {
        flushToken();
      }
      continue;
    }
    token += ch;
    hasToken = true;
  }
  flushSegment();
  return segments;
}

function realpathIfExists(targetPath) {
  if (typeof targetPath !== "string" || !targetPath || !existsSync(targetPath)) {
    return null;
  }
  try {
    return realpathSync(targetPath);
  } catch {
    return null;
  }
}

function commandTargetsGuard(command, expectedGuardReal) {
  if (typeof command !== "string" || !command.trim()) {
    return false;
  }
  const segments = parseCommandSegments(command);
  let sawExec = false;
  for (const seg of segments) {
    if (seg.length === 0) {
      continue;
    }
    const head = basename(seg[0]);
    if (head === "test" || head === "[") {
      const fIdx = seg.indexOf("-f");
      if (fIdx >= 0 && fIdx + 1 < seg.length) {
        const checkReal = realpathIfExists(seg[fIdx + 1]);
        if (checkReal !== expectedGuardReal) {
          return false;
        }
      }
      continue;
    }
    let scriptPath = null;
    if (head === "node") {
      for (let i = 1; i < seg.length; i += 1) {
        if (!seg[i].startsWith("-")) {
          scriptPath = seg[i];
          break;
        }
      }
    } else {
      scriptPath = seg[0];
    }
    if (!scriptPath || realpathIfExists(scriptPath) !== expectedGuardReal) {
      return false;
    }
    sawExec = true;
  }
  return sawExec;
}

function shellSingleQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildGuardCommand(absGuardPath) {
  const quoted = shellSingleQuote(absGuardPath);
  return `test ! -f ${quoted} || node ${quoted}`;
}

function buildExpectedGuardSpec(pluginGuardSpec, absGuardPath) {
  const command = buildGuardCommand(absGuardPath);
  const spec = {};
  for (const eventName of ["SessionStart", "PreInvocation"]) {
    const entries = Array.isArray(pluginGuardSpec[eventName]) ? pluginGuardSpec[eventName] : [];
    spec[eventName] = entries.map((entry) => ({
      type: "command",
      command,
      timeout: typeof entry?.timeout === "number" ? entry.timeout : 10,
    }));
  }
  const preToolEntries = Array.isArray(pluginGuardSpec.PreToolUse) ? pluginGuardSpec.PreToolUse : [];
  spec.PreToolUse = preToolEntries.map((block) => ({
    matcher: String(block?.matcher || ""),
    hooks: (Array.isArray(block?.hooks) ? block.hooks : []).map((entry) => ({
      type: "command",
      command,
      timeout: typeof entry?.timeout === "number" ? entry.timeout : 10,
    })),
  }));
  const stopEntries = Array.isArray(pluginGuardSpec.Stop) ? pluginGuardSpec.Stop : [];
  spec.Stop = stopEntries.map((entry) => ({
    type: "command",
    command,
    timeout: typeof entry?.timeout === "number" ? entry.timeout : 10,
  }));
  return spec;
}

function validateGlobalHooksSpec(globalDoc, pluginGuardSpec, absGuardReal) {
  const guardSpec = globalDoc["pstack-swarm-guard"];
  if (!guardSpec || typeof guardSpec !== "object" || Array.isArray(guardSpec)) {
    return { ok: false, reason: "Missing pstack-swarm-guard entry in global hooks.json" };
  }
  if (guardSpec.enabled === false) {
    return { ok: false, reason: "pstack-swarm-guard is disabled in global hooks.json" };
  }
  for (const eventName of ["SessionStart", "PreInvocation", "Stop"]) {
    const handlers = guardSpec[eventName];
    if (!Array.isArray(handlers) || handlers.length === 0) {
      return { ok: false, reason: `Missing ${eventName} handler in pstack-swarm-guard` };
    }
    const valid = handlers.every(
      (h) => h && typeof h === "object" && h.type === "command" && commandTargetsGuard(h.command, absGuardReal),
    );
    if (!valid) {
      return { ok: false, reason: `Stale ${eventName} command or guard path in pstack-swarm-guard` };
    }
  }
  const actualPreTool = guardSpec.PreToolUse;
  const expectedPreTool = Array.isArray(pluginGuardSpec.PreToolUse) ? pluginGuardSpec.PreToolUse : [];
  if (!Array.isArray(actualPreTool) || actualPreTool.length === 0) {
    return { ok: false, reason: "Missing PreToolUse handlers in pstack-swarm-guard" };
  }
  for (const expectedBlock of expectedPreTool) {
    const matcher = String(expectedBlock?.matcher || "");
    const matchBlock = actualPreTool.find((b) => b && typeof b === "object" && b.matcher === matcher);
    if (!matchBlock || !Array.isArray(matchBlock.hooks) || matchBlock.hooks.length === 0) {
      return { ok: false, reason: `Missing PreToolUse matcher '${matcher}' in pstack-swarm-guard` };
    }
    const valid = matchBlock.hooks.every(
      (h) => h && typeof h === "object" && h.type === "command" && commandTargetsGuard(h.command, absGuardReal),
    );
    if (!valid) {
      return { ok: false, reason: `Stale PreToolUse command for matcher '${matcher}' in pstack-swarm-guard` };
    }
  }
  return { ok: true };
}

function parseCliArgs(argv) {
  let check = false;
  let configDir = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") {
      check = true;
    } else if (arg === "--config-dir") {
      if (i + 1 >= argv.length || !argv[i + 1]) {
        return { error: "Missing value for --config-dir" };
      }
      configDir = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--config-dir=")) {
      const val = arg.slice(13);
      if (!val) {
        return { error: "Missing value for --config-dir" };
      }
      configDir = val;
    } else {
      return { error: `Unknown argument '${arg}'` };
    }
  }
  return { check, configDir, error: null };
}

function main() {
  const parsedArgs = parseCliArgs(process.argv.slice(2));
  if (parsedArgs.error) {
    process.stderr.write(`${parsedArgs.error}\n`);
    process.exit(1);
  }

  const pluginRoot =
    typeof process.env.PSTACK_PLUGIN_ROOT === "string" && process.env.PSTACK_PLUGIN_ROOT
      ? resolve(process.env.PSTACK_PLUGIN_ROOT)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

  const pluginHooksPath = join(pluginRoot, "hooks.json");
  const guardPath = join(pluginRoot, "hooks", "guard.mjs");
  if (!existsSync(pluginHooksPath) || !existsSync(guardPath)) {
    process.stderr.write(`Missing plugin hooks.json or hooks/guard.mjs under ${pluginRoot}\n`);
    process.exit(1);
  }

  const absGuardPath = realpathSync(guardPath);
  const pluginHooks = parseJsonObjectStrict(readFileSync(pluginHooksPath, "utf8"));
  const pluginGuardSpec = pluginHooks["pstack-swarm-guard"];
  if (!pluginGuardSpec || typeof pluginGuardSpec !== "object") {
    process.stderr.write(`Missing pstack-swarm-guard in ${pluginHooksPath}\n`);
    process.exit(1);
  }

  const configDir = parsedArgs.configDir
    ? resolve(parsedArgs.configDir)
    : typeof process.env.PSTACK_CONFIG_DIR === "string" && process.env.PSTACK_CONFIG_DIR
      ? resolve(process.env.PSTACK_CONFIG_DIR)
      : join(process.env.HOME || homedir(), ".gemini", "config");
  const globalHooksPath = join(configDir, "hooks.json");

  if (parsedArgs.check) {
    if (!existsSync(globalHooksPath)) {
      process.stderr.write(`Global hooks.json not found at ${globalHooksPath}\n`);
      process.exit(1);
    }
    let globalDoc;
    try {
      globalDoc = parseJsonObjectStrict(readFileSync(globalHooksPath, "utf8"));
    } catch (err) {
      process.stderr.write(`Invalid global hooks.json at ${globalHooksPath}: ${err.message}\n`);
      process.exit(1);
    }
    const status = validateGlobalHooksSpec(globalDoc, pluginGuardSpec, absGuardPath);
    if (!status.ok) {
      process.stderr.write(`${status.reason}\n`);
      process.exit(1);
    }
    process.stdout.write(`Global hooks.json at ${globalHooksPath} is synced with ${absGuardPath}\n`);
    process.exit(0);
  }

  let globalDoc = {};
  if (existsSync(globalHooksPath)) {
    const raw = readFileSync(globalHooksPath, "utf8");
    if (raw.trim()) {
      try {
        globalDoc = parseJsonObjectStrict(raw);
      } catch (err) {
        process.stderr.write(`Invalid global hooks.json at ${globalHooksPath}: ${err.message}\n`);
        process.exit(1);
      }
    }
  }

  globalDoc["pstack-swarm-guard"] = buildExpectedGuardSpec(pluginGuardSpec, absGuardPath);
  writeJsonAtomically(globalHooksPath, globalDoc);
  process.stdout.write(`Synced pstack-swarm-guard in ${globalHooksPath} to ${absGuardPath}\n`);
}

main();
