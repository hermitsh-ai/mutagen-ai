/**
 * Mutagen-AI — Validators
 *
 * Reusable validation functions for testing LLM prompt responses.
 * Each validator returns [passed, reason] — a boolean and a human-readable explanation.
 *
 * These are the building blocks for test cases. YAML test definitions map
 * check types (e.g. "json_parseable") to these functions automatically.
 */

export type ValidatorResult = [passed: boolean, reason: string];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Strip markdown code fences that models sometimes wrap JSON in. */
export function stripCodeFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    const nl = t.indexOf("\n");
    t = nl === -1 ? "" : t.slice(nl + 1);
  }
  if (t.endsWith("```")) {
    t = t.slice(0, -3);
  }
  return t.trim();
}

/** Safely parse JSON from a response, stripping code fences first. */
function safeParse(response: string): { data: unknown; error?: string } {
  const cleaned = stripCodeFences(response);
  try {
    return { data: JSON.parse(cleaned) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { data: null, error: `Invalid JSON: ${msg}` };
  }
}

/** Unwrap: if data is a non-empty array, return the first element for field checks. */
function unwrap(data: unknown): unknown {
  if (Array.isArray(data) && data.length > 0) return data[0];
  return data;
}

// ---------------------------------------------------------------------------
// Structural Validators
// ---------------------------------------------------------------------------

export function validateJsonParseable(response: string): ValidatorResult {
  const { error } = safeParse(response);
  return error ? [false, error] : [true, "Valid JSON"];
}

export function validateJsonFields(
  response: string,
  requiredFields: string[],
): ValidatorResult {
  const { data, error } = safeParse(response);
  if (error) return [false, error];

  const obj = unwrap(data);
  if (typeof obj !== "object" || obj === null) {
    return [false, "Response is not a JSON object"];
  }
  const missing = requiredFields.filter((f) => !(f in (obj as Record<string, unknown>)));
  if (missing.length > 0) return [false, `Missing fields: ${JSON.stringify(missing)}`];
  return [true, "All required fields present"];
}

export function validateJsonFieldType(
  response: string,
  field: string,
  expectedType: string,
): ValidatorResult {
  const { data, error } = safeParse(response);
  if (error) return [false, error];

  const obj = unwrap(data) as Record<string, unknown>;
  if (typeof obj !== "object" || obj === null) return [false, "Response is not a JSON object"];
  if (!(field in obj)) return [false, `Field '${field}' not found`];

  const typeMap: Record<string, (v: unknown) => boolean> = {
    string: (v) => typeof v === "string",
    str: (v) => typeof v === "string",
    number: (v) => typeof v === "number",
    int: (v) => typeof v === "number" && Number.isInteger(v),
    integer: (v) => typeof v === "number" && Number.isInteger(v),
    float: (v) => typeof v === "number",
    boolean: (v) => typeof v === "boolean",
    bool: (v) => typeof v === "boolean",
    array: (v) => Array.isArray(v),
    list: (v) => Array.isArray(v),
    object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
    dict: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  };

  const checker = typeMap[expectedType.toLowerCase()];
  if (!checker) return [false, `Unknown expected type: ${expectedType}`];
  if (!checker(obj[field])) {
    return [false, `Field '${field}' is ${typeof obj[field]}, expected ${expectedType}`];
  }
  return [true, `Field '${field}' has correct type`];
}

export function validateJsonFieldValue(
  response: string,
  field: string,
  allowed: unknown[],
): ValidatorResult {
  const { data, error } = safeParse(response);
  if (error) return [false, error];

  const obj = unwrap(data) as Record<string, unknown>;
  if (typeof obj !== "object" || obj === null) return [false, "Response is not a JSON object"];
  if (!(field in obj)) return [false, `Field '${field}' not found`];
  if (!allowed.includes(obj[field])) {
    return [false, `Field '${field}' = '${obj[field]}', expected one of ${JSON.stringify(allowed)}`];
  }
  return [true, `Field '${field}' has valid value`];
}

export function validateJsonArrayLength(
  response: string,
  field: string,
  minLen = 0,
  maxLen = 999,
): ValidatorResult {
  const { data, error } = safeParse(response);
  if (error) return [false, error];

  let arr: unknown[];
  if (Array.isArray(data)) {
    arr = data;
  } else {
    const obj = data as Record<string, unknown>;
    if (!(field in obj)) return [false, `Field '${field}' not found`];
    if (!Array.isArray(obj[field])) return [false, `Field '${field}' is not an array`];
    arr = obj[field] as unknown[];
  }

  if (arr.length < minLen) return [false, `Array '${field}' has ${arr.length} items, minimum is ${minLen}`];
  if (arr.length > maxLen) return [false, `Array '${field}' has ${arr.length} items, maximum is ${maxLen}`];
  return [true, `Array '${field}' length ${arr.length} is within [${minLen}, ${maxLen}]`];
}

export function validateMaxNestingDepth(
  response: string,
  maxDepth: number,
): ValidatorResult {
  const { data, error } = safeParse(response);
  if (error) return [false, error];

  function measureDepth(obj: unknown, current = 0): number {
    if (typeof obj === "object" && obj !== null) {
      if (Array.isArray(obj)) {
        if (obj.length === 0) return current;
        return Math.max(...obj.map((item) => measureDepth(item, current + 1)));
      }
      const vals = Object.values(obj);
      if (vals.length === 0) return current;
      return Math.max(...vals.map((v) => measureDepth(v, current + 1)));
    }
    return current;
  }

  const depth = measureDepth(data);
  if (depth > maxDepth) return [false, `Nesting depth ${depth} exceeds maximum ${maxDepth}`];
  return [true, `Nesting depth ${depth} <= ${maxDepth}`];
}

// ---------------------------------------------------------------------------
// Content Validators
// ---------------------------------------------------------------------------

export function validateNoBannedWords(
  response: string,
  bannedWords: string[],
  field?: string,
): ValidatorResult {
  const cleaned = stripCodeFences(response);
  let checkText = cleaned;

  if (field) {
    try {
      const data = JSON.parse(cleaned);
      if (Array.isArray(data)) {
        checkText = data
          .filter((item) => typeof item === "object" && item !== null)
          .map((item) => String((item as Record<string, unknown>)[field] ?? ""))
          .join(" ");
      } else if (typeof data === "object" && data !== null) {
        checkText = String((data as Record<string, unknown>)[field] ?? "");
      }
    } catch {
      checkText = cleaned;
    }
  }

  const found: string[] = [];
  for (const word of bannedWords) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(checkText)) {
      found.push(word);
    }
  }

  if (found.length > 0) return [false, `Banned words found: ${JSON.stringify(found)}`];
  return [true, "No banned words found"];
}

