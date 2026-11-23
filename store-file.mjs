// 1.124.2: the one reader for the JSON stores whose next write replaces the whole file (projects, tasks, documents,
// coordination). A missing file is a new store. A file that is there but cannot be read or does not hold a JSON object (a
// hand edit with a bad comma, a file torn by a power cut) is renamed to <name>.corrupt-<UTC time> beside it and logged with
// both paths, and the store starts empty; before, it was read as empty with no word and the next change replaced the only
// copy. The kept name matches the store's .gitignore line (projects.json* and the rest), so an update's backup carries it.
// When the file cannot be set aside either, the store refuses to start rather than overwrite it.
import fs from 'node:fs';
import path from 'node:path';

const stamp = t => new Date(t).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); // 20261123-101530, as the update backups are named

export function readStore(file, { log = (...a) => console.log(new Date().toISOString(), ...a), now = Date.now } = {}) {
  let raw, why = null, d = null;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return {}; why = e.code || e.message; }
  // the parser's message quotes the text around the fault, which may be private: the log says only what kind of fault
  if (!why) try { d = JSON.parse(raw); } catch { why = 'not valid JSON'; }
  if (!why && d && typeof d === 'object' && !Array.isArray(d)) return d;
  why ||= 'not a JSON object';
  const kept = `${file}.corrupt-${stamp(now())}`;
  try { fs.renameSync(file, kept); } catch (e) {
    throw new Error(`${file} could not be read (${why}) and could not be set aside (${e.code || e.message}). Move or fix it, then start Pocket again.`);
  }
  log(`${file} could not be read (${why}): kept it as ${kept}, and ${path.basename(file)} starts empty. To get the old one back, stop Pocket, fix the kept copy and move it back to ${file}.`);
  return {};
}
