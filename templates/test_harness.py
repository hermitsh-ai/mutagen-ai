"""
Prompt Evolution — Test Harness Template
=========================================

Dependencies: Python 3.10+ (stdlib only). Optional: pyyaml (for YAML test cases)

Adapt this template for the user's target API. The harness makes raw HTTP calls
with no framework context — just the system prompt + user input, exactly as the
production system sends them.

Usage:
    1. Copy this file into your working directory
    2. Replace the API_CONFIG section with the user's target provider
    3. Load the prompt text and test cases
    4. Run: python test_harness.py
    5. Multi-run: python test_harness.py --runs 3
    6. Tag filter: python test_harness.py --tags nesting,regression
    7. Single test: python test_harness.py --test basic_simple_input
    8. YAML tests: python test_harness.py --yaml test_cases.yaml
    9. Save results: python test_harness.py --save-to ./results
    10. Load saved prompt: python test_harness.py --prompt-file ./prompts/v1.txt
    11. Cross-model test: python test_harness.py --models "gemini:gemini-2.5-flash:GEMINI_API_KEY,openai:gpt-4o:OPENAI_API_KEY"
    12. Dry-run with cost: python test_harness.py --dry-run
    13. Retry on failure: python test_harness.py --retries 3

The harness is designed to be modified by Claude during a prompt evolution session.
It is NOT a fixed library — treat it as scaffolding that gets adapted per engagement.
"""

import json
import os
import sys
import time
import re
import subprocess
import argparse
import base64
from pathlib import Path
from typing import Any, Callable
from datetime import datetime


# =============================================================================
# API CONFIGURATION — Replace with the user's target provider
# =============================================================================

API_CONFIG = {
    # --- Gemini ---
    # "provider": "gemini",
    # "model": "gemini-2.5-flash-preview-04-17",
    # "api_key_env": "GEMINI_API_KEY",
    # "temperature": 1.0,
    # "max_tokens": 8192,

    # --- OpenAI / compatible ---
    # "provider": "openai",
    # "model": "gpt-4o",
    # "api_key_env": "OPENAI_API_KEY",
    # "endpoint": "https://api.openai.com/v1/chat/completions",
    # "temperature": 0.7,
    # "max_tokens": 4096,

    # --- Anthropic ---
    # "provider": "anthropic",
    # "model": "claude-sonnet-4-20250514",
    # "api_key_env": "ANTHROPIC_API_KEY",
    # "temperature": 0.7,
    # "max_tokens": 4096,

    # Uncomment and configure one of the above, or add a new provider below.
    "provider": "UNCONFIGURED",
}


# =============================================================================
# PROMPT LOADING — How the system prompt is assembled
# =============================================================================

def load_prompt() -> str:
    """
    Load the system prompt exactly as the production system assembles it.

    For a monolithic prompt:
        return open("prompt.txt").read()

    For a sectioned prompt:
        sections = [
            open("rules.txt").read(),
            open("schema.txt").read(),
            open("categories.txt").read(),
        ]
        return "\\n\\n".join(sections)

    For a template prompt:
        template = open("prompt_template.txt").read()
        return template.format(user_name="...", context="...")
    """
    raise NotImplementedError(
        "Configure load_prompt() to match how the production system assembles its prompt."
    )


def build_user_prompt(request: str, **context) -> str:
    """
    Assemble the user-side message with app state context.

    This is a stub — customize it to match how your production system
    builds the user message from a request + context.

    Example:
        existing_tasks = context.get("existing_tasks", "")
        if existing_tasks:
            return f"Current state:\\n{existing_tasks}\\n\\nRequest: {request}"
        return request
    """
    # Default: no context assembly, just return the request as-is
    return request


# =============================================================================
# TEST CASES — Define inputs and validators
# =============================================================================

# Each test case is a dict with:
#   "id":          Short identifier (e.g., "basic_greeting")
#   "description": What this test checks
#   "input":       The user message to send (str for text, dict for multimodal)
#   "validate":    A function(response_text) -> (passed: bool, reason: str)
#   "tags":        Optional list of tags for filtering
#   "context":     Optional dict to pass to build_user_prompt()
#
# For multimodal inputs (text + images), use a dict:
#   "input": {
#       "text": "Analyze these images",
#       "images": ["path/to/image1.jpg", "path/to/image2.png"]
#   }

TEST_CASES: list[dict[str, Any]] = [
    # Example test case — replace with real ones
    # {
    #     "id": "basic_greeting",
    #     "description": "Simple greeting produces valid JSON with expected fields",
    #     "input": "Hello, how are you?",
    #     "validate": lambda resp: validate_json_structure(resp, required_fields=["message"]),
    #     "tags": ["basic", "json"],
    # },
]


# =============================================================================
# VALIDATORS — Reusable validation functions
# =============================================================================

def validate_json_parseable(response: str) -> tuple[bool, str]:
    """Check that the response is valid JSON (strips code fences if present)."""
    cleaned = strip_code_fences(response)
    try:
        json.loads(cleaned)
        return True, "Valid JSON"
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON: {e}"


