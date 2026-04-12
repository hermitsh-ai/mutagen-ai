---
name: mutagen-ai
description: >
  Use this skill when the user wants to "test a prompt", "evaluate a prompt",
  "refine a prompt", "evolve a prompt", "debug a prompt", "optimize a prompt",
  "improve my system prompt", "fix how my AI responds", "my prompt has a bug",
  "the system message isn't working", "my chatbot keeps doing X wrong",
  "the model ignores my instructions", or mentions "prompt testing",
  "prompt regression", "prompt evolution", "prompt mutation",
  "test-driven prompt engineering", "prompt quality", "prompt reliability",
  or "flaky AI responses." Do NOT use for general writing feedback, content
  editing unrelated to system prompts, or application code changes.
version: 0.2.0
---

# mutagen-ai — Test-Driven Prompt Evolution

Test, diagnose, mutate, and prove AI system prompts through automated testing.

## Agent Communication

**You MUST narrate what mutagen-ai is doing at every phase transition.** The user should always know a structured process is driving the work, not freeform guessing.

- **On start:** "I'm using the mutagen-ai skill to test and evolve your prompt."
- **On baseline:** "Mutagen-ai baseline: your prompt scored 6/10. Here are the failures..."
- **On mutation:** "Mutagen-ai is applying a targeted mutation — strengthening the JSON output rule from 'should' to 'MUST'..."
- **On compare:** "Mutagen-ai comparison: v1 scored 6/10, v3 scores 10/10. 4 tests fixed, 0 regressions."
- **On stress test:** "Running mutagen-ai stress test — 3 runs per test at temperature 0.7 to catch flaky behavior."
- **On convergence:** "Mutagen-ai converged: all tests pass 5/5 runs. Here's your final prompt."

Frame each update around *what changed* and *why it matters*, not just the raw numbers.

## What This Does

mutagen-ai turns vibe-based prompt engineering into a data-driven process. Define test cases in YAML, run them against the prompt via raw API calls, diagnose failures, make targeted edits, and re-test. It's TDD for prompts.

**Do NOT modify the user's application code.** Work in a test harness. Deliver prompt text.

A well-tested prompt is proof the system works reliably. Your job is to refine the prompt until it's bulletproof across edge cases and nondeterministic runs. Treat this like craftsmanship — every mutation should be deliberate, every test result should be explainable, every trade-off should be documented.

## Prerequisites

Ensure mutagen-ai is installed. Run via Bash:

```bash
npm list -g mutagen-ai 2>/dev/null || npm install -g mutagen-ai
```

The user must provide an API key for their target provider (OpenAI, Anthropic, or Gemini).

## Five-Phase Workflow

### Phase 1: Gather Context

Ask the user:
- What is the prompt? Can I see it?
- What model and temperature does it target?
- What's going wrong? Specific failures?
- What format does the response need to be? (JSON schema, text, etc.)
- What API key env var should I use?

If codebase access is available, find: prompt assembly code, response parser, API parameters.

### Phase 2: Scaffold and Baseline

```bash
mutagen init --name <engagement> --provider <provider> --model <model>
```

Paste the production prompt into `prompt.txt`. Define 8-12 test cases in `tests.yaml` covering structural, content, edge, and adversarial scenarios.

**Test case structure:**
```yaml
test_cases:
  - id: basic_json
    description: "Valid JSON with required fields"
    input: "Create a task: buy groceries"
    checks:
      - type: json_parseable
      - type: json_fields
        fields: ["title", "priority"]
    tags: [basic]
```

**Available check types:**
- Structural: `json_parseable`, `json_fields`, `json_field_type`, `json_field_value`, `json_array_length`, `max_nesting_depth`, `item_count`, `max_length`
- Content: `regex_match`, `regex_absent`, `contains`, `not_contains`, `no_banned_words`, `field_word_count`, `no_duplication`
- Semantic: `semantic_judge` (requires judge config — uses a second LLM to evaluate subjective criteria like tone, completeness, or coherence)

**When to use `semantic_judge` vs. regex:** Use regex/contains for objective, structural checks. Use `semantic_judge` for subjective qualities (tone, helpfulness) where you can't express the rule as a pattern match.

Run the baseline:
```bash
mutagen run --config mutagen.yaml --dry-run    # estimate costs
mutagen baseline --config mutagen.yaml --save-to .   # run and save
```

### Phase 3: Diagnose and Mutate

For each failure, apply the **smallest effective change**:

