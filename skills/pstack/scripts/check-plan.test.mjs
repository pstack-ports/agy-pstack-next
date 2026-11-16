import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const checker = join(scriptDir, "check-plan.mjs");
const decisionLog = join(scriptDir, "decision-log.sh");
const rule =
	"Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.";

const makePrSection = (title, dependsOn = "None.") => `## ${title}
**Depends on.** ${dependsOn}
**Files.**
- [ ] Do the thing.
**Build.**
- [ ] Do the thing.
**You see.**
- [ ] Do the thing.
**Verify, unit.** ${rule}
- [ ] Check the thing.
**Verify, live.** ${rule} Ten lanes on \`example-model\` at the PR head
${Array.from({ length: 10 }, (_, i) => `- [ ] Lane ${i + 1}. Save \`lane-${i + 1}.png\`. Pass when evidence exists.`).join("\n")}
**Verify, perf.** ${rule}
- [ ] Metric. Recorded.
- [ ] Probe. Recorded.
- [ ] Baseline. Recorded.
- [ ] Rule. Recorded.
**Review gate.** None.
**Merge.**
- [ ] Merge when approved.`;

const buildValidPlan = (prSections = [makePrSection("PR 1")]) => `# Demo

## How to read this
One box is one unit of work and names the evidence. Check a box only when its evidence exists. See topologies/.
${rule}

## Program checklist
### Arm the program
### Spawn owners
### PR mechanics
### Verdict and merge
### Boot recipe
\`~/.gemini/config/plugins/agy-pstack-next/\` /schedule 1h status message

${prSections.join("\n\n")}

## Close the program
Close.

## Appendix Prototype evidence
Recorded.
`;

const validPlan = buildValidPlan();