def validate_json_structure(response: str, required_fields: list[str]) -> tuple[bool, str]:
    """Check that parsed JSON contains all required top-level fields."""
    cleaned = strip_code_fences(response)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON: {e}"

    if isinstance(data, list):
        # If the response is an array, check the first element
        if len(data) == 0:
            return False, "JSON array is empty"
        data = data[0]

    missing = [f for f in required_fields if f not in data]
    if missing:
        return False, f"Missing fields: {missing}"
    return True, "All required fields present"


def validate_json_field_type(response: str, field: str, expected_type: type) -> tuple[bool, str]:
    """Check that a specific JSON field has the expected type."""
    cleaned = strip_code_fences(response)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON: {e}"

    if isinstance(data, list) and len(data) > 0:
        data = data[0]

    if field not in data:
        return False, f"Field '{field}' not found"
    if not isinstance(data[field], expected_type):
        return False, f"Field '{field}' is {type(data[field]).__name__}, expected {expected_type.__name__}"
    return True, f"Field '{field}' has correct type"


def validate_json_field_value(response: str, field: str, allowed_values: list) -> tuple[bool, str]:
    """Check that a JSON field's value is in the allowed set."""
    cleaned = strip_code_fences(response)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON: {e}"

    if isinstance(data, list) and len(data) > 0:
        data = data[0]

    if field not in data:
        return False, f"Field '{field}' not found"
    if data[field] not in allowed_values:
        return False, f"Field '{field}' = '{data[field]}', expected one of {allowed_values}"
    return True, f"Field '{field}' has valid value"


def validate_json_array_length(response: str, field: str, min_len: int = 0, max_len: int = 999) -> tuple[bool, str]:
    """Check that a JSON array field has length within bounds."""
    cleaned = strip_code_fences(response)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON: {e}"

    if isinstance(data, list):
        # If the top-level response is the array
        arr = data
    else:
        if field not in data:
            return False, f"Field '{field}' not found"
        arr = data[field]

    if not isinstance(arr, list):
        return False, f"Field '{field}' is not an array"
    if len(arr) < min_len:
        return False, f"Array '{field}' has {len(arr)} items, minimum is {min_len}"
    if len(arr) > max_len:
        return False, f"Array '{field}' has {len(arr)} items, maximum is {max_len}"
    return True, f"Array '{field}' length {len(arr)} is within [{min_len}, {max_len}]"


def validate_max_nesting_depth(response: str, max_depth: int) -> tuple[bool, str]:
    """Check that JSON nesting does not exceed a maximum depth.

    Useful for preventing over-nesting in structured outputs. Counts the
    deepest path through nested objects/arrays.
    """
    cleaned = strip_code_fences(response)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON: {e}"

    def measure_depth(obj, current=0):
        if isinstance(obj, dict):
            if not obj:
                return current
            return max(measure_depth(v, current + 1) for v in obj.values())
        elif isinstance(obj, list):
            if not obj:
                return current
            return max(measure_depth(item, current + 1) for item in obj)
        return current

    depth = measure_depth(data)
    if depth > max_depth:
        return False, f"Nesting depth {depth} exceeds maximum {max_depth}"
    return True, f"Nesting depth {depth} <= {max_depth}"


def validate_no_banned_words(response: str, banned_words: list[str], field: str | None = None) -> tuple[bool, str]:
    """Check that response (or a specific field) doesn't contain banned words.

    Useful for detecting meta-task verbs, AI-generated filler, etc.
    """
    cleaned = strip_code_fences(response)

    check_text = cleaned
    if field:
        try:
            data = json.loads(cleaned)
            if isinstance(data, list):
                # Check across all items in the array
                check_text = " ".join(
                    str(item.get(field, "")) for item in data if isinstance(item, dict)
                )
            elif isinstance(data, dict):
                check_text = str(data.get(field, ""))
        except json.JSONDecodeError:
            check_text = cleaned

    found = []
    for word in banned_words:
        if re.search(r'\b' + re.escape(word) + r'\b', check_text, re.IGNORECASE):
            found.append(word)

    if found:
        return False, f"Banned words found: {found}"
    return True, "No banned words found"


def validate_field_word_count(response: str, field: str, min_words: int = 1, max_words: int = 999) -> tuple[bool, str]:
    """Check that a text field's word count is within bounds."""
    cleaned = strip_code_fences(response)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON: {e}"

    if isinstance(data, list) and len(data) > 0:
        data = data[0]

    if field not in data:
        return False, f"Field '{field}' not found"

    word_count = len(str(data[field]).split())
    if word_count < min_words:
        return False, f"Field '{field}' has {word_count} words, minimum is {min_words}"
    if word_count > max_words:
        return False, f"Field '{field}' has {word_count} words, maximum is {max_words}"
    return True, f"Field '{field}' word count {word_count} is within [{min_words}, {max_words}]"


