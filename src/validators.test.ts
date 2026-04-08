import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import {
  validateJsonParseable,
  validateJsonFields,
  validateJsonFieldType,
  validateJsonFieldValue,
  validateJsonArrayLength,
  validateMaxNestingDepth,
  validateNoBannedWords,
  validateFieldWordCount,
  validateRegex,
  validateNoPattern,
  validateMaxLength,
  validateItemCount,
  validateContains,
  validateNotContains,
  validateNoDuplication,
  stripCodeFences,
  runCheck,
} from "./validators.js";

// ---------------------------------------------------------------------------
// stripCodeFences
// ---------------------------------------------------------------------------

describe("stripCodeFences", () => {
  it("passes plain text through", () => {
    assert.equal(stripCodeFences('{"a":1}'), '{"a":1}');
  });

  it("strips ```json fences", () => {
    assert.equal(stripCodeFences('```json\n{"a":1}\n```'), '{"a":1}');
  });

  it("strips bare ``` fences", () => {
    assert.equal(stripCodeFences('```\nhello\n```'), "hello");
  });

  it("handles trailing whitespace", () => {
    assert.equal(stripCodeFences('  ```json\n{"a":1}\n```  '), '{"a":1}');
  });
});

// ---------------------------------------------------------------------------
// validateJsonParseable
// ---------------------------------------------------------------------------

describe("validateJsonParseable", () => {
  it("passes for valid JSON object", () => {
    const [passed] = validateJsonParseable('{"key": "value"}');
    assert.equal(passed, true);
  });

  it("passes for valid JSON array", () => {
    const [passed] = validateJsonParseable('[1, 2, 3]');
    assert.equal(passed, true);
  });

  it("fails for invalid JSON", () => {
    const [passed, reason] = validateJsonParseable("not json at all");
    assert.equal(passed, false);
    assert.match(reason, /Invalid JSON/);
  });

  it("passes for JSON wrapped in code fences", () => {
    const [passed] = validateJsonParseable('```json\n{"ok": true}\n```');
    assert.equal(passed, true);
  });
});

// ---------------------------------------------------------------------------
// validateJsonFields
// ---------------------------------------------------------------------------

describe("validateJsonFields", () => {
  it("passes when all fields present", () => {
    const [passed] = validateJsonFields('{"name": "a", "age": 1}', ["name", "age"]);
    assert.equal(passed, true);
  });

  it("fails when field missing", () => {
    const [passed, reason] = validateJsonFields('{"name": "a"}', ["name", "age"]);
    assert.equal(passed, false);
    assert.match(reason, /Missing fields.*age/);
  });

  it("unwraps arrays and checks first element", () => {
    const [passed] = validateJsonFields('[{"title": "x"}]', ["title"]);
    assert.equal(passed, true);
  });
});

// ---------------------------------------------------------------------------
// validateJsonFieldType
// ---------------------------------------------------------------------------

describe("validateJsonFieldType", () => {
  it("passes for correct string type", () => {
    const [passed] = validateJsonFieldType('{"name": "hello"}', "name", "string");
    assert.equal(passed, true);
  });

  it("passes for correct array type", () => {
    const [passed] = validateJsonFieldType('{"items": [1,2]}', "items", "array");
    assert.equal(passed, true);
  });

  it("fails for wrong type", () => {
    const [passed] = validateJsonFieldType('{"name": 123}', "name", "string");
    assert.equal(passed, false);
  });

  it("fails for missing field", () => {
    const [passed] = validateJsonFieldType('{"other": 1}', "name", "string");
    assert.equal(passed, false);
  });
});

// ---------------------------------------------------------------------------
// validateJsonFieldValue
// ---------------------------------------------------------------------------

describe("validateJsonFieldValue", () => {
  it("passes when value is in allowed set", () => {
    const [passed] = validateJsonFieldValue('{"priority": "high"}', "priority", ["high", "medium", "low"]);
    assert.equal(passed, true);
  });

  it("fails when value not in allowed set", () => {
    const [passed] = validateJsonFieldValue('{"priority": "critical"}', "priority", ["high", "medium", "low"]);
    assert.equal(passed, false);
  });
});

