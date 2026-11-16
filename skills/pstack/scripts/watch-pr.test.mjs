import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CliUsageError,
  GhGitHubReader,
  WatcherQueryError,
  applyQueueSnapshot,
  assessGitHubMerge,
  buildReviewThreads,
  classifyPr,
  createQueueState,
  evaluateQueue,
  main,
  mapRollupNode,
  orderStack,
  parseArgs,
  parseFastCheck,
  parsePrNumber,
  parsePullRequest,
  parseReviewThreadPage,
  planQueue,
  queryBackoffSeconds,
  readSnapshot,
  renderJson,
  renderPretty,
  resolveChecks,
  resolveContext,
  resolveReviewThreads,
  runQueued,
  runSimple,
  selectTierMajorStackDecision,
} from "./watch-pr";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const watchPrPath = join(scriptDir, "watch-pr");
const watchPrUrl = pathToFileURL(watchPrPath).href;

const silentIo = { stdout: () => {}, stderr: () => {} };

function toRawThread(thread) {
  return { id: thread.id, firstComment: thread.firstComment, resolved: false };
}

function passingCheck(name = "ci") {
  return {
    kind: "passed",
    name,
    reportedState: "SUCCESS",
    description: "",
    link: "",
    workflow: "",
  };
}

function pendingCheck(name = "ci") {
  return {
    kind: "pending",
    name,
    reportedState: "PENDING",
    description: "",
    link: "",
    workflow: "",
  };
}

function failedCheck(name = "ci") {
  return {
    kind: "failed",
    name,
    reportedState: "FAILURE",
    description: "",
    link: "",
    workflow: "",
  };
}

function fakeReader(options = {}) {
  const calls = [];
  const context = options.current ?? {
    owner: "owner",
    repo: "repo",
    number: parsePrNumber(1),
  };
  const defaults = {
    context,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    headRefOid: "head",
    headRefName: "feature",
    baseRefName: "main",
    state: "OPEN",
    mergedAt: null,
    isDraft: false,
  };
  let page = 0;
  let threadPage = 0;
  return {
    calls,
    async originRepo() {
      calls.push("originRepo");
      return options.origin === undefined
        ? { owner: "owner", repo: "repo" }
        : options.origin;
    },
    async currentPr(pr) {
      calls.push("currentPr");
      return { ...context, number: pr ?? context.number };
    },
    async pullRequest(requested) {
      calls.push("pullRequest");
      return { ...defaults, ...options.facts, context: requested };
    },
    async openPullRequests() {
      calls.push("openPullRequests");
      return options.openPullRequests ?? [];
    },
    async checksFastPath() {
      calls.push("checksFastPath");
      return options.fastPath ?? { kind: "checks", checks: [passingCheck()] };
    },
    async checkRollupPage(_requested, after) {
      calls.push(`checkRollupPage:${after ?? "null"}`);
      return options.rollupPages?.[page++] ?? { checks: [], endCursor: null };
    },
    async reviewThreadPage(_requested, after) {
      calls.push(`reviewThreadPage:${after ?? "null"}`);
      return (
        options.threadPages?.[threadPage++] ?? {
          threads: (options.threads ?? []).map(toRawThread),
          endCursor: null,
        }
      );
    },
    async commitRollups() {
      calls.push("commitRollups");
      return options.commitRollups ?? [{ oid: "head", state: "SUCCESS" }];
    },
  };
}

function testRuntime(reader) {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    runtime: {
      reader,
      clock: {
        now: () => 0,
        observedAt: () => "2026-07-26T00:00:00.000Z",
        async sleep() {
          throw new Error("test unexpectedly slept");
        },
      },
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    },
  };
}

describe("parseArgs", () => {
  it("uses the specified defaults", () => {
    assert.deepEqual(parseArgs([], silentIo), {
      owner: null,
      repo: null,
      pr: null,
      mode: "single",
      stackPrs: [],
      statusOnly: false,
      pretty: false,
      polling: {
        interval: 60,
        sweepInterval: 300,
        timeout: 0,
        maxQueryErrors: 5,
        allowDraft: false,
      },
    });
  });

  it("parses a frozen queued stack bottom-to-top", () => {
    const parsed = parseArgs(
      [
        "--queued-stack",
        "--stack-prs",
        "#10, 11,#12",
        "--interval",
        "2.5",
        "--sweep-interval",
        "30",
        "--timeout",
        "0",
        "--max-query-errors",
        "3",
        "--allow-draft",
        "--pretty",
      ],
      silentIo
    );
    assert.equal(parsed.mode, "queued-stack");
    assert.deepEqual(parsed.stackPrs.map(Number), [10, 11, 12]);
    assert.deepEqual(parsed.polling, {
      interval: 2.5,
      sweepInterval: 30,
      timeout: 0,
      maxQueryErrors: 3,
      allowDraft: true,
    });
    assert.equal(parsed.pretty, true);
  });

  it("rejects every invalid mode and numeric shape as usage", async () => {
    const invalid = [
      ["--unknown"],
      ["--interval", "0"],
      ["--sweep-interval", "-1"],
      ["--timeout", "-1"],
      ["--max-query-errors", "1.5"],
      ["--stack", "--queued-stack"],
      ["--stack-prs", "1,2"],
      ["--queued-stack", "--stack-prs", "1,1"],
    ];
    for (const argv of invalid) {
      const harness = testRuntime(fakeReader());
      assert.equal(await main(argv, harness.runtime), 64);
      assert.deepEqual(harness.stdout, []);
      assert.ok(harness.stderr.join("").includes("error:"));
    }
  });

  it("rejects boolean flags with =false arguments as CliUsageError (exit 64)", async () => {
    const negated = [
      "--stack=false",
      "--pretty=false",
      "--status-only=false",
      "--allow-draft=false",
      "--queued-stack=false",
    ];
    for (const flag of negated) {
      assert.throws(
        () => parseArgs([flag], silentIo),
        (err) => err instanceof CliUsageError && err.exitCode === 64
      );
      const harness = testRuntime(fakeReader());
      assert.equal(await main([flag], harness.runtime), 64);
      assert.deepEqual(harness.stdout, []);
      assert.ok(harness.stderr.join("").includes("error:"));
    }
  });
});

