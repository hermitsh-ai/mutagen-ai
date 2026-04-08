# Prompt Evolution: {App Name}

**Date started:** {date}
**Target model:** {model}
**Temperature:** {temp}
**Runs per test:** {N}
**Engagement directory:** {path}

---

## Context

**Application:** {description}
**Prompt structure:** {monolithic / sectioned / few-shot}
**Response format:** {JSON / text / etc}
**Consumer:** {how the app uses the response}

### Known Failure Modes (from user)
1. {failure 1}
2. {failure 2}

### Prompt Sections
| Section | Purpose | File |
|---------|---------|------|
| {name} | {purpose} | prompts/v1.txt |

---

## Baseline

**Suite:** {N} tests, {M} runs each
**Score:** {X}/{Y}
**Date:** {date}

| Test ID | Status | Pass Rate | Notes |
|---------|--------|-----------|-------|

### Failure Patterns Identified
1. **{Pattern name}** — {brief description}

---

## Iteration Log

### Iteration 1: {description}
**Mutation level:** {1-7}
**Targets:** {pattern name}

**Change:**
{diff or description}

**Results:** {X}/{Y} (previous: {X}/{Y})
**Regressions:** {none / list}

---

## Human Review

### Review 1 ({date})
**Presented:** {what}
**Feedback:** {what they said}
**Action:** {what changed}

---

## Final State

**Score:** {X}/{Y} across {N} runs
**Prompt version:** v{N}
**Delivered:** {date}

### Changes from Original
{summary of all mutations}

### Lessons Learned
{what worked, what didn't}
