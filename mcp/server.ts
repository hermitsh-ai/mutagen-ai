#!/usr/bin/env node
/**
 * mutagen-ai MCP Server
 *
 * Exposes mutagen-ai's test runner, baseline, compare, and versioning
 * as MCP tools that any agent can call directly.
 *
 * Transport: stdio (runs as a subprocess of the MCP client)
 *
 * Usage:
 *   node dist/mcp/server.js
 *   # or via the CLI:
 *   mutagen --mcp
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve } from "node:path";

import { runTests, formatSummary, formatMarkdownTable, type SuiteResult } from "../src/runner.js";
import { loadTestCasesFromYaml, loadConfig, loadPrompt } from "../src/loader.js";
import { type ProviderConfig } from "../src/providers.js";
import { savePrompt, saveResults, ensureEngagementDir, listPromptVersions, loadPromptVersion } from "../src/persistence.js";

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "mutagen-ai-mcp-server",
  version: "0.2.0",
});

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const RunConfigSchema = z.object({
  config_path: z.string().describe("Path to mutagen.yaml config file"),
  runs: z.number().int().min(1).max(20).default(1).describe("Number of runs per test (use 3+ for nondeterminism testing)"),
  tags: z.string().optional().describe("Comma-separated tag filter (e.g. 'basic,json')"),
  test_id: z.string().optional().describe("Run a single test by ID"),
  verbose: z.boolean().default(false).describe("Include response text in failure details"),
}).strict();

const RunInlineSchema = z.object({
  prompt_text: z.string().min(1).describe("The system prompt text to test"),
  test_cases_yaml: z.string().min(1).describe("YAML string containing test_cases definitions"),
  provider: z.string().describe("LLM provider: openai, anthropic, gemini"),
  model: z.string().describe("Model name (e.g. gpt-4o, claude-sonnet-4-20250514)"),
  api_key_env: z.string().describe("Environment variable holding the API key"),
  temperature: z.number().min(0).max(2).default(0.7).describe("Temperature"),
  max_tokens: z.number().int().min(1).default(4096).describe("Max output tokens"),
  runs: z.number().int().min(1).max(20).default(1).describe("Number of runs per test"),
}).strict();

const BaselineSchema = z.object({
  config_path: z.string().describe("Path to mutagen.yaml config file"),
  save_to: z.string().describe("Engagement directory to save results and prompt version"),
  runs: z.number().int().min(1).max(20).default(1).describe("Number of runs per test"),
}).strict();

const CompareSchema = z.object({
  v1: z.number().int().min(1).describe("First version number to compare"),
  v2: z.number().int().min(1).describe("Second version number to compare"),
  config_path: z.string().describe("Path to mutagen.yaml config file"),
  save_to: z.string().describe("Engagement directory containing versioned prompts"),
  runs: z.number().int().min(1).max(20).default(1).describe("Number of runs per test"),
}).strict();

const VersionsSchema = z.object({
  save_to: z.string().describe("Engagement directory to list versions from"),
}).strict();

const InitSchema = z.object({
  name: z.string().min(1).describe("Engagement name (creates a directory)"),
  provider: z.string().default("openai").describe("LLM provider: openai, anthropic, gemini"),
  model: z.string().default("gpt-4o").describe("Model name"),
}).strict();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function suiteToText(suite: SuiteResult, verbose: boolean): string {
  const lines: string[] = [];
  lines.push(formatSummary(suite));
  lines.push(formatMarkdownTable(suite));

  if (verbose) {
    const failures = suite.results.filter((r) => !r.passed);
    if (failures.length > 0) {
      lines.push("\n## Failure Details\n");
      for (const f of failures) {
        lines.push(`### ${f.id} [${f.passRate}]`);
        lines.push(f.description);
        for (const run of f.runs) {
          if (!run.passed) {
            lines.push(`- Run ${run.run}: ${run.reason}`);
            if (run.response) {
              lines.push(`  Response preview: ${run.response.slice(0, 300)}...`);
            }
          }
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

function suiteToJson(suite: SuiteResult): Record<string, unknown> {
  return {
    passed: suite.passed,
    failed: suite.failed,
    total: suite.total,
    totalTokens: suite.totalTokens,
    timestamp: suite.timestamp,
    results: suite.results.map((r) => ({
      id: r.id,
      passed: r.passed,
      passRate: r.passRate,
      avgLatencyMs: r.avgLatencyMs,
      totalTokens: r.totalTokens,
      failureReasons: r.runs.filter((run) => !run.passed).map((run) => run.reason),
    })),
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

server.registerTool(
  "mutagen_run",
  {
    title: "Run Mutagen Tests",
    description: `Run mutagen-ai test suite against a prompt using a config file.

Returns pass/fail results for each test case, with optional verbose failure details.
Exit code: 0 if all tests pass, 1 if any fail.

Args:
  - config_path (string): Path to mutagen.yaml config file
  - runs (number): Runs per test, 1-20 (default: 1). Use 3+ at temperature > 0.5
  - tags (string): Comma-separated tag filter (optional)
  - test_id (string): Run a single test by ID (optional)
  - verbose (boolean): Include response text in failures (default: false)

Returns: Summary with pass/fail table and failure details.`,
    inputSchema: RunConfigSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params) => {
    try {
      const cfg = loadConfig(params.config_path);
      if (!cfg.promptFile) throw new Error("Config missing prompt_file");
      if (!cfg.testCasesFile) throw new Error("Config missing test_cases");

      const prompt = loadPrompt(cfg.promptFile);
      const tests = loadTestCasesFromYaml(cfg.testCasesFile);
      const tags = params.tags ? params.tags.split(",").map((t) => t.trim()) : undefined;

      const suite = await runTests(prompt, tests, cfg.provider, {
        numRuns: params.runs,
        tags,
        testId: params.test_id,
        verbose: params.verbose,
        judgeConfig: cfg.judgeProvider,
      });

      const output = suiteToJson(suite);
      return {
        content: [{ type: "text", text: suiteToText(suite, params.verbose) }],
        structuredContent: output,
      };
    } catch (e: unknown) {
      return {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "mutagen_run_inline",
  {
    title: "Run Mutagen Tests (Inline)",
    description: `Run mutagen-ai tests with inline prompt text and YAML test cases — no files needed.

This is the most convenient tool for agents: pass the prompt and tests directly as strings.

Args:
  - prompt_text (string): The system prompt to test
  - test_cases_yaml (string): YAML string with test_cases definitions
  - provider (string): LLM provider (openai, anthropic, gemini)
  - model (string): Model name
  - api_key_env (string): Env var holding the API key
  - temperature (number): Temperature 0-2 (default: 0.7)
  - max_tokens (number): Max output tokens (default: 4096)
  - runs (number): Runs per test (default: 1)

Returns: Summary with pass/fail table and failure details.`,
    inputSchema: RunInlineSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params) => {
    try {
      // Parse YAML from string
      const YAML = await import("yaml");
      const parsed = YAML.parse(params.test_cases_yaml) as { test_cases?: unknown[] } | unknown[];
      let rawCases: unknown[];
      if (Array.isArray(parsed)) {
        rawCases = parsed;
      } else if (parsed && typeof parsed === "object" && "test_cases" in parsed && Array.isArray(parsed.test_cases)) {
        rawCases = parsed.test_cases;
      } else {
        throw new Error("YAML must be a list or have a 'test_cases' key");
      }

      const tests = rawCases.map((tc: any) => ({
        id: tc.id ?? "unnamed",
        description: tc.description ?? tc.id ?? "unnamed",
        input: tc.input,
        checks: tc.checks ?? [],
        tags: tc.tags ?? [],
        context: tc.context,
      }));

      const config: ProviderConfig = {
        provider: params.provider,
        model: params.model,
        apiKeyEnv: params.api_key_env,
        temperature: params.temperature,
        maxTokens: params.max_tokens,
      };

      const suite = await runTests(params.prompt_text, tests, config, {
        numRuns: params.runs,
      });

      const output = suiteToJson(suite);
      return {
        content: [{ type: "text", text: suiteToText(suite, true) }],
        structuredContent: output,
      };
    } catch (e: unknown) {
      return {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "mutagen_baseline",
  {
    title: "Save Mutagen Baseline",
    description: `Run tests and save results as a baseline. Auto-versions the prompt (v1.txt, v2.txt, etc.).

Args:
  - config_path (string): Path to mutagen.yaml config file
  - save_to (string): Engagement directory to save into
  - runs (number): Runs per test (default: 1)

Returns: Baseline results with version number and file paths.`,
    inputSchema: BaselineSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params) => {
    try {
      const cfg = loadConfig(params.config_path);
      if (!cfg.promptFile) throw new Error("Config missing prompt_file");
      if (!cfg.testCasesFile) throw new Error("Config missing test_cases");

      const prompt = loadPrompt(cfg.promptFile);
      const tests = loadTestCasesFromYaml(cfg.testCasesFile);

      const promptPath = savePrompt(prompt, params.save_to);
      const suite = await runTests(prompt, tests, cfg.provider, {
        numRuns: params.runs,
        judgeConfig: cfg.judgeProvider,
      });
      const resultsPath = saveResults(suite, params.save_to);

      const output = {
        ...suiteToJson(suite),
        promptVersion: promptPath,
        resultsFile: resultsPath,
      };

      return {
        content: [{
          type: "text",
          text: `Prompt saved: ${promptPath}\n${suiteToText(suite, false)}\nResults saved: ${resultsPath}`,
        }],
        structuredContent: output,
      };
    } catch (e: unknown) {
      return {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "mutagen_compare",
  {
    title: "Compare Mutagen Prompt Versions",
    description: `Compare two prompt versions by running the full test suite against each.

Shows a side-by-side comparison table with FIXED / REGRESSION / STILL FAILING labels.

Args:
  - v1 (number): First version number
  - v2 (number): Second version number
  - config_path (string): Path to mutagen.yaml config file
  - save_to (string): Engagement directory containing versioned prompts
  - runs (number): Runs per test (default: 1)

Returns: Comparison table and per-test diff.`,
    inputSchema: CompareSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params) => {
    try {
      const prompt1 = loadPromptVersion(params.save_to, params.v1);
      const prompt2 = loadPromptVersion(params.save_to, params.v2);

      const cfg = loadConfig(params.config_path);
      if (!cfg.testCasesFile) throw new Error("Config missing test_cases");
      const tests = loadTestCasesFromYaml(cfg.testCasesFile);

      const suite1 = await runTests(prompt1, tests, cfg.provider, {
        numRuns: params.runs,
        judgeConfig: cfg.judgeProvider,
      });
      const suite2 = await runTests(prompt2, tests, cfg.provider, {
        numRuns: params.runs,
        judgeConfig: cfg.judgeProvider,
      });

      // Build comparison
      const rows: string[] = [];
      rows.push(`| Test ID | v${params.v1} | v${params.v2} | Change |`);
      rows.push(`|---------|------|------|--------|`);

      for (const r1 of suite1.results) {
        const r2 = suite2.results.find((r) => r.id === r1.id);
        const s1 = r1.passed ? "PASS" : "FAIL";
        const s2 = r2 ? (r2.passed ? "PASS" : "FAIL") : "—";
        let change = "";
        if (r2) {
          if (!r1.passed && r2.passed) change = "FIXED";
          else if (r1.passed && !r2.passed) change = "REGRESSION";
          else if (r1.passed && r2.passed) change = "—";
          else change = "STILL FAILING";
        }
        rows.push(`| ${r1.id} | ${s1} (${r1.passRate}) | ${s2}${r2 ? ` (${r2.passRate})` : ""} | ${change} |`);
      }

      const delta = suite2.passed - suite1.passed;
      const deltaStr = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "no change";

      const text = [
        `## Comparison: v${params.v1} vs v${params.v2}`,
        "",
        rows.join("\n"),
        "",
        `v${params.v1}: ${suite1.passed}/${suite1.total} passed`,
        `v${params.v2}: ${suite2.passed}/${suite2.total} passed`,
        `Delta: ${deltaStr}`,
      ].join("\n");

      const output = {
        v1: { version: params.v1, ...suiteToJson(suite1) },
        v2: { version: params.v2, ...suiteToJson(suite2) },
        delta,
      };

      return {
        content: [{ type: "text", text }],
        structuredContent: output,
      };
    } catch (e: unknown) {
      return {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "mutagen_versions",
  {
    title: "List Mutagen Prompt Versions",
    description: `List all saved prompt versions in an engagement directory.

Args:
  - save_to (string): Engagement directory

Returns: List of version numbers and character counts.`,
    inputSchema: VersionsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const versions = listPromptVersions(params.save_to);
      if (versions.length === 0) {
        return { content: [{ type: "text", text: "No prompt versions found." }] };
      }

      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");

      const items = versions.map((v) => {
        const path = join(resolve(params.save_to), "prompts", `v${v}.txt`);
        const content = readFileSync(path, "utf-8");
        return { version: v, chars: content.length };
      });

      const text = items.map((i) => `v${i.version} — ${i.chars} chars`).join("\n");
      return {
        content: [{ type: "text", text: `Prompt versions:\n${text}` }],
        structuredContent: { versions: items },
      };
    } catch (e: unknown) {
      return {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "mutagen_init",
  {
    title: "Initialize Mutagen Engagement",
    description: `Scaffold a new mutagen-ai engagement directory with config, starter tests, and templates.

Creates: mutagen.yaml, prompt.txt, tests.yaml, engagement.md, failure_log.md, prompts/, results/

Args:
  - name (string): Engagement name (creates a directory with this name)
  - provider (string): LLM provider (default: openai)
  - model (string): Model name (default: gpt-4o)

Returns: Path to created directory and next steps.`,
    inputSchema: InitSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const { existsSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");

      const dir = resolve(params.name);
      if (existsSync(dir)) {
        return {
          content: [{ type: "text", text: `Error: directory '${params.name}' already exists` }],
          isError: true,
        };
      }

      ensureEngagementDir(dir);

      const apiKeyMap: Record<string, string> = {
        openai: "OPENAI_API_KEY",
        anthropic: "ANTHROPIC_API_KEY",
        gemini: "GEMINI_API_KEY",
        google: "GEMINI_API_KEY",
      };

      const configYaml = [
        "# Mutagen-AI Configuration",
        `provider: ${params.provider}`,
        `model: ${params.model}`,
        `api_key_env: ${apiKeyMap[params.provider] ?? "API_KEY"}`,
        "temperature: 0.7",
        "max_tokens: 4096",
        "prompt_file: prompt.txt",
        "test_cases: tests.yaml",
        "runs: 1",
      ].join("\n");

      writeFileSync(join(dir, "mutagen.yaml"), configYaml);
      writeFileSync(join(dir, "prompt.txt"), "# Paste your system prompt here\n\nYou are a helpful assistant.\n");
      writeFileSync(join(dir, "tests.yaml"), [
        "test_cases:",
        "",
        "  - id: basic_valid_response",
        '    description: "Simple input produces a valid response"',
        '    input: "Hello, how are you?"',
        "    checks:",
        "      - type: max_length",
        "        max_chars: 5000",
        "    tags: [basic]",
      ].join("\n"));
      writeFileSync(join(dir, "engagement.md"), [
        `# Prompt Evolution: ${params.name}`,
        "",
        `**Date started:** ${new Date().toISOString().split("T")[0]}`,
        `**Target model:** ${params.model}`,
        `**Provider:** ${params.provider}`,
        "",
        "---",
        "",
        "## Iteration Log",
        "",
        "[Mutations and results will be recorded here]",
      ].join("\n"));

      return {
        content: [{
          type: "text",
          text: [
            `Created engagement: ${params.name}/`,
            "",
            "Next steps:",
            "1. Paste your system prompt into prompt.txt",
            "2. Define test cases in tests.yaml",
            `3. Set API key: export ${apiKeyMap[params.provider] ?? "API_KEY"}=...`,
            `4. Run baseline: mutagen baseline --config ${params.name}/mutagen.yaml --save-to ${params.name}`,
          ].join("\n"),
        }],
        structuredContent: { directory: dir, provider: params.provider, model: params.model },
      };
    } catch (e: unknown) {
      return {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mutagen-ai MCP server running via stdio");
}

main().catch((err) => {
  console.error(`MCP server error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