export function validateFieldWordCount(
  response: string,
  field: string,
  minWords = 1,
  maxWords = 999,
): ValidatorResult {
  const { data, error } = safeParse(response);
  if (error) return [false, error];

  const obj = unwrap(data) as Record<string, unknown>;
  if (typeof obj !== "object" || obj === null) return [false, "Response is not a JSON object"];
  if (!(field in obj)) return [false, `Field '${field}' not found`];

  const wordCount = String(obj[field]).split(/\s+/).filter(Boolean).length;
  if (wordCount < minWords) return [false, `Field '${field}' has ${wordCount} words, minimum is ${minWords}`];
  if (wordCount > maxWords) return [false, `Field '${field}' has ${wordCount} words, maximum is ${maxWords}`];
  return [true, `Field '${field}' word count ${wordCount} is within [${minWords}, ${maxWords}]`];
}

export function validateRegex(
  response: string,
  pattern: string,
  description = "",
): ValidatorResult {
  if (new RegExp(pattern, "s").test(response)) {
    return [true, `Matches pattern: ${description || pattern}`];
  }
  return [false, `Does not match pattern: ${description || pattern}`];
}

export function validateNoPattern(
  response: string,
  pattern: string,
  description = "",
): ValidatorResult {
  if (new RegExp(pattern, "s").test(response)) {
    return [false, `Unwanted pattern found: ${description || pattern}`];
  }
  return [true, `Pattern absent as expected: ${description || pattern}`];
}

export function validateMaxLength(
  response: string,
  maxChars: number,
): ValidatorResult {
  if (response.length <= maxChars) return [true, `Length ${response.length} <= ${maxChars}`];
  return [false, `Length ${response.length} exceeds max ${maxChars}`];
}

