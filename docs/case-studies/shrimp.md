# Case Study: SHrimp Task Manager Prompt Optimization

This is the first real engagement using the Prompt Evolution methodology. It's documented in detail so future sessions can reference what worked, what didn't, and why.

## Context

**Application:** SHrimp — a task management system where an AI processes user messages and converts them into structured task objects. Think of it as an AI layer between natural-language input and a structured task board.

**Target model:** Gemini 2.5 Flash (`gemini-2.5-flash-preview-04-17`)

**API parameters:** `temperature: 0.7`, raw Gemini API via `system_instruction` + `contents`

**Prompt structure:** Sectioned — the system prompt is assembled from multiple sections:
- **Rules** (numbered behavioral constraints, started at 12, grew to 16)
- **Thoroughness Guidelines** (depth/detail instructions)
- **Categories** (the task taxonomy)
- **Schema** (JSON output structure with example)
- **Terminal section** (final behavioral alignment)

**The consumer:** The app parses the JSON response into task objects for a board UI. It expects specific field names, controlled nesting depth, category values from a fixed taxonomy, and clean separation between task titles, notes, and subtasks.

## Phase 1: What We Learned About the System

Key discoveries from reading the codebase:

1. **The prompt is big.** Multiple sections concatenated at runtime, each with its own responsibility. Cross-section interactions are the primary source of bugs.

2. **Schema example teaches by demonstration.** The original schema section included a 3-level nested example (parent task > subtask > sub-subtask). This example was *teaching* the model to nest deeply, even though the rules section said to prefer flat structures. The example won — models mimic what they see.

3. **Temperature 0.7 means nondeterminism.** The same input can produce structurally different outputs across runs. This means any single test run is unreliable. We needed multiple runs per test to get confidence.

4. **The terminal section was misaligned.** The section at the very end of the prompt (high-attention position) had instructions that contradicted rules added during optimization. This section needed to be updated to match as rules evolved.

## Phase 2: Baseline Testing

### Test Harness Design

Built a Python script making raw HTTP calls to the Gemini API via `curl` subprocess calls. Key design decisions:
- No SDK dependencies — just `subprocess` calling `curl` with JSON payloads
- Prompt loaded by concatenating the section files exactly as the app does
- Each test is a cold, stateless single-turn call (no conversation history)
- Multi-run support from the start (3 runs per test at temperature 0.7)

### Test Suite Evolution

**Started with 10 core test cases** covering basic task creation, edge cases, and known failure modes.

**Expanded to 30 tests across two suites** as failure patterns emerged:
- **Core suite (15 tests):** Basic inputs, multi-intent messages, ambiguous inputs, passive content, reference data
- **Nesting suite (15 tests):** Flat inputs that should stay flat, inputs with legitimate 1-level nesting, inputs that could tempt deep nesting, multi-image inputs

The nesting suite was added after discovering that nesting behavior was an orthogonal failure dimension — tests could pass all content-quality checks but still produce structures the UI couldn't render.

### Baseline Results

**6/10 passing** on the initial core suite.

Seven distinct failure patterns identified across the failing tests (some tests failed for multiple reasons).

## Phase 3: The Iteration History

### Failure Pattern 1: Over-Nesting

**Signal:** Simple inputs that should produce flat task lists were coming back with 2-3 levels of hierarchy. A message like "buy milk, eggs, and bread" would produce a parent task "Grocery Shopping" with three subtasks, sometimes with sub-subtasks for each item.

**Root cause:** The schema example. It showed a 3-level nested structure as the "correct" format. The model was mimicking the example's depth regardless of input complexity.

**Mutation:** Flattened the schema example to show a simple 1-level structure. Removed the deeply nested example entirely.

**Result:** Over-nesting dropped from ~80% of responses to ~10%. The remaining 10% was handled by subsequent mutations.

**Lesson:** Schema examples are the most powerful teaching tool in a prompt. They override rules. If your example shows deep nesting, you'll get deep nesting no matter what your rules say.

### Failure Pattern 2: Over-Action on Passive Content

**Signal:** Informational content — product specs, ingredient lists, reference material — was being decomposed into action items. A packing list like "passport, charger, medications, snacks" would become four separate tasks: "Pack passport", "Pack charger", etc.

**Root cause:** No rule distinguished between actionable messages and reference data. The prompt's framing as a task manager biased the model toward treating *everything* as action items.

**Mutation:** Added **Rule 13** — reference data handling:

```
When the input contains reference data, informational content, or passive
lists (e.g., product specs, ingredient lists, inventory, packing lists),
create a SINGLE task titled with the subject of that data. Place the
reference content in the notes field. Do NOT decompose reference data
into individual subtasks.
```

