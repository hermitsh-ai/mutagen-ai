/**
 * Mutagen-AI — Test Case & Config Loader
 *
 * Loads test cases from YAML files and engagement configs.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import YAML from "yaml";
import type { TestCase } from "./runner.js";
import type { Check } from "./validators.js";
import type { ProviderConfig } from "./providers.js";

// ---------------------------------------------------------------------------
// YAML Test Case Loader
// ---------------------------------------------------------------------------

interface YamlTestCase {
  id: string;
  description?: string;
  input: string | { text: string; images?: string[] };
  checks?: Check[];
  tags?: string[];
  context?: Record<string, unknown>;
}

interface YamlTestFile {
  test_cases?: YamlTestCase[];
}

export function loadTestCasesFromYaml(yamlPath: string): TestCase[] {
  const absPath = resolve(yamlPath);
  if (!existsSync(absPath)) {
    throw new Error(`YAML file not found: ${absPath}`);
  }

  const raw = readFileSync(absPath, "utf-8");
  const parsed = YAML.parse(raw) as YamlTestFile | YamlTestCase[];

  let cases: YamlTestCase[];
  if (Array.isArray(parsed)) {
    cases = parsed;
  } else if (parsed && "test_cases" in parsed && Array.isArray(parsed.test_cases)) {
    cases = parsed.test_cases;
  } else {
    throw new Error(`YAML data is not a list and has no 'test_cases' key`);
  }

  return cases.map((tc) => ({
    id: tc.id,
    description: tc.description ?? tc.id,
    input: tc.input as string | { text: string; images?: string[] },
    checks: tc.checks ?? [],
    tags: tc.tags ?? [],
    context: tc.context,
  }));
}

// ---------------------------------------------------------------------------
// Engagement Config Loader
// ---------------------------------------------------------------------------

interface MutagenConfig {
  provider: string;
  model: string;
  api_key_env: string;
  temperature?: number;
  max_tokens?: number;
  endpoint?: string;
  prompt_file?: string;
  test_cases?: string;
  runs?: number;
}

export function loadConfig(configPath: string): {
  provider: ProviderConfig;
  promptFile?: string;
  testCasesFile?: string;
  runs?: number;
} {
  const absPath = resolve(configPath);
  if (!existsSync(absPath)) {
    throw new Error(`Config file not found: ${absPath}`);
  }

  const raw = readFileSync(absPath, "utf-8");
  const config = YAML.parse(raw) as MutagenConfig;

  const baseDir = dirname(absPath);

  return {
    provider: {
      provider: config.provider,
      model: config.model,
      apiKeyEnv: config.api_key_env,
      temperature: config.temperature,
      maxTokens: config.max_tokens,
      endpoint: config.endpoint,
    },
    promptFile: config.prompt_file ? resolve(baseDir, config.prompt_file) : undefined,
    testCasesFile: config.test_cases ? resolve(baseDir, config.test_cases) : undefined,
    runs: config.runs,
  };
}

// ---------------------------------------------------------------------------
// Prompt Loader
// ---------------------------------------------------------------------------

export function loadPrompt(promptPath: string): string {
  const absPath = resolve(promptPath);
  if (!existsSync(absPath)) {
    throw new Error(`Prompt file not found: ${absPath}`);
  }
  return readFileSync(absPath, "utf-8");
}
