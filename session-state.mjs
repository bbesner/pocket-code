// 1.64: the CLI's background job list. A Bash command run in the background or a subagent keeps
// the session's process alive after the reply, and the CLI starts a turn by itself when one
// finishes. Until then the session is working, not finished: this state outranks the outcome
// and the transcript's age, and ends when the CLI reports an empty list or the process exits.
export function backgroundSummary(tasks) {
  const jobs = (Array.isArray(tasks) ? tasks : []).map(t => ({
    kind: /agent/.test(t?.task_type || '') ? 'agent' : 'job',
    description: String(t?.description || t?.subagent_type || '').slice(0, 120),
  }));
  if (!jobs.length) return null;
  const agents = jobs.filter(j => j.kind === 'agent').length, plain = jobs.length - agents;
  const parts = [agents ? `${agents} ${agents === 1 ? 'agent' : 'agents'}` : '', plain ? `${plain} ${plain === 1 ? 'job' : 'jobs'}` : ''].filter(Boolean);
  return { count: jobs.length, summary: parts.join(', '), jobs };
}

// quietSince: the transcript has had no message from another app since our last turn ended. The CLI
// appends its own bookkeeping when its process exits (an idle close, or the process limit making room
// seconds after a reply), and that write alone must not turn Response ready into Recent (1.88.1).
export function sessionState({ turn, external = false, retryAt = null, outcome = null, mtimeMs = 0, background = [], quietSince = false }) {
  if (turn) return {
    kind: 'running', label: 'Running', confirmed: true,
    startedAt: turn.startedAt, queued: turn.queue?.length || 0,
  };
  if (retryAt) return { kind: 'waiting', label: 'Waiting for usage reset', retryAt, confirmed: true };
  const bg = backgroundSummary(background);
  if (bg) return { kind: 'background', label: `Working in background · ${bg.summary}`, confirmed: true, background: bg };
  // A newer external turn invalidates our older outcome. Filesystem flushes can
  // trail our completion callback, so tolerate a small bounded delay.
  if (outcome && (mtimeMs <= outcome.at + 5000 || quietSince)) return { ...outcome, confirmed: true };
  if (external) return { kind: 'observed', label: 'Activity elsewhere', confirmed: false };
  return { kind: 'idle', label: 'Recent', confirmed: false };
}

export function prioritizeSessions(rows, limit) {
  const important = rows.filter(s => s.pinned || ['running', 'background', 'observed', 'waiting', 'failed', 'input'].includes(s.state.kind));
  const importantIds = new Set(important.map(s => s.id));
  return [...important, ...rows.filter(s => !importantIds.has(s.id)).slice(0, Math.max(0, limit - important.length))];
}