**Result:** Reference data inputs now produce single tasks with notes. No regressions on action-item inputs.

### Failure Pattern 3: Lists Becoming Subtasks

**Signal:** Related to Pattern 2 but distinct — even when the model recognized content as a list, it would convert each list item into a subtask rather than keeping the list in the notes field.

**Root cause:** The model's default behavior treats lists as decomposable. Without explicit instruction to keep lists intact, the training prior takes over.

**Mutation:** Added specific anti-decomposition language to Rule 13 and added **Rule 15** (no duplication):

```
Information MUST appear in exactly one place. If details are captured in
the notes field, they MUST NOT also appear as subtasks. If items are
represented as subtasks, they MUST NOT be duplicated in notes.
```

**Result:** Eliminated the duplication pattern where lists appeared both as notes AND as subtasks.

### Failure Pattern 4: Vague Titles

**Signal:** Task titles like "Handle the situation", "Address the issue", "Take care of things." Generic language with no connection to the input content.

**Root cause:** No constraint on title specificity or length. The model defaulted to abstract summaries.

**Mutation:** Rewrote **Rule 5** — title requirements:

```
Task titles MUST be 3-8 words. Titles MUST contain at least one specific
noun from the user's input. NEVER use generic titles like "Handle",
"Address", "Take care of", "Deal with". Titles describe the concrete
outcome, not the process.
```

**Result:** Titles became specific and grounded in input content. The word count constraint prevented both one-word titles and sentence-length titles.

### Failure Pattern 5: Auto-Merging Unrelated Inputs

**Signal:** When the system received multiple messages (or a message with multiple unrelated topics), the model would merge them into a single task or group them under a common theme that didn't exist.

**Root cause:** No rule establishing message independence. The model's instinct to "organize" led it to find connections between unrelated items.

**Mutation:** Added **Rule 16** — message independence:

```
Each input message is independent. NEVER merge, combine, or group items
from different messages into a single task. NEVER create summary tasks
that span multiple inputs. Process each message as if it were the only
message you received.
```

**Result:** Multi-message inputs now produce independent task sets.

### Failure Pattern 6: AI-Generated Summary Notes

**Signal:** Instead of preserving the user's words in the notes field, the model was writing its own summaries and interpretations. A user's detailed description would be condensed into the AI's paraphrase.

**Root cause:** No grounding constraint on the notes field. The model defaulted to "helpful summarization."

**Mutation:** Rewrote **Rule 4** — notes field:

```
The notes field contains the user's own words and relevant details from
their input. Do NOT summarize, paraphrase, or editorialize. Do NOT add
AI-generated analysis or recommendations in notes. Notes are a record
of what the user said, not what the AI thinks about it.
```

**Result:** Notes became faithful to input content.

### Failure Pattern 7: Meta-Planning Tasks

**Signal:** The model generated organizational/planning tasks that weren't in the input: "Organize kitchen supplies", "Create a system for tracking expenses", "Plan the renovation project." These are meta-tasks — tasks about doing tasks.

**Root cause:** The prompt's framing as a task manager made the model think it should *help plan*, not just *record*. The Thoroughness section's language about "being helpful" reinforced this.

**Mutation:** This required two changes that worked together:

**a) Banned verb list in Thoroughness section:**
```
NEVER generate tasks using these verbs: Organize, Plan, Review, Evaluate,
Assess, Consider, Research, Explore, Investigate, Analyze, Prepare,
Develop, Create plan for, Set up system for, Establish process for
```

**b) Conceptual reframe** — the breakthrough mutation. Changed the Thoroughness section's framing from "help the user plan and organize" to:

```
You ARE the planner. The planning is YOUR job. The user receives ONLY the
concrete, actionable results of your planning. NEVER output planning steps,
organizational suggestions, or meta-tasks. If the input requires planning,
do the planning silently and output only the concrete tasks that result.
```

**Result:** Meta-task generation dropped to zero. The banned verb list caught the obvious cases; the conceptual reframe prevented the model from inventing new meta-patterns not on the list.

**This was the single most important conceptual insight of the engagement.** Telling the model "you are the planner — do the planning, output only results" changed its entire orientation. It stopped delegating planning back to the user.

### Additional Key Mutations

**Rule 10 rewrite — multi-image handling:** When the input included multiple images, the model would either ignore some or create separate task groups for each image. Rewrote Rule 10 to specify that all images in a single message represent a single context and should be analyzed together.

**Rule 14 — parent category prohibition:** Categories marked as parent-level organizational categories (e.g., "Home", "Work") were being used directly on tasks. Added a hard constraint that parent categories are for grouping only — tasks MUST use leaf categories.

