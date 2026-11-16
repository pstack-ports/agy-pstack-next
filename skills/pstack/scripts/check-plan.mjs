#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

const RULE =
	"Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.";
const LANES = /Ten lanes on `[^`<>]+` at the PR head/;
const SUB_BLOCKS = [
	"Depends on.",
	"Files.",
	"Build.",
	"You see.",
	"Verify, unit.",
	"Verify, live.",
	"Verify, perf.",
	"Review gate.",
	"Merge.",
];
const PROGRAM_H3 = ["Arm the program", "Spawn owners", "PR mechanics", "Verdict and merge", "Boot recipe"];
const PROGRAM_MARKERS = ["/schedule 1h", "status message"];
const HOW_TO_READ_MARKERS = [
	"One box is one unit of work",
	"names the evidence",
	"Check a box only when its evidence exists",
	"topologies/",
	RULE,
];
const PERF_ITEMS = ["Metric.", "Probe.", "Baseline.", "Rule."];
const BOX = /^\s*- \[[ x]\] (.*)$/;
const ROOT_KEYS = ["goal", "tasks", "threads"];
const GOAL_KEYS = ["title", "line"];
const THREAD_KEYS = ["id", "title", "goal", "tasks"];
const RESERVED_WORKERS = new Set(["coordinator", "all"]);
const PLUGIN_PATH = "~/.gemini/config/plugins/agy-pstack-next/";

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;
const isIdentChar = (ch) => ch !== undefined && /[A-Za-z0-9_]/.test(ch);

const checkExactKeys = (obj, expectedKeys, label, fail) => {
	for (const key of expectedKeys) {
		if (!Object.hasOwn(obj, key)) fail(1, `${label} missing required key "${key}"`);
	}
	for (const key of Object.keys(obj)) {
		if (!expectedKeys.includes(key)) fail(1, `${label} has unexpected key "${key}"`);
	}
};

const checkJsonPlan = (file, rawText) => {
	const problems = [];
	const fail = (line, message) => problems.push(`${file}:${line}: ${message}`);
	let data;
	try {
		data = JSON.parse(rawText);
	} catch (err) {
		console.error(`${file}:1: invalid JSON (${err.message})`);
		process.exit(1);
	}

	if (!isPlainObject(data)) {
		fail(1, "root must be a JSON object");
		return { summaryLines: ["0 tasks, 0 threads, 1 problems"], problems };
	}

	checkExactKeys(data, ROOT_KEYS, "root", fail);

	if (Object.hasOwn(data, "goal")) {
		if (!isPlainObject(data.goal)) {
			fail(1, "goal must be an object");
		} else {
			checkExactKeys(data.goal, GOAL_KEYS, "goal", fail);
			if (Object.hasOwn(data.goal, "title")) {
				if (!isNonEmptyString(data.goal.title)) {
					fail(1, "goal.title must be a non-empty string");
				} else {
					const words = wordCount(data.goal.title);
					if (words < 4 || words > 8) fail(1, `goal.title has ${words} words, expected 4 to 8`);
				}
			}
			if (Object.hasOwn(data.goal, "line")) {
				if (!isNonEmptyString(data.goal.line)) {
					fail(1, "goal.line must be a non-empty string");
				} else {
					const words = wordCount(data.goal.line);
					if (words < 1 || words > 12) fail(1, `goal.line has ${words} words, expected 1 to 12`);
				}
			}
		}
	}

	const validTasks = isPlainObject(data.tasks);
	if (Object.hasOwn(data, "tasks")) {
		if (!validTasks) {
			fail(1, "tasks must be an object");
		} else {
			const entries = Object.entries(data.tasks);
			if (entries.length === 0) fail(1, "tasks must have at least 1 entry");
			for (const [worker, desc] of entries) {
				if (worker === "" || /\s/.test(worker)) {
					fail(1, `tasks key ${JSON.stringify(worker)} must be a non-empty worker name without whitespace`);
				} else if (RESERVED_WORKERS.has(worker)) {
					fail(1, `tasks key "${worker}" is reserved`);
				}
				if (!isNonEmptyString(desc)) fail(1, `tasks.${worker} must be a non-empty string`);
			}
		}
	}

	const validThreads = Array.isArray(data.threads);
	const assignedWorkers = new Set();
	if (Object.hasOwn(data, "threads")) {
		if (!validThreads) {
			fail(1, "threads must be an array");
		} else {
			if (data.threads.length < 1 || data.threads.length > 6) {
				fail(1, `threads has ${data.threads.length} entries, expected 1 to 6`);
			}
			const seenIds = new Set();
			for (let i = 0; i < data.threads.length; i++) {
				const thread = data.threads[i];
				const label = `threads[${i}]`;
				if (!isPlainObject(thread)) {
					fail(1, `${label} must be an object`);
					continue;
				}
				checkExactKeys(thread, THREAD_KEYS, label, fail);
				if (Object.hasOwn(thread, "id")) {
					if (!isNonEmptyString(thread.id)) {
						fail(1, `${label}.id must be a non-empty string`);
					} else if (seenIds.has(thread.id)) {
						fail(1, `duplicate thread id "${thread.id}"`);
					} else {
						seenIds.add(thread.id);
					}
				}
				if (Object.hasOwn(thread, "title") && !isNonEmptyString(thread.title)) {
					fail(1, `${label}.title must be a non-empty string`);
				}
				if (Object.hasOwn(thread, "goal") && !isNonEmptyString(thread.goal)) {
					fail(1, `${label}.goal must be a non-empty string`);
				}
				if (Object.hasOwn(thread, "tasks")) {
					if (!Array.isArray(thread.tasks)) {
						fail(1, `${label}.tasks must be an array`);
					} else if (thread.tasks.length === 0) {
						fail(1, `${label}.tasks must have at least 1 worker`);
					} else {
						for (const worker of thread.tasks) {
							if (!isNonEmptyString(worker)) {
								fail(1, `${label}.tasks must contain non-empty worker strings`);
								continue;
							}
							if (validTasks && !Object.hasOwn(data.tasks, worker)) {
								fail(1, `${label}.tasks references unknown worker "${worker}"`);
							}
							if (assignedWorkers.has(worker)) {
								fail(1, `worker "${worker}" is assigned more than once in threads`);
							} else {
								assignedWorkers.add(worker);
							}
						}
					}
				}
			}
		}
	}

	if (validTasks && validThreads) {
		for (const worker of Object.keys(data.tasks)) {
			if (!assignedWorkers.has(worker)) {
				fail(1, `worker "${worker}" in tasks is not assigned to any thread`);
			}
		}
	}

	const taskCount = validTasks ? Object.keys(data.tasks).length : 0;
	const threadCount = validThreads ? data.threads.length : 0;
	return {
		summaryLines: [`${taskCount} tasks, ${threadCount} threads, ${problems.length} problems`],
		problems,
	};
};

const extractExactTitleRefs = (text, exactTitles, byTitle) => {
	let remainder = text;
	const refs = [];
	for (const title of exactTitles) {
		let from = 0;
		while (from <= remainder.length - title.length) {
			const at = remainder.indexOf(title, from);
			if (at === -1) break;
			const end = at + title.length;
			if (!isIdentChar(remainder[at - 1]) && !isIdentChar(remainder[end])) {
				refs.push(byTitle.get(title));
				remainder = remainder.slice(0, at) + " ".repeat(title.length) + remainder.slice(end);
			}
			from = at + title.length;
		}
	}
	return { remainder, refs };
};

const validatePrDependencies = (prEntries, fail) => {
	const byTitle = new Map();
	const byNumber = new Map();
	for (let i = 0; i < prEntries.length; i++) {
		const { pr } = prEntries[i];
		if (byTitle.has(pr.title)) {
			fail(pr.n, `duplicate PR section "${pr.title}"`);
		} else {
			byTitle.set(pr.title, i);
		}
		const numMatch = pr.title.match(/^PR\s+(\d+)\b/i);
		if (numMatch) {
			const num = Number(numMatch[1]);
			if (byNumber.has(num)) {
				if (prEntries[byNumber.get(num)].pr.title !== pr.title) {
					fail(pr.n, `duplicate PR number ${num}`);
				}
			} else {
				byNumber.set(num, i);
			}
		}
	}

	const exactTitles = [...byTitle.keys()].sort((a, b) => b.length - a.length);
	const edges = prEntries.map(() => []);

	for (let i = 0; i < prEntries.length; i++) {
		const { pr, depends } = prEntries[i];
		if (!depends || depends.rest === "") continue;
		const dependsText = [depends.rest, ...depends.lines.map((l) => l.text)].join("\n").trim();
		const { remainder, refs } = extractExactTitleRefs(dependsText, exactTitles, byTitle);
		let unknown = false;
		for (const match of remainder.matchAll(/\bPR\s+(\d+)\b/gi)) {
			const num = Number(match[1]);
			if (byNumber.has(num)) {
				refs.push(byNumber.get(num));
			} else {
				unknown = true;
				fail(depends.n, `${pr.title}: Depends on references unknown PR ${num}`);
			}
		}

		const hasNone = /\bNone\b/i.test(remainder);
		if (hasNone && (refs.length > 0 || unknown)) {
			fail(depends.n, `${pr.title}: Depends on cannot combine None with PR references`);
		} else if (!hasNone && refs.length === 0 && !unknown) {
			fail(depends.n, `${pr.title}: Depends on must be None. or reference known PRs`);
		}

		const seen = new Set();
		for (const target of refs) {
			if (seen.has(target)) continue;
			seen.add(target);
			if (target === i) fail(depends.n, `${pr.title}: Depends on cannot reference itself`);
			else edges[i].push(target);
		}
	}

	const state = new Uint8Array(prEntries.length);
	const stack = [];
	const reportedCycles = new Set();
	const visit = (node) => {
		state[node] = 1;
		stack.push(node);
		for (const next of edges[node]) {
			if (state[next] === 1) {
				const start = stack.indexOf(next);
				const key = [...stack.slice(start)].sort((a, b) => a - b).join(",");
				if (!reportedCycles.has(key)) {
					reportedCycles.add(key);
					const chain = [...stack.slice(start), next].map((idx) => prEntries[idx].pr.title);
					fail(prEntries[next].pr.n, `dependency cycle: ${chain.join(" -> ")}`);
				}
			} else if (state[next] === 0) {
				visit(next);
			}
		}
		stack.pop();
		state[node] = 2;
	};
	for (let i = 0; i < prEntries.length; i++) {
		if (state[i] === 0) visit(i);
	}
};

const openingFence = (text) => {
	const match = text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
	if (!match || (match[1][0] === "`" && match[2].includes("`"))) return null;
	return { char: match[1][0], length: match[1].length };
};

const closingFence = (text, opening) => {
	const match = text.match(/^ {0,3}(`+|~+)[ \t]*$/);
	return Boolean(
		match &&
		match[1][0] === opening.char &&
		match[1].length >= opening.length,
	);
};

