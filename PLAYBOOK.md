# Prompt Evolution Playbook

This is your operational guide. When a user says "I've got a prompt to refine" (or similar), follow this playbook. It tells you what to do at each phase, what questions to ask, and how to structure your work.

Read `docs/prompt-structures.md` before starting if you haven't already. Refer to `docs/case-studies/` for concrete examples of the methodology in action.

---

## Quick Reference

```bash
mutagen init --name my-app --provider openai --model gpt-4o
mutagen run --config mutagen.yaml
mutagen run --config mutagen.yaml --runs 3 --verbose
mutagen run --config mutagen.yaml --json          # structured JSON output for agents/CI
mutagen run --config mutagen.yaml --quiet          # only show failures
mutagen baseline --config mutagen.yaml --save-to .
mutagen compare 1 2 --config mutagen.yaml --save-to .
mutagen versions --save-to .
```

---

## Before You Start: Mental Model

You are running a test-driven optimization loop. The prompt is the code. The test harness is the compiler. The user is the product owner. Your job is to:

1. Understand what the prompt is supposed to do
2. Build tests that verify it does that
3. Find where it fails
4. Fix it with minimal, targeted edits
5. Prove the fixes work without regressions

**The conceptual frame:** You are the optimizer — do the optimization, output only results. The user should never need to explain this methodology to you. You read this playbook, you understand the process, you execute it. Ask questions about *their prompt and their app*, not about *how prompt evolution works*.

**You do NOT modify the user's application code.** You work entirely in a test harness. You deliver prompt text that the user copies into their app.

---

## Phase 1: Context Gathering

### Questions to Ask the User