**Categories section rewrite:** Changed from soft guidance ("prefer specific categories") to a hard constraint: "Parent categories are structural groupings ONLY. They MUST NOT be assigned to individual tasks. Tasks MUST be assigned a leaf-level category."

**Terminal section alignment:** After all the rule additions and rewrites, the terminal section (last thing the model reads, high-attention position) was still reflecting the original prompt's framing. Rewrote it to align with the new rules — reinforcing independence, anti-merging, anti-meta-task, and the "you are the planner" frame.

## Phase 4-5: Results and Convergence

### Score Progression

| Iteration | Score | Key Change |
|-----------|-------|-----------|
| Baseline | 6/10 | Initial state |
| After schema flatten | 8/10 | Over-nesting fixed |
| After Rule 13 (reference data) | 9/10 | Passive content handled |
| After Rule 14-16 + rewrites | 10/10 | All core tests passing |
| Suite expansion to 30 | 22/30 | New nesting tests exposed gaps |
| After Thoroughness rewrite + banned verbs | 28/30 | Meta-tasks eliminated |
| After terminal alignment | 30/30 | Full suite green |
| Final fresh harness (9 focused tests) | 9/9 | Clean verification |

### Mutation Summary

| Mutation | Type | Target |
|----------|------|--------|
| Flatten schema example | Level 4 (Schema as teacher) | Over-nesting |
| Add Rule 13 (reference data) | Level 5 (Rule addition) | Over-action on passive content |
| Add Rule 14 (parent category ban) | Level 5 (Rule addition) | Wrong category level |
| Add Rule 15 (no duplication) | Level 5 (Rule addition) | Content in two places |
| Add Rule 16 (message independence) | Level 5 (Rule addition) | Auto-merging |
| Rewrite Rule 4 (notes) | Level 6 (Section rewrite) | AI-generated summaries |
| Rewrite Rule 5 (titles) | Level 3 (Concrete thresholds) | Vague titles |
| Rewrite Rule 10 (multi-image) | Level 6 (Section rewrite) | Image handling |
| Add banned verb list to Thoroughness | Level 2 (Banned list) | Meta-tasks |
| Rewrite Thoroughness framing ("you are the planner") | Level 6 (Section rewrite) | Meta-tasks |
| Rewrite Categories hard constraint | Level 3 (Concrete threshold) | Category misuse |
| Rewrite Terminal section | Level 6 (Section rewrite) | Alignment |

## Key Lessons (Ranked by Impact)

### 1. Schema Examples Teach by Demonstration
The highest-impact single fix was flattening the schema example. Rules said "prefer flat" but the example said "here's what 3-level nesting looks like." The example won every time. **Always check your schema example first when debugging structural issues.**

### 2. Banned Verb Lists Beat Soft Guidance
"Avoid meta-planning language" failed across multiple iterations. A concrete list of 15 banned verbs worked immediately. Models need specifics, not principles.

### 3. "You Are the Planner" Was the Conceptual Breakthrough
Changing the model's identity from "helper who suggests plans" to "planner who outputs only results" eliminated an entire category of failures. This is a prompt-architecture-level insight: the model's role framing determines what it thinks "helpful" means.

### 4. Nondeterminism Requires Multi-Run Testing
At temperature 0.7, a test that passes once may fail on the next run. Single-run testing gives false confidence. Three runs minimum, worst-case result counts.

### 5. Test Suite Expansion Is Part of the Process
Starting with 10 tests and ending with 30 was not scope creep — it was discovery. Each new failure pattern revealed inputs that the original suite didn't cover. The nesting suite in particular was an entire failure dimension that was invisible until we started looking for it.

### 6. The Terminal Section Matters
The last section of the prompt is a high-attention position. If it's misaligned with the rest of the prompt, the model gets conflicting signals. After making changes to the body of the prompt, always verify the terminal section still agrees.

### 7. Never Modify User Source Code
The deliverable is always prompt text that the user copies into their app. Working in a test harness keeps the iteration loop fast and the user's codebase untouched. This also means the user maintains full control over when and how changes are integrated.

## What We'd Do Differently

1. **Start with multi-run testing from the beginning.** We initially ran single-shot tests and had to re-run the whole suite when we realized some "passes" were flaky.

2. **Build the nesting suite earlier.** Nesting failures were orthogonal to content failures and needed their own test category. We discovered this late.

3. **Check schema examples before rules.** The first instinct was to add more rules for over-nesting. The real fix was changing the example. Schema-first diagnosis would have saved several iterations.

4. **Align the terminal section after every batch of mutations.** We let it drift and had to do a big realignment at the end. Smaller, incremental alignments would have been smoother.
