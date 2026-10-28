// session-schema.mjs — the versioned shape of the session-meta.json overlay, and the typed
// "engine config" a session carries when its engine needs more than the id prefix can encode.
//
// Today the overlay (server.mjs `smeta`, keyed by session id) holds name/outcome/seen/pin/etc.,
// and a session's engine is derived from its id prefix (cx: -> codex, else claude). A third
// engine (the ACP/OpenRouter engine — docs/openrouter-acp-engine-spec.md) needs to persist what
// a prefix can't: which inference provider, which model, which credential. This module is that
// slot plus the version/migration machinery so the overlay can evolve safely across daemon
// upgrades (a cached PWA client can outlive a bump). Pure + unit-tested; server.mjs owns the
// in-memory store and the file I/O.
import { ENGINE_IDS } from './engines.mjs';

// Bump when the overlay RECORD shape changes; add a step in migrateSmeta for each bump.
export const SMETA_SCHEMA = 1;
// Reserved top-level key holding the schema version. Never a session id (ids are UUID / cx: / acp:),
// so it never collides with a record. Callers that iterate the overlay must skip it (see overlayIds).
export const VERSION_KEY = '__schemaVersion';

// Bring a loaded session-meta.json object to the current schema. A legacy file (no version key)
// is treated as v0 and passes through unchanged except for the stamp — the existing
// name/outcome/seen/pin records are already current-shaped and the engineConfig slot is purely
// additive, so v0->v1 only stamps the version. A non-object (missing/corrupt) yields a fresh store.
export function migrateSmeta(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { [VERSION_KEY]: SMETA_SCHEMA };
  const out = { ...raw };
  // Future bumps: for (let v = (Number.isInteger(out[VERSION_KEY]) ? out[VERSION_KEY] : 0); v < SMETA_SCHEMA; v++) STEP[v](out);
  out[VERSION_KEY] = SMETA_SCHEMA;
  return out;
}

// Session ids present in the overlay (everything except the reserved version key). Use this
// wherever the overlay is iterated, so the version key is never treated as a session.
export function overlayIds(smeta) {
  return Object.keys(smeta || {}).filter(k => k !== VERSION_KEY);
}

// Optional string fields an engine config may carry beyond `engine`.
export const ENGINE_CONFIG_FIELDS = ['inferenceProvider', 'model', 'credentialRef', 'routingPolicyRef', 'runtime', 'runtimeVersion'];

// Validate + normalize an engine-config patch: `engine` must be a known engine id; the rest are
// optional strings (<=200 chars). Returns a clean object; throws a 400-style Error on bad input.
// Unknown fields are dropped. This is the validator the engine adapter (M1) calls before persisting.
export function validateEngineConfig(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw err('engine config must be an object');
  if (!ENGINE_IDS.includes(cfg.engine)) throw err(`unknown engine: ${cfg.engine}`);
  const out = { engine: cfg.engine };
  for (const f of ENGINE_CONFIG_FIELDS) {
    if (cfg[f] == null) continue;
    if (typeof cfg[f] !== 'string' || cfg[f].length > 200) throw err(`engine config '${f}' must be a string ≤200 chars`);
    out[f] = cfg[f];
  }
  return out;
}

// The engine config stored on a session's overlay record, or null when absent/malformed.
export function readEngineConfig(record) {
  const c = record && record.engineConfig;
  return c && typeof c === 'object' && typeof c.engine === 'string' ? c : null;
}

function err(message) { return Object.assign(new Error(message), { status: 400, code: 400 }); }
