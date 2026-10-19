/* Plain progress lines and approval questions (1.59). One phrase table for the browser (window.PocketPhrase)
   and the tests (imported for its side effect). It only words things; it never decides what runs.

   PocketPhrase.step(name, detail)  -> "Saved Proposal.pdf"            a finished or running tool call, past tense
   PocketPhrase.ask(tool, input)    -> "Save Proposal.pdf?"            a Claude permission request, as a question
   PocketPhrase.server(name)        -> "Gmail"                         a readable name for an MCP server

   `detail` is what the server already sends with a tool line (toolSummary in server.mjs, the Codex item mapping in
   codex.mjs): a file path, a Bash description or command, a URL or query, a skill name, or a JSON excerpt. Unknown
   tools fall back to "Used <name>", so a new tool still reads as a sentence. */
(function (root) {
  'use strict';
  const MAX = 90;
  const clip = (s, n = MAX) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  const base = p => { const s = String(p || '').replace(/[\\/]+$/, ''); return s.split(/[\\/]/).pop() || s; };
  const quote = s => `“${clip(s, 60)}”`;
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const words = s => String(s || '').replace(/^claude_ai_/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const json = d => { if (d && typeof d === 'object') return d; try { const o = JSON.parse(d); return o && typeof o === 'object' ? o : null; } catch { return null; } };
  // A field from a tool line's detail. The server clips JSON to 140 characters, so a cut-off object is read with a
  // pattern rather than JSON.parse.
  const field = (d, k) => { const o = json(d); if (o && typeof o[k] === 'string') return o[k]; const m = String(d || '').match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`)); return m ? m[1].replace(/\\"/g, '"') : ''; };

  // MCP servers people will see. Keys are lower-case server names with claude_ai_ and separators removed.
  const SERVERS = {
    gmail: 'Gmail', googlecalendar: 'Google Calendar', calendar: 'Google Calendar', googledrive: 'Google Drive', drive: 'Google Drive',
    googledocs: 'Google Docs', docs: 'Google Docs', googlesheets: 'Google Sheets', sheets: 'Google Sheets', googleslides: 'Google Slides', slides: 'Google Slides',
    memstem: 'past conversations', playwright: 'the browser', chrome: 'the browser', slack: 'Slack', notion: 'Notion', github: 'GitHub', linear: 'Linear',
  };
  const serverKey = s => words(s).toLowerCase().replace(/\s+/g, '');
  function server(name) {
    const k = serverKey(name);
    if (SERVERS[k]) return SERVERS[k];
    if (/^memstem/.test(k)) return 'past conversations';
    const w = words(name);
    return w ? w.replace(/\b[a-z]/g, c => c.toUpperCase()) : 'a connector';
  }
  // mcp__server__tool (Claude) or server.tool (Codex) -> [server, tool]
  function mcpParts(name) {
    let m = /^mcp__(.+?)__(.+)$/.exec(name || '');
    if (m) return [m[1], m[2]];
    m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_.-]+)$/.exec(name || '');
    return m ? [m[1], m[2]] : null;
  }
  // [past, question] by the tool's first word. The question form is phrased as a request to the person.
  const VERBS = [
    [/^(search|list|get|read|fetch|find|query|lookup|look|check|view|show|describe|count|download|export|browser_snapshot|browser_take|browser_console|browser_network)/, s => `Checked ${s}`, s => `Check ${s}?`],
    [/^(create|add|new|insert|upload|draft|compose|make|save|upsert|write|post|import)/, s => `Added to ${s}`, s => `Add to ${s}?`],
    [/^(update|edit|modify|patch|set|rename|move|label|mark|archive|change)/, s => `Updated ${s}`, s => `Update ${s}?`],
    [/^(delete|remove|trash|clear|cancel)/, s => `Removed from ${s}`, s => `Remove from ${s}?`],
    [/^(send|reply|forward|share|invite|publish)/, s => `Sent with ${s}`, s => `Send with ${s}?`],
  ];
  // Phrases that read better than the verb table, keyed "server:tool" (both lower-case, separators removed).
  const SPECIAL = {
    'gmail:createdraft': ['Made a Gmail draft', 'Make a Gmail draft?'],
    'gmail:senddraft': ['Sent a Gmail draft', 'Send a Gmail draft?'],
    'gmail:sendmessage': ['Sent an email', 'Send an email?'],
    'googlecalendar:createevent': ['Added a calendar event', 'Add a calendar event?'],
    'memstem:memstemupsert': ['Saved a note to memory', 'Save a note to memory?'],
  };
  function mcpPhrase(name, ask) {
    const parts = mcpParts(name); if (!parts) return null;
    const [srv, tool] = parts, s = server(srv), sk = serverKey(srv).replace(/^memstem.*/, 'memstem'), tk = tool.toLowerCase().replace(/[^a-z0-9]/g, '');
    const sp = SPECIAL[sk + ':' + tk]; if (sp) return sp[ask ? 1 : 0];
    if (s === 'past conversations') return ask ? 'Check past conversations?' : /upsert|save|write/.test(tk) ? 'Saved a note to memory' : 'Checked past conversations';
    if (s === 'the browser') return ask ? 'Use the browser?' : 'Used the browser';
    const t = tool.toLowerCase();
    for (const [re, past, q] of VERBS) if (re.test(t)) return ask ? q(s) : past(s);
    return ask ? `Use ${s}?` : `Used ${s}`;
  }
  // A Bash description from Claude Code reads as a sentence ("List files in the work folder"); a raw command doesn't.
  const looksLikeSentence = s => /^[A-Z][^|&;<>$`=\\]*$/.test(s) && /\s/.test(s) && !/^[A-Z_]+=/.test(s);
  const unsentence = s => s.replace(/[.\s]+$/, '');

  function step(name, detail) {
    const d = String(detail ?? '');
    const mcp = mcpPhrase(name, false); if (mcp) return mcp;
    switch (name) {
      case 'Read': return d ? `Looked at ${clip(base(d), 60)}` : 'Looked at a file';
      case 'Write': return d ? `Saved ${clip(base(d), 60)}` : 'Saved a file';
      case 'Edit': case 'MultiEdit': {
        const m = /^(.*?) \+(\d+) more$/.exec(d);           // Codex: "path +N more"
        if (m) return `Edited ${clip(base(m[1]), 50)} and ${m[2]} more`;
        return d ? `Edited ${clip(base(d), 60)}` : 'Edited a file';
      }
      case 'NotebookEdit': return 'Edited a notebook';
      case 'Glob': { const p = field(d, 'pattern'); return p ? `Looked for files named ${quote(p)}` : 'Looked for files'; }
      case 'Grep': { const p = field(d, 'pattern'); return p ? `Searched files for ${quote(p)}` : 'Searched files'; }
      case 'LS': return 'Listed a folder';
      case 'Bash': {
        const exit = /\s\(exit (\d+)\)$/.exec(d);
        if (exit) return 'A command didn’t succeed';
        return looksLikeSentence(d) ? clip(unsentence(d)) : 'Ran a command';
      }
      case 'BashOutput': case 'TaskOutput': return 'Checked a background task';
      case 'KillShell': case 'KillBash': case 'TaskStop': return 'Stopped a background task';
      case 'WebSearch': return d ? `Searched the web for ${quote(d)}` : 'Searched the web';
      case 'WebFetch': { const h = host(d); return h ? `Read ${h}` : 'Read a web page'; }
      case 'Web': { const h = host(d); return h ? `Read ${h}` : d ? `Searched the web for ${quote(d)}` : 'Searched the web'; }
      case 'Skill': return d ? `Used the ${clip(words(d), 50)} skill` : 'Used a skill';
      case 'Agent': case 'Task': case 'Subagent': case 'agent': case 'spawnAgent': return d ? `Started a helper: ${clip(d, 70)}` : 'Started a helper';
      case 'TodoWrite': return 'Updated the plan';
      case 'AskUserQuestion': return 'Asked you a question';
      case 'ToolSearch': return 'Got its tools ready';
      case 'EnterPlanMode': case 'ExitPlanMode': return 'Proposed a plan';
      case 'Thinking': return 'Thought it through';
      case 'Image': return 'Looked at an image';
      case 'Sleep': case 'Monitor': case 'ScheduleWakeup': return d ? `Waited ${clip(d, 20)}` : 'Waited';
      case 'Compact': return 'Summarized earlier messages to make room';
      case 'ListMcpResourcesTool': case 'ReadMcpResourceTool': return 'Checked a connector';
      default: return name ? `Used ${clip(words(name), 50)}` : 'Worked on it';
    }
  }

  function ask(tool, input) {
    const i = input && typeof input === 'object' ? input : {};
    const mcp = mcpPhrase(tool, true); if (mcp) return mcp;
    switch (tool) {
      case 'Bash': return i.description ? `Run: ${clip(unsentence(i.description), 80)}?` : 'Run this command?';
      case 'Write': return i.file_path ? `Save ${clip(base(i.file_path), 60)}?` : 'Save a file?';
      case 'Edit': case 'MultiEdit': return i.file_path ? `Edit ${clip(base(i.file_path), 60)}?` : 'Edit a file?';
      case 'NotebookEdit': return 'Edit a notebook?';
      case 'Read': return i.file_path ? `Look at ${clip(base(i.file_path), 60)}?` : 'Look at a file?';
      case 'WebFetch': { const h = host(i.url); return h ? `Open ${h}?` : 'Open a web page?'; }
      case 'WebSearch': return i.query ? `Search the web for ${quote(i.query)}?` : 'Search the web?';
      case 'Agent': case 'Task': return i.description ? `Start a helper: ${clip(i.description, 70)}?` : 'Start a helper?';
      case 'Skill': return i.skill ? `Use the ${clip(words(i.skill), 50)} skill?` : 'Use a skill?';
      default: return tool ? `Use ${clip(words(tool), 50)}?` : 'Allow this action?';
    }
  }

  // Where a Claude request acts, in a few words, for the line under an approval question.
  function where(tool, input) {
    const i = input && typeof input === 'object' ? input : {};
    // Never clipped: an approval shows the whole command or address it allows.
    if (tool === 'Bash' && i.command) return { mono: String(i.command) };
    if (/^(Write|Edit|MultiEdit|Read|NotebookEdit)$/.test(tool) && (i.file_path || i.notebook_path)) {
      const p = String(i.file_path || i.notebook_path), dir = p.replace(/[\\/][^\\/]*$/, '');
      return { text: `In ${base(dir) || dir}`, mono: p };
    }
    if (tool === 'WebFetch' && i.url) return { mono: String(i.url) };
    return null;
  }

  root.PocketPhrase = { step, ask, where, server };
})(typeof globalThis !== 'undefined' ? globalThis : this);