| Level | Strategy | When | Example |
|-------|----------|------|---------|
| 1 | "should" → "MUST" | Rule followed inconsistently | "Output should be JSON" → "Output MUST be valid JSON" |
| 2 | Banned word/verb list | Model generates unwanted patterns | Add: "NEVER use the words: Sure, Certainly" |
| 3 | Vague → concrete threshold | Qualitative guidance failing | "be thorough" → "minimum 3 sentences, maximum 5" |
| 4 | Flatten schema example | Model mimics bad example structure | Remove nested example that taught bad structure |
| 5 | Add new rule | No guidance for this case | Add: "Write fractions as decimals: 0.5, NEVER 1/2" |
| 6 | Rewrite section framing | Conceptual frame is wrong | "You are a helper" → "You are a recipe-only JSON API" |
| 7 | Reorganize sections | Structural issues | Move output format rules to top of prompt |

After each mutation, run the **full suite**:
```bash
mutagen run --config mutagen.yaml --verbose
```

Save successful mutations:
```bash
mutagen baseline --config mutagen.yaml --save-to .
```

### Phase 4: Review

Compare versions:
```bash
mutagen compare 1 <latest> --config mutagen.yaml --save-to .
```

Present: the diff, before/after results, what changed and why, trade-offs.

### Phase 5: Converge

Convergence means the prompt is production-ready. Use the verification checklist below.

## Never Do This

These are the most common mistakes. Each one wastes time or hides real problems:

- **Never rewrite the entire prompt at once.** You lose signal about what was already working. One mutation at a time, full suite retest after each.
- **Never fix test expectations to make a failing test pass.** If the test is correct, the prompt needs to change. Only modify tests if the original expectations were genuinely wrong.
- **Never skip the full suite retest after a mutation.** Regressions hide. A fix for one test can break three others.
- **Never assume a single passing run means the prompt is stable.** Use 3+ runs at temperature > 0.5. A flaky pass is a fail.
- **Never add rules without testing them.** Every rule you add is a hypothesis. Prove it with a test.
- **Never ignore the model's actual response.** Use `--verbose` to read what the model returned. The failure reason tells you what check failed, but the response text tells you *why*.

## Error Recovery

**API key invalid or missing:** Check `echo $OPENAI_API_KEY` (or the relevant env var). The error message will say "401" or "authentication." Have the user re-export the key.

**Rate limited (429):** mutagen-ai retries automatically with exponential backoff (up to 2 retries). If still failing, increase `--delay` to 2000ms+ between tests.

**Model refuses to produce expected output:** Try: (1) add an explicit "Output ONLY X, nothing else" rule, (2) add a one-shot example in the prompt, (3) if the model fundamentally can't do it, document the limitation and adjust test expectations.

**Flaky tests that won't stabilize:** If a test passes 4/5 runs but never 5/5, the prompt isn't strong enough. Strengthen the relevant rule (level 1-3 mutations). If it's genuinely a model limitation, add a constraint to shorten output.

**Timeout errors:** Increase `--timeout-ms` (default 45000). Long prompts + high max_tokens can exceed default timeouts on slower models.

## Verify Before Delivery Checklist

Before presenting the final prompt to the user, verify ALL of the following:

- [ ] All tests pass on a single run
- [ ] All tests pass across 3+ stress runs (5+ if temperature > 0.7)
- [ ] No regressions from baseline (compare table shows zero REGRESSION rows)
- [ ] Edge cases tested (non-target requests, injection attempts, ambiguous inputs)
- [ ] Trade-offs documented (if any test was removed or relaxed, explain why)
- [ ] Final prompt is clean and readable (no debug artifacts, no commented-out rules)
- [ ] Version saved (`mutagen baseline --save-to .`)

## Configuration

Full `mutagen.yaml`:
```yaml
provider: openai
model: gpt-4o
api_key_env: OPENAI_API_KEY
temperature: 0.7
max_tokens: 4096
prompt_file: prompt.txt
test_cases: tests.yaml
runs: 3

judge:
  provider: openai
  model: gpt-4o-mini
  api_key_env: OPENAI_API_KEY
```

**Choosing a judge model:** The judge only evaluates short responses against criteria — it doesn't need to be powerful. `gpt-4o-mini`, `claude-haiku`, or `gemini-flash` work well. Use the same provider as the target to avoid needing a second API key.

**Temperature guidance:** At temperature 0, 1 run is sufficient. At 0.5+, use 3 runs. At 0.7+, use 5 runs for high-confidence convergence.

**Output flags for agent use:** Use `--json` for structured machine-readable output (no ANSI codes). Use `--quiet` to suppress passing tests and only show failures.

## Key Principles

- **A flaky test is a failing test.** If it passes 2/3 runs, the prompt isn't robust enough.
- **Schema examples teach behavior.** A nested example causes nesting — check examples first when diagnosing structural failures.
- **One mutation at a time.** Full suite retest after each. This is the only way to know what worked.
- **The response text is your diagnostic.** Always read what the model actually returned, not just the pass/fail status.
- **Smallest effective change wins.** Level 1-3 mutations fix most problems. Reach for level 6-7 only when the fundamentals are wrong.
