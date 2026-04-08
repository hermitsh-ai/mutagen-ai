/**
 * Mutagen-AI — Persistence
 *
 * Save and load prompts, results, and engagement artifacts.
 * Auto-versions prompts as v1.txt, v2.txt, etc.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SuiteResult } from "./runner.js";

// ---------------------------------------------------------------------------
// Directory Setup
// ---------------------------------------------------------------------------

export function ensureEngagementDir(dir: string): void {
  const absDir = resolve(dir);
  mkdirSync(join(absDir, "prompts"), { recursive: true });
  mkdirSync(join(absDir, "results"), { recursive: true });

  // Create failure_log.md template if it doesn't exist
  const logPath = join(absDir, "failure_log.md");
  if (!existsSync(logPath)) {
    writeFileSync(logPath, `# Failure Log

Track failures and their resolutions here.

## Format
- **Date**: YYYY-MM-DD
- **Test ID**: test_id
- **Failure**: What failed
- **Root Cause**: Why it failed
- **Resolution**: What was changed
- **Prompt Version**: Which version fixed it

---
`);
  }
}

// ---------------------------------------------------------------------------
// Prompt Versioning
// ---------------------------------------------------------------------------

export function getNextVersion(dir: string): number {
  const promptsDir = join(resolve(dir), "prompts");
  if (!existsSync(promptsDir)) return 1;

  const files = readdirSync(promptsDir);
  const versions = files
    .filter((f) => /^v\d+\.txt$/.test(f))
    .map((f) => parseInt(f.slice(1, -4), 10))
    .filter((n) => !isNaN(n));

  return versions.length > 0 ? Math.max(...versions) + 1 : 1;
}

export function savePrompt(prompt: string, dir: string): string {
  ensureEngagementDir(dir);
  const version = getNextVersion(dir);
  const filePath = join(resolve(dir), "prompts", `v${version}.txt`);
  writeFileSync(filePath, prompt);
  return filePath;
}

export function loadPromptVersion(dir: string, version: number): string {
  const filePath = join(resolve(dir), "prompts", `v${version}.txt`);
  if (!existsSync(filePath)) {
    throw new Error(`Prompt version v${version} not found at ${filePath}`);
  }
  return readFileSync(filePath, "utf-8");
}

export function listPromptVersions(dir: string): number[] {
  const promptsDir = join(resolve(dir), "prompts");
  if (!existsSync(promptsDir)) return [];

  return readdirSync(promptsDir)
    .filter((f) => /^v\d+\.txt$/.test(f))
    .map((f) => parseInt(f.slice(1, -4), 10))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Results Persistence
// ---------------------------------------------------------------------------

export function saveResults(suite: SuiteResult, dir: string): string {
  ensureEngagementDir(dir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filePath = join(resolve(dir), "results", `run_${timestamp}.json`);
  writeFileSync(filePath, JSON.stringify(suite, null, 2));
  return filePath;
}