describe("rendering", () => {
  const context = {
    owner: "owner",
    repo: "repo",
    number: parsePrNumber(1),
  };
  const status = {
    schemaVersion: 1,
    sequence: 1,
    observedAt: "2026-07-26T00:00:00.000Z",
    mode: "single",
    kind: "STATUS",
    terminal: true,
    exitCode: 0,
    reason: "status-only",
    rows: [
      {
        kind: "merged",
        context,
        facts: {
          context,
          mergeable: "MERGEABLE",
          mergeStateStatus: "CLEAN",
          reviewDecision: "APPROVED",
          headRefOid: "head",
          headRefName: "feature",
          baseRefName: "main",
          state: "MERGED",
          mergedAt: "now",
          isDraft: false,
        },
      },
    ],
  };

  it("emits compact valid JSON by default", () => {
    const rendered = renderJson(status);
    assert.equal(rendered.endsWith("\n"), true);
    assert.deepEqual(JSON.parse(rendered), status);
  });

  it("renders the Markdown table from the same verdict only", () => {
    const rendered = renderPretty(status);
    assert.ok(rendered.includes("| PR | CI | Review | Merge |"));
    assert.ok(
      rendered.includes(
        "| [#1](https://github.com/owner/repo/pull/1) | - | - | merged |"
      )
    );
  });
});

describe("main", () => {
  it("returns EX_USAGE 64 and writes usage errors only to stderr", async () => {
    const harness = testRuntime(fakeReader());
    assert.equal(await main(["--interval", "0"], harness.runtime), 64);
    assert.deepEqual(harness.stdout, []);
    assert.ok(
      harness.stderr
        .join("")
        .includes("option '--interval' argument '0' is invalid")
    );
  });

  it("bypasses the queue machine for queued-stack status-only", async () => {
    const reader = fakeReader();
    const harness = testRuntime(reader);
    const code = await main(
      [
        "--owner",
        "owner",
        "--repo",
        "repo",
        "--queued-stack",
        "--stack-prs",
        "1",
        "--status-only",
      ],
      harness.runtime
    );
    assert.equal(code, 0);
    assert.equal(harness.stdout.length, 1);
    const verdict = JSON.parse(harness.stdout[0]);
    assert.equal(verdict.kind, "STATUS");
    assert.equal(verdict.terminal, true);
    assert.equal(verdict.exitCode, 0);
    assert.equal(verdict.mode, "queued-stack");
    assert.ok(!harness.stdout[0].includes('"kind":"QUEUE"'));
  });

  it("returns exit 4 for a hidden GitHub-side CI refusal", async () => {
    const reader = fakeReader({
      facts: { mergeStateStatus: "BLOCKED" },
      fastPath: { kind: "checks", checks: [passingCheck()] },
      commitRollups: [{ oid: "head", state: "FAILURE" }],
    });
    const harness = testRuntime(reader);
    const code = await main(
      ["--owner", "owner", "--repo", "repo", "--pr", "1"],
      harness.runtime
    );
    assert.equal(code, 4);
    assert.equal(harness.stdout.length, 1);
    const verdict = JSON.parse(harness.stdout[0]);
    assert.equal(verdict.kind, "BLOCKER");
    assert.equal(verdict.exitCode, 4);
    assert.equal(verdict.blocker.kind, "failing-checks");
    assert.equal(verdict.blocker.ci.kind, "ci-github-rejected");
  });

  it("shows help without touching the reader", async () => {
    const reader = fakeReader();
    const harness = testRuntime(reader);
    assert.equal(await main(["--help"], harness.runtime), 0);
    assert.ok(harness.stdout.join("").includes("JSON (NDJSON while polling)"));
    assert.deepEqual(reader.calls, []);
  });

  it("does not throw ENOENT when imported via stdin (node --input-type=module -)", () => {
    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "-"],
      {
        input: `import { parseArgs } from ${JSON.stringify(watchPrUrl)}; console.log(typeof parseArgs);`,
        encoding: "utf8",
        timeout: 2000,
      }
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0);
    assert.equal(child.stdout.trim(), "function");
  });
});