const runChecker = (filename, content, expectedExit) => {
	const directory = mkdtempSync(join(tmpdir(), "check-plan-test-"));
	const file = join(directory, filename);
	writeFileSync(file, content);
	try {
		const result = spawnSync("node", [checker, file], { encoding: "utf8" });
		assert.equal(result.status, expectedExit, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
		return result;
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
};

const runPlan = (example, expectedExit) => runChecker("plan.md", validPlan + example, expectedExit);

const runJson = (payload, expectedExit, filename = "plan.json") =>
	runChecker(filename, typeof payload === "string" ? payload : JSON.stringify(payload), expectedExit);

const baseJson = () => ({
	goal: { title: "Fix Hub split pane layouts", line: "Audit, fix, then verify in both themes." },
	tasks: { "impl-1": "Fix split card" },
	threads: [{ id: "t-1", title: "Split pane cards", goal: "Panes share one card.", tasks: ["impl-1"] }],
});

test("prints usage and handles missing or unreadable files without stack traces", () => {
	const noArgs = spawnSync("node", [checker], { encoding: "utf8" });
	assert.equal(noArgs.status, 2);
	assert.ok(noArgs.stderr.includes("Usage: node check-plan.mjs <plan.json|plan.md>"));

	const directory = mkdtempSync(join(tmpdir(), "check-plan-missing-"));
	try {
		const missing = spawnSync("node", [checker, join(directory, "missing.json")], { encoding: "utf8" });
		assert.equal(missing.status, 1);
		assert.ok(missing.stderr.includes("cannot read file"));
		assert.ok(!missing.stderr.includes("node:fs"));

		const dirArg = spawnSync("node", [checker, directory], { encoding: "utf8" });
		assert.equal(dirArg.status, 1);
		assert.ok(dirArg.stderr.includes("cannot read file"));
		assert.ok(!dirArg.stderr.includes("node:fs"));
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("accepts valid plan.json examples from pstack and swarm_pane", () => {
	const pstackExample = {
		goal: { title: "Fix Hub split pane layouts", line: "Audit, fix, then verify in both themes." },
		tasks: { "impl-1": "Fix split card" },
		threads: [{ id: "t-1", title: "Split pane cards", goal: "Panes share one card.", tasks: ["impl-1"] }],
	};
	const res1 = runJson(pstackExample, 0);
	assert.equal(res1.stdout.trim(), "1 tasks, 1 threads, 0 problems");

	const swarmPaneExample = {
		goal: { title: "Fix Hub split pane layouts", line: "Audit, fix, then verify in both themes." },
		tasks: { auditor: "Audit split panes across states", fixer: "Put split panes in one card" },
		threads: [
			{
				id: "t-split",
				title: "Split pane cards",
				goal: "Panes share one card with clean headers.",
				tasks: ["auditor", "fixer"],
			},
		],
	};
	const res2 = runJson(swarmPaneExample, 0);
	assert.equal(res2.stdout.trim(), "2 tasks, 1 threads, 0 problems");

	const boundaryJson = {
		goal: {
			title: "Four words exactly ok",
			line: "One two three four five six seven eight nine ten eleven twelve.",
		},
		tasks: { w1: "t1", w2: "t2", w3: "t3", w4: "t4", w5: "t5", w6: "t6" },
		threads: [1, 2, 3, 4, 5, 6].map((n) => ({
			id: `t-${n}`,
			title: `Thread ${n}`,
			goal: `Deliver slice ${n}.`,
			tasks: [`w${n}`],
		})),
	};
	const res3 = runJson(boundaryJson, 0, "PLAN.JSON");
	assert.equal(res3.stdout.trim(), "6 tasks, 6 threads, 0 problems");

	const inferredJson = runJson(pstackExample, 0, "plan.txt");
	assert.equal(inferredJson.stdout.trim(), "1 tasks, 1 threads, 0 problems");
});

test("rejects invalid JSON, non-object root, and missing or extra keys", () => {
	const malformed = runJson("{bad json", 1);
	assert.ok(malformed.stderr.includes(":1: invalid JSON"));

	for (const nonObj of ["[]", "null", '"hello"', "42"]) {
		const res = runJson(nonObj, 1);
		assert.ok(res.stderr.includes("root must be a JSON object"));
	}
	assert.ok(runJson("  []", 1, "plan.txt").stderr.includes("root must be a JSON object"));

	const missingRoot = runJson({ goal: baseJson().goal, tasks: baseJson().tasks }, 1);
	assert.ok(missingRoot.stderr.includes('root missing required key "threads"'));

	for (const extraKey of ["status", "blockers", "asks"]) {
		const payload = { ...baseJson(), [extraKey]: "nope" };
		const res = runJson(payload, 1);
		assert.ok(res.stderr.includes(`root has unexpected key "${extraKey}"`));
	}

	const badGoalKeys = baseJson();
	badGoalKeys.goal = { title: "Four word goal title", extra: "bad" };
	const goalRes = runJson(badGoalKeys, 1);
	assert.ok(goalRes.stderr.includes('goal missing required key "line"'));
	assert.ok(goalRes.stderr.includes('goal has unexpected key "extra"'));

	const badThreadKeys = baseJson();
	badThreadKeys.threads[0] = { id: "t-1", title: "Split", goal: "Done", tasks: ["impl-1"], status: "active" };
	const threadRes = runJson(badThreadKeys, 1);
	assert.ok(threadRes.stderr.includes('threads[0] has unexpected key "status"'));
});

test("validates goal word counts in plan.json", () => {
	const shortTitle = baseJson();
	shortTitle.goal.title = "Too short title";
	assert.ok(runJson(shortTitle, 1).stderr.includes("goal.title has 3 words, expected 4 to 8"));

	const longTitle = baseJson();
	longTitle.goal.title = "One two three four five six seven eight nine";
	assert.ok(runJson(longTitle, 1).stderr.includes("goal.title has 9 words, expected 4 to 8"));

	const emptyLine = baseJson();
	emptyLine.goal.line = "   ";
	assert.ok(runJson(emptyLine, 1).stderr.includes("goal.line must be a non-empty string"));

	const longLine = baseJson();
	longLine.goal.line = "One two three four five six seven eight nine ten eleven twelve thirteen";
	assert.ok(runJson(longLine, 1).stderr.includes("goal.line has 13 words, expected 1 to 12"));
});

test("validates tasks entries and worker names in plan.json", () => {
	const emptyTasks = baseJson();
	emptyTasks.tasks = {};
	emptyTasks.threads[0].tasks = ["impl-1"];
	assert.ok(runJson(emptyTasks, 1).stderr.includes("tasks must have at least 1 entry"));

	for (const reserved of ["coordinator", "all"]) {
		const payload = baseJson();
		payload.tasks = { [reserved]: "Do work" };
		payload.threads[0].tasks = [reserved];
		assert.ok(runJson(payload, 1).stderr.includes(`tasks key "${reserved}" is reserved`));
	}

	const whitespaceName = baseJson();
	whitespaceName.tasks = { "impl 1": "Do work" };
	whitespaceName.threads[0].tasks = ["impl 1"];
	assert.ok(runJson(whitespaceName, 1).stderr.includes("without whitespace"));

	const emptyDesc = baseJson();
	emptyDesc.tasks["impl-1"] = "  ";
	assert.ok(runJson(emptyDesc, 1).stderr.includes("tasks.impl-1 must be a non-empty string"));
});

test("validates threads bounds, uniqueness, and task cross-checks in plan.json", () => {
	const zeroThreads = baseJson();
	zeroThreads.threads = [];
	assert.ok(runJson(zeroThreads, 1).stderr.includes("threads has 0 entries, expected 1 to 6"));

	const sevenThreads = baseJson();
	sevenThreads.tasks = { w1: "a", w2: "b", w3: "c", w4: "d", w5: "e", w6: "f", w7: "g" };
	sevenThreads.threads = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
		id: `t-${n}`,
		title: `T${n}`,
		goal: `G${n}`,
		tasks: [`w${n}`],
	}));
	assert.ok(runJson(sevenThreads, 1).stderr.includes("threads has 7 entries, expected 1 to 6"));

	const dupId = baseJson();
	dupId.tasks = { w1: "a", w2: "b" };
	dupId.threads = [
		{ id: "t-1", title: "T1", goal: "G1", tasks: ["w1"] },
		{ id: "t-1", title: "T2", goal: "G2", tasks: ["w2"] },
	];
	assert.ok(runJson(dupId, 1).stderr.includes('duplicate thread id "t-1"'));

	const unknownWorker = baseJson();
	unknownWorker.threads[0].tasks = ["impl-1", "ghost"];
	assert.ok(runJson(unknownWorker, 1).stderr.includes('unknown worker "ghost"'));

	const unassigned = baseJson();
	unassigned.tasks["impl-2"] = "Extra work";
	assert.ok(runJson(unassigned, 1).stderr.includes('worker "impl-2" in tasks is not assigned to any thread'));

	const duplicateAcross = baseJson();
	duplicateAcross.tasks = { w1: "a", w2: "b" };
	duplicateAcross.threads = [
		{ id: "t-1", title: "T1", goal: "G1", tasks: ["w1", "w2"] },
		{ id: "t-2", title: "T2", goal: "G2", tasks: ["w2"] },
	];
	assert.ok(runJson(duplicateAcross, 1).stderr.includes('worker "w2" is assigned more than once'));
});

test("accepts ordinary, indented, and longer closing fences", () => {
	for (const indent of ["", " ", "  ", "   "])
		runPlan(`${indent}\`\`\`markdown\n## Example only\n${indent}\`\`\`\n`, 0);
	runPlan("```markdown\n## Example only\n````\n", 0);
});

test("accepts nested backticks and tilde info strings", () => {
	runPlan("````markdown\n```markdown\n## Example only\n```\n````\n", 0);
	runPlan("~~~markdown `info`\n## Example only\n ~~~\n", 0);
});

test("keeps mismatched, shorter, and suffixed closers inside the fence", () => {
	runPlan("````markdown\n~~~\n## Example only\n````\n", 0);
	runPlan("````markdown\n```\n## Example only\n````\n", 0);
	runPlan("````markdown\n``` info\n## Example only\n````\n", 0);
});

test("rejects headings and prose outside a proper close", () => {
	for (const suffix of ["  ", "\t"]) {
		const heading = runPlan(`\`\`\`markdown\n## Example only\n\`\`\`${suffix}\n## Example only\n`, 1);
		assert.ok(heading.stderr.includes('"## Example only" after Close the program is not an appendix'));
	}

	const prose = runPlan("```markdown\nThis prose has a mid-sentence colon: inside code\n```\nThis prose has a mid-sentence colon: bad.\n", 1);
	assert.ok(prose.stderr.includes("mid-sentence colon"));
});

test("rejects backtick info strings containing a backtick", () => {
	const result = runPlan("```markdown `invalid`\n## Example only\n```\n", 1);
	assert.ok(result.stderr.includes('"## Example only" after Close the program is not an appendix'));
});

test("ignores prose punctuation inside matching multi-backtick code spans", () => {
	for (const count of [2, 3, 4]) {
		const delimiter = "`".repeat(count);
		runPlan(`Use ${delimiter}echo \`x\`: “quoted” — example${delimiter}.\n`, 0);
	}
});

test("checks prose following a multi-backtick span and unmatched delimiters", () => {
	const outside = runPlan("Use ``echo `x`: y``. Bad: prose.\n", 1);
	assert.ok(outside.stderr.includes("mid-sentence colon"));
	const unmatched = runPlan("Use ``unclosed: bad` here.\n", 1);
	assert.ok(unmatched.stderr.includes("mid-sentence colon"));
});

test("enforces Pstack v2 markers and rejects legacy v1 playbooks and plugins/pstack paths", () => {
	const subpath = validPlan.replace(
		"`~/.gemini/config/plugins/agy-pstack-next/`",
		"`~/.gemini/config/plugins/agy-pstack-next/skills/pstack/SKILL.md`",
	);
	runChecker("plan.md", subpath, 0);

	const legacyPlaybooks = validPlan.replace("topologies/", "playbooks/");
	const resPlaybooks = runChecker("plan.md", legacyPlaybooks, 1);
	assert.ok(resPlaybooks.stderr.includes('How to read this lacks "topologies/"'));

	const legacyPlugin = validPlan.replace(
		"~/.gemini/config/plugins/agy-pstack-next/",
		"~/.gemini/config/plugins/pstack/",
	);
	const resPlugin = runChecker("plan.md", legacyPlugin, 1);
	assert.ok(resPlugin.stderr.includes('Program checklist lacks "~/.gemini/config/plugins/agy-pstack-next/"'));
});

test("validates multi-PR Depends on chains, exact titles, and dependency errors", () => {
	const validDag = buildValidPlan([
		makePrSection("PR 1. Core schema", "None."),
		makePrSection("PR 2. CLI parser", "PR 1."),
		makePrSection("PR 3. Test suite", "PR 1. Core schema, PR 2."),
	]);
	const dagRes = runChecker("plan.md", validDag, 0);
	assert.ok(dagRes.stdout.includes("3 PR sections, 0 problems"));

	const mixedNone = buildValidPlan([
		makePrSection("PR 1", "None."),
		makePrSection("PR 2", "None. PR 1."),
	]);
	assert.ok(runChecker("plan.md", mixedNone, 1).stderr.includes("cannot combine None with PR references"));

	const unknownPr = buildValidPlan([
		makePrSection("PR 1", "None."),
		makePrSection("PR 2", "PR 99."),
	]);
	assert.ok(runChecker("plan.md", unknownPr, 1).stderr.includes("unknown PR 99"));

	const selfDep = buildValidPlan([makePrSection("PR 1", "PR 1.")]);
	assert.ok(runChecker("plan.md", selfDep, 1).stderr.includes("cannot reference itself"));

	const cycle2 = buildValidPlan([
		makePrSection("PR 1", "PR 2."),
		makePrSection("PR 2", "PR 1."),
	]);
	assert.ok(runChecker("plan.md", cycle2, 1).stderr.includes("dependency cycle: PR 1 -> PR 2 -> PR 1"));

	const cycle3 = buildValidPlan([
		makePrSection("PR 1", "PR 3."),
		makePrSection("PR 2", "PR 1."),
		makePrSection("PR 3", "PR 2."),
	]);
	assert.ok(runChecker("plan.md", cycle3, 1).stderr.includes("dependency cycle: PR 1 -> PR 3 -> PR 2 -> PR 1"));
});

test("decision-log.sh sanitizes tabs, newlines, CRs, and spreadsheet formula prefixes", () => {
	const directory = mkdtempSync(join(tmpdir(), "decision-log-test-"));
	const logfile = join(directory, "nested", "decisions.tsv");
	try {
		const badArgs = spawnSync(decisionLog, [logfile, "phase"], { encoding: "utf8" });
		assert.equal(badArgs.status, 1);

		const run1 = spawnSync(
			decisionLog,
			[logfile, "=phase\t1", "+decision\nline", "-why\rcr", "@evidence", "ok"],
			{ encoding: "utf8" },
		);
		assert.equal(run1.status, 0);

		const run2 = spawnSync(
			decisionLog,
			[logfile, "normal", "safe", "reason", "link", "pass"],
			{ encoding: "utf8" },
		);
		assert.equal(run2.status, 0);

		const rows = readFileSync(logfile, "utf8").trimEnd().split("\n");
		assert.equal(rows.length, 3);
		assert.equal(rows[0], "ts\tphase\tdecision\twhy\tevidence\tresult");

		const cols1 = rows[1].split("\t");
		assert.equal(cols1.length, 6);
		assert.match(cols1[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
		assert.deepEqual(cols1.slice(1), [
			"'=phase 1",
			"'+decision line",
			"'-why cr",
			"'@evidence",
			"ok",
		]);

		const cols2 = rows[2].split("\t");
		assert.equal(cols2.length, 6);
		assert.deepEqual(cols2.slice(1), ["normal", "safe", "reason", "link", "pass"]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