// ---------------------------------------------------------------------------
// validateJsonArrayLength
// ---------------------------------------------------------------------------

describe("validateJsonArrayLength", () => {
  it("passes when length in range", () => {
    const [passed] = validateJsonArrayLength('{"items": [1,2,3]}', "items", 1, 5);
    assert.equal(passed, true);
  });

  it("fails when too few", () => {
    const [passed] = validateJsonArrayLength('{"items": []}', "items", 1, 5);
    assert.equal(passed, false);
  });

  it("fails when too many", () => {
    const [passed] = validateJsonArrayLength('{"items": [1,2,3,4,5,6]}', "items", 1, 5);
    assert.equal(passed, false);
  });

  it("works on top-level arrays", () => {
    const [passed] = validateJsonArrayLength('[1,2,3]', "items", 2, 4);
    assert.equal(passed, true);
  });
});

// ---------------------------------------------------------------------------
// validateMaxNestingDepth
// ---------------------------------------------------------------------------

describe("validateMaxNestingDepth", () => {
  it("passes for flat object", () => {
    const [passed] = validateMaxNestingDepth('{"a": 1, "b": 2}', 2);
    assert.equal(passed, true);
  });

  it("fails for deeply nested object", () => {
    const [passed] = validateMaxNestingDepth('{"a": {"b": {"c": {"d": 1}}}}', 2);
    assert.equal(passed, false);
  });

  it("counts array nesting", () => {
    const [passed] = validateMaxNestingDepth('[[[[1]]]]', 2);
    assert.equal(passed, false);
  });
});

// ---------------------------------------------------------------------------
// validateNoBannedWords
// ---------------------------------------------------------------------------

describe("validateNoBannedWords", () => {
  it("passes when no banned words found", () => {
    const [passed] = validateNoBannedWords("Buy milk and eggs", ["Organize", "Plan"]);
    assert.equal(passed, true);
  });

  it("fails when banned word found", () => {
    const [passed, reason] = validateNoBannedWords("Organize the kitchen", ["Organize", "Plan"]);
    assert.equal(passed, false);
    assert.match(reason, /Organize/);
  });

  it("checks specific JSON field when provided", () => {
    const [passed] = validateNoBannedWords(
      '{"title": "Plan the renovation", "notes": "some notes"}',
      ["Plan"],
      "title",
    );
    assert.equal(passed, false);
  });

  it("passes when banned word is only in other fields", () => {
    const [passed] = validateNoBannedWords(
      '{"title": "Buy milk", "notes": "Plan to get organic"}',
      ["Plan"],
      "title",
    );
    assert.equal(passed, true);
  });

  it("case-insensitive matching", () => {
    const [passed] = validateNoBannedWords("organize the kitchen", ["Organize"]);
    assert.equal(passed, false);
  });
});

// ---------------------------------------------------------------------------
// validateFieldWordCount
// ---------------------------------------------------------------------------

describe("validateFieldWordCount", () => {
  it("passes when word count in range", () => {
    const [passed] = validateFieldWordCount('{"title": "Buy milk from store"}', "title", 3, 8);
    assert.equal(passed, true);
  });

  it("fails when too few words", () => {
    const [passed] = validateFieldWordCount('{"title": "Milk"}', "title", 3, 8);
    assert.equal(passed, false);
  });

  it("fails when too many words", () => {
    const [passed] = validateFieldWordCount('{"title": "Go to the store and buy some milk for the family"}', "title", 1, 5);
    assert.equal(passed, false);
  });
});

// ---------------------------------------------------------------------------
// validateRegex / validateNoPattern
// ---------------------------------------------------------------------------

describe("validateRegex", () => {
  it("passes when pattern matches", () => {
    const [passed] = validateRegex("Error code: 404", "\\d{3}");
    assert.equal(passed, true);
  });

  it("fails when pattern doesn't match", () => {
    const [passed] = validateRegex("No numbers here", "\\d{3}");
    assert.equal(passed, false);
  });
});

