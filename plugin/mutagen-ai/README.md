# mutagen-ai Plugin

Test-driven prompt evolution toolkit for Claude.

## What It Does

mutagen-ai helps you systematically test, diagnose, and improve AI system prompts. Define test cases in YAML, run them against any LLM provider, diagnose failures, apply targeted mutations, and prove the fixes work.

## Components

- **Skill**: Teaches Claude the five-phase prompt evolution methodology and how to use the mutagen CLI
- **MCP Server**: Exposes mutagen tools directly (run tests, save baselines, compare versions)

## Setup

1. **Node.js 18+** is required
2. The plugin auto-installs `mutagen-ai` via npx on first use
3. Set your API key as an environment variable:
   - OpenAI: `OPENAI_API_KEY`
   - Anthropic: `ANTHROPIC_API_KEY`
   - Google Gemini: `GEMINI_API_KEY`

## Usage

Say things like:
- "Test my prompt"
- "Help me refine this system prompt"
- "My prompt isn't working — it keeps generating the wrong format"
- "Run prompt evolution on my chatbot"

The skill guides Claude through the full optimization loop. The MCP tools let Claude call mutagen directly for running tests and comparing versions.

## Links

- [GitHub](https://github.com/hermitsh/mutagen-ai)
- [npm](https://www.npmjs.com/package/mutagen-ai)
- [PLAYBOOK.md](https://github.com/hermitsh/mutagen-ai/blob/main/PLAYBOOK.md) — Full methodology guide