const checkMarkdownPlan = (file, rawText) => {
	const raw = rawText.split(/\r?\n/);
	const problems = [];
	const fail = (line, message) => problems.push(`${file}:${line}: ${message}`);

	let start = 0;
	if (raw[0] === "---") start = raw.indexOf("---", 1) + 1;

	const lines = [];
	let fence = null;
	for (let i = start; i < raw.length; i++) {
		const text = raw[i];
		const n = i + 1;
		let code = Boolean(fence);
		if (fence && closingFence(text, fence)) {
			code = false;
			fence = null;
		} else if (!fence) {
			fence = openingFence(text);
			code = Boolean(fence);
		}
		lines.push({ n, text, code });
		if (code) continue;
		const prose = text
			.replace(/(?<!`)(`+)(?!`)(.*?)(?<!`)\1(?!`)/g, "`")
			.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
			.replace(/\]\([^)]*\)/g, "]");
		if (/[\u2013\u2014]/.test(prose)) fail(n, "long dash");
		if (/[\u2018\u2019\u201c\u201d]/.test(prose)) fail(n, "curly quote");
		if (/: \S/.test(prose)) fail(n, "mid-sentence colon");
	}

	const h2 = (l) => (!l.code && l.text.startsWith("## ") ? l.text.slice(3).trim() : null);
	const sections = [];
	for (const l of lines) {
		const title = h2(l);
		if (title !== null) sections.push({ title, n: l.n, body: [] });
		else if (sections.length) sections.at(-1).body.push(l);
	}
	const find = (title) => sections.find((s) => s.title === title);
	const bodyText = (s) => s.body.map((l) => l.text).join("\n");
	const boxes = (ls) => ls.filter((l) => !l.code && BOX.test(l.text)).map((l) => ({ n: l.n, text: l.text.match(BOX)[1] }));

	const h1 = lines.findIndex((l) => !l.code && l.text.startsWith("# "));
	if (h1 === -1) fail(1, "no H1 title");
	const howToRead = find("How to read this");
	if (!howToRead) fail(1, 'no "## How to read this" section');
	if (h1 !== -1 && howToRead) {
		const intro = lines.slice(h1 + 1).filter((l) => l.n < howToRead.n && l.text.trim() !== "");
		if (intro.length >= 10) fail(lines[h1].n, `intro is ${intro.length} lines, under ten required`);
		for (const marker of HOW_TO_READ_MARKERS) {
			if (!bodyText(howToRead).includes(marker)) fail(howToRead.n, `How to read this lacks "${marker}"`);
		}
	}

	const program = find("Program checklist");
	if (!program) fail(1, 'no "## Program checklist" section');
	else {
		const h3s = program.body.filter((l) => !l.code && l.text.startsWith("### ")).map((l) => l.text.slice(4).trim());
		let cursor = 0;
		for (const name of PROGRAM_H3) {
			const at = h3s.findIndex((t, i) => i >= cursor && t.startsWith(name));
			if (at === -1) fail(program.n, `Program checklist lacks "### ${name}" in order`);
			else cursor = at + 1;
		}
		const programBody = bodyText(program);
		if (!programBody.includes(PLUGIN_PATH)) {
			fail(program.n, `Program checklist lacks "${PLUGIN_PATH}"`);
		}
		for (const marker of PROGRAM_MARKERS) {
			if (!programBody.includes(marker)) fail(program.n, `Program checklist lacks "${marker}"`);
		}
	}

	const close = find("Close the program");
	if (!close) fail(1, 'no "## Close the program" section');
	const programIndex = sections.indexOf(program);
	const closeIndex = sections.indexOf(close);
	const prSections = programIndex === -1 || closeIndex === -1 ? [] : sections.slice(programIndex + 1, closeIndex);
	if (prSections.length === 0) fail(1, "no PR sections between Program checklist and Close the program");

	const report = [];
	const prEntries = [];
	for (const pr of prSections) {
		const heads = [];
		for (const l of pr.body) {
			if (l.code) continue;
			const m = l.text.match(/^\*\*([^*]+)\*\*(.*)$/);
			if (m && SUB_BLOCKS.includes(m[1])) heads.push({ name: m[1], n: l.n, rest: m[2].trim(), lines: [] });
			else if (heads.length) heads.at(-1).lines.push(l);
		}
		const names = heads.map((h) => h.name);
		if (names.join("|") !== SUB_BLOCKS.join("|")) {
			fail(pr.n, `${pr.title}: sub-blocks are [${names.join(", ")}], expected [${SUB_BLOCKS.join(", ")}]`);
		}
		const block = (name) => heads.find((h) => h.name === name);
		const counts = {};
		for (const h of heads) counts[h.name] = boxes(h.lines).length;

		const depends = block("Depends on.");
		if (depends && depends.rest === "") fail(depends.n, `${pr.title}: Depends on names nothing`);
		prEntries.push({ pr, depends });
		for (const name of ["Files.", "Build.", "You see.", "Verify, unit.", "Merge."]) {
			const b = block(name);
			if (b && boxes(b.lines).length === 0) fail(b.n, `${pr.title}: ${name} has no box`);
		}
		for (const name of ["Verify, unit.", "Verify, live.", "Verify, perf."]) {
			const b = block(name);
			if (b && !b.rest.startsWith(RULE)) fail(b.n, `${pr.title}: ${name} does not open with the rule`);
		}

		const live = block("Verify, live.");
		if (live) {
			if (!LANES.test(live.rest)) fail(live.n, `${pr.title}: Verify, live lacks "Ten lanes on \`<swarm workers model>\` at the PR head" with the model filled in`);
			const lanes = boxes(live.lines).map((b) => ({ ...b, m: b.text.match(/^Lane (\d+)\. /) }));
			const numbers = lanes.filter((b) => b.m).map((b) => Number(b.m[1])).sort((a, b) => a - b);
			if (numbers.join(",") !== "1,2,3,4,5,6,7,8,9,10") fail(live.n, `${pr.title}: lanes are [${numbers.join(",")}], expected 1 to 10`);
			for (const lane of lanes) {
				if (!lane.m) fail(lane.n, `${pr.title}: live box is not a lane`);
				else if (!/Save `[^`]+`/.test(lane.text)) fail(lane.n, `${pr.title}: lane ${lane.m[1]} names no screenshot`);
				else if (!lane.text.includes("Pass when")) fail(lane.n, `${pr.title}: lane ${lane.m[1]} has no pass predicate`);
			}
		}

		const perf = block("Verify, perf.");
		if (perf) {
			const items = boxes(perf.lines).map((b) => b.text.split(" ")[0]);
			if (items.join("|") !== PERF_ITEMS.join("|")) fail(perf.n, `${pr.title}: perf boxes are [${items.join(", ")}], expected [${PERF_ITEMS.join(", ")}]`);
		}

		const gate = block("Review gate.");
		if (gate) {
			const gateBoxes = boxes(gate.lines);
			if (gate.rest.startsWith("None.")) {
				if (gateBoxes.length) fail(gate.n, `${pr.title}: Review gate says None but has boxes`);
			} else {
				const text = gate.lines.map((l) => l.text).join("\n");
				if (gateBoxes.length === 0) fail(gate.n, `${pr.title}: Review gate has no box`);
				for (const word of ["screenshot", "video", "operator"]) {
					if (!text.includes(word)) fail(gate.n, `${pr.title}: Review gate lacks "${word}"`);
				}
			}
		}

		const total = boxes(pr.body).length;
		const cells = SUB_BLOCKS.filter((s) => s !== "Depends on.").map((s) => `${s.replace(/[ ,.]+/g, "-").replace(/-$/, "").toLowerCase()}=${counts[s] ?? 0}`);
		report.push(`${pr.title}  boxes=${total}  ${cells.join(" ")}`);
	}

	validatePrDependencies(prEntries, fail);

	if (closeIndex !== -1) {
		const tail = sections.slice(closeIndex + 1);
		for (const s of tail) {
			if (!s.title.startsWith("Appendix")) fail(s.n, `"## ${s.title}" after Close the program is not an appendix`);
		}
		if (!tail.some((s) => s.title.includes("Prototype evidence"))) fail(close.n, 'no "## Appendix ... Prototype evidence" section');
	}

	return {
		summaryLines: [...report, `${prSections.length} PR sections, ${problems.length} problems`],
		problems,
	};
};

const file = process.argv[2];
if (!file || process.argv.length > 3) {
	console.error("Usage: node check-plan.mjs <plan.json|plan.md>");
	process.exit(2);
}

let rawText;
try {
	rawText = fs.readFileSync(file, "utf8");
} catch (err) {
	console.error(`${file}:1: cannot read file (${err.code || err.message})`);
	process.exit(1);
}

const lowerPath = file.toLowerCase();
const isJson = lowerPath.endsWith(".json") || (!lowerPath.endsWith(".md") && /^[\[{]/.test(rawText.trimStart()));
const { summaryLines, problems } = isJson ? checkJsonPlan(file, rawText) : checkMarkdownPlan(file, rawText);

for (const line of summaryLines) console.log(line);
for (const p of problems) console.error(p);
process.exit(problems.length ? 1 : 0);