def validate_regex(response: str, pattern: str, description: str = "") -> tuple[bool, str]:
    """Check that the response matches a regex pattern."""
    if re.search(pattern, response, re.DOTALL):
        return True, f"Matches pattern: {description or pattern}"
    return False, f"Does not match pattern: {description or pattern}"


def validate_no_pattern(response: str, pattern: str, description: str = "") -> tuple[bool, str]:
    """Check that the response does NOT contain a pattern."""
    if re.search(pattern, response, re.DOTALL):
        return False, f"Unwanted pattern found: {description or pattern}"
    return True, f"Pattern absent as expected: {description or pattern}"


def validate_max_length(response: str, max_chars: int) -> tuple[bool, str]:
    """Check that response length is within bounds."""
    if len(response) <= max_chars:
        return True, f"Length {len(response)} <= {max_chars}"
    return False, f"Length {len(response)} exceeds max {max_chars}"


def validate_item_count(response: str, min_items: int = 1, max_items: int = 999) -> tuple[bool, str]:
    """For array responses, check the number of top-level items."""
    cleaned = strip_code_fences(response)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON: {e}"

    if not isinstance(data, list):
        # Might be a single object — count as 1
        count = 1
    else:
        count = len(data)

    if count < min_items:
        return False, f"Got {count} items, minimum is {min_items}"
    if count > max_items:
        return False, f"Got {count} items, maximum is {max_items}"
    return True, f"Item count {count} is within [{min_items}, {max_items}]"


def validate_no_duplication(response: str, notes_field: str, children_field: str) -> tuple[bool, str]:
    """Check that content doesn't appear in both notes and children.

    A common failure pattern: the model puts the same information in the notes
    field AND as subtasks/children, duplicating content.
    """
    cleaned = strip_code_fences(response)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON: {e}"

    items = data if isinstance(data, list) else [data]

    for item in items:
        if not isinstance(item, dict):
            continue
        notes = str(item.get(notes_field, "")).lower()
        children = item.get(children_field, [])
        if not isinstance(children, list) or not notes:
            continue

        for child in children:
            if isinstance(child, dict):
                child_title = str(child.get("title", child.get("name", ""))).lower()
                if child_title and child_title in notes:
                    return False, f"Duplication: child '{child_title}' also appears in notes"

    return True, "No duplication between notes and children"


def validate_custom(response: str, check_fn: Callable, description: str = "") -> tuple[bool, str]:
    """Run an arbitrary check function on the response."""
    try:
        result = check_fn(response)
        if result:
            return True, f"Custom check passed: {description}"
        return False, f"Custom check failed: {description}"
    except Exception as e:
        return False, f"Custom check error: {e}"


# =============================================================================
# YAML TEST CASE LOADER
# =============================================================================

