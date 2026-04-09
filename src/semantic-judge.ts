import { callApi, type ProviderConfig } from "./providers.js";
import { stripCodeFences } from "./validators.js";

export interface SemanticJudgeCheck {
  type: "semantic_judge";
  criteria: string;
  pass_threshold?: number; // default 0.7
}

export interface SemanticJudgeResult {
  passed: boolean;
  reason: string;
  score: number;
}

function parseJudgeJson(text: string): SemanticJudgeResult {
  const cleaned = stripCodeFences(text);
  const parsed = JSON.parse(cleaned) as {
    passed?: boolean;
    reason?: string;
    score?: number;
  };
  return {
    passed: Boolean(parsed.passed),
    reason: parsed.reason ?? "No reason provided",
    score: typeof parsed.score === "number" ? parsed.score : 0,
  };
}

export async function runSemanticJudge(
  modelOutput: string,
  check: SemanticJudgeCheck,
  judgeConfig: ProviderConfig,
): Promise<SemanticJudgeResult> {
  const threshold = check.pass_threshold ?? 0.7;

  const system = [
    "You are a strict evaluator for prompt-test outputs.",
    "Return ONLY valid JSON with keys: passed (boolean), score (0..1), reason (string).",
    "No markdown. No extra text.",
  ].join(" ");

  const user = [
    `CRITERIA:\n${check.criteria}`,
    "",
    "MODEL_OUTPUT:",
    modelOutput,
    "",
    `PASS RULE: passed=true only if score >= ${threshold} and criteria is satisfied.`,
  ].join("\n");

  const resp = await callApi(system, user, judgeConfig);
  const parsed = parseJudgeJson(resp.text);
  const passed = parsed.passed && parsed.score >= threshold;

  return {
    passed,
    score: parsed.score,
    reason: parsed.reason,
  };
}