const ghContext = {
  owner: "owner",
  repo: "repo",
  number: parsePrNumber(42),
};

describe("checks fallback chain", () => {
  it("uses a non-empty fast-path result without a rollup query", async () => {
    const reader = fakeReader({
      fastPath: { kind: "checks", checks: [passingCheck("fast")] },
    });
    const read = await resolveChecks(reader, ghContext);
    assert.equal(read.source, "gh-pr-checks");
    assert.deepEqual(
      read.checks.map((check) => check.name),
      ["fast"]
    );
    assert.deepEqual(reader.calls, ["checksFastPath"]);
  });

  it("paginates GraphQL when the fast path is unusable", async () => {
    const reader = fakeReader({
      fastPath: { kind: "unusable", exitCode: 8, stderr: "" },
      rollupPages: [
        { checks: [passingCheck("first")], endCursor: "next" },
        { checks: [failedCheck("second")], endCursor: null },
      ],
    });
    const read = await resolveChecks(reader, ghContext);
    assert.equal(read.source, "graphql-rollup");
    assert.deepEqual(
      read.checks.map((check) => check.name),
      ["first", "second"]
    );
    assert.deepEqual(reader.calls, [
      "checksFastPath",
      "checkRollupPage:null",
      "checkRollupPage:next",
    ]);
  });

  it("falls back when valid fast-path JSON represented an empty list", async () => {
    const reader = fakeReader({
      fastPath: { kind: "checks", checks: [] },
      rollupPages: [{ checks: [pendingCheck("fallback")], endCursor: null }],
    });
    assert.equal((await resolveChecks(reader, ghContext)).checks[0].name, "fallback");
    assert.deepEqual(reader.calls, ["checksFastPath", "checkRollupPage:null"]);
  });

  it("fails closed when both paths are empty", async () => {
    const reader = fakeReader({
      fastPath: {
        kind: "unusable",
        exitCode: 8,
        stderr: "credential cannot read checks",
      },
    });
    await assert.rejects(
      () => resolveChecks(reader, ghContext),
      (error) =>
        error instanceof WatcherQueryError &&
        error.failure.kind === "checks-unavailable"
    );
    assert.deepEqual(reader.calls, ["checksFastPath", "checkRollupPage:null"]);
  });
});

describe("rollup node mapping", () => {
  it("maps terminal and non-terminal CheckRun states fail closed", () => {
    const cases = [
      ["IN_PROGRESS", null, "pending", "PENDING"],
      ["COMPLETED", "SUCCESS", "passed", "SUCCESS"],
      ["COMPLETED", "NEUTRAL", "skipped", "NEUTRAL"],
      ["COMPLETED", "SKIPPED", "skipped", "SKIPPED"],
      ["COMPLETED", "ACTION_REQUIRED", "failed", "ACTION_REQUIRED"],
      ["COMPLETED", "TIMED_OUT", "failed", "FAILURE"],
      ["COMPLETED", "FUTURE_VALUE", "failed", "FAILURE"],
    ];
    for (const [status, conclusion, kind, reportedState] of cases) {
      const mapped = mapRollupNode({
        __typename: "CheckRun",
        name: "ci",
        status,
        conclusion,
      });
      assert.equal(mapped.kind, kind);
      assert.equal(mapped.reportedState, reportedState);
    }
  });

  it("classifies an in-progress Code Review Gate from the rollup as the gate", () => {
    assert.equal(
      mapRollupNode({
        __typename: "CheckRun",
        name: "Code Review Gate",
        status: "IN_PROGRESS",
        conclusion: null,
      }).kind,
      "code-review-gate"
    );
    assert.equal(
      mapRollupNode({
        __typename: "StatusContext",
        context: "Code Review Gate",
        state: "PENDING",
      }).kind,
      "code-review-gate"
    );
  });

  it("classifies a Code Review Gate waiting on an owner approval as the gate", () => {
    const mapped = mapRollupNode({
      __typename: "CheckRun",
      name: "Code Review Gate",
      status: "COMPLETED",
      conclusion: "ACTION_REQUIRED",
      description: "1 of 2 policies",
    });
    assert.equal(mapped.kind, "code-review-gate");
    assert.equal(mapped.reportedState, "ACTION_REQUIRED");
  });

  it("classifies a fast-path Code Review Gate waiting on an owner approval as the gate", () => {
    const gate = parseFastCheck({
      name: "Code Review Gate",
      state: "ACTION_REQUIRED",
      bucket: "fail",
    });
    assert.equal(gate.kind, "code-review-gate");
    assert.equal(gate.reportedState, "ACTION_REQUIRED");

    const regular = parseFastCheck({
      name: "ci",
      state: "ACTION_REQUIRED",
      bucket: "fail",
    });
    assert.equal(regular.kind, "failed");
    assert.equal(regular.reportedState, "ACTION_REQUIRED");
  });

  it("maps StatusContext states and drops unknown typenames", () => {
    const pending = mapRollupNode({
      __typename: "StatusContext",
      context: "ci",
      state: "EXPECTED",
    });
    assert.equal(pending.kind, "pending");
    assert.equal(pending.reportedState, "PENDING");

    const unknown = mapRollupNode({
      __typename: "StatusContext",
      context: "ci",
      state: "FUTURE_VALUE",
    });
    assert.equal(unknown.kind, "failed");
    assert.equal(unknown.reportedState, "FUTURE_VALUE");

    assert.equal(mapRollupNode({ __typename: "FutureNode" }), null);
  });
});

