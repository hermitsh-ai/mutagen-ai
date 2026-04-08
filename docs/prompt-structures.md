# Prompt Structures Guide

Different applications assemble their system prompts in different ways. Understanding the structure matters because it determines how you diagnose failures and where you make mutations.

## The Three Common Architectures

### 1. Monolithic Prompt

A single block of text, usually in one string or file. Everything lives together — instructions, rules, examples, schema definitions.

```
You are a helpful assistant that analyzes customer support tickets.

Always respond in JSON format with the following fields:
- category: one of ["billing", "technical", "general"]
- priority: "high", "medium", or "low"
- summary: a one-sentence summary of the issue
- suggested_action: what the support team should do

Be concise. Never include personally identifiable information in your response.
If the ticket is unclear, set category to "general" and priority to "medium".
```

**Characteristics:**
- Easy to read and understand as a whole
- Rules can conflict without it being obvious
- Changes ripple — editing one paragraph can affect how the model interprets others
- Common in simpler applications and prototypes

**Mutation strategy:** Read the whole prompt before changing anything. Mutations may need to account for how the model reads the full context, not just the edited section.

### 2. Sectioned Prompt

The prompt is assembled from distinct sections, often stored in separate files or config blocks. Each section has a clear responsibility. The application concatenates them at runtime.

```
=== ROLE ===
You are SHrimp AI, a freshwater shrimp keeping assistant.

=== RULES ===
1. Always respond in valid JSON
2. Never recommend medications without dosage warnings
3. If water parameters are outside safe ranges, flag as urgent
...

=== CATEGORIES ===
The following diagnostic categories are available:
- water_quality
- disease
- behavior
- breeding
...

=== OUTPUT SCHEMA ===
Respond with a JSON object matching this structure:
{
  "diagnosis": { ... },
  "recommendations": [ ... ],
  "urgency": "low" | "medium" | "high"
}
```

**Characteristics:**
- Each section can be tested and mutated somewhat independently
- Section order matters — models weight earlier content more heavily
- Cross-section interactions can cause subtle bugs
- Common in production applications with complex requirements

**Mutation strategy:** Identify which section owns the failure. Mutate within that section first. If the failure involves cross-section interaction, consider whether section ordering needs to change.

### 3. Few-Shot / Example-Driven Prompt

The prompt includes concrete input/output examples that demonstrate the desired behavior. The model learns the pattern from examples rather than (or in addition to) explicit rules.

```
You classify customer feedback into categories. Here are examples:

Input: "The app crashes every time I try to upload a photo"
Output: {"category": "bug", "severity": "high", "component": "upload"}

Input: "It would be nice if you could sort by date"
Output: {"category": "feature_request", "severity": "low", "component": "sorting"}

Input: "I love this app, great work team!"
Output: {"category": "praise", "severity": "none", "component": "general"}

Now classify the following feedback:
```

**Characteristics:**
- Very effective for format compliance — models mimic examples closely
- Examples can overfit — the model may copy example patterns too literally
- Adding contradictory examples confuses the model
- Works well combined with a brief rule section (hybrid approach)

**Mutation strategy:** If the model fails on format, add an example that demonstrates the correct format for a similar input. If the model is too literal, add more diverse examples. If examples conflict with rules, the examples usually win — so fix the examples.

## Hybrid Approaches

Most production prompts are hybrids. The SHrimp prompt, for instance, is a sectioned prompt (Rules + Thoroughness + Categories + Schema) with no few-shot examples. A common pattern is:

1. **Role / context** — Who the AI is and what it's doing
2. **Rules** — Explicit behavioral constraints
3. **Examples** — 2-3 input/output pairs showing the desired format
4. **Schema** — The exact output structure expected

The key insight is that **sections interact**. A rule saying "be concise" can conflict with a schema requiring detailed nested objects. An example showing flat output can override a schema showing nested output. When diagnosing failures, always consider cross-section effects.

## The User Prompt: The Forgotten Half

Most guides focus on the system prompt, but production apps also build a dynamic **user prompt** that includes app state — existing items, user preferences, calendar data, conversation history. This is where the hardest failures hide.

**Why it matters:** A prompt that works perfectly with a clean input like "buy milk" may completely fail when the user prompt includes 20 existing tasks, archived items, and calendar context. The model gets overwhelmed by context, or it misinterprets existing state as instructions.

**Testing implications:**
- Always test with simulated app state, not just raw user messages
- The test harness supports `context` fixtures that inject app state into the user prompt
- Build fixtures that represent realistic scenarios: empty state, crowded state, state with similar-named items, state with archived items
- The most common failure pattern we've seen: the model creates new top-level items instead of adding to existing lists, because the user prompt includes existing tasks but the system prompt doesn't give strong enough guidance about when to merge vs. create new

**Example fixture pattern:**
```
ACTIVE TASKS:
- [AAA-111] Grocery list
  - [AAA-112] Milk [errands]
  - [AAA-113] Eggs [errands]

ARCHIVED TASKS:
(none)

USER REQUEST:
add butter and cheese to my grocery list
```

This is a direct insight from the SHrimp engagement where "add to existing list" behavior only failed when tested with realistic task trees, not with clean inputs.

## Schema Examples: The Hidden Teacher

**This is the single most important structural insight from the SHrimp engagement.**

