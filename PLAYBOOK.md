# Prompt Evolution Playbook

This is your operational guide. When a user says "I've got a prompt to refine" (or similar), follow this playbook. It tells you what to do at each phase, what questions to ask, and how to structure your work.

Read `docs/prompt-structures.md` before starting if you haven't already. Refer to `docs/case-studies/` for concrete examples of the methodology in action.

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

3. **Find the API call.** What model, what temperature, what parameters? You need to replicate this exactly in your test harness.

4. **Find the UI/consumer.** What does the end user see? This helps you write content-quality validators, not just structural ones.

### Setting Up the Engagement Directory

Before Phase 2, create a dedicated engagement directory using `--save-to`. This centralizes all artifacts in one place:

```bash
python test_harness.py --save-to ./engagement_myapp
```

Copy the engagement template from `templates/engagement_template.md` into this directory. You'll fill it in as you go, not retrospectively. It captures context, baseline results, iterations, and reviews in one place.

### Phase 1 Outputs

Before moving to Phase 2, you should have:
- [ ] Set up engagement directory with `--save-to`
- [ ] Copied engagement template into the directory
- [ ] The full prompt text as the production system sends it
- [ ] The target model and API parameters
- [ ] An API key set as an environment variable
- [ ] A list of known failure modes from the user
- [ ] Understanding of the response format requirements
- [ ] Understanding of how the app consumes responses

---

## Phase 2: Baseline Testing

### Step 1: Build the Test Harness

Copy `templates/test_harness.py` into your working directory. Adapt it:

1. Set `API_CONFIG` for the user's provider, model, and parameters
2. Implement `load_prompt()` to assemble the prompt exactly as the production system does
3. Verify the API call works with a single manual test before running the suite

Test cases can be defined in **YAML** (via `--yaml path/to/tests.yaml`) or **Python**:
- **YAML is preferred** for declarative test definitions and static inputs
- **Python is better** for custom validators and complex setup logic

For apps with dynamic user prompts that include app state (existing tasks, user data, context), use `build_user_prompt()` to simulate that state in your test inputs.

**Critical:** The test harness must make the same API call the production system makes. Same model, same temperature, same system/user message structure. No extra context. If the production system uses `temperature: 1.0`, your tests use `temperature: 1.0`. If the production system sends the prompt as `system_instruction`, your tests do the same.

**Why raw API calls?** Sub-agents and orchestration frameworks inject their own system context (persona, workspace files, memory, behavioral rules). This pollutes the test — the AI isn't responding to just the prompt being tested, it's responding to the prompt *plus* framework scaffolding. Your test harness must be clean.

### Step 2: Define Test Cases

Start with 8-12 test cases. You will expand as you discover failure modes. Aim for coverage across these categories:

| Category | Starting Count | Purpose |
|----------|---------------|---------|
| Basic / happy path | 3-4 | Typical inputs that should work well |
| Edge cases | 2-3 | Boundary conditions, unusual inputs |
| Rule-specific | 1 per known failure | Directly test reported problems |
| Adversarial | 1-2 | Injection attempts, format breakers |

As failures emerge, add targeted regression tests. The SHrimp engagement started with 10 tests and expanded to 30 across two suites (core behavior + nesting-specific) as new failure patterns surfaced.

**YAML test structure** now supports a `context` field for simulating app state. This is critical for apps where the AI's behavior depends on what's already in the system (existing tasks, user data, preferences). Use it to replicate realistic state:

```yaml
test_case:
  name: "Adding task to populated list"
  context:
    existing_tasks:
      - id: 1
        title: "Review proposal"
        status: "pending"
  input: "Also need to call marketing"
  expected:
    - new_task_created: true
```

For each test case, write a validator function. Validators should check:
- **Structure:** Does it parse? Are required fields present? Are types correct?
- **Content:** Is the response accurate and appropriate?
- **App compatibility:** Will the consuming application accept this output?
- **Nesting/depth:** Does the structure stay within what the app's UI can render?

Use the validator functions from `templates/test_harness.py` as building blocks. Write custom validators when the template ones aren't sufficient.

### Step 3: Run the Baseline