describe("closed enum parsing", () => {
  const rawPullRequest = {
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    headRefOid: "head",
    headRefName: "feature",
    baseRefName: "main",
    state: "OPEN",
    mergedAt: null,
    isDraft: false,
  };

  it("accepts mergeStateStatus CONFLICTING", () => {
    assert.equal(
      parsePullRequest(
        { ...rawPullRequest, mergeStateStatus: "CONFLICTING" },
        ghContext
      ).mergeStateStatus,
      "CONFLICTING"
    );
  });

  it("reads gh's empty reviewDecision as no decision rather than a parse failure", () => {
    assert.equal(
      parsePullRequest({ ...rawPullRequest, reviewDecision: "" }, ghContext)
        .reviewDecision,
      null
    );
  });

  it("still rejects an unknown reviewDecision", () => {
    assert.throws(
      () =>
        parsePullRequest(
          { ...rawPullRequest, reviewDecision: "MAYBE" },
          ghContext
        ),
      WatcherQueryError
    );
  });

  it("rejects unknown enum values as retryable errors carrying the raw value", () => {
    assert.throws(
      () =>
        parsePullRequest(
          { ...rawPullRequest, mergeStateStatus: "FUTURE_STATE" },
          ghContext
        ),
      (error) => {
        assert.ok(error instanceof WatcherQueryError);
        assert.equal(error.failure.kind, "missing-key");
        assert.equal(error.failure.retryable, true);
        assert.equal(error.failure.rawValue, '"FUTURE_STATE"');
        return true;
      }
    );
  });
});

