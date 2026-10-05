/* Voice mode text rules: what to say aloud, how to chunk it, and which short phrases are local commands. */
'use strict';
const VoiceText = (() => {
  // Markdown → plain speech. Code, tables and raw URLs don't survive being read aloud; they stay on screen.
  function speakable(md) {
    let s = String(md || '');
    s = s.replace(/```[\s\S]*?(```|$)/g, ' ')                         // fenced code
      .replace(/^\s*\|.*\|\s*$/gm, ' ')                               // table rows
      .replace(/<[^>]+>/g, ' ')                                        // stray HTML
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')                           // images
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')                         // links keep their text
      .replace(/https?:\/\/\S+/g, 'a link')
      .replace(/(?:~|\/home\/[^/\s`]+)?(?:\/[\w.@+-]+){2,}\/?/g, p => p.split('/').filter(Boolean).pop() || p) // paths → last part
      .replace(/`([^`]+)`/g, (_, c) => c.length > 40 ? 'that' : c)     // inline code: short names only
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')                              // headings
      .replace(/^\s*>\s?/gm, '')                                       // quotes
      .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/gm, '')                    // bullets and task boxes
      .replace(/[*_~]{1,3}([^*_~\n]+)[*_~]{1,3}/g, '$1')               // emphasis
      .replace(/\s+[—–]\s+/g, ', ')
      .replace(/[ \t]*\n+[ \t]*/g, '\n')
      .replace(/([^.!?:;\n])\n/g, '$1. ')                              // a line break ends a spoken sentence
      .replace(/\n/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return s;
  }

  // Split only where punctuation is followed by space, so "search.py" or "1.7.3" stay whole.
  function sentences(text) {
    return String(text).split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(x => /[a-z0-9]/i.test(x));
  }

  // The spoken summary of a reply: its opening sentences, about two, never more than ~280 characters.
  // A very short opener ("Done.") doesn't count toward the two.
  function summary(md, max = 280) {
    const all = sentences(speakable(md)); let out = '', counted = 0;
    for (const s of all) {
      if (out && (counted >= 2 || out.length + s.length > max)) break;
      out = out ? `${out} ${s}` : s;
      if (s.length >= 25) counted++;
    }
    if (out.length > max + 40) out = out.slice(0, max).replace(/\s+\S*$/, '') + '.';
    return out;
  }

  // TTS chunks: start with a short first chunk so audio begins quickly; keep later chunks under ~220 chars.
  function chunks(text, firstMax = 120, max = 220) {
    const out = [];
    for (const s of sentences(text)) {
      const limit = out.length ? max : firstMax;
      if (s.length <= limit) { out.push(s); continue; }
      let rest = s;
      while (rest.length > (out.length ? max : firstMax)) {
        const lim = out.length ? max : firstMax;
        let cut = rest.lastIndexOf(', ', lim); if (cut < lim * 0.4) cut = rest.lastIndexOf(' ', lim);
        if (cut <= 0) cut = lim;
        out.push(rest.slice(0, cut + 1).trim()); rest = rest.slice(cut + 1).trim();
      }
      if (rest) out.push(rest);
    }
    return out;
  }

  // Short phrases handled on the device, with no AI involved. Anything longer or different goes to the session.
  const INTENTS = [
    ['quiet', /^(be quiet|quiet|stop talking|shut up|silence|enough)$/],
    ['stop', /^(stop|stop it|stop that|stop the turn|stop working|stop the session|cancel( it| that| the turn)?|abort)$/],
    ['status', /^(whats|what is) (it|he|she|claude|codex|the agent|the session|this session) (doing|working on|up to)( (right )?now)?$|^(status|progress|whats the status|what is the status|where are we|where are things|hows it going|how is it going|whats happening|what is happening)( (right )?now)?$/],
    ['readAll', /^read (me )?(it |that |the whole thing |everything )?(all|in full|the whole thing|everything|the whole reply|the full reply)$/],
    ['read', /^(read (it|that|me the (result|reply|answer|response|last message|last reply))|what did (it|you) say|repeat( that)?|say (that|it) again)$/],
    ['waiting', /^((is )?(there )?anything (waiting|pending) (on|for) me|whats waiting (on|for) me|what is waiting (on|for) me|what needs me|what needs my attention|anything need me|does anything need me)$/],
  ];
  function intent(transcript) {
    const t = String(transcript || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/^(ok(ay)?|hey|so|um|uh|and|please) /, '').replace(/ please$/, '').replace(/^(pocket|hey pocket),? /, '');
    if (!t || t.split(' ').length > 9) return null;
    for (const [kind, re] of INTENTS) if (re.test(t)) return kind;
    return null;
  }

  // A tool ledger line ("Bash  npm test --silent") as a short spoken step.
  function stepText(name, detail) {
    const d = speakable(String(detail || '')).replace(/\s+/g, ' ').slice(0, 70).replace(/\s+\S*$/, '');
    return d ? `${name}, ${d}` : String(name || 'a step');
  }

  // Whisper's well-known phantom phrases on a short burst of noise. Only applied to short recordings.
  const NOISE = /^(thank you|thanks|thank you for watching|thanks for watching|you|bye|uh|um|hmm|mm|music)[.!]?$/i;
  function isNoise(text, seconds) { return seconds < 1.6 && NOISE.test(String(text || '').trim()); }

  return { speakable, sentences, summary, chunks, intent, stepText, isNoise };
})();
globalThis.VoiceText = VoiceText;
