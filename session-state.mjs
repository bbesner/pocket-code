export function sessionState({ turn, external = false, retryAt = null, outcome = null, mtimeMs = 0 }) {
  if (turn) return {
    kind: 'running', label: 'Running', confirmed: true,
    startedAt: turn.startedAt, queued: turn.queue?.length || 0,
  };
  if (retryAt) return { kind: 'waiting', label: 'Waiting for usage reset', retryAt, confirmed: true };
  // A newer external turn invalidates our older outcome. Filesystem flushes can
  // trail our completion callback, so tolerate a small bounded delay.
  if (outcome && mtimeMs <= outcome.at + 5000) return { ...outcome, confirmed: true };
  if (external) return { kind: 'observed', label: 'Activity elsewhere', confirmed: false };
  return { kind: 'idle', label: 'Recent', confirmed: false };
}

export function prioritizeSessions(rows, limit) {
  const important = rows.filter(s => s.pinned || ['running', 'observed', 'waiting', 'failed'].includes(s.state.kind));
  const importantIds = new Set(important.map(s => s.id));
  return [...important, ...rows.filter(s => !importantIds.has(s.id)).slice(0, Math.max(0, limit - important.length))];
}