Run the full test suite against the **unmodified** prompt. Record results using `--save-to` to persist them in the engagement directory:

```bash
python test_harness.py --save-to ./engagement_myapp
```

This is your reference point. Every future change is measured against this baseline.

Before running the full suite, use `--dry-run` to preview API costs and confirm the harness is set up correctly:

```bash
python test_harness.py --dry-run
```

**Prompt versioning:** After baseline, the prompt is automatically saved as `v1.txt` in the engagement directory. Each mutation creates a new version (`v2.txt`, `v3.txt`, etc.) for easy rollback and comparison.

**Handling nondeterminism:** At temperature > 0, the same input can produce different outputs on each call. This is especially pronounced at temperature 0.7+ where the SHrimp engagement saw tests pass/fail randomly across runs.

Strategy for nondeterminism:
1. Run each test **3 times minimum** at temperatures above 0.5
2. A test must pass **all runs** to be considered passing. A flaky test is a failing test.
3. Use the `--runs N` flag in the test harness to automate multi-run testing
4. When reporting results, report the worst-case result for each test
5. If a test passes 2/3 times, the prompt isn't robust enough — the rule it tests needs to be stronger

Record the multi-run results in your failure log. "Passes 2/3" is useful diagnostic information — it tells you the rule exists but lacks sufficient force.

### Phase 2 Outputs

- [ ] Working test harness making real API calls
- [ ] 8-12 test cases with validators (YAML or Python)
- [ ] Test fixtures or context fields set up for stateful inputs
- [ ] Baseline results recorded with `--save-to` (with multi-run data if temperature > 0.5)
- [ ] API costs estimated via `--dry-run`
- [ ] List of failures to investigate, grouped by pattern

---

## Phase 3: Mutation & Iteration

### A/B Testing Specific Versions

To compare two prompt versions side-by-side (for example, mutation 3 vs mutation 5):

```bash
python test_harness.py --prompt-file ./engagement_myapp/prompts/v3.txt
```

This runs the full suite against a specific version without changing your working prompt. Useful for debugging regressions or testing fallback approaches.

### The Diagnosis -> Mutate -> Test Loop

For each failure pattern:

**1. Diagnose.** Read the failing test's actual response carefully. Compare it to what was expected. Ask:

- Which specific words or section of the prompt caused this behavior?
- Is the problem what the prompt says, or what it *doesn't* say?
- Is there a cross-section conflict (two parts of the prompt contradicting each other)?
- Is a schema example teaching the wrong pattern?

Log the pattern in `templates/failure_log.md` with the actual response excerpts.

**2. Mutate.** Make a targeted edit. One mutation per failure pattern. See the Mutation Strategy Guide below for detailed tactics.

**3. Test.** Run the **full suite** after every mutation. Not just the test you were targeting — the full suite. Regressions must be caught immediately.

**4. Record.** Log what changed, why, and the before/after test results.

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
1. Revert the mutation
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

### Engagement Template

The engagement template (`templates/engagement_template.md`) should be filled in as you go through the phases, not retrospectively. It captures:
- **Context:** Problem statement, known failure modes, test strategy
- **Baseline:** Initial test results and failure patterns
- **Iterations:** Each mutation with before/after results
- **Reviews:** User feedback and decisions made
- **Final state:** Convergence details and sign-off

This becomes the complete record of the engagement and helps future sessions understand what was tried.

### What to Present

1. **The refined prompt text.** If the prompt is sectioned, present each section. If it's monolithic, present the whole thing. Either way, include a diff from the original.

2. **Test results.** Show the before/after comparison. Make it easy to see what improved. Include multi-run data if applicable.

3. **What changed and why.** For each mutation, one sentence on what was changed and one on why. Don't over-explain — the user can ask for details.

4. **Trade-offs.** If you made judgment calls, say so. The user may disagree.

5. **Open questions.** If there are cases where you weren't sure what "good" looks like, ask.

6. **The engagement template.** Show the user the filled-in template; it serves as the full audit trail.

### Incorporating Feedback

