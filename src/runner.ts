/**
 * Mutagen-AI — Test Runner
 *
 * Executes test cases against an LLM API and collects results.
 * Supports multi-run testing for nondeterminism validation.
 */

import { callApi, type ProviderConfig, type UserInput } from "./providers.js";
import { runCheck, type Check } from "./validators.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestCase {
  id: string;
  description: string;
  input: UserInput;
  checks: Check[];
  tags?: string[];
  context?: Record<string, unknown>;
}

export interface RunResult {
  run: number;
  passed: boolean;
  reason: string;
  response: string | null;
  tokens: number;
  latencyMs: number;
}

export interface TestResult {
  id: string;
  description: string;
  tags: string[];
  runs: RunResult[];
  passed: boolean;
  passRate: string;
  totalTokens: number;
  avgLatencyMs: number;
}

export interface SuiteResult {
  results: TestResult[];
  passed: number;
  failed: number;
  total: number;
  totalTokens: number;
  timestamp: string;
}

export interface RunOptions {
  numRuns?: number;
  tags?: string[];
  testId?: string;
  delayBetween?: number;
  retries?: number;
  verbose?: boolean;
  buildUserPrompt?: (input: UserInput, context?: Record<string, unknown>) => UserInput;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateResponse(response: string, checks: Check[]): [boolean, string] {
  for (const check of checks) {
    const [passed, reason] = runCheck(response, check);
    if (!passed) return [false, reason];
  }
  return [true, "All checks passed"];
}

async function runSingleTest(
  testCase: TestCase,
  systemPrompt: string,
  config: ProviderConfig,
  opts: RunOptions,
): Promise<TestResult> {
  const numRuns = opts.numRuns ?? 1;
  const retries = opts.retries ?? 1;

  const result: TestResult = {
    id: testCase.id,
    description: testCase.description,
    tags: testCase.tags ?? [],
    runs: [],
    passed: true,
    passRate: "0/0",
    totalTokens: 0,
    avgLatencyMs: 0,
  };

  let passes = 0;
  let totalLatency = 0;

  for (let runIdx = 0; runIdx < numRuns; runIdx++) {
    const runData: RunResult = {
      run: runIdx + 1,
      passed: false,
      reason: "",
      response: null,
      tokens: 0,
      latencyMs: 0,
    };

    // Build the user input (with optional context)
    let userInput = testCase.input;
    if (testCase.context && opts.buildUserPrompt) {
      userInput = opts.buildUserPrompt(testCase.input, testCase.context);
    }

    // Try with retries on transient failures
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const start = Date.now();
        const apiResponse = await callApi(systemPrompt, userInput, config);
        const elapsed = Date.now() - start;

        runData.response = apiResponse.text;
        runData.latencyMs = elapsed;
        totalLatency += elapsed;

        const tokens = (apiResponse.metadata.inputTokens ?? 0) + (apiResponse.metadata.outputTokens ?? 0);
        runData.tokens = tokens;
        result.totalTokens += tokens;

        const [passed, reason] = validateResponse(apiResponse.text, testCase.checks);
        runData.passed = passed;
        runData.reason = reason;
        if (passed) {
          passes++;
        } else {
          result.passed = false;
        }
        break; // Success — don't retry
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt < retries - 1) {
          await sleep(1000); // Brief backoff
          continue;
        }
        runData.reason = `Error after ${retries} attempt(s): ${msg}`;
        result.passed = false;
        break;
      }
    }

    result.runs.push(runData);
    if (runIdx < numRuns - 1) {
      await sleep(500); // Brief pause between runs
    }
  }

  result.passRate = `${passes}/${numRuns}`;
  result.avgLatencyMs = numRuns > 0 ? Math.round(totalLatency / numRuns) : 0;
  return result;
}