it("annotates Bugbot threads with distinct review-pass counts", () => {
  const response = {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: "one",
                isResolved: false,
                comments: {
                  nodes: [
                    {
                      body: "RUN_ID: run-1",
                      createdAt: "now",
                      path: "a.ts",
                      line: 1,
                      author: { login: "bugbot" },
                    },
                  ],
                },
              },
              {
                id: "two",
                isResolved: false,
                comments: {
                  nodes: [
                    {
                      body: "CURSOR_AUTOMATION_ID: run-2 severity high",
                      createdAt: "now",
                      path: null,
                      line: null,
                      author: { login: "cursor" },
                    },
                  ],
                },
              },
              {
                id: "resolved",
                isResolved: true,
                comments: {
                  nodes: [
                    {
                      body: "RUN_ID: run-3",
                      createdAt: "now",
                      path: null,
                      line: null,
                      author: { login: "bugbot" },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };
  const threads = buildReviewThreads(parseReviewThreadPage(response).threads);
  assert.equal(threads.length, 2);
  assert.deepEqual(
    threads.map((thread) => thread.isBugbot),
    [true, true]
  );
  assert.deepEqual(
    threads.map((thread) => thread.bugbotReviewPasses),
    [3, 3]
  );
});

describe("review thread pagination", () => {
  const thread = (id, resolved = false) => ({
    id,
    firstComment: {
      authorLogin: "someone",
      body: "please fix",
      path: "a.ts",
      line: 1,
      createdAt: "now",
    },
    resolved,
  });

  it("keeps walking pages until the cursor is exhausted", async () => {
    const reader = fakeReader({
      threadPages: [
        { threads: [thread("one")], endCursor: "next" },
        { threads: [thread("two")], endCursor: "last" },
        { threads: [thread("three")], endCursor: null },
      ],
    });
    const threads = await resolveReviewThreads(reader, ghContext);
    assert.deepEqual(
      threads.map((item) => item.id),
      ["one", "two", "three"]
    );
    assert.deepEqual(reader.calls, [
      "reviewThreadPage:null",
      "reviewThreadPage:next",
      "reviewThreadPage:last",
    ]);
  });

  it("sees an unresolved thread that sits past the first page", async () => {
    const reader = fakeReader({
      threadPages: [
        { threads: [thread("early", true)], endCursor: "next" },
        { threads: [thread("late")], endCursor: null },
      ],
    });
    const threads = await resolveReviewThreads(reader, ghContext);
    assert.deepEqual(
      threads.map((item) => item.id),
      ["late"]
    );
  });

  it("stops after a single page when the cursor is exhausted", async () => {
    const reader = fakeReader({
      threadPages: [{ threads: [thread("only")], endCursor: null }],
    });
    assert.equal((await resolveReviewThreads(reader, ghContext)).length, 1);
    assert.deepEqual(reader.calls, ["reviewThreadPage:null"]);
  });

  it("counts Bugbot review passes across every page", async () => {
    const bugbot = (id, runId) => ({
      id,
      firstComment: {
        authorLogin: "bugbot",
        body: `RUN_ID: ${runId}`,
        path: "a.ts",
        line: 1,
        createdAt: "now",
      },
      resolved: false,
    });
    const reader = fakeReader({
      threadPages: [
        { threads: [bugbot("one", "run-1")], endCursor: "next" },
        { threads: [bugbot("two", "run-2")], endCursor: null },
      ],
    });
    const threads = await resolveReviewThreads(reader, ghContext);
    assert.deepEqual(
      threads.map((item) => item.bugbotReviewPasses),
      [2, 2]
    );
  });

  it("drops resolved threads from later pages too", async () => {
    const reader = fakeReader({
      threadPages: [
        { threads: [thread("one")], endCursor: "next" },
        { threads: [thread("two", true)], endCursor: null },
      ],
    });
    assert.deepEqual(
      (await resolveReviewThreads(reader, ghContext)).map((item) => item.id),
      ["one"]
    );
  });

  it("rejects a page that omits pageInfo instead of assuming one page", () => {
    const response = {
      data: {
        repository: {
          pullRequest: { reviewThreads: { nodes: [] } },
        },
      },
    };
    assert.throws(() => parseReviewThreadPage(response), WatcherQueryError);
  });
});

describe("context and stack discovery", () => {
  it("returns a fully explicit context without any reader call", async () => {
    const reader = fakeReader();
    assert.deepEqual(
      await resolveContext({
        reader,
        owner: "explicit",
        repo: "repo",
        pr: ghContext.number,
      }),
      { owner: "explicit", repo: "repo", number: ghContext.number }
    );
    assert.deepEqual(reader.calls, []);
  });

  it("uses the local origin before currentPr for an explicit number", async () => {
    const reader = fakeReader({ origin: { owner: "local", repo: "checkout" } });
    assert.deepEqual(
      await resolveContext({
        reader,
        owner: null,
        repo: null,
        pr: ghContext.number,
      }),
      { owner: "local", repo: "checkout", number: ghContext.number }
    );
    assert.deepEqual(reader.calls, ["originRepo"]);
  });

  it("orders the connected stack bottom-to-top", () => {
    const ordered = orderStack(ghContext, [
      {
        number: parsePrNumber(41),
        headRefName: "base-feature",
        isCrossRepository: false,
        baseRefName: "main",
      },
      {
        number: ghContext.number,
        headRefName: "feature",
        isCrossRepository: false,
        baseRefName: "base-feature",
      },
      {
        number: parsePrNumber(43),
        headRefName: "upstack",
        isCrossRepository: false,
        baseRefName: "feature",
      },
    ]);
    assert.deepEqual(
      ordered.map((item) => Number(item.number)),
      [41, 42, 43]
    );
  });

  it("does not use a fork's same-named head as a stack parent", () => {
    const ordered = orderStack(ghContext, [
      {
        number: parsePrNumber(41),
        headRefName: "base-feature",
        baseRefName: "main",
        isCrossRepository: true,
      },
      {
        number: ghContext.number,
        headRefName: "feature",
        baseRefName: "base-feature",
        isCrossRepository: false,
      },
    ]);
    assert.deepEqual(
      ordered.map((item) => Number(item.number)),
      [42]
    );
  });

  it("does not attach upstream branch children to a fork head", () => {
    const ordered = orderStack(ghContext, [
      {
        number: ghContext.number,
        headRefName: "feature",
        baseRefName: "main",
        isCrossRepository: true,
      },
      {
        number: parsePrNumber(43),
        headRefName: "upstack",
        baseRefName: "feature",
        isCrossRepository: false,
      },
    ]);
    assert.deepEqual(
      ordered.map((item) => Number(item.number)),
      [42]
    );
  });

  it("terminates when an unrelated fork opens main against main", () => {
    const program = `import { orderStack } from ${JSON.stringify(watchPrUrl)};
      console.log(JSON.stringify(orderStack(${JSON.stringify(ghContext)}, [
        { number: 41, headRefName: "main", baseRefName: "main", isCrossRepository: true },
        { number: 42, headRefName: "feature", baseRefName: "main", isCrossRepository: false }
      ])));`;
    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", program],
      { encoding: "utf8", timeout: 2000 }
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0);
    assert.deepEqual(
      JSON.parse(child.stdout).map((item) => item.number),
      [42]
    );
  });

  it("requests and parses fork identity from gh before stack discovery", () => {
    const directory = mkdtempSync(join(tmpdir(), "watch-pr-fork-"));
    try {
      writeFileSync(
        join(directory, "gh"),
        `#!/bin/sh
case "$*" in
  *number,headRefName,baseRefName,isCrossRepository*) ;;
  *) exit 2 ;;
esac
printf '%s\\n' '[{"number":42,"headRefName":"feature","baseRefName":"main","isCrossRepository":true}]'
`,
        { mode: 0o755 }
      );
      const program = `import { GhGitHubReader } from ${JSON.stringify(watchPrUrl)};
        console.log(JSON.stringify(await new GhGitHubReader().openPullRequests({ owner: "owner", repo: "repo" })));`;
      const child = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", program],
        {
          encoding: "utf8",
          timeout: 2000,
          env: { ...process.env, PATH: directory + ":" + process.env.PATH },
        }
      );
      assert.equal(child.error, undefined);
      assert.equal(child.status, 0);
      assert.deepEqual(JSON.parse(child.stdout), [
        {
          number: 42,
          headRefName: "feature",
          baseRefName: "main",
          isCrossRepository: true,
        },
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

const policyContext = (number) => ({
  owner: "owner",
  repo: "repo",
  number: parsePrNumber(number),
});

const policyOptions = {
  interval: 10,
  sweepInterval: 300,
  timeout: 0,
  maxQueryErrors: 5,
  allowDraft: false,
};

describe("readiness truth table", () => {
  it("covers every specified row and every UNKNOWN rollup value", () => {
    const cases = [
      ["BLOCKED", "FAILURE", "refused"],
      ["BLOCKED", "ERROR", "refused"],
      ["BLOCKED", "PENDING", "allowed"],
      ["UNSTABLE", "FAILURE", "allowed"],
      ["UNKNOWN", "ERROR", "allowed"],
      ["UNKNOWN", "EXPECTED", "allowed"],
      ["UNKNOWN", "FAILURE", "allowed"],
      ["UNKNOWN", "PENDING", "allowed"],
      ["UNKNOWN", "SUCCESS", "allowed"],
      ["UNKNOWN", null, "allowed"],
      ["CLEAN", "SUCCESS", "allowed"],
    ];
    for (const [mergeStateStatus, headRollupState, expected] of cases) {
      assert.equal(
        assessGitHubMerge({ mergeStateStatus, headRollupState }).kind,
        expected
      );
    }
  });

  it("turns a clean visible list plus GitHub refusal into an explicit CI blocker", async () => {
    const reader = fakeReader({
      facts: { mergeStateStatus: "BLOCKED" },
      fastPath: { kind: "checks", checks: [passingCheck()] },
      commitRollups: [{ oid: "head", state: "FAILURE" }],
    });
    const snapshot = await readSnapshot({
      reader,
      context: policyContext(1),
      pendingHistory: "include",
      allowDraft: false,
    });
    assert.equal(snapshot.kind, "open");
    assert.equal(snapshot.ci.kind, "ci-github-rejected");
    const decision = classifyPr(snapshot);
    assert.equal(decision.kind, "blocker");
    assert.equal(decision.blocker.kind, "failing-checks");
  });
});

describe("snapshot query planning", () => {
  it("does not query commit rollups while queued checks are pending", async () => {
    const reader = fakeReader({
      fastPath: { kind: "checks", checks: [pendingCheck()] },
    });
    const snapshot = await readSnapshot({
      reader,
      context: policyContext(2),
      pendingHistory: "omit",
      allowDraft: false,
    });
    assert.equal(snapshot.kind, "open");
    assert.equal(snapshot.ci.kind, "ci-pending");
    assert.deepEqual(reader.calls, [
      "pullRequest",
      "reviewThreadPage:null",
      "checksFastPath",
    ]);
  });

  it("queries rollups for settled and failed lists", async () => {
    const settled = fakeReader();
    await readSnapshot({
      reader: settled,
      context: policyContext(3),
      pendingHistory: "omit",
      allowDraft: false,
    });
    assert.ok(settled.calls.includes("commitRollups"));

    const failed = fakeReader({
      fastPath: { kind: "checks", checks: [failedCheck()] },
    });
    await readSnapshot({
      reader: failed,
      context: policyContext(4),
      pendingHistory: "omit",
      allowDraft: false,
    });
    assert.ok(failed.calls.includes("commitRollups"));
  });

  it("short-circuits merged rows before threads and checks", async () => {
    const reader = fakeReader({
      facts: { state: "MERGED", mergedAt: "2026-07-26T00:00:00Z" },
    });
    assert.equal(
      (
        await readSnapshot({
          reader,
          context: policyContext(5),
          pendingHistory: "include",
          allowDraft: false,
        })
      ).kind,
      "merged"
    );
    assert.deepEqual(reader.calls, ["pullRequest"]);
  });
});

it("scans stacks tier-major so an upstack conflict outranks frontier CI", async () => {
  const frontier = await readSnapshot({
    reader: fakeReader({
      fastPath: { kind: "checks", checks: [failedCheck()] },
      commitRollups: [{ oid: "head", state: "FAILURE" }],
    }),
    context: policyContext(10),
    pendingHistory: "omit",
    allowDraft: false,
  });
  const upstack = await readSnapshot({
    reader: fakeReader({ facts: { mergeable: "CONFLICTING" } }),
    context: policyContext(11),
    pendingHistory: "omit",
    allowDraft: false,
  });
  const decision = selectTierMajorStackDecision([frontier, upstack]);
  assert.equal(decision.kind, "blocker");
  assert.equal(decision.blocker.kind, "merge-conflicts");
  assert.equal(decision.blocker.pr.number, 11);
});

it("attributes a stack wait to the PR whose checks are pending, not the bottom", async () => {
  const readyBottom = await readSnapshot({
    reader: fakeReader(),
    context: policyContext(20),
    pendingHistory: "omit",
    allowDraft: false,
  });
  const pendingUpstack = await readSnapshot({
    reader: fakeReader({
      fastPath: { kind: "checks", checks: [pendingCheck("upstack-build")] },
    }),
    context: policyContext(21),
    pendingHistory: "omit",
    allowDraft: false,
  });
  const decision = selectTierMajorStackDecision([readyBottom, pendingUpstack]);
  assert.equal(decision.kind, "waiting");
  assert.equal(decision.frontier.number, 21);
  assert.equal(decision.pending[0].name, "upstack-build");
});

it("waits on a draft while checks are pending, then reports the draft gate", async () => {
  const pending = await readSnapshot({
    reader: fakeReader({
      facts: { isDraft: true },
      fastPath: { kind: "checks", checks: [pendingCheck()] },
    }),
    context: policyContext(12),
    pendingHistory: "omit",
    allowDraft: false,
  });
  assert.equal(classifyPr(pending).kind, "waiting");

  const settled = await readSnapshot({
    reader: fakeReader({ facts: { isDraft: true } }),
    context: policyContext(12),
    pendingHistory: "omit",
    allowDraft: false,
  });
  const decision = classifyPr(settled);
  assert.equal(decision.kind, "blocker");
  assert.equal(decision.blocker.kind, "merge-gate");
  assert.equal(decision.blocker.reason, "draft-pr");
});

describe("queued-stack cadence", () => {
  async function openSnapshot(pr) {
    return readSnapshot({
      reader: fakeReader(),
      context: pr,
      pendingHistory: "omit",
      allowDraft: false,
    });
  }

  it("drops a sweep head only after its snapshot succeeds", async () => {
    const queue = [policyContext(20), policyContext(21), policyContext(22)];
    let state = createQueueState(queue, 0);
    const first = await openSnapshot(queue[0]);
    state = applyQueueSnapshot(state, first, 0, policyOptions).state;
    assert.equal(state.work.kind, "whole-stack-sweep");
    assert.deepEqual(
      state.work.remaining.map((item) => item.number),
      [21, 22]
    );
    const second = await openSnapshot(queue[1]);
    state = applyQueueSnapshot(state, second, 60, policyOptions).state;
    assert.equal(state.work.kind, "whole-stack-sweep");
    assert.deepEqual(
      state.work.remaining.map((item) => item.number),
      [22]
    );
  });

  it("resumes the sweep at the PR whose read failed", async () => {
    const middle = policyContext(21);
    const base = fakeReader();
    let failNext = true;
    const timeline = [];
    const reader = {
      ...base,
      async pullRequest(pr) {
        if (pr.number === middle.number && failNext) {
          failNext = false;
          timeline.push(`fail:${pr.number}`);
          throw new WatcherQueryError({
            kind: "command-exit",
            retryable: true,
            detail: "rate limited",
            code: 1,
          });
        }
        timeline.push(`read:${pr.number}`);
        return base.pullRequest(pr);
      },
    };
    let now = 0;
    let sleeps = 0;
    const running = runQueued({
      dependencies: {
        reader,
        clock: {
          now: () => now,
          observedAt: () => "2026-07-26T00:00:00.000Z",
          async sleep(seconds) {
            timeline.push("sleep");
            now += seconds;
            sleeps += 1;
            if (sleeps === 2) throw new Error("stop after resume proof");
          },
        },
        emit(verdict) {
          timeline.push(`emit:${verdict.kind}`);
        },
      },
      contexts: [policyContext(20), middle, policyContext(22)],
      options: policyOptions,
    });
    await assert.rejects(running, /stop after resume proof/);
    assert.deepEqual(timeline, [
      "emit:QUEUE",
      "read:20",
      "fail:21",
      "emit:RETRY",
      "sleep",
      "read:21",
      "read:22",
      "emit:STATUS",
      "emit:WAITING",
      "sleep",
    ]);
  });

  it("emits a completed sweep only after its final successful snapshot", async () => {
    const queue = [policyContext(30), policyContext(31)];
    let state = createQueueState(queue, 0);
    const first = applyQueueSnapshot(
      state,
      await openSnapshot(queue[0]),
      0,
      policyOptions
    );
    assert.equal(first.completedSweepRows, null);
    state = first.state;
    const second = applyQueueSnapshot(
      state,
      await openSnapshot(queue[1]),
      5,
      policyOptions
    );
    assert.deepEqual(
      second.completedSweepRows?.map((row) => Number(row.context.number)),
      [30, 31]
    );
    assert.equal(second.state.nextSweepAt, 305);
  });

  it("ADVANCE continues directly to the new frontier without sleeping", async () => {
    const one = policyContext(40);
    const two = policyContext(41);
    const base = fakeReader();
    const reads = new Map();
    const timeline = [];
    const reader = {
      ...base,
      async pullRequest(pr) {
        timeline.push(`read:${pr.number}`);
        const facts = await base.pullRequest(pr);
        const count = (reads.get(pr.number) ?? 0) + 1;
        reads.set(pr.number, count);
        return pr.number === one.number && count > 1
          ? {
              ...facts,
              state: "MERGED",
              mergedAt: "2026-07-26T00:00:00Z",
            }
          : facts;
      },
    };
    let now = 0;
    let sleeps = 0;
    const emitted = [];
    const running = runQueued({
      dependencies: {
        reader,
        clock: {
          now: () => now,
          observedAt: () => "2026-07-26T00:00:00.000Z",
          async sleep(seconds) {
            timeline.push("sleep");
            now += seconds;
            sleeps += 1;
            if (sleeps === 2) throw new Error("stop after advance proof");
          },
        },
        emit(verdict) {
          emitted.push(verdict);
          timeline.push(`emit:${verdict.kind}`);
        },
      },
      contexts: [one, two],
      options: policyOptions,
    });
    await assert.rejects(running, /stop after advance proof/);
    assert.equal(
      emitted.some((event) => event.kind === "ADVANCE"),
      true
    );
    const firstSleep = timeline.indexOf("sleep");
    assert.deepEqual(timeline.slice(firstSleep, firstSleep + 5), [
      "sleep",
      "read:40",
      "emit:ADVANCE",
      "read:41",
      "emit:WAITING",
    ]);
  });

  it("deduplicates identical waits and schedules the next due sweep", async () => {
    const queue = [policyContext(50)];
    let state = createQueueState(queue, 0);
    state = applyQueueSnapshot(
      state,
      await openSnapshot(queue[0]),
      0,
      policyOptions
    ).state;
    const first = evaluateQueue(state, 0, policyOptions);
    assert.equal(first.kind, "waiting");
    assert.equal(first.emit, true);
    const second = evaluateQueue(first.state, 10, policyOptions);
    assert.equal(second.kind, "waiting");
    assert.equal(second.emit, false);
    assert.equal(planQueue(second.state, 300).work?.kind, "whole-stack-sweep");
  });
});

it("uses the specified retry floor and cap", () => {
  assert.equal(queryBackoffSeconds(1, 1), 60);
  assert.equal(queryBackoffSeconds(1, 2), 120);
  assert.equal(queryBackoffSeconds(60, 4), 300);
});

describe("polling deadline sleeps", () => {
  for (const mode of ["single", "queued-stack", "query-retry"]) {
    it(`caps ${mode} sleeps at the configured deadline`, async () => {
      let now = 0;
      const sleeps = [];
      const pending = fakeReader({
        fastPath: { kind: "checks", checks: [pendingCheck()] },
      });
      const reader =
        mode === "query-retry"
          ? {
              ...pending,
              async pullRequest() {
                throw new WatcherQueryError({
                  kind: "command-exit",
                  retryable: true,
                  code: 1,
                  detail: "temporary failure",
                });
              },
            }
          : pending;
      const dependencies = {
        reader,
        clock: {
          now: () => now,
          observedAt: () => "2026-07-26T00:00:00.000Z",
          async sleep(seconds) {
            sleeps.push(seconds);
            now += seconds;
          },
        },
        emit() {},
      };
      const polling = { ...policyOptions, interval: 60, timeout: 5 };
      const result =
        mode === "queued-stack"
          ? await runQueued({
              dependencies,
              contexts: [policyContext(1)],
              options: polling,
            })
          : await runSimple({
              dependencies,
              contexts: [policyContext(1)],
              mode: "single",
              statusOnly: false,
              options: polling,
            });
      assert.equal(result.kind, "TIMEOUT");
      assert.deepEqual(sleeps, [5]);
      assert.equal(now, 5);
    });
  }

  it("preserves the polling interval when the deadline is disabled", async () => {
    let now = 0;
    let reads = 0;
    const sleeps = [];
    const pending = fakeReader({
      fastPath: { kind: "checks", checks: [pendingCheck()] },
    });
    const passed = fakeReader({
      fastPath: { kind: "checks", checks: [passingCheck()] },
    });
    const result = await runSimple({
      dependencies: {
        reader: {
          ...pending,
          async checksFastPath(pr) {
            reads += 1;
            return reads === 1
              ? pending.checksFastPath(pr)
              : passed.checksFastPath(pr);
          },
        },
        clock: {
          now: () => now,
          observedAt: () => "2026-07-26T00:00:00.000Z",
          async sleep(seconds) {
            sleeps.push(seconds);
            now += seconds;
          },
        },
        emit() {},
      },
      contexts: [policyContext(1)],
      mode: "single",
      statusOnly: false,
      options: { ...policyOptions, interval: 60, timeout: 0 },
    });
    assert.equal(result.kind, "READY");
    assert.deepEqual(sleeps, [60]);
  });
});