The user's feedback will typically be:
- "This looks good, ship it" -> Move to Phase 5 / Convergence
- "This case still isn't right" -> Add or refine a test case, return to Phase 3
- "I don't like the tone / style / approach" -> Content quality issue. May need custom validators or more nuanced prompt language.
- "This works but I also want it to handle X" -> Scope expansion. Add new test cases and iterate.

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
- **The final prompt text** (complete, ready to copy) — located in the engagement directory as `prompts/v{N}.txt`
- A summary of all changes from the original
- **The test suite** (portable YAML tests + harness) so the user can re-run it if they make future edits
- **The failure log** so future sessions can understand what was tried
- **The engagement template** (filled in as a complete record of decisions and iterations)
- Optional: **Cross-model testing results** if you tested the prompt against multiple providers using `--models` to verify robustness

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
After 8 mutations you need to roll back to mutation 3. If you didn't save versions, you're reconstructing from memory. Use `--save-to` from the start of Phase 1. The harness automatically versions each mutation as `v1.txt`, `v2.txt`, etc., making rollback trivial. Without this, you lose the ability to pinpoint when a regression was introduced and why.

---

## Common Questions Claude Should Be Ready For

**"How long will this take?"**
Depends on the prompt's complexity and how many failure patterns exist. A simple prompt with 2-3 failure patterns: 30-60 minutes. A complex sectioned prompt with 5+ patterns: 2-4 hours across multiple sessions. Set expectations early.

**"Can you just rewrite the whole thing?"**
You can, but you shouldn't. A rewrite loses the signal of what was already working. The test-driven approach preserves working behavior and fixes only what's broken. If the prompt is fundamentally misconceived, discuss a restructure with the user rather than silently rewriting.

**"Why can't you just use Claude/GPT to generate a better prompt?"**
Because "better" is undefined without tests. Any model can generate a plausible-sounding prompt. The question is whether it actually produces correct output for the specific inputs the user cares about. That requires testing, not generation.

**"The tests pass but the output doesn't feel right."**
This means your validators are incomplete. Work with the user to articulate what "right" looks like, then encode it as a validator. If it's genuinely subjective (tone, style), this may require iterating on prompt language beyond what automated tests can catch.

---

## Checklist Summary

```
Phase 1: Context Gathering
  [ ] Obtained the full prompt text
  [ ] Identified prompt structure (monolithic / sectioned / few-shot)
  [ ] Determined target model and API parameters
  [ ] Obtained API key and set as environment variable
  [ ] Read codebase to understand response consumer
  [ ] Collected known failure modes from user
  [ ] Set up engagement directory with --save-to
  [ ] Copied engagement template into directory

Phase 2: Baseline Testing
  [ ] Built test harness with raw API calls
  [ ] Verified API call matches production exactly
  [ ] Defined test cases in YAML or Python (with fixtures if stateful)
  [ ] Verified context/app state simulation where needed
  [ ] Ran --dry-run to estimate API costs
  [ ] Ran baseline with multiple runs (3+ at temp > 0.5)
  [ ] Recorded baseline results with --save-to and multi-run data
  [ ] Identified failure patterns, grouped by root cause

Phase 3: Mutation & Iteration
  [ ] Diagnosed each failure pattern (root cause + responsible prompt section)
  [ ] Applied targeted mutations (smallest effective change)
  [ ] Ran full test suite (multi-run) after each mutation
  [ ] Checked for regressions after each mutation
  [ ] Used --prompt-file for A/B comparison where needed
  [ ] Logged all changes in failure log with before/after
  [ ] Expanded test suite as new patterns emerged

Phase 4: Human Review
  [ ] Presented refined prompt with diff
  [ ] Showed before/after test results (with multi-run data)
  [ ] Explained changes and trade-offs
  [ ] Presented the engagement template as complete record
  [ ] Incorporated user feedback
  [ ] Added any new test cases from feedback

Phase 5: Convergence
  [ ] All tests pass across multiple runs
  [ ] User approves output quality
  [ ] No regressions from baseline
  [ ] Delivered final prompt text for user to copy (from prompts/v{N}.txt)
  [ ] Delivered test suite (portable YAML + harness) for future use
  [ ] Delivered failure log for future reference
  [ ] Cross-model tested with --models (if multi-provider app)
```