def load_test_cases_from_yaml(yaml_path: str) -> list[dict[str, Any]]:
    """
    Load test cases from a YAML file and convert YAML checks to validator calls.

    YAML format:
        - id: test_id
          input: "user input"
          context:
            key: value
          checks:
            - type: json_parseable
            - type: json_fields
              fields: [field1, field2]
            - type: json_field_type
              field: name
              expected: str
            - type: json_field_value
              field: status
              allowed: [active, inactive]
            - type: json_array_length
              field: items
              min_len: 1
              max_len: 10
            - type: max_nesting_depth
              max_depth: 3
            - type: no_banned_words
              words: [meta, think]
              field: content
            - type: field_word_count
              field: description
              min_words: 5
              max_words: 100
            - type: regex_match
              pattern: "\\d{3}"
              description: "contains 3 digits"
            - type: regex_absent
              pattern: "ERROR"
            - type: max_length
              max_chars: 1000
            - type: item_count
              min_items: 1
              max_items: 5
            - type: no_duplication
              notes_field: notes
              children_field: children
            - type: contains
              substring: "success"
            - type: not_contains
              substring: "error"

    Returns a list of test cases with validator functions attached.
    """
    try:
        import yaml
    except ImportError:
        print("ERROR: pyyaml not installed. Run: pip install pyyaml")
        sys.exit(1)

    with open(yaml_path, "r") as f:
        yaml_data = yaml.safe_load(f)

    if not yaml_data:
        return []

    # Support both flat list and wrapped {"test_cases": [...]} formats
    if isinstance(yaml_data, dict) and "test_cases" in yaml_data:
        yaml_data = yaml_data["test_cases"]

    if not isinstance(yaml_data, list):
        print(f"ERROR: YAML data is not a list (got {type(yaml_data).__name__})")
        return []

    test_cases = []
    for test in yaml_data:
        test_id = test.get("id", "unknown")
        description = test.get("description", test_id)
        input_text = test.get("input")
        context = test.get("context", {})
        checks = test.get("checks", [])
        tags = test.get("tags", [])

        # Build a validator that runs all checks
        def build_validator(check_list, ctx):
            def validate(response):
                for check in check_list:
                    check_type = check.get("type", "").lower()

                    # Route to the appropriate validator based on check type
                    if check_type == "json_parseable":
                        passed, reason = validate_json_parseable(response)
                    elif check_type == "json_fields":
                        fields = check.get("fields", [])
                        passed, reason = validate_json_structure(response, fields)
                    elif check_type == "json_field_type":
                        field = check.get("field")
                        expected = check.get("expected")
                        # Map string type names to Python types
                        type_map = {
                            "str": str, "string": str,
                            "int": int, "integer": int,
                            "float": float,
                            "bool": bool, "boolean": bool,
                            "list": list, "array": list,
                            "dict": dict, "object": dict,
                        }
                        expected_type = type_map.get(expected, str)
                        passed, reason = validate_json_field_type(response, field, expected_type)
                    elif check_type == "json_field_value":
                        field = check.get("field")
                        allowed = check.get("allowed", [])
                        passed, reason = validate_json_field_value(response, field, allowed)
                    elif check_type == "json_array_length":
                        field = check.get("field")
                        min_len = check.get("min_len", 0)
                        max_len = check.get("max_len", 999)
                        passed, reason = validate_json_array_length(response, field, min_len, max_len)
                    elif check_type == "max_nesting_depth":
                        max_depth = check.get("max_depth", 5)
                        passed, reason = validate_max_nesting_depth(response, max_depth)
                    elif check_type == "no_banned_words":
                        words = check.get("words", [])
                        field = check.get("field")
                        passed, reason = validate_no_banned_words(response, words, field)
                    elif check_type == "field_word_count":
                        field = check.get("field")
                        min_words = check.get("min_words", 1)
                        max_words = check.get("max_words", 999)
                        passed, reason = validate_field_word_count(response, field, min_words, max_words)
                    elif check_type == "regex_match":
                        pattern = check.get("pattern")
                        description = check.get("description", "")
                        passed, reason = validate_regex(response, pattern, description)
                    elif check_type == "regex_absent":
                        pattern = check.get("pattern")
                        description = check.get("description", "")
                        passed, reason = validate_no_pattern(response, pattern, description)
                    elif check_type == "max_length":
                        max_chars = check.get("max_chars", 5000)
                        passed, reason = validate_max_length(response, max_chars)
                    elif check_type == "item_count":
                        min_items = check.get("min_items", 1)
                        max_items = check.get("max_items", 999)
                        passed, reason = validate_item_count(response, min_items, max_items)
                    elif check_type == "no_duplication":
                        notes_field = check.get("notes_field", "notes")
                        children_field = check.get("children_field", "children")
                        passed, reason = validate_no_duplication(response, notes_field, children_field)
                    elif check_type == "contains":
                        substring = check.get("substring", "")
                        passed = substring in response
                        reason = f"Contains '{substring}'" if passed else f"Does not contain '{substring}'"
                    elif check_type == "not_contains":
                        substring = check.get("substring", "")
                        passed = substring not in response
                        reason = f"Does not contain '{substring}'" if passed else f"Contains unwanted '{substring}'"
                    else:
                        passed, reason = False, f"Unknown check type: {check_type}"

                    # Return on first failure
                    if not passed:
                        return False, reason

                # All checks passed
                return True, "All checks passed"

            return validate

        test_case = {
            "id": test_id,
            "description": description,
            "input": input_text,
            "validate": build_validator(checks, context),
            "tags": tags,
            "context": context if context else None,
        }

        test_cases.append(test_case)

    return test_cases


# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def strip_code_fences(text: str) -> str:
    """Remove markdown code fences if present. Models sometimes wrap JSON in ```json blocks."""
    text = text.strip()
    if text.startswith("```"):
        # Remove opening fence (with optional language tag)
        first_newline = text.index("\n") if "\n" in text else len(text)
        text = text[first_newline + 1:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def encode_image_base64(image_path: str) -> tuple[str, str]:
    """Read an image file and return (base64_data, mime_type)."""
    path = Path(image_path)
    mime_map = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".gif": "image/gif",
        ".webp": "image/webp", ".bmp": "image/bmp",
    }
    mime_type = mime_map.get(path.suffix.lower(), "image/jpeg")
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode("utf-8")
    return data, mime_type


def ensure_save_directory(save_dir: str) -> None:
    """Create the directory structure for saving results."""
    Path(save_dir).mkdir(parents=True, exist_ok=True)
    Path(save_dir, "prompts").mkdir(exist_ok=True)
    Path(save_dir, "results").mkdir(exist_ok=True)

    # Create failure_log.md template if it doesn't exist
    log_path = Path(save_dir, "failure_log.md")
    if not log_path.exists():
        template = """# Failure Log

Track failures and their resolutions here.

## Format
- **Date**: YYYY-MM-DD
- **Test ID**: test_id
- **Failure**: What failed
- **Root Cause**: Why it failed
- **Resolution**: What was changed
- **Prompt Version**: Which version fixed it

---
"""
        log_path.write_text(template)


