/**
 * Mutagen-AI — Test-driven prompt evolution toolkit
 *
 * Public API for programmatic use.
 *
 * @example
 * ```ts
 * import { runTests, loadTestCasesFromYaml, loadPrompt } from "mutagen-ai";
 *
 * const prompt = loadPrompt("./prompt.txt");
 * const tests = loadTestCasesFromYaml("./tests.yaml");
 * const results = await runTests(prompt, tests, {
 *   provider: "openai",
 *   model: "gpt-4o",
 *   apiKeyEnv: "OPENAI_API_KEY",
 *   temperature: 0.7,
 * }, { numRuns: 3 });
 *
 * console.log(`${results.passed}/${results.total} passed`);
 * ```
 */

export {
  runTests,
  formatSummary,
  formatMarkdownTable,
  type TestCase,
  type TestResult,
  type SuiteResult,
  type RunOptions,
  type RunResult,
} from "./runner.js";

export {
  loadTestCasesFromYaml,
  loadConfig,
  loadPrompt,
} from "./loader.js";

export {
  callApi,
  listProviders,
  type ProviderConfig,
  type ApiResponse,
  type UserInput,
  type MultimodalInput,
} from "./providers.js";

export {
  runSemanticJudge,
  type SemanticJudgeCheck,
  type SemanticJudgeResult,
} from "./semantic-judge.js";

export {
  runCheck,
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
  type ValidatorResult,
  type Check,
} from "./validators.js";
