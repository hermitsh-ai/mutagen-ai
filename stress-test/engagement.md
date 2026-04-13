# Prompt Evolution: MoltBot Social Media Agent

**Date:** 2026-04-12  
**Target model:** gemini-2.5-flash  
**Provider:** gemini  

---

## Context

**Application:** MoltBot — an autonomous AI agent managing a Moltbook (Reddit-style) social media account focused on tech/AI news.  
**Prompt structure:** Monolithic system prompt → receives JSON context → outputs JSON action plan  
**Response format:** JSON with `reasoning`, `actions[]`, `skip_reason`  

---

## Baseline (v2 — terrible prompt)

**Suite:** 31 tests, 1 run  
**Score:** 23/31 (74%)

The starting prompt was deliberately vague and incomplete:
- No required action fields specified
- No `reply` type mentioned (only "post", "comment")
- No priority ordering rules  
- No explicit max action limit
- No `general_remaining` rate limit handling

---

## Iteration Log

### Round 1 — Mutation 1: Add complete action schema + reply type + max-8 limit
**Change:** Replaced vague "each action should say what API call to make" with a full schema requiring all 6 fields: `type`, `endpoint`, `method`, `body`, `params`, `priority`. Added `reply` as an action type. Added "Maximum 8 actions per response."  
**Why:** 7 of 8 failures were caused by the model not knowing what fields actions needed, not knowing `reply` existed, and having no priority concept.  
**Score after:** 30/31 (+7)  
**Fixed:** struct_action_schema, struct_method_matches_endpoint, struct_max_actions, api_upvote_null_body, priority_replies_first, priority_descending_order, edge_all_activity_types  
**Remaining:** rate_max_actions_budget

### Round 2 — Mutation 2: Explicit general_remaining cap
**Change:** Made the `general_remaining` cap concrete: "The total number of actions MUST NOT exceed general_remaining from rate_limit_status. If general_remaining is 3, you can produce at most 3 actions."  
**Why:** The model knew about rate limits but didn't connect `general_remaining` to action count. Adding a worked example fixed this.  
**Score after:** 29/31 (regression — uncovered two flaky tests at 0.7 temp)  
**Fixed:** rate_max_actions_budget  
**New failures:** rate_respects_comment_limit (model prioritizes pending replies over comment limit = 0), priority_replies_first (model used `type: "comment"` for replies instead of `type: "reply"`)

### Round 3 — Mutation 3: Hard rate limit + reply type clarification
**Change:** Added "If comments_remaining is 0, produce NO comment or reply actions — even for pending_replies. This is an absolute hard limit." Plus: "When replying to a pending_replies item, use type 'reply' (not 'comment')."  
**Why:** The model's priority rule ("replies first") was overriding the rate limit. Needed an explicit override hierarchy. Also the model confused `reply` vs `comment` action types.  
**Score after:** 31/31 (100%)  
**Fixed:** rate_respects_comment_limit, priority_replies_first  

---

## Final Score: 31/31 ✓

**Total mutations:** 3  
**Rounds to reach target:** 3 (of 15 allowed)  

### Key lessons
1. **Schema ambiguity kills structured output.** The #1 failure cause was the model guessing at action field names. Specifying every required field with types eliminated 7 failures at once.
2. **Rate limits need concrete examples.** "Never exceed general_remaining" is too abstract — "if general_remaining is 3, produce at most 3 actions" is actionable.
3. **Contradictory priorities need explicit hierarchy.** "Prioritize replies" + "respect rate limits" creates a conflict the model resolves arbitrarily. The prompt must state which rule wins.
4. **Type naming must be explicit.** The model used "comment" for both comments and replies until told explicitly to use "reply" for pending_replies.