def get_next_version_number(save_dir: str) -> int:
    """Get the next version number for saving prompts."""
    prompts_dir = Path(save_dir, "prompts")
    if not prompts_dir.exists():
        return 1
    existing = list(prompts_dir.glob("v*.txt"))
    if not existing:
        return 1
    versions = []
    for f in existing:
        try:
            v = int(f.stem[1:])
            versions.append(v)
        except (ValueError, IndexError):
            pass
    return max(versions) + 1 if versions else 1


def save_prompt(prompt: str, save_dir: str) -> str:
    """Save prompt to versioned file and return path."""
    ensure_save_directory(save_dir)
    version = get_next_version_number(save_dir)
    prompt_path = Path(save_dir, "prompts", f"v{version}.txt")
    prompt_path.write_text(prompt)
    return str(prompt_path)


def save_results(results: list[dict], save_dir: str, timestamp: str = None) -> str:
    """Save results JSON to dated file and return path."""
    if timestamp is None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    ensure_save_directory(save_dir)
    results_path = Path(save_dir, "results", f"run_{timestamp}.json")
    results_path.write_text(json.dumps(results, indent=2))
    return str(results_path)


def estimate_api_cost(num_tests: int, num_runs: int, model_name: str) -> tuple[int, float]:
    """Estimate API call count and cost (rough).

    This is a placeholder — customize based on your actual cost model.
    Returns (estimated_calls, estimated_dollars).
    """
    calls = num_tests * num_runs
    # Rough cost estimates per call (input + output)
    cost_per_call = {
        "gpt-4o": 0.005,
        "gpt-4": 0.010,
        "gpt-3.5-turbo": 0.001,
        "claude-sonnet": 0.003,
        "claude-opus": 0.010,
        "gemini-2.5-flash": 0.0001,
        "gemini-pro": 0.0005,
    }
    rate = cost_per_call.get(model_name, 0.005)
    return calls, calls * rate


# =============================================================================
# API CALL FUNCTIONS — One per provider
# =============================================================================

def call_gemini(system_prompt: str, user_input: str | dict, config: dict) -> tuple[str, dict]:
    """Make a raw API call to Google Gemini. Supports text and multimodal inputs.

    Returns (response_text, metadata) where metadata includes token info if available.
    """
    api_key = os.environ.get(config["api_key_env"], "")
    if not api_key:
        raise RuntimeError(f"Set {config['api_key_env']} environment variable")

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{config['model']}:generateContent?key={api_key}"
    )

    # Build user content parts
    if isinstance(user_input, dict):
        parts = []
        if user_input.get("text"):
            parts.append({"text": user_input["text"]})
        for img_path in user_input.get("images", []):
            img_data, mime = encode_image_base64(img_path)
            parts.append({"inline_data": {"mime_type": mime, "data": img_data}})
    else:
        parts = [{"text": user_input}]

    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "temperature": config.get("temperature", 1.0),
            "maxOutputTokens": config.get("max_tokens", 8192),
        },
    }

    result = subprocess.run(
        ["curl", "-s", "-X", "POST", url,
         "-H", "Content-Type: application/json",
         "-d", json.dumps(payload)],
        capture_output=True, text=True, timeout=120
    )

    response = json.loads(result.stdout)
    if "candidates" not in response:
        raise RuntimeError(f"API error: {json.dumps(response, indent=2)}")

    metadata = {}
    if "usageMetadata" in response:
        metadata["input_tokens"] = response["usageMetadata"].get("promptTokenCount", 0)
        metadata["output_tokens"] = response["usageMetadata"].get("candidatesTokenCount", 0)

    return response["candidates"][0]["content"]["parts"][0]["text"], metadata


def call_openai(system_prompt: str, user_input: str | dict, config: dict) -> tuple[str, dict]:
    """Make a raw API call to OpenAI (or compatible endpoint). Supports multimodal."""
    api_key = os.environ.get(config["api_key_env"], "")
    if not api_key:
        raise RuntimeError(f"Set {config['api_key_env']} environment variable")

    endpoint = config.get("endpoint", "https://api.openai.com/v1/chat/completions")

    # Build user message content
    if isinstance(user_input, dict):
        content = []
        if user_input.get("text"):
            content.append({"type": "text", "text": user_input["text"]})
        for img_path in user_input.get("images", []):
            img_data, mime = encode_image_base64(img_path)
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{img_data}"}
            })
    else:
        content = user_input

    payload = {
        "model": config["model"],
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": content},
        ],
        "temperature": config.get("temperature", 0.7),
        "max_tokens": config.get("max_tokens", 4096),
    }

    result = subprocess.run(
        ["curl", "-s", "-X", "POST", endpoint,
         "-H", "Content-Type: application/json",
         "-H", f"Authorization: Bearer {api_key}",
         "-d", json.dumps(payload)],
        capture_output=True, text=True, timeout=120
    )

    response = json.loads(result.stdout)
    if "choices" not in response:
        raise RuntimeError(f"API error: {json.dumps(response, indent=2)}")

    metadata = {}
    if "usage" in response:
        metadata["input_tokens"] = response["usage"].get("prompt_tokens", 0)
        metadata["output_tokens"] = response["usage"].get("completion_tokens", 0)

    return response["choices"][0]["message"]["content"], metadata