Schema examples don't just show format — they teach behavior. The model treats them as demonstrations of what "correct" looks like, and it mimics them.

### The Problem

If your schema section includes a deeply nested example:

```json
{
  "tasks": [
    {
      "title": "Kitchen renovation",
      "children": [
        {
          "title": "Replace countertops",
          "children": [
            {"title": "Choose material"},
            {"title": "Get quotes"}
          ]
        }
      ]
    }
  ]
}
```

The model will produce deeply nested output *even when the input doesn't warrant it*. Simple inputs like "buy milk" become nested structures because the example taught the model that nesting is the normal/expected pattern.

### The Fix

Show the behavior you want, not just the format you allow. If you want flat output by default:

```json
{
  "tasks": [
    {"title": "Buy milk", "notes": "From the store on 5th"},
    {"title": "Call dentist", "notes": "Reschedule Thursday appointment"}
  ]
}
```

The model will default to flat structures and only nest when the input genuinely requires it.

### The Rule

**Your schema example is the strongest behavioral signal in your prompt.** It overrides rules. It overrides explicit instructions. If the example shows X, the model does X. When debugging structural issues, check the schema example *before* adding more rules.

## Section Ordering Heuristics

Models (especially instruction-tuned models) tend to give more weight to:
1. Content at the very beginning of the system prompt
2. Content at the very end of the system prompt
3. Content immediately preceding the user message

This means:
- Put your most important rules first or last, not buried in the middle
- Put the output schema last if format compliance is critical
- If the model ignores a rule, try moving it to a more prominent position before rewriting it

### The Terminal Section

The last section of the prompt (whatever immediately precedes the user message) is a high-attention position. The SHrimp engagement discovered that after making significant changes to the Rules and Thoroughness sections, the terminal section was still reflecting the original framing — creating conflicting signals.

**After every batch of mutations, verify the terminal section still aligns with the rest of the prompt.** A misaligned terminal section can undo the work of mutations elsewhere because the model weights it heavily.

## Diagnosing by Structure Type

| Symptom | Monolithic | Sectioned | Few-Shot |
|---------|-----------|-----------|----------|
| Model ignores a rule | Rule is buried or contradicted | Rule is in a low-priority section | Examples override the rule |
| Output format is wrong | Format spec is ambiguous | Schema section is unclear; **schema example shows wrong format** | Examples show a different format |
| Model is too verbose | No conciseness constraint | Conflicting instructions across sections | Examples are verbose |
| Model hallucinates | No grounding constraint | Grounding rules too weak | Examples encourage fabrication |
| Inconsistent behavior | Multiple possible interpretations | Section order causes priority conflicts; **schema example contradicts rules** | Too few examples for coverage |
| Over-nesting | Schema example shows deep nesting | Schema in high-attention position demonstrating depth | Examples show nested output |
| Meta-task generation | Framing encourages delegation | Thoroughness section says "be helpful" | Examples include planning tasks |

## When to Recommend Restructuring

Sometimes the prompt's structure is itself the problem. Consider recommending a restructure when:

- The same rule needs to be stated in 3+ places to be followed (the structure is fighting you)
- Section ordering experiments show wildly different results (the model is confused about priorities)
- The prompt exceeds the model's effective instruction-following window (too long; needs compression)
- The user is on a small-context model and the prompt consumes too much of the context window
- Cross-section conflicts are causing cascading failures that targeted mutations can't resolve

Restructuring is a bigger change than mutation. Present it to the user as an option with trade-offs, don't do it silently. The user may have reasons for the current structure that aren't visible in the code.

## Prompt Architecture Patterns That Work

### The Grounded Planner Pattern

From the SHrimp engagement. Effective when the prompt produces structured output from unstructured input.

```
[Role: You ARE the planner. You do the planning. Output only results.]
[Rules: Hard constraints with MUST/NEVER language]
[Anti-patterns: Banned verbs, explicit "do NOT" lists]
[Categories/Taxonomy: Exhaustive enums, parent categories banned from direct use]
[Schema: Flat example showing desired default behavior]
[Terminal: Reinforces key rules from the beginning]
```

Key features: The role framing tells the model its job is to *do* the work, not to *help* with it. This prevents delegation, meta-tasks, and planning suggestions.

### The Defensive Classifier Pattern

Effective when the prompt classifies, categorizes, or triages input.

```
[Role: What you classify and why]
[Taxonomy: Exhaustive list of categories with descriptions]
[Rules: "ONLY use categories from the taxonomy. Never invent new ones."]
[Escape hatch: "If nothing fits, use X and explain in notes"]
[Examples: 3-4 diverse input/output pairs covering edge cases]
[Schema: Matches the example format exactly]
```

Key features: The escape hatch prevents the model from forcing bad fits. The examples cover the tricky cases, not just the obvious ones.

### The Cautious Expert Pattern

Effective when the prompt provides advice or diagnosis.

```
[Role: Domain expert with specific constraints]
[Rules: When to advise, when to ask for more info, when to refuse]
[Depth requirements: Concrete minimums, not "be thorough"]
[Safety constraints: Numeric thresholds for urgency/risk]
[Schema: Shows both a normal response and an "insufficient info" response]
```

Key features: The schema shows two modes — full response and "I need more info" — so the model knows both are acceptable outputs.