Start by understanding the landscape. Ask these questions (adapt to context — don't interrogate):

**About the prompt:**
- Can I see the prompt? (If they haven't shared it yet)
- How is it structured? Single block, multiple sections, templated?
- Which model does it target? What API parameters (temperature, max tokens)?
- Is the prompt the entire system message, or does the app add anything around it?

**About the application:**
- What does the app do with the AI's response? (Parse JSON? Display text? Feed into another system?)
- Can I read the relevant source code to understand how the response is consumed?
- Are there format requirements? (JSON schema, max length, specific field names)
- What does the user see? (UI constraints, mobile vs desktop, rendering limitations)

**About the problems:**
- What's going wrong? What specific failures have you noticed?
- Can you give me an example input where it fails?
- Are there cases where it works well? What do those look like?
- Is this a new prompt or an existing one that regressed?

**About the setup:**
- I'll need to make raw API calls to test the prompt. Can you provide an API key for [target provider]?
- What environment variable should I use for the key? (Convention: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)

### What to Do With the Codebase

If the user gives you access to their codebase:

1. **Find the prompt assembly code.** How does the app build the system message? Is it a single string, concatenated sections, a template? Understand exactly what gets sent to the API.

2. **Find the response parser.** How does the app consume the AI's output? JSON.parse? Regex extraction? Direct display? This tells you what format constraints are hard requirements.

3. **Find the API call.** What model, what temperature, what parameters? You need to replicate this exactly in your test configuration.

4. **Find the UI/consumer.** What does the end user see? This helps you write content-quality validators, not just structural ones.

### Setting Up the Engagement Directory

Scaffold the engagement with the CLI:

```bash
mutagen init --name my-app --provider openai --model gpt-4o
```

This creates:
```
my-app/
  mutagen.yaml       — configuration (provider, model, paths)
  prompt.txt         — paste the production prompt here
  tests.yaml         — define test cases here
  engagement.md      — iteration tracking
  failure_log.md     — failure pattern log
  prompts/           — auto-versioned prompts (v1.txt, v2.txt, ...)
  results/           — saved test results (JSON)
```

Then:
1. Paste the full production prompt into `prompt.txt`
2. Set the API key: `export OPENAI_API_KEY=sk-...`
3. Edit `mutagen.yaml` to match production parameters (temperature, max_tokens)

### Phase 1 Outputs

Before moving to Phase 2, you should have:
- [ ] Scaffolded engagement directory with `mutagen init`
- [ ] Pasted the full prompt text into `prompt.txt`
- [ ] Configured `mutagen.yaml` with the target model and API parameters
- [ ] Set the API key as an environment variable
- [ ] Collected known failure modes from the user
- [ ] Understood the response format requirements
- [ ] Understood how the app consumes responses

---

## Phase 2: Baseline Testing

### Step 1: Define Test Cases

Define tests declaratively in `tests.yaml`. Start with 8-12 test cases covering these categories:

| Category | Starting Count | Purpose |
|----------|---------------|---------|
| Basic / happy path | 3-4 | Typical inputs that should work well |
| Edge cases | 2-3 | Boundary conditions, unusual inputs |
| Rule-specific | 1 per known failure | Directly test reported problems |
| Adversarial | 1-2 | Injection attempts, format breakers |

**YAML test structure:**

```yaml
test_cases:
  - id: basic_json_output
    description: "Response is valid JSON with required fields"
    input: "Create a task: buy groceries"
    checks:
      - type: json_parseable
      - type: json_fields
        fields: ["title", "priority"]
      - type: json_field_value
        field: priority
        allowed: ["high", "medium", "low"]
    tags: [basic, json]

  - id: no_meta_tasks
    description: "No planning/organizing meta-tasks"
    input: "I need to prepare for my trip next week"
    checks:
      - type: json_parseable
      - type: no_banned_words
        words: ["Organize", "Plan", "Review", "Evaluate"]
        field: title
    tags: [content, rules]
```

For apps with dynamic user prompts that include app state, use the `context` field:

```yaml
  - id: task_with_existing_data
    description: "Adding task to populated list"
    input: "Also need to call marketing"
    context:
      existing_tasks:
        - id: 1
          title: "Review proposal"
          status: "pending"
    checks:
      - type: json_parseable
      - type: item_count
        min_items: 1
    tags: [stateful]
```

For subjective quality criteria, use the semantic judge:

```yaml
  - id: tone_check
    description: "Response is professional and concise"
    input: "Summarize the Q3 results"
    checks:
      - type: semantic_judge
        criteria: "Response should be professional in tone, concise, and free of casual language"
        pass_threshold: 0.7
    tags: [quality]
```

**Available check types:**

- **Structural:** `json_parseable`, `json_fields`, `json_field_type`, `json_field_value`, `json_array_length`, `max_nesting_depth`, `item_count`, `max_length`
- **Content:** `regex_match`, `regex_absent`, `contains`, `not_contains`, `no_banned_words`, `field_word_count`, `no_duplication`, `semantic_judge`

### Step 2: Configure the Semantic Judge (Optional)

If your test suite uses `semantic_judge` checks, add a judge section to `mutagen.yaml`:

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

The judge is a second LLM that evaluates the main model's output against your criteria. Use a cheaper/faster model for the judge — it only needs to score, not generate.

### Step 3: Estimate Costs

Before running, preview the API call count:

```bash
mutagen run --config mutagen.yaml --dry-run
```

### Step 4: Run the Baseline

Run the full test suite against the **unmodified** prompt and save as baseline:

```bash
mutagen baseline --config mutagen.yaml --save-to .
```

This does three things:
1. Saves the prompt as `prompts/v1.txt`
2. Runs all tests
3. Saves results to `results/`

This is your reference point. Every future change is measured against this baseline.

**Handling nondeterminism:** At temperature > 0, the same input can produce different outputs. Set `runs: 3` (or higher) in `mutagen.yaml` for temperatures above 0.5. A test must pass **all runs** to be considered passing. A flaky test is a failing test.

### Phase 2 Outputs

- [ ] 8-12 test cases defined in `tests.yaml`
- [ ] Context fields set up for stateful inputs (if applicable)
- [ ] Semantic judge configured (if using `semantic_judge` checks)
- [ ] API costs estimated via `--dry-run`
- [ ] Baseline results saved (multi-run if temperature > 0.5)
- [ ] List of failures to investigate, grouped by pattern

---

## Phase 3: Mutation & Iteration

### A/B Testing Specific Versions

To compare two prompt versions side-by-side:

```bash
mutagen compare 1 3 --config mutagen.yaml --save-to .
```

This runs the full suite against both versions and shows a comparison table with FIXED / REGRESSION / STILL FAILING labels.

To list all saved versions:

```bash
mutagen versions --save-to .
```

### The Diagnosis → Mutate → Test Loop

For each failure pattern:

**1. Diagnose.** Run the failing test with `--verbose` to see the actual response:

```bash
mutagen run --config mutagen.yaml --test failing_test_id --verbose
```

Read the response carefully. Compare it to what was expected. Ask:

- Which specific words or section of the prompt caused this behavior?
- Is the problem what the prompt says, or what it *doesn't* say?
- Is there a cross-section conflict (two parts of the prompt contradicting each other)?
- Is a schema example teaching the wrong pattern?

Log the pattern in `failure_log.md` with the actual response excerpts.

**2. Mutate.** Make a targeted edit to `prompt.txt`. One mutation per failure pattern. See the Mutation Strategy Guide below for detailed tactics.

**3. Test.** Run the **full suite** after every mutation. Not just the test you were targeting — the full suite. Regressions must be caught immediately.

```bash
mutagen run --config mutagen.yaml --verbose
```

**4. Save.** When a mutation improves things, save it as a new version:

```bash
mutagen baseline --config mutagen.yaml --save-to .
```

This auto-increments the version (v2.txt, v3.txt, etc.) and saves the results.

### Mutation Strategy Guide

These strategies are ordered from smallest/safest to largest/riskiest. Always try the smallest effective change first.

#### Level 1: Word-Level Strengthening
Change hedge words to absolutes.

| Weak | Strong |
|------|--------|
| "should" | "MUST" |
| "consider" | "ALWAYS" |
| "try to" | (delete — just state the rule) |
| "you can" | "you WILL" |
| "prefer" | "ONLY use" |
| "avoid" | "NEVER" |

This is your first move for any rule that's being inconsistently followed. If a rule uses "should" and the model ignores it 30% of the time, change to "MUST" and retest.

#### Level 2: Negative Examples and Banned Lists
When a model does something unwanted, tell it explicitly not to do that thing. Soft guidance ("avoid meta-planning") is weaker than a hard ban list.

**Pattern — Banned verb list:** If the model generates meta-tasks like "Organize kitchen supplies" or "Plan bathroom renovation," don't just say "avoid planning language." Give it a concrete list:

```
NEVER use these verbs in task titles: Organize, Plan, Review, Evaluate,
Assess, Consider, Research, Explore, Investigate, Analyze, Prepare,
Develop, Create plan for, Set up system for
```

This was the single most effective mutation type in the SHrimp engagement. Banned verbs eliminated meta-task generation where softer instructions had failed across multiple iterations.

**Pattern — Explicit "do NOT" pairs:** For every "do X," consider whether you also need "do NOT do Y."

```
DO: Create one task per concrete action mentioned
DO NOT: Create umbrella tasks that group multiple actions
DO NOT: Create tasks about creating tasks
```

#### Level 3: Concrete Thresholds Replace Qualitative Descriptions
Replace subjective language with numbers and enums.

| Vague | Concrete |
|-------|----------|
| "be thorough" | "address every symptom mentioned; minimum 2 sentences per recommendation" |
| "dangerous levels" | "> 0.25ppm ammonia = high urgency" |
| "keep titles short" | "titles MUST be 3-8 words" |
| "appropriate category" | "one of: [exhaustive enum]" |
| "some detail" | "between 50-150 words" |

#### Level 4: Schema Examples as Teachers
**This is a critical insight.** Schema examples don't just show format — they teach behavior. A 3-level nested example will cause 3-level nesting even if your rules say "prefer flat structures." The model mimics what it sees.

**Diagnosis:** If the model produces a structure you don't want, check your schema example first. It may be demonstrating exactly the behavior you're trying to prevent.

**Fix:** Flatten or simplify your schema example to demonstrate the *desired* behavior, not just the *possible* structure. If you show a flat example, the model defaults to flat. If you show a deep example, the model defaults to deep.

From the SHrimp engagement: The original schema had a 3-level nested example (parent > child > grandchild). This caused the model to over-nest every input, even simple ones. Flattening the example to show a 1-level structure fixed over-nesting across all test cases.

#### Level 5: Rule Additions for Uncovered Cases
When the prompt is missing guidance entirely for a failure pattern, add a new rule. Be precise about the trigger condition and the required behavior.

**Pattern — Reference data rules:** When the input contains reference material (lists, specs, documentation) rather than action items:

```
Rule: When the input contains reference data, informational content, or passive
lists (e.g., product specs, ingredient lists, inventory), create a SINGLE task
titled with the subject of that data. Place the reference content in the notes
field verbatim. Do NOT decompose reference data into subtasks.
```

**Pattern — Message independence rules:** When the system receives messages from multiple senders or at different times:

```
Rule: Each input message is independent. Do NOT merge, combine, or group items
from different messages into a single task. Do NOT create summary tasks that
span multiple messages.
```

**Pattern — Anti-duplication rules:** When content appears both in notes and as child tasks:

```
Rule: Information MUST appear in exactly one place. If details are in the notes
field, they MUST NOT also appear as subtasks. If items are subtasks, they MUST
NOT be duplicated in the notes.
```

#### Level 6: Section Rewrites
When multiple word-level fixes haven't worked, rewrite the entire section. This is heavier but sometimes necessary when the section's overall framing is wrong.

The key question before a rewrite: **What is the conceptual frame this section establishes?** If the Thoroughness section's frame is "be helpful and thorough," the model interprets that as "add more stuff." If the frame is "extract exactly what is stated, add nothing," the model stays grounded.

**The "you are the planner" breakthrough:** In the SHrimp engagement, the conceptual breakthrough was reframing the prompt from "help the user plan" to "you are the planner — do the planning, output only actionable results." This single conceptual shift eliminated meta-tasks, planning suggestions, and organizational overhead from the output because the model stopped delegating planning back to the user.

#### Level 7: Structural Changes
Reorganize the prompt architecture (section order, section boundaries, moving content between sections). This requires user discussion — present it as an option with trade-offs.

### When Mutations Cause Regressions

This happens. A fix for one case can break another because:
- The model rebalances attention when you add or strengthen a rule
- Two rules conflict and the model picks one based on position
- A more specific instruction overrides a more general one

When you hit a regression:
1. Revert the mutation (you saved versions, so roll back to the previous `prompts/v{N}.txt`)
2. Understand *why* it caused the regression
3. Try an alternative approach that fixes the target without triggering the conflict
4. If no single mutation works, you may need to fix both issues in a single coordinated mutation

### Knowing When to Expand the Test Suite

Add new tests when:
- A mutation passes existing tests but you suspect it might cause problems in untested areas
- The user mentions a new failure mode during review
- You discover a failure pattern that no existing test covers
- Your test suite doesn't cover a whole category of input (e.g., you have no multi-image tests)

The SHrimp engagement went from 10 to 30 tests by adding a dedicated "nesting suite" after discovering that nesting behavior was its own category of failures orthogonal to the core behavior tests.

### When to Stop Iterating

Move to Phase 4 (Human Review) when:
- All test cases pass across multiple runs
- OR you've hit a plateau where further mutations aren't improving things
- OR you've found issues that need human judgment (subjective quality, domain expertise)

Don't iterate forever. If you're on iteration 5+ without meaningful progress, present what you have and get user feedback. The user may have context that reframes the problem.

---

## Phase 4: Human Review

### What to Present

1. **The refined prompt text.** If the prompt is sectioned, present each section. If it's monolithic, present the whole thing. Either way, include a diff from the original.

2. **Test results.** Show the comparison between baseline and current:

```bash
mutagen compare 1 <latest> --config mutagen.yaml --save-to .
```

3. **What changed and why.** For each mutation, one sentence on what was changed and one on why. Don't over-explain — the user can ask for details.

4. **Trade-offs.** If you made judgment calls, say so. The user may disagree.

5. **Open questions.** If there are cases where you weren't sure what "good" looks like, ask.

6. **The engagement template.** Show the user `engagement.md` — it serves as the full audit trail.

### Incorporating Feedback

The user's feedback will typically be:
- "This looks good, ship it" → Move to Phase 5 / Convergence
- "This case still isn't right" → Add or refine a test case, return to Phase 3
- "I don't like the tone / style / approach" → Content quality issue. Consider adding `semantic_judge` checks with criteria that encode the desired tone.
- "This works but I also want it to handle X" → Scope expansion. Add new test cases and iterate.

---

## Phase 5: Convergence

The prompt is done when:
1. All test cases pass across multiple runs (not just once)
2. The user approves the output quality
3. There are no known regressions from the baseline

### Final Delivery

Present the **complete final prompt text** to the user. They will copy it into their application. We do not modify application source code.

If the prompt is sectioned, present each section separately with clear labels so the user knows which section goes where.

Include:
- **The final prompt text** (complete, ready to copy) — located in `prompts/v{N}.txt`
- A summary of all changes from the original
- **The test suite** (portable YAML tests) so the user can re-run if they make future edits
- **The failure log** so future sessions can understand what was tried
- **The engagement template** (`engagement.md` as a complete record of decisions and iterations)

---

## Failure Pattern Taxonomy

These are the most common failure patterns you'll encounter, organized by category. For each pattern, the table shows the diagnostic signal (what you observe), the typical root cause, and the recommended mutation strategy.

### Structural Failures

| Pattern | Signal | Root Cause | Fix |
|---------|--------|-----------|-----|
| Over-nesting | Output has deeper hierarchy than schema allows | Schema example shows deep nesting | Flatten schema example (Level 4) |
| Missing fields | Required JSON fields absent | Model doesn't see the field as required | Add to schema with "REQUIRED" annotation |
| Wrong types | String where array expected, etc. | Schema example shows wrong type | Fix schema example; add type constraint |
| Extra wrapping | JSON wrapped in ```json fences | Model defaults to markdown formatting | Add "Do NOT wrap in code fences" |
| Invented structure | Fields/keys not in the schema | Schema interpreted as example, not constraint | Add "ONLY these fields are allowed" |

### Content Failures

| Pattern | Signal | Root Cause | Fix |
|---------|--------|-----------|-----|
| Meta-tasks | Output includes planning/organizing tasks instead of concrete actions | Prompt framing encourages delegation | Banned verb list (Level 2); "you are the planner" reframe (Level 6) |
| Over-action on passive content | Reference data decomposed into subtasks | No rule distinguishing reference data from action items | Add reference data rule (Level 5) |
| Lists become subtasks | Every list item turned into a separate task | Model interprets all lists as action lists | Add "lists in reference data stay as notes" rule |
| Vague titles | Titles like "Handle the situation" | No specificity constraint on titles | Add word count range + "use nouns from the input" |
| Auto-merging | Unrelated inputs combined into one output | No message independence rule | Add independence rule (Level 5) |
| AI-generated summaries | Notes contain AI interpretation instead of user content | No grounding constraint on notes | Add "notes contain user's words, not AI summaries" |
| Hallucinated detail | Response includes facts not in the input | No grounding constraint | Add "ONLY reference information from the input" |
| Shallow analysis | Surface-level response to complex input | "Be thorough" without concrete depth requirements | Replace with specific depth requirements (Level 3) |

### Rule Adherence Failures

| Pattern | Signal | Root Cause | Fix |
|---------|--------|-----------|-----|
| Inconsistent rule following | Rule works sometimes, not others | Hedge words ("should", "consider") | Strengthen to absolutes (Level 1) |
| Rule ignored entirely | Rule never followed | Rule buried in middle of long section | Move to beginning or end; add emphasis |
| Rule conflict | Two rules produce contradictory behavior | Cross-section contradiction | Identify conflict, rewrite one or both rules |
| Example overrides rule | Model follows example pattern instead of rule | Schema example contradicts rule text | Fix the example — examples always win |
| Rule too abstract | Model doesn't know how to apply the rule | Qualitative instead of quantitative | Add concrete thresholds (Level 3) |

---

## Anti-Patterns: Things That Don't Work

Learn from what failed in past engagements so you don't repeat it.

### Soft Guidance for Hard Problems
"Try to avoid over-nesting" does not work. "Prefer flat structures" does not work. If the behavior is wrong, you need a hard constraint: "Maximum nesting depth is 1 level. NEVER create grandchild tasks."

### Relying on the Model's "Good Judgment"
"Use appropriate categories" fails because "appropriate" is subjective. Give exhaustive enums. Give numeric thresholds. Give banned lists. Don't rely on the model to figure out what you mean.

### One-Shot Testing
Running a test once and calling it "passing" is unreliable at temperature > 0. The SHrimp engagement saw tests that passed 2/3 runs but failed on the third. A flaky pass is a fail — the prompt isn't robust enough.

### Wholesale Prompt Rewrites
Rewriting the entire prompt from scratch loses signal. You won't know which changes helped and which hurt. Small, targeted mutations with full-suite retesting after each one. This is slower but it's the only way to know what's working.

### Fixing Tests Instead of Fixing the Prompt
If a test is failing, the instinct is sometimes to make the test less strict. Resist this unless the test genuinely has wrong expectations. A validator that accepts bad output is worse than no validator — it gives false confidence.

### Ignoring Schema Examples
When debugging content or structural failures, people look at the rules section first. But schema examples are often the real culprit — they teach by demonstration, and models mimic what they see. Always check the schema example when diagnosing structural issues.

### Not Saving Prompt Versions
After 8 mutations you need to roll back to mutation 3. If you didn't save versions, you're reconstructing from memory. Use `mutagen baseline --save-to .` after each successful mutation to auto-version. The `prompts/` directory keeps every version, making rollback trivial.

---

## Common Questions Claude Should Be Ready For

**"How long will this take?"**
Depends on the prompt's complexity and how many failure patterns exist. A simple prompt with 2-3 failure patterns: 30-60 minutes. A complex sectioned prompt with 5+ patterns: 2-4 hours across multiple sessions. Set expectations early.

**"Can you just rewrite the whole thing?"**
You can, but you shouldn't. A rewrite loses the signal of what was already working. The test-driven approach preserves working behavior and fixes only what's broken. If the prompt is fundamentally misconceived, discuss a restructure with the user rather than silently rewriting.

**"Why can't you just use Claude/GPT to generate a better prompt?"**
Because "better" is undefined without tests. Any model can generate a plausible-sounding prompt. The question is whether it actually produces correct output for the specific inputs the user cares about. That requires testing, not generation.

**"The tests pass but the output doesn't feel right."**
This means your validators are incomplete. Consider adding `semantic_judge` checks with criteria that capture the subjective quality. Work with the user to articulate what "right" looks like, then encode it. If it's genuinely subjective (tone, style), this may require iterating on both prompt language and test criteria.

---

## Checklist Summary

```
Phase 1: Context Gathering
  [ ] Scaffolded engagement with `mutagen init`
  [ ] Pasted the full prompt text into prompt.txt
  [ ] Configured mutagen.yaml (model, temperature, max_tokens)
  [ ] Set API key as environment variable
  [ ] Read codebase to understand response consumer (if available)
  [ ] Collected known failure modes from user

Phase 2: Baseline Testing
  [ ] Defined 8-12 test cases in tests.yaml
  [ ] Set up context fields for stateful inputs (if needed)
  [ ] Configured semantic judge (if using semantic_judge checks)
  [ ] Ran `mutagen run --config mutagen.yaml --dry-run` to estimate costs
  [ ] Ran `mutagen baseline --config mutagen.yaml --save-to .` (multi-run if temp > 0.5)
  [ ] Identified failure patterns, grouped by root cause

Phase 3: Mutation & Iteration
  [ ] Diagnosed each failure pattern (root cause + responsible prompt section)
  [ ] Applied targeted mutations (smallest effective change)
  [ ] Ran full suite after each mutation: `mutagen run --config mutagen.yaml --verbose`
  [ ] Checked for regressions after each mutation
  [ ] Used `mutagen compare` for A/B comparison where needed
  [ ] Saved successful mutations: `mutagen baseline --save-to .`
  [ ] Logged all changes in failure_log.md with before/after
  [ ] Expanded test suite as new patterns emerged

Phase 4: Human Review
  [ ] Presented refined prompt with diff
  [ ] Showed comparison: `mutagen compare 1 <latest> --config mutagen.yaml --save-to .`
  [ ] Explained changes and trade-offs
  [ ] Presented engagement.md as complete record
  [ ] Incorporated user feedback
  [ ] Added any new test cases from feedback

Phase 5: Convergence
  [ ] All tests pass across multiple runs
  [ ] User approves output quality
  [ ] No regressions from baseline
  [ ] Delivered final prompt text (from prompts/v{N}.txt)
  [ ] Delivered test suite (tests.yaml) for future use
  [ ] Delivered failure_log.md for future reference
```