def call_anthropic(system_prompt: str, user_input: str | dict, config: dict) -> tuple[str, dict]:
    """Make a raw API call to Anthropic. Supports multimodal."""
    api_key = os.environ.get(config["api_key_env"], "")
    if not api_key:
        raise RuntimeError(f"Set {config['api_key_env']} environment variable")

    # Build user message content
    if isinstance(user_input, dict):
        content = []
        if user_input.get("text"):
            content.append({"type": "text", "text": user_input["text"]})
        for img_path in user_input.get("images", []):
            img_data, mime = encode_image_base64(img_path)
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": mime, "data": img_data}
            })
    else:
        content = user_input

    payload = {
        "model": config["model"],
        "max_tokens": config.get("max_tokens", 4096),
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": content},
        ],
    }

    if "temperature" in config:
        payload["temperature"] = config["temperature"]

    result = subprocess.run(
        ["curl", "-s", "-X", "POST", "https://api.anthropic.com/v1/messages",
         "-H", "Content-Type: application/json",
         "-H", f"x-api-key: {api_key}",
         "-H", "anthropic-version: 2023-06-01",
         "-d", json.dumps(payload)],
        capture_output=True, text=True, timeout=120
    )

    response = json.loads(result.stdout)
    if "content" not in response:
        raise RuntimeError(f"API error: {json.dumps(response, indent=2)}")

    metadata = {}
    if "usage" in response:
        metadata["input_tokens"] = response["usage"].get("input_tokens", 0)
        metadata["output_tokens"] = response["usage"].get("output_tokens", 0)

    return response["content"][0]["text"], metadata


PROVIDERS = {
    "gemini": call_gemini,
    "openai": call_openai,
    "anthropic": call_anthropic,
}


# =============================================================================
# TEST RUNNER
# =============================================================================

def call_api(system_prompt: str, user_input: str | dict) -> tuple[str, dict]:
    """Route to the configured provider. Returns (response_text, metadata)."""
    provider = API_CONFIG["provider"]
    if provider == "UNCONFIGURED":
        raise RuntimeError("Configure API_CONFIG before running tests.")
    if provider not in PROVIDERS:
        raise RuntimeError(f"Unknown provider: {provider}. Available: {list(PROVIDERS.keys())}")
    return PROVIDERS[provider](system_prompt, user_input, API_CONFIG)


def run_single_test(test_case: dict, system_prompt: str, num_runs: int = 1, retries: int = 1) -> dict:
    """Run a single test case with multiple runs for nondeterminism testing.

    A test passes only if ALL runs pass. A flaky test is a failing test.
    Retries are used for transient API failures (connection errors, 5xx).
    """
    result = {
        "id": test_case["id"],
        "description": test_case["description"],
        "tags": test_case.get("tags", []),
        "runs": [],
        "passed": True,  # Innocent until proven guilty
        "pass_rate": "0/0",
        "total_tokens": 0,
    }

    passes = 0
    for run_idx in range(num_runs):
        run_data = {"run": run_idx + 1, "passed": False, "reason": "", "response": None, "tokens": 0}

        # Get the user input (with context if available)
        user_input = test_case["input"]
        context = test_case.get("context")
        if context:
            user_input = build_user_prompt(user_input, **context)

        # Try with retries on transient failures
        attempt = 0
        while attempt < retries:
            try:
                response, metadata = call_api(system_prompt, user_input)
                run_data["response"] = response

                # Extract token info
                tokens = metadata.get("input_tokens", 0) + metadata.get("output_tokens", 0)
                run_data["tokens"] = tokens
                result["total_tokens"] += tokens

                passed, reason = test_case["validate"](response)
                run_data["passed"] = passed
                run_data["reason"] = reason
                if passed:
                    passes += 1
                else:
                    result["passed"] = False  # Any failure means overall failure
                break  # Success, don't retry
            except (ConnectionError, TimeoutError) as e:
                attempt += 1
                if attempt < retries:
                    time.sleep(1)  # Brief backoff before retry
                    continue
                run_data["reason"] = f"Error after {retries} retries: {e}"
                result["passed"] = False
                break
            except Exception as e:
                run_data["reason"] = f"Error: {e}"
                result["passed"] = False
                break

        result["runs"].append(run_data)

        if run_idx < num_runs - 1:
            time.sleep(0.5)  # Brief pause between runs

    result["pass_rate"] = f"{passes}/{num_runs}"
    return result


