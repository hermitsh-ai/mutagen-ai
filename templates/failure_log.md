# Failure Log & Mutation Tracker

**Prompt:** [Name/description of the prompt being refined]
**Target model:** [e.g., Gemini 2.5 Flash]
**Temperature:** [e.g., 0.7]
**Runs per test:** [e.g., 3]
**Date started:** [YYYY-MM-DD]

---

## Baseline Results

Run the full suite with `--runs N` and record results here. The pass rate column shows consistency across multiple runs (important at temperature > 0).

| Test ID | Status | Pass Rate | Notes |
|---------|--------|-----------|-------|
| example_test_1 | PASS | 3/3 | -- |
| example_test_2 | FAIL | 0/3 | Returned plain text instead of JSON |
| example_test_3 | FAIL | 1/3 | Missing "categories" field in 2 of 3 runs |
| example_test_4 | PASS | 2/3 | FLAKY — passes inconsistently, treat as fail |

**Baseline score:** X/Y passing (strict: all runs must pass)

**Flaky tests:** [List any tests that pass sometimes but not always. These need stronger rules.]

---

## Failure Patterns

Each failure pattern groups related test failures under a root cause. One pattern may explain multiple test failures.

### Pattern 1: [Short name, e.g., "Over-nesting on simple inputs"]

**Affected tests:** test_2, test_5
**Observed behavior:** [What the model actually does — include representative response excerpt]
**Root cause analysis:** [Why it does it — which part of the prompt is ambiguous, missing, or teaching the wrong pattern]
**Prompt section responsible:** [Which section, e.g., "Schema example", "Rules 4-6", "Thoroughness guidelines"]
**Consistency:** [Always fails / Fails 2/3 runs / Intermittent]

### Pattern 2: [Short name]

**Affected tests:** [list]
**Observed behavior:** [What happens]
**Root cause analysis:** [Why — be specific about which words/phrases in the prompt cause this]
**Prompt section responsible:** [Section]
**Consistency:** [Always / Intermittent]

### Pattern 3: [Short name]

**Affected tests:** [list]
**Observed behavior:** [What happens]
**Root cause analysis:** [Why]
**Prompt section responsible:** [Section]
**Consistency:** [Always / Intermittent]

---

## Mutations

Each mutation is a targeted edit. Record the exact change, the reasoning, and the test results (including pass rates across runs).

### Mutation 1: [Short description]

**Targets pattern:** Pattern 1
**Change type:** [Word-level / Sentence-level / Rule addition / Reorder / Section rewrite / Structural]
**Mutation level:** [Level 1-7 per PLAYBOOK.md strategy guide]

**Before:**
```
[Exact text being replaced]
```

**After:**
```
[Exact replacement text]
```

**Rationale:** [Why this change should fix the pattern]

**Test results after this mutation:**

| Test ID | Before | After | Pass Rate | Notes |
|---------|--------|-------|-----------|-------|
| test_2  | FAIL   | PASS  | 3/3       | Over-nesting eliminated |
| test_5  | FAIL   | PASS  | 3/3       | -- |
| test_1  | PASS   | PASS  | 3/3       | No regression |
| test_3  | FAIL   | FAIL  | 0/3       | Unrelated — different pattern |

**Regressions:** None / [List any tests that went from PASS to FAIL]

---

### Mutation 2: [Short description]

**Targets pattern:** Pattern 2
**Change type:** [Type]
**Mutation level:** [Level]

**Before:**
```
[Exact text]
```

**After:**
```
[Exact text]
```

**Rationale:** [Why]

**Test results after this mutation:**

| Test ID | Before | After | Pass Rate | Notes |
|---------|--------|-------|-----------|-------|
| ...     | ...    | ...   | ...       | ...   |

**Regressions:** None / [List]

---

## Iteration Summary

Track the cumulative score after each mutation. This shows progress and makes regressions visible.

| Iteration | Mutations Applied | Score | Pass Rate | Notes |
|-----------|-------------------|-------|-----------|-------|
| Baseline  | --                | X/Y   | --        | Initial state |
| 1         | Mutation 1        | X/Y   | X/Y strict | Fixed Pattern 1 |
| 2         | Mutations 1-2     | X/Y   | X/Y strict | Fixed Pattern 2, no regressions |
| 3         | Mutations 1-3     | X/Y   | X/Y strict | Fixed Pattern 3, regression on test_4 |
| 4         | Mutations 1-2, 3b | X/Y   | X/Y strict | Reverted M3, tried alternative |
| Final     | Mutations 1-2, 3b, 4-5 | Y/Y | Y/Y strict | All passing, all runs |

---

## Test Suite Expansion Log

Track when and why new tests were added during the engagement.

| Test ID | Added After | Reason |
|---------|-------------|--------|
| nesting_flat_input | Mutation 2 | Discovered nesting was an orthogonal failure dimension |
| content_reference_data | User feedback | User reported passive content being decomposed |
| ... | ... | ... |

---

## Human Review Notes

**Review 1 (date):**
- Presented: [What was shown — score, diff summary]
- User feedback: [What they said]
- Action taken: [What changed in response — new tests, new mutations, scope change]

**Review 2 (date):**
- Presented: [What was shown]
- User feedback: [What they said]
- Action taken: [What changed]

---

## Final Prompt Diff

```diff
[Include a unified diff of the original prompt vs the final prompt]
```

---

## Lessons Learned

[What worked well, what didn't, what you'd do differently next time. This section helps future engagements avoid repeating mistakes.]