export async function runTests(
  systemPrompt: string,
  testCases: TestCase[],
  config: ProviderConfig,
  opts: RunOptions = {},
): Promise<SuiteResult> {
  let cases = [...testCases];

  // Filter by test ID
  if (opts.testId) {
    cases = cases.filter((tc) => tc.id === opts.testId);
    if (cases.length === 0) {
      throw new Error(`No test case found with id '${opts.testId}'`);
    }
  }

  // Filter by tags
  if (opts.tags && opts.tags.length > 0) {
    cases = cases.filter((tc) =>
      opts.tags!.some((tag) => (tc.tags ?? []).includes(tag)),
    );
  }

  if (cases.length === 0) {
    throw new Error("No test cases to run after filtering.");
  }

  const numRuns = opts.numRuns ?? 1;
  const runLabel = numRuns > 1 ? ` x${numRuns} runs` : "";
  process.stderr.write(`\nRunning ${cases.length} tests${runLabel}...\n\n`);

  const results: TestResult[] = [];
  const delay = opts.delayBetween ?? 500;

  for (let i = 0; i < cases.length; i++) {
    if (i > 0) await sleep(delay);

    const tc = cases[i];
    const label = `  [${i + 1}/${cases.length}] ${tc.id}`;
    const runsLabel = numRuns > 1 ? ` (${numRuns} runs)` : "";
    process.stderr.write(`${label}${runsLabel}... `);

    const result = await runSingleTest(tc, systemPrompt, config, opts);
    const status = result.passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
    const rate = numRuns > 1 ? ` (${result.passRate})` : "";
    process.stderr.write(`${status}${rate}\n`);

    if (!result.passed && opts.verbose) {
      for (const run of result.runs) {
        if (!run.passed) {
          process.stderr.write(`    Run ${run.run}: ${run.reason}\n`);
          if (run.response) {
            const preview = run.response.slice(0, 200);
            process.stderr.write(`    Response: ${preview}...\n`);
          }
        }
      }
    }

    results.push(result);
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  const totalTokens = results.reduce((sum, r) => sum + r.totalTokens, 0);

  return {
    results,
    passed,
    failed,
    total: results.length,
    totalTokens,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Output Formatting
// ---------------------------------------------------------------------------

export function formatSummary(suite: SuiteResult): string {
  const lines: string[] = [];
  const sep = "=".repeat(60);
  lines.push(`\n${sep}`);
  lines.push(`Results: ${suite.passed}/${suite.total} passed`);
  if (suite.totalTokens > 0) {
    lines.push(`Total tokens: ${suite.totalTokens}`);
  }
  lines.push(sep);

  const failures = suite.results.filter((r) => !r.passed);
  if (failures.length > 0) {
    lines.push("\nFailures:");
    for (const f of failures) {
      lines.push(`\n  ${f.id} [${f.passRate}]`);
      lines.push(`    ${f.description}`);
      for (const run of f.runs) {
        if (!run.passed) {
          lines.push(`    Run ${run.run}: ${run.reason}`);
        }
      }
    }
  }

  // Flaky tests
  const flaky = suite.results.filter((r) => {
    if (!r.passed) return false;
    const [p, t] = r.passRate.split("/").map(Number);
    return t > 1 && p !== t;
  });
  if (flaky.length > 0) {
    lines.push("\nFlaky (passed but inconsistent):");
    for (const f of flaky) {
      lines.push(`  ${f.id}: ${f.passRate}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function formatMarkdownTable(suite: SuiteResult): string {
  const lines: string[] = [];
  lines.push("| Test ID | Status | Pass Rate | Latency | Notes |");
  lines.push("|---------|--------|-----------|---------|-------|");

  for (const r of suite.results) {
    const status = r.passed ? "PASS" : "FAIL";
    let notes = "";
    if (!r.passed) {
      const lastFail = [...r.runs].reverse().find((run) => !run.passed);
      if (lastFail) notes = lastFail.reason.slice(0, 50);
    }
    lines.push(`| ${r.id} | ${status} | ${r.passRate} | ${r.avgLatencyMs}ms | ${notes} |`);
  }

  return lines.join("\n");
}