def run_all_tests(
    system_prompt: str,
    test_cases: list[dict] | None = None,
    num_runs: int = 1,
    tags: list[str] | None = None,
    test_id: str | None = None,
    delay_between: float = 0.5,
    retries: int = 1,
) -> list[dict]:
    """Run all test cases (or a filtered subset) and return results."""
    cases = test_cases or TEST_CASES

    if test_id:
        cases = [tc for tc in cases if tc["id"] == test_id]
        if not cases:
            print(f"ERROR: No test case found with id '{test_id}'")
            sys.exit(1)

    if tags:
        cases = [tc for tc in cases if any(t in tc.get("tags", []) for t in tags)]

    if not cases:
        print("No test cases to run.")
        sys.exit(1)

    run_label = f" x{num_runs} runs" if num_runs > 1 else ""
    print(f"Running {len(cases)} tests{run_label}...\n")

    results = []
    for i, tc in enumerate(cases):
        if i > 0:
            time.sleep(delay_between)

        print(f"  [{i+1}/{len(cases)}] {tc['id']}", end="", flush=True)
        if num_runs > 1:
            print(f" ({num_runs} runs)", end="", flush=True)
        print("...", end=" ", flush=True)

        result = run_single_test(tc, system_prompt, num_runs, retries)
        status = "PASS" if result["passed"] else "FAIL"
        rate = result["pass_rate"]

        if num_runs > 1:
            print(f"{status} ({rate})")
        else:
            print(status)

        results.append(result)

    return results


def print_summary(results: list[dict], verbose: bool = False, total_tokens: int = 0) -> None:
    """Print a concise test summary with optional verbose failure details."""
    passed = sum(1 for r in results if r["passed"])
    total = len(results)

    print(f"\n{'='*60}")
    print(f"Results: {passed}/{total} passed")
    if total_tokens > 0:
        print(f"Total tokens: {total_tokens}")
        # Rough estimate: $0.05 per 1M tokens average
        estimated_cost = (total_tokens / 1_000_000) * 0.05
        print(f"Estimated cost: ${estimated_cost:.4f}")
    print(f"{'='*60}")

    failures = [r for r in results if not r["passed"]]
    if failures:
        print("\nFailures:")
        for f in failures:
            print(f"\n  {f['id']} [{f['pass_rate']}]")
            print(f"    {f['description']}")
            for run in f["runs"]:
                if not run["passed"]:
                    print(f"    Run {run['run']}: {run['reason']}")
                    if verbose and run["response"]:
                        preview = run["response"][:300]
                        print(f"    Response: {preview}...")

    # Flaky tests (passed overall but with inconsistent runs)
    flaky = [r for r in results if r["passed"] and "/" in r["pass_rate"]]
    if flaky:
        actually_flaky = [r for r in flaky if r["pass_rate"].split("/")[0] != r["pass_rate"].split("/")[1]
                          and int(r["pass_rate"].split("/")[1]) > 1]
        if actually_flaky:
            print("\nFlaky (passed but inconsistent):")
            for f in actually_flaky:
                print(f"  {f['id']}: {f['pass_rate']}")

    print()


def print_results_table(results: list[dict]) -> None:
    """Print results as a markdown table for easy copy-paste into failure logs."""
    print("\n| Test ID | Status | Pass Rate | Notes |")
    print("|---------|--------|-----------|-------|")
    for r in results:
        status = "PASS" if r["passed"] else "FAIL"
        notes = ""
        if not r["passed"]:
            last_fail = next((run for run in reversed(r["runs"]) if not run["passed"]), None)
            if last_fail:
                notes = last_fail["reason"][:60]
        print(f"| {r['id']} | {status} | {r['pass_rate']} | {notes} |")
    print()