export function validateItemCount(
  response: string,
  minItems = 1,
  maxItems = 999,
): ValidatorResult {
  const { data, error } = safeParse(response);
  if (error) return [false, error];

  const count = Array.isArray(data) ? data.length : 1;
  if (count < minItems) return [false, `Got ${count} items, minimum is ${minItems}`];
  if (count > maxItems) return [false, `Got ${count} items, maximum is ${maxItems}`];
  return [true, `Item count ${count} is within [${minItems}, ${maxItems}]`];
}

export function validateContains(
  response: string,
  substring: string,
  ignoreCase = true,
): ValidatorResult {
  const hay = ignoreCase ? response.toLowerCase() : response;
  const needle = ignoreCase ? substring.toLowerCase() : substring;
  if (hay.includes(needle)) return [true, `Contains '${substring}'`];
  return [false, `Does not contain '${substring}'`];
}

export function validateNotContains(
  response: string,
  substring: string,
  ignoreCase = true,
): ValidatorResult {
  const hay = ignoreCase ? response.toLowerCase() : response;
  const needle = ignoreCase ? substring.toLowerCase() : substring;
  if (!hay.includes(needle)) return [true, `Does not contain '${substring}'`];
  return [false, `Contains unwanted '${substring}'`];
}

export function validateNoDuplication(
  response: string,
  notesField: string,
  childrenField: string,
): ValidatorResult {
  const { data, error } = safeParse(response);
  if (error) return [false, error];

  const items = Array.isArray(data) ? data : [data];

  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const notes = String(obj[notesField] ?? "").toLowerCase();
    const children = obj[childrenField];
    if (!Array.isArray(children) || !notes) continue;

    for (const child of children) {
      if (typeof child === "object" && child !== null) {
        const c = child as Record<string, unknown>;
        const childTitle = String(c["title"] ?? c["name"] ?? "").toLowerCase();
        if (childTitle && notes.includes(childTitle)) {
          return [false, `Duplication: child '${childTitle}' also appears in notes`];
        }
      }
    }
  }

  return [true, "No duplication between notes and children"];
}

// ---------------------------------------------------------------------------
// Validator Registry — maps YAML check type names to validator calls
// ---------------------------------------------------------------------------

export type Check = Record<string, unknown>;

export function runCheck(response: string, check: Check): ValidatorResult {
  const type = String(check["type"] ?? "").toLowerCase();

  switch (type) {
    case "json_parseable":
      return validateJsonParseable(response);
    case "json_fields":
      return validateJsonFields(response, (check["fields"] as string[]) ?? []);
    case "json_field_type":
      return validateJsonFieldType(response, check["field"] as string, check["expected"] as string);
    case "json_field_value":
      return validateJsonFieldValue(response, check["field"] as string, (check["allowed"] as unknown[]) ?? []);
    case "json_array_length":
      return validateJsonArrayLength(
        response,
        check["field"] as string,
        (check["min_len"] as number) ?? 0,
        (check["max_len"] as number) ?? 999,
      );
    case "max_nesting_depth":
      return validateMaxNestingDepth(response, (check["max_depth"] as number) ?? 5);
    case "no_banned_words":
      return validateNoBannedWords(
        response,
        (check["words"] as string[]) ?? [],
        check["field"] as string | undefined,
      );
    case "field_word_count":
      return validateFieldWordCount(
        response,
        check["field"] as string,
        (check["min_words"] as number) ?? 1,
        (check["max_words"] as number) ?? 999,
      );
    case "regex_match":
      return validateRegex(response, check["pattern"] as string, check["description"] as string);
    case "regex_absent":
      return validateNoPattern(response, check["pattern"] as string, check["description"] as string);
    case "max_length":
      return validateMaxLength(response, (check["max_chars"] as number) ?? 5000);
    case "item_count":
      return validateItemCount(
        response,
        (check["min_items"] as number) ?? 1,
        (check["max_items"] as number) ?? 999,
      );
    case "contains":
      return validateContains(
        response,
        check["substring"] as string,
        (check["ignore_case"] as boolean | undefined) ?? true,
      );
    case "not_contains":
      return validateNotContains(
        response,
        check["substring"] as string,
        (check["ignore_case"] as boolean | undefined) ?? true,
      );
    case "no_duplication":
      return validateNoDuplication(
        response,
        (check["notes_field"] as string) ?? "notes",
        (check["children_field"] as string) ?? "children",
      );
    default:
      return [false, `Unknown check type: ${type}`];
  }
}
