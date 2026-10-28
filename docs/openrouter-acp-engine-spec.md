# Route C — OpenRouter via an ACP third engine (OpenCode): build spec

**Status:** proposed · **Author:** Claude Code · **Date:** 2026-10-28
**Decision record:** Council tasks #178, #179 + live probes this session.
**Goal:** let a Pocket Code user select from *many* OpenRouter models (DeepSeek V4.1 Flash first; any OpenRouter slug, including models that don't exist yet) as a native, first-class engine — running concurrently with Claude Code and Codex sessions exactly as those two run side by side today.

---

## 1. Decision & rationale (why C, not A/B)

Pocket's value is the agentic **harness** (tool loop, approvals, questions, skills, usage, transcripts, MemStem ingest) that the CLI agents provide. We do **not** rebuild it.

- **Route A (ride the Codex engine):** cheapest, but Codex 0.156.1 is Responses-API-only and OpenRouter's Responses API is stateless; DeepSeek rides under the *Codex* identity; Pocket's Codex model handling is Codex-shaped. Workable, not a clean home for "many models."
- **Route B (bespoke engine):** rejected — rebuilds retries/approvals/recovery/compaction/tool-exec permanently.
- **Route C (this spec):** one ACP (Agent Client Protocol) client adapter as a real third engine, driving a model-agnostic ACP runtime (OpenCode) pointed at OpenRouter. Native separate identity; future-proof on **both** axes — new *models* via OpenRouter, new *runtimes* via ACP. Chosen because the owner's requirement is breadth + future models, which is exactly ACP + a model-agnostic runtime's core competency.

### What the live probes proved (OpenCode 1.19.4, this session)
- ACP `initialize` advertises: `loadSession:true`, `sessionCapabilities:{list,resume,fork,close}`, `promptCapabilities:{embeddedContext,image}`, `mcpCapabilities:{http,sse}`.
- **Approvals work:** with `permission:"ask"`, `session/request_permission` reaches the client. (Default is `allow` — see §6, a must-fix.)
- **Tools work:** DeepSeek V4.1 Flash (`openrouter/deepseek/deepseek-v4.1-flash-1017`) drove the bash tool to completion.
- **Breadth works:** GLM 5.3 (different vendor) drove tools through the *identical* plumbing by changing only the slug.
- **Cancel-during-permission:** clean (`stopReason:cancelled`, process healthy afterward).
- **Crash + resume:** hard `SIGKILL` mid-session, a *fresh* process `session/load`'d the id with full history replay, no error.

### The one known gap (carry into the build)
- **No structured `elicitation` for model questions.** OpenCode delivers model questions as plain assistant text, not `elicitation/create`. So Pocket's **choice-button UX won't auto-light-up** on this engine; questions arrive as normal text turns the user replies to. Not a blocker; it's a feature-parity gap vs. the Codex engine (whose own engine currently *cancels* elicitation anyway — `codex.mjs:82`). Decision in §7.

---

## 2. Target architecture

### 2.1 Split the overloaded `provider` field (prerequisite — do first, independent of C)
Today `provider` is a `'claude'|'codex'` string and unknown values fall back to `'claude'` (`server.mjs:2610`, also ~:2721/:3134; model-compat split at ~:180). Replace with three orthogonal concepts, persisted on the session record and resumed from it:

```jsonc
{
  "engine":           "acp",                                   // transport/adapter: 'claude' | 'codex' | 'acp'
  "runtime":          "opencode",                              // which ACP agent (acp engine only)
  "runtimeVersion":   "1.19.4",                                // tested, pinned
  "inferenceProvider":"openrouter",
  "model":            "openrouter/deepseek/deepseek-v4.1-flash-1017",
  "credentialRef":    "openrouter-default",                    // server-side ref; NEVER the key itself
  "routingPolicyRef": "us-zero-retention",                     // see §5
  "nativeSessionId":  "ses_...",                               // the runtime's own session id
  "schemaVersion":    2
}
```
- Keep a **data-driven profile→engine map** (`openrouter→acp:opencode`) so a future ACP runtime swaps in without touching the picker or sessions.
- **Version the schema.** A cached mobile PWA client can outlive a daemon upgrade and still POST a bare `provider` — migrate legacy records (bare `provider` → `{engine, …}`), pin existing sessions to their engine, reject ambiguous combinations. Do not silently coerce unknown engines to `'claude'`.

### 2.2 The `acp.mjs` engine adapter (mirror `codex.mjs`)
ACP is JSON-RPC 2.0 over stdio — the **same shape** as Codex's app-server — so reuse `codex.mjs`'s transport machinery (`LineBuffer`, the `AppServer` framing class, the supervised-child + keeper + adoption lifecycle in `makeTransport`/`spawnTransport`). `acp.mjs` exposes the same interface surface `server.mjs` already calls on the Codex engine:

| Pocket need | Codex engine (today) | ACP engine (`acp.mjs`) |
|---|---|---|
| id namespace | `CX='cx:'` | `ACP='acp:'` |
| availability | `codexAvailable()` | `acpAvailable()` (runtime binary present) |
| start a turn | `startCodexTurn({…, emit, onQuestion, onApproval, onFinish})` | `startAcpTurn(...)` — same callback contract |
| stream output | app-server notifications → `emit` | `session/update` (agent_message_chunk, tool_call, tool_call_update) → `emit` |
| approvals | `onApproval` | `session/request_permission` → `onApproval` (answer with `{outcome:{outcome:'selected',optionId}}`) |
| questions | `onQuestion` | `elicitation/create` → `onQuestion` **if/when it fires** (see §7) |
| steer / cancel | `steerCodexTurn` / `stopCodexTurn` | follow-up `session/prompt` / `session/cancel` |
| sessions list/read | `listCodexSessions`/`readCodexThread` | `session/list` + `session/load` (replay) + the runtime's on-disk store |
| resume | app-server resume | `session/load` (`loadSession:true`) |
| models | `codexModels()` | OpenRouter catalog (see §4) |
| context/usage | `codexContextAndCache` | from `session/update` usage (verify OpenCode emits it — open item) |

### 2.3 Concurrency & isolation (the owner's hard requirement)
- One **supervised child process per session** (`opencode acp` over stdio), kept alive between turns, exactly like the per-session `codex app-server` (`spawnTransport`, `codex.mjs:795`). This is what already lets GPT + Claude run concurrently; an ACP session is just a third kind of child.
- **"Separate service" = a supervised child process, not a network daemon** — avoids extra auth/deploy surface. (OpenCode also offers `opencode serve` HTTP/SDK; ACP-over-stdio is the better fit for Pocket's per-session supervised-child model and reuses the Codex transport.)
- A separate process is **not** filesystem isolation: give each session its own `--cwd` / worktree and rely on the runtime's own session-store locking; test concurrent sessions don't collide on the store.

---

## 3. Credentials & secrets (Critical — the leak is open on every route)

The agent runs model-chosen shell commands, so **any key in its environment or a readable file is exfiltratable** by a prompt-injected turn.

- **Do not** put `OPENROUTER_API_KEY` in the general daemon env — `agentEnv()` strips only `DAEMON_SECRETS` (`environment.mjs`), so it would reach *every* child (claude, codex, thumbnails, voice, MCP, reminders). Add it to `DAEMON_SECRETS` and inject it only where needed.
- **Preferred: a localhost key-broker proxy.** Pocket runs a loopback proxy that injects the real OpenRouter key; the ACP child is configured with the proxy base URL and a **dummy** token. The agent never holds the real key. The broker enforces the routing policy (§5) and spend caps (§5).
- Use a **dedicated, credit-limited OpenRouter key**, separate from Pocket's existing `POCKET_ROUTER_KEY`.
- **Canary:** a test that captures outgoing auth headers and **fails CI if any real credential (esp. an Anthropic login token) leaves the box.**
- OpenCode reads the provider key from config `{env:OPENROUTER_API_KEY}` or `~/.local/share/opencode/auth.json`. Point it at the broker; keep the per-session config 0600, generated by Pocket, never a copy of a user's global config.

---

## 4. Model selection — "many, including future" (the headline requirement)

- The picker lists OpenRouter models from the live catalog (`GET https://openrouter.ai/api/v1/models`, cached), filtered to those advertising `tools`/`tool_choice`.
- **Two tiers:** a **curated/tested** default set (starts: `deepseek/deepseek-v4.1-flash-1017`) and an **"experimental"** tier for everything else — so a model OpenRouter adds next year is selectable the day it appears, with an honest "unverified for agentic/tool use" label. Breadth without flooding issues with "tools don't work on model X."
- Mechanism is model-agnostic (proven live with DeepSeek + GLM); no per-model code.
- Note: the `POCKET_CODEX_MODEL` env validator `/^[\w.-]{1,64}$/` rejects `/`; the ACP engine's model field must accept provider-prefixed slugs (`openrouter/vendor/model`). Make `validateModel` **profile-aware** (block bare `gpt-*` on the OpenRouter profile, `deepseek/*` on the OpenAI profile, `claude-*` off both) rather than the current claude-only reject.

---

## 5. Data governance

OpenRouter is a **router**: by default it can fall back to downstream hosts that retain data and sit in other regions — source code, shell output and retrieved docs could reach a provider the user never chose.
- Pin approved (e.g. US-hosted, zero-retention) downstream providers per `routingPolicyRef`; disable fallback; **fail closed**.
- The broker (§3) enforces the pin and **inspects actual outbound traffic** — auxiliary calls (title generation, compaction, retries, helper models) must not bypass it.
- **Spend caps must reserve capacity for concurrent in-flight requests** (post-hoc usage checks let parallel sessions overspend). Use OpenRouter's per-key credit limits as the backstop before any in-house accounting.
- **MemStem read is a governance boundary too:** scope MemStem MCP search per-engine or disable it for third-party-hosted models, so one project's/provider's material isn't surfaced to a newly enabled DeepSeek destination.
- **DeepSeek-direct** (`api.deepseek.com`) stays an optional, off-by-default provider with a PRC-jurisdiction warning — it can't pin the `-1017` snapshot (first-party exposes only the moving `deepseek-flash` alias) and drops "any OpenRouter model."

---

## 6. Approvals (must-fix config)

OpenCode defaults tool permissions to **`allow`** (only `doom_loop`/`external_directory` default to `ask`), so edit/bash/webfetch would run **without** `request_permission` reaching Pocket. Pocket must:
- Ship a generated OpenCode config with `"permission": {"edit":"ask","bash":"ask","webfetch":"ask", …}` (or `"*":"ask"`), **never** pass `--auto`.
- On session start, **assert** a probe tool call actually produces `session/request_permission` before trusting the approvals path (regression guard — proven working live, but config-dependent).
- Map `request_permission.options[]` → Pocket's approval choice buttons; answer `{outcome:{outcome:'selected',optionId}}`. `reject`/cancel → Pocket's deny.
- Decide the `fs/*` + `terminal/*` ACP client capabilities deliberately: advertising them makes **Pocket** the executor (Route-B burden creeping in); not advertising leaves execution to the runtime under the `ask` policy above. **Recommendation:** do *not* advertise `fs`/`terminal` execution; let OpenCode execute under the `ask` policy, so Pocket stays an orchestrator.

---

## 7. Questions / choice-buttons (the known gap)

OpenCode does not emit `elicitation/create` for model questions (proven live). Options:
1. **Ship it:** questions arrive as plain assistant text; the user replies next turn. Choice-buttons are simply a Claude/Codex-engine feature, absent on ACP engines. Lowest effort, honest. **Recommended for v1.**
2. Investigate what *does* trigger OpenCode elicitation (likely tool/config flows) and whether a prompt convention or plugin can route model questions through it. Defer.
3. Synthesize choices client-side from text (fragile heuristic) — not recommended.
Document the gap in the engine's capability disclosure so the UI doesn't promise buttons it won't deliver.

---

## 8. MemStem

- **Search (read): free.** Register MemStem's MCP (OpenCode advertises `mcpCapabilities:{http,sse}`) — subject to the §5 per-engine read-scoping.
- **Ingest (write): a new adapter**, watching OpenCode's session store and parsing its transcript format, writing provenance `opencode/<model>` (not `codex`). **Keep this optional and out of the core public repo** — MemStem is Brad-specific infra; it belongs in his deployment or the MemStem repo, not a hard dependency every forker inherits. Don't claim parity until a *resumed* OpenCode session is searchable.
- Pin awareness: the on-disk session format is OpenCode's; it can change across releases — the ingest adapter rests on it, so version-gate it.

---

## 9. Milestones

1. **M0 — refactor (route-independent):** `provider`→`{engine,inferenceProvider,model,credentialRef}`, schema-versioned + migration, profile-aware `validateModel`. Ships value regardless of C.
2. **M1 — `acp.mjs` adapter:** reuse `codex.mjs` transport; `initialize`/`session/new`/`session/prompt`/`session/update`/`request_permission`/`cancel`/`load`; supervised child + adoption + keeper; map callbacks. Hard-code OpenCode as the one runtime, pinned version.
3. **M2 — provider + credentials:** localhost broker, dedicated key in `DAEMON_SECRETS`, routing pin, spend caps, header canary.
4. **M3 — picker + concurrency:** OpenRouter catalog, curated/experimental tiers, run a DeepSeek session concurrent with a live GPT/Claude session, usage wiring.
5. **M4 — MemStem ingest (optional module)** + docs: min OpenCode version, capability disclosure (no choice-buttons), the metered-billing + jurisdiction notes.

## 10. Testing / CI
- **No paid keys in CI:** run the real OpenCode binary against a **local deterministic Responses/chat test server**; exercise malformed streams, disconnects, unsupported params, failed auth, and approval requests. Mocks alone reproduce the implementer's assumptions.
- Keep the **header-exfil canary** and an **upgrade canary** against a pinned OpenCode version range.
- Live model suite (DeepSeek + a second vendor) gated/optional behind a dedicated key.

## 11. Open items (not viability blockers)
- Does OpenCode emit token/cost usage over ACP for Pocket's usage UI? (verify in M1)
- DeepSeek V4.1 Flash reliability on *long* multi-step tool chains (only single-tool tasks probed).
- Exact OpenCode session-store format + its stability (drives M4).
- What triggers OpenCode `elicitation` (for a possible future choice-button path).

## Appendix — verified facts & probe commands (this session)
- `opencode-ai@1.19.4`, MIT, bin `opencode`; `opencode acp` = ACP server over stdio; `opencode serve` = HTTP/OpenAPI/SDK alt.
- ACP `initialize` result captured live (§1). Approvals/tools/breadth/cancel/resume all passed; elicitation did not fire. Probe scripts: `/tmp/acp-probe/acp-*.mjs`. Total live spend ~5–8¢ OpenRouter credit (Ari's key).
- Codex is Responses-API-only (`wire_api="chat"` removed) — the reason A is not the clean path.
- Pocket touchpoints: `server.mjs:2610` (provider), `:3983` (ANTHROPIC_AUTH_TOKEN refusal), `~:180` (validateModel), `environment.mjs` (`DAEMON_SECRETS`/`agentEnv`), `codex.mjs:795` (`spawnTransport`), `:34` (`CODEX_HOME`), `:82` (elicitation cancelled today), `models.mjs` (claude-* ids).