def print_cross_model_comparison(all_results: dict[str, list[dict]]) -> None:
    """Print a comparison table across multiple models."""
    print(f"\n{'='*80}")
    print("CROSS-MODEL COMPARISON")
    print(f"{'='*80}\n")

    # Build header
    models = list(all_results.keys())
    header = "| Test ID |"
    for model in models:
        header += f" {model[:20]} |"
    print(header)
    print("|" + "|".join(["-" * 20 for _ in range(len(models) + 1)]) + "|")

    # Gather all test IDs
    all_test_ids = set()
    for results in all_results.values():
        for r in results:
            all_test_ids.add(r["id"])

    # Print rows
    for test_id in sorted(all_test_ids):
        row = f"| {test_id[:20]} |"
        for model in models:
            result = next((r for r in all_results[model] if r["id"] == test_id), None)
            if result:
                status = "PASS" if result["passed"] else "FAIL"
                row += f" {status} ({result['pass_rate']}) |"
            else:
                row += " — |"
        print(row)

    print()

    # Summary per model
    print("\nModel Summary:")
    for model in models:
        results = all_results[model]
        passed = sum(1 for r in results if r["passed"])
        total = len(results)
        total_tokens = sum(r.get("total_tokens", 0) for r in results)
        print(f"  {model}: {passed}/{total} passed, {total_tokens} tokens")

    print()


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="Prompt Evolution Test Harness")
    parser.add_argument("--runs", type=int, default=1,
                        help="Number of times to run each test (for nondeterminism)")
    parser.add_argument("--tags", type=str, default=None,
                        help="Comma-separated tags to filter tests")
    parser.add_argument("--test", type=str, default=None,
                        help="Run a single test by ID")
    parser.add_argument("--verbose", action="store_true",
                        help="Show full response text for failures")
    parser.add_argument("--table", action="store_true",
                        help="Print results as a markdown table")
    parser.add_argument("--delay", type=float, default=0.5,
                        help="Delay between tests in seconds (for rate limiting)")

    # YAML test cases
    parser.add_argument("--yaml", type=str, default=None,
                        help="Load test cases from YAML file")

    # Session persistence
    parser.add_argument("--save-to", type=str, default=None,
                        help="Directory to save prompts and results")
    parser.add_argument("--prompt-file", type=str, default=None,
                        help="Load prompt from saved version file instead of load_prompt()")

    # Cross-model testing
    parser.add_argument("--models", type=str, default=None,
                        help="Comma-separated models: provider:model:key_env,...")

    # Cost tracking
    parser.add_argument("--dry-run", action="store_true",
                        help="Estimate API calls and cost without running")

    # Retry/timeout
    parser.add_argument("--retries", type=int, default=1,
                        help="Number of retries for transient API failures")

    args = parser.parse_args()

    # Load test cases (Python + YAML)
    test_cases = list(TEST_CASES)  # Start with defined test cases
    if args.yaml:
        yaml_cases = load_test_cases_from_yaml(args.yaml)
        test_cases.extend(yaml_cases)

    if not test_cases:
        print("ERROR: No test cases found. Define TEST_CASES or use --yaml")
        sys.exit(1)

    # Handle cross-model testing
    if args.models:
        model_configs = []
        for model_spec in args.models.split(","):
            parts = model_spec.strip().split(":")
            if len(parts) != 3:
                print(f"ERROR: Invalid model spec '{model_spec}'. Use: provider:model:key_env")
                sys.exit(1)
            provider, model, key_env = parts
            model_configs.append({
                "provider": provider,
                "model": model,
                "api_key_env": key_env,
            })

        # Load prompt once
        if args.prompt_file:
            prompt = Path(args.prompt_file).read_text()
        else:
            print("Loading prompt...")
            prompt = load_prompt()
        print(f"Prompt length: {len(prompt)} chars\n")

        all_results = {}
        for config in model_configs:
            API_CONFIG.update(config)
            model_label = f"{config['provider']}:{config['model']}"
            print(f"\n{'='*60}")
            print(f"Testing: {model_label}")
            print(f"{'='*60}\n")

            tags = args.tags.split(",") if args.tags else None
            results = run_all_tests(
                prompt,
                test_cases=test_cases,
                num_runs=args.runs,
                tags=tags,
                test_id=args.test,
                delay_between=args.delay,
                retries=args.retries,
            )

            all_results[model_label] = results
            print_summary(results, verbose=args.verbose)

            if args.save_to:
                save_results(results, args.save_to, timestamp=datetime.now().strftime("%Y%m%d_%H%M%S"))

        print_cross_model_comparison(all_results)
        sys.exit(0)

    # Dry-run: estimate cost (before prompt loading, since prompt may not be configured yet)
    if args.dry_run:
        filtered = test_cases
        if args.tags:
            tag_list = args.tags.split(",")
            filtered = [tc for tc in filtered if any(t in tc.get("tags", []) for t in tag_list)]
        if args.test:
            filtered = [tc for tc in filtered if tc["id"] == args.test]
        test_count = len(filtered)
        calls, cost = estimate_api_cost(test_count, args.runs, API_CONFIG.get("model", "unknown"))
        print(f"Dry-run estimate:")
        print(f"  Tests: {test_count}")
        print(f"  Runs: {args.runs}")
        print(f"  Estimated API calls: {calls}")
        print(f"  Estimated cost: ${cost:.4f}")
        print()
        sys.exit(0)

    # Single model testing — load prompt
    if args.prompt_file:
        prompt = Path(args.prompt_file).read_text()
        print(f"Loaded prompt from {args.prompt_file}")
    else:
        print("Loading prompt...")
        prompt = load_prompt()

    print(f"Prompt length: {len(prompt)} chars")
    print(f"Provider: {API_CONFIG['provider']} / {API_CONFIG.get('model', '?')}")
    print(f"Temperature: {API_CONFIG.get('temperature', 'default')}")
    print()

    # Run tests
    tags = args.tags.split(",") if args.tags else None
    results = run_all_tests(
        prompt,
        test_cases=test_cases,
        num_runs=args.runs,
        tags=tags,
        test_id=args.test,
        delay_between=args.delay,
        retries=args.retries,
    )

    total_tokens = sum(r.get("total_tokens", 0) for r in results)
    print_summary(results, verbose=args.verbose, total_tokens=total_tokens)

    if args.table:
        print_results_table(results)

    # Save results
    if args.save_to:
        prompt_path = save_prompt(prompt, args.save_to)
        results_path = save_results(results, args.save_to)
        print(f"Saved prompt: {prompt_path}")
        print(f"Saved results: {results_path}\n")

    sys.exit(0 if all(r["passed"] for r in results) else 1)


if __name__ == "__main__":
    main()
