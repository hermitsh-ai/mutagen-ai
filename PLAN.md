# mutagen-ai — Production Readiness Plan

**Goal:** Ship mutagen-ai to every channel where agents discover and use tools.  
**Org:** hermitsh (github.com/hermitsh)  
**Distribution:** npm + Claude Code skill + Cowork plugin + MCP server

---

## The Packaging Question (needs decision)

The MCP server and Cowork plugin need to call mutagen's runner. Two approaches:

### Option A: Wrap the CLI / import the library (recommended)

The MCP server `import`s from `mutagen-ai` (the npm package). The user or agent runs `npm install -g mutagen-ai` first. The Cowork plugin declares this as a prerequisite.

**Pros:**
- Single source of truth — one codebase, one version
- MCP server is tiny (just a thin adapter layer)
- Updates to mutagen-ai automatically flow through
- The audience IS developers/prompt engineers — `npm install` isn't friction for them

**Cons:**
- Requires Node.js + npm on the machine
- Extra setup step before first use

### Option B: Self-contained bundle

Bundle mutagen's runner, validators, providers, and the yaml dependency into the plugin/MCP server directly. No external install needed.

**Pros:**
- Zero-friction "just works" install
- No dependency on global npm packages

**Cons:**
- Two copies of the code to maintain
- Plugin updates lag behind npm releases
- Bundling complexity (need esbuild/rollup step)
- Larger plugin size

### Recommendation: Option A

mutagen-ai is a developer tool for prompt engineers. Anyone using it already has Node.js. The MCP server should `import { runTests, loadTestCasesFromYaml, loadPrompt } from "mutagen-ai"` and expose those as tools. The Cowork plugin's setup step can auto-run `npm install -g mutagen-ai` if it's missing.

If Cowork ever targets a less-technical audience, we can revisit with a bundled version later.

---

## Phase 1: Code Cleanup & Hygiene

**Branch:** do this work on `feat/mutagen-hardening-semantic-judge`, then merge to `main`.

### 1.1 Add .gitignore
```
node_modules/
dist/
.test-tmp/
*.tgz
```

