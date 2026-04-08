import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { loadTestCasesFromYaml, loadPrompt } from "./loader.js";

import { tmpdir } from "node:os";
const TMP = join(tmpdir(), "mutagen-ai-test-" + Date.now());

// Setup/teardown
function setup() {
  mkdirSync(TMP, { recursive: true });
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// loadTestCasesFromYaml
// ---------------------------------------------------------------------------

describe("loadTestCasesFromYaml", () => {
  it("loads test cases from YAML with test_cases key", () => {
    setup();
    try {
      const yamlContent = `test_cases:
  - id: basic_test
    description: "A basic test"
    input: "hello"
    checks:
      - type: json_parseable
    tags: [basic]
  - id: another_test
    description: "Another test"
    input: "world"
    checks:
      - type: contains
        substring: "test"
    tags: [content]
`;
      const path = join(TMP, "tests.yaml");
      writeFileSync(path, yamlContent);

      const cases = loadTestCasesFromYaml(path);
      assert.equal(cases.length, 2);
      assert.equal(cases[0].id, "basic_test");
      assert.equal(cases[0].description, "A basic test");
      assert.equal(cases[0].input, "hello");
      assert.equal(cases[0].checks.length, 1);
      assert.deepEqual(cases[0].tags, ["basic"]);
      assert.equal(cases[1].id, "another_test");
    } finally {
      teardown();
    }
  });

  it("loads flat YAML array (no test_cases wrapper)", () => {
    setup();
    try {
      const yamlContent = `- id: flat_test
  input: "test input"
  checks:
    - type: json_parseable
`;
      const path = join(TMP, "flat.yaml");
      writeFileSync(path, yamlContent);

      const cases = loadTestCasesFromYaml(path);
      assert.equal(cases.length, 1);
      assert.equal(cases[0].id, "flat_test");
    } finally {
      teardown();
    }
  });

  it("handles context field", () => {
    setup();
    try {
      const yamlContent = `test_cases:
  - id: stateful_test
    input: "add butter"
    context:
      existing_tasks:
        - title: "Buy milk"
    checks:
      - type: json_parseable
`;
      const path = join(TMP, "ctx.yaml");
      writeFileSync(path, yamlContent);

      const cases = loadTestCasesFromYaml(path);
      assert.equal(cases.length, 1);
      assert.deepEqual(cases[0].context, { existing_tasks: [{ title: "Buy milk" }] });
    } finally {
      teardown();
    }
  });

  it("throws for missing file", () => {
    assert.throws(() => loadTestCasesFromYaml("/nonexistent/path.yaml"), /not found/);
  });
});

// ---------------------------------------------------------------------------
// loadPrompt
// ---------------------------------------------------------------------------

describe("loadPrompt", () => {
  it("loads prompt text from file", () => {
    setup();
    try {
      const path = join(TMP, "prompt.txt");
      writeFileSync(path, "You are a helpful assistant.");

      const prompt = loadPrompt(path);
      assert.equal(prompt, "You are a helpful assistant.");
    } finally {
      teardown();
    }
  });

  it("throws for missing file", () => {
    assert.throws(() => loadPrompt("/nonexistent/prompt.txt"), /not found/);
  });
});