describe("validateNoPattern", () => {
  it("passes when unwanted pattern absent", () => {
    const [passed] = validateNoPattern("Clean response", "ERROR");
    assert.equal(passed, true);
  });

  it("fails when unwanted pattern present", () => {
    const [passed] = validateNoPattern("ERROR: something broke", "ERROR");
    assert.equal(passed, false);
  });
});

// ---------------------------------------------------------------------------
// validateMaxLength / validateItemCount / contains / notContains
// ---------------------------------------------------------------------------

describe("validateMaxLength", () => {
  it("passes under limit", () => {
    const [passed] = validateMaxLength("short", 100);
    assert.equal(passed, true);
  });

  it("fails over limit", () => {
    const [passed] = validateMaxLength("a".repeat(200), 100);
    assert.equal(passed, false);
  });
});

describe("validateItemCount", () => {
  it("passes for array in range", () => {
    const [passed] = validateItemCount('[1, 2, 3]', 1, 5);
    assert.equal(passed, true);
  });

  it("treats non-array as count 1", () => {
    const [passed] = validateItemCount('{"single": true}', 1, 1);
    assert.equal(passed, true);
  });

  it("fails when too many items", () => {
    const [passed] = validateItemCount('[1,2,3,4,5]', 1, 3);
    assert.equal(passed, false);
  });
});

describe("validateContains", () => {
  it("passes when substring found", () => {
    const [passed] = validateContains("hello world", "world");
    assert.equal(passed, true);
  });

  it("fails when substring missing", () => {
    const [passed] = validateContains("hello world", "xyz");
    assert.equal(passed, false);
  });
});

describe("validateNotContains", () => {
  it("passes when substring absent", () => {
    const [passed] = validateNotContains("hello world", "HACKED");
    assert.equal(passed, true);
  });

  it("fails when substring present", () => {
    const [passed] = validateNotContains("HACKED", "HACKED");
    assert.equal(passed, false);
  });
});

// ---------------------------------------------------------------------------
// validateNoDuplication
// ---------------------------------------------------------------------------

describe("validateNoDuplication", () => {
  it("passes when no duplication", () => {
    const [passed] = validateNoDuplication(
      '{"notes": "Remember to call", "children": [{"title": "Buy milk"}]}',
      "notes",
      "children",
    );
    assert.equal(passed, true);
  });

  it("fails when child title appears in notes", () => {
    const [passed] = validateNoDuplication(
      '{"notes": "Buy milk from the store", "children": [{"title": "Buy milk"}]}',
      "notes",
      "children",
    );
    assert.equal(passed, false);
  });
});

// ---------------------------------------------------------------------------
// runCheck — YAML check type routing
// ---------------------------------------------------------------------------

describe("runCheck", () => {
  it("routes json_parseable", () => {
    const [passed] = runCheck('{"a":1}', { type: "json_parseable" });
    assert.equal(passed, true);
  });

  it("routes contains", () => {
    const [passed] = runCheck("hello world", { type: "contains", substring: "world" });
    assert.equal(passed, true);
  });

  it("routes not_contains", () => {
    const [passed] = runCheck("clean", { type: "not_contains", substring: "HACKED" });
    assert.equal(passed, true);
  });

  it("routes no_banned_words with field", () => {
    const [passed] = runCheck(
      '{"title": "Organize kitchen"}',
      { type: "no_banned_words", words: ["Organize"], field: "title" },
    );
    assert.equal(passed, false);
  });

  it("routes max_nesting_depth", () => {
    const [passed] = runCheck('{"a":{"b":{"c":1}}}', { type: "max_nesting_depth", max_depth: 2 });
    assert.equal(passed, false);
  });

  it("returns error for unknown check type", () => {
    const [passed, reason] = runCheck("test", { type: "nonexistent" });
    assert.equal(passed, false);
    assert.match(reason, /Unknown check type/);
  });
});