### 1.2 Remove legacy Python harness
- Delete `templates/test_harness.py` — the CLI replaces it entirely
- Keep `templates/test_cases.yaml` (it's a useful reference for check types)
- Keep `templates/engagement_template.md` and `templates/failure_log.md` (referenced by `init` command, and useful as standalone templates)

### 1.3 Clean up .test-tmp/
- Add `.test-tmp/` to `.gitignore`
- Delete the three untracked test files (they're scratch work)

### 1.4 Review and update package.json
- Bump version to `0.2.0` (this is a meaningful feature release: semantic judge, hardened runner)
- Verify `files` array only includes what should ship
- Add `"type": "module"` or verify CJS/ESM story is clean
- Consider adding `engines` field for minimum npm version

### 1.5 Merge to main
- Squash or merge `feat/mutagen-hardening-semantic-judge` → `main`
- Tag `v0.2.0`
- Delete the feature branch

---

## Phase 2: Feature Gaps

### 2.1 Judge config in YAML
Currently semantic judge is CLI-only. Add support in `mutagen.yaml`:

```yaml
provider: openai
model: gpt-4o
api_key_env: OPENAI_API_KEY
temperature: 0.7
max_tokens: 4096

prompt_file: prompt.txt
test_cases: tests.yaml
runs: 3

# NEW: semantic judge config
judge:
  provider: openai
  model: gpt-4o-mini
  api_key_env: OPENAI_API_KEY
```

Changes needed:
- `loader.ts` — parse `judge` section from config
- `cli.ts` — use config-file judge settings as defaults (CLI flags still override)

### 2.2 JSON output mode
The `--json` flag exists but only in the `run` command. Extend to `baseline` and `compare` for CI/pipeline integration.

### 2.3 Exit codes
Verify all commands exit with proper codes:
- `0` = all tests pass
- `1` = any test fails
- `2` = config/setup error

This matters for CI pipelines and agent tool use.

### 2.4 Consider: parallel test execution
Currently tests run sequentially. For large suites (30+ tests), parallel execution with configurable concurrency would speed things up significantly. This is a nice-to-have, not a blocker.

### 2.5 Consider: `--watch` mode
Re-run tests when prompt.txt changes. Useful during manual iteration. Also nice-to-have.

---

## Phase 3: PLAYBOOK Rewrite

This is critical. The PLAYBOOK is mutagen's killer feature — it's what makes the tool agent-native. But it's currently out of sync with the CLI.

### 3.1 Replace all Python references with CLI commands
Every instance of `python test_harness.py` → the equivalent `mutagen` CLI command.

### 3.2 Update Phase 1 (Context Gathering)
- Reference `mutagen init` for scaffolding
- Remove instructions about copying templates manually (init does it)
- Update the "Setting Up the Engagement Directory" section

### 3.3 Update Phase 2 (Baseline Testing)
- "Build the Test Harness" → "Define your tests in YAML" (no harness to build — it IS the harness)
- Reference `mutagen run --dry-run` for cost estimation
- Reference `mutagen baseline` for saving baselines
- Update code examples to show YAML test definitions, not Python validators

### 3.4 Update Phase 3 (Mutation & Iteration)
- A/B testing section should reference `mutagen compare`
- Update the iteration loop to reference `mutagen run --verbose`

### 3.5 Update Phase 5 (Convergence)
- Reference `mutagen versions` for listing versions
- Reference engagement directory structure as created by `init`

### 3.6 Add semantic judge documentation
- Add a section on when to use `semantic_judge` checks vs. structural checks
- Document the judge config in YAML and CLI flags
- Add examples of good criteria strings

### 3.7 General cleanup
- Remove any remaining references to `templates/test_harness.py`
- Ensure the checklist at the end matches the actual CLI workflow
- Add a "Quick Reference" section at the top with the five most common commands

---

## Phase 4: README Refresh

### 4.1 Update for v0.2.0
- Add semantic judge to the feature list and check types
- Add judge config example to Quick Start
- Update provider examples if any models have changed
- Add a "For AI Agents" section that's more prominent (this is the differentiator)

### 4.2 Add badges
- npm version badge
- License badge
- Node.js version badge

### 4.3 Add a "How It Works" diagram
A simple flow: `prompt.txt → mutagen run → test results → diagnose → mutate → repeat`

---

## Phase 5: Claude Code Skill

Create a SKILL.md that Claude Code agents can read to learn the methodology and operate the CLI.

### 5.1 Structure
```
skills/
  mutagen/
    SKILL.md          # The main skill document
```

### 5.2 SKILL.md content
The skill document should:
- Explain what mutagen-ai does (2-3 sentences)
- Tell the agent to `npm install -g mutagen-ai` if not available
- Provide the condensed five-phase workflow with exact CLI commands
- Include the mutation taxonomy (Levels 1-7) as a quick reference
- Include the failure pattern taxonomy
- Reference the PLAYBOOK for deep dives
- Be self-contained enough that an agent can run the full loop without reading PLAYBOOK.md (but PLAYBOOK.md adds depth)

### 5.3 Trigger description
```
Use this skill when the user wants to: test, evaluate, refine, evolve, debug, 
or optimize an AI system prompt. Also when they mention "prompt testing", 
"prompt regression", "prompt evolution", "prompt mutation", or "test-driven 
prompt engineering".
```

---

## Phase 6: MCP Server

Build an MCP server that exposes mutagen's programmatic API as tools.

### 6.1 Architecture
- TypeScript MCP server using `@modelcontextprotocol/sdk`
- Imports from `mutagen-ai` (the npm package — Option A)
- Exposes 5-6 tools

### 6.2 Tools to expose

| Tool | Description | Parameters |
|------|-------------|------------|
| `mutagen_init` | Scaffold a new engagement | name, provider, model |
| `mutagen_run` | Run test suite against a prompt | config_path, runs, tags, verbose |
| `mutagen_baseline` | Run and save as baseline | config_path, save_to |
| `mutagen_compare` | Compare two prompt versions | v1, v2, config_path, save_to |
| `mutagen_versions` | List saved prompt versions | save_to |
| `mutagen_run_inline` | Run tests with inline prompt + tests (no files needed) | prompt_text, test_cases_yaml, provider, model, api_key_env, runs |

The `mutagen_run_inline` tool is key for agent use — it lets an agent pass prompt text and test YAML directly without having to write files first.

### 6.3 Repository structure
```
mutagen-ai-mcp/
  src/
    server.ts         # MCP server implementation
    tools.ts          # Tool definitions and handlers
  package.json
  tsconfig.json
  README.md
```

Or: include the MCP server in the main `mutagen-ai` repo under `mcp/`.

### 6.4 Decision: separate repo or monorepo?
**Recommendation: same repo, separate package entry point.**

```
mutagen-ai/
  src/           # existing library + CLI
  mcp/
    server.ts    # MCP server
  bin/
    cli.ts       # existing CLI
    mcp.ts       # MCP server entry point
  package.json   # adds "mutagen-mcp" bin entry
```

This way `npm install -g mutagen-ai` gives you both the CLI and the MCP server.

---

## Phase 7: Cowork Plugin

Package everything as a `.plugin` file for Cowork distribution.

### 7.1 Plugin structure
```
mutagen-ai.plugin/
  manifest.json       # Plugin metadata
  skills/
    mutagen/
      SKILL.md        # The skill from Phase 5
  mcp/
    mutagen/
      server.ts       # The MCP server from Phase 6 (or reference to it)
  README.md
```

### 7.2 manifest.json
```json
{
  "name": "mutagen-ai",
  "version": "0.2.0",
  "description": "Test-driven prompt evolution toolkit",
  "author": "hermitsh",
  "homepage": "https://github.com/hermitsh/mutagen-ai",
  "skills": ["skills/mutagen"],
  "mcpServers": {
    "mutagen": {
      "command": "npx",
      "args": ["mutagen-ai", "--mcp"]
    }
  }
}
```

### 7.3 Setup flow
When installed, the plugin should:
1. Check if `mutagen-ai` is installed globally → if not, prompt to install
2. Register the MCP server
3. Register the skill

---

## Phase 8: Testing & CI

### 8.1 GitHub Actions
- **CI workflow:** lint, build, run unit tests on push/PR
- **Release workflow:** publish to npm on tag push
- **Node versions:** test on 18, 20, 22

### 8.2 Expand unit tests
- Add tests for `semantic-judge.ts` (mock the API call)
- Add tests for `persistence.ts` (temp directories)
- Add integration test that runs a real test suite against a mock/cheap model (optional, requires API key in CI)

### 8.3 Linting
- Add eslint with a reasonable config
- Add prettier or similar for formatting consistency

---

## Phase 9: Documentation & Marketing

### 9.1 Case studies
- The Shrimp case study is great. Consider adding 1-2 more for different use cases (e.g., a chatbot prompt, a code generation prompt, a RAG system prompt)

### 9.2 Blog post / launch post
- "Test-Driven Prompt Engineering" — the methodology pitch
- Publish on hermitsh.ai and/or dev.to

### 9.3 Demo video
- 2-minute screencast showing the full loop: init → baseline → diagnose → mutate → compare → convergence

---

## Execution Order

| Order | Phase | Effort | Blocks |
|-------|-------|--------|--------|
| 1 | Phase 1: Code Cleanup | Small | Nothing |
| 2 | Phase 2: Feature Gaps (2.1, 2.2, 2.3) | Medium | Phase 1 |
| 3 | Phase 3: PLAYBOOK Rewrite | Medium | Phase 2 |
| 4 | Phase 4: README Refresh | Small | Phase 3 |
| 5 | Phase 5: Claude Code Skill | Medium | Phase 3 |
| 6 | Phase 6: MCP Server | Large | Phase 2 |
| 7 | Phase 7: Cowork Plugin | Medium | Phase 5 + 6 |
| 8 | Phase 8: Testing & CI | Medium | Phase 1 |
| 9 | Phase 9: Docs & Marketing | Flexible | Phase 4 |

Phases 5 and 6 can run in parallel. Phase 8 can start as early as after Phase 1.

---

## Open Questions

1. **Packaging decision** — Option A (wrap CLI) vs Option B (self-contained). Recommendation is A. See discussion above.

2. **MCP server location** — Same repo or separate? Recommendation is same repo with a `--mcp` flag on the binary.

3. **Plugin marketplace submission** — What's the actual submission process for Anthropic's plugin registry? Need to research this when we get to Phase 7.

4. **Pricing/licensing** — Stays MIT? Any plans to offer a hosted/premium version?

5. **Naming** — Is "mutagen-ai" the final name? It's good — distinctive, memorable, describes what it does (mutations). Just confirming before we go wide.
