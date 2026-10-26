// 1.81: the one .env reader, for the daemon, every command in scripts/ and pocket-init (#185). Each used to parse the file its
// own way, so a quoted value or a name with a digit meant one thing to the daemon and another to the commands.
// A line is NAME=value: the name is [A-Z0-9_]+; spaces before the name, around the = and around the value are ignored; one
// pair of matching quotes around the value is removed (quote a value whose spaces matter). Comments, blank lines and anything
// else are skipped. No escapes, no ${} expansion. A name set twice keeps its first non-empty value, as the daemon always read
// it and as pocket-init and the Vault key writer assume (they replace the first line).
import fs from 'node:fs';

export function parseEnv(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !out[m[1]]) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}
export function readEnvFile(file) {
  if (!file) return {};
  try { return parseEnv(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
