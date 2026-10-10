// Agent skills that ship with Pocket Code (1.34). skills/pocket-projects and skills/pocket-files are written into the
// user-level folders Claude Code (~/.claude/skills) and Codex ($CODEX_HOME/skills) read, so every agent on this server
// (Pocket's, the terminal's, code-server's) knows how to create a project and what "save it to my files" means.
// A skill is installed while its feature is on and removed when it is turned off. Pocket only writes or removes a
// folder that carries its marker file, so a user's own skill of the same name is never touched. POCKET_SKILLS=0 turns
// installation off entirely (the test suite does).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MARKER = '.pocket-managed';
export const SKILLS = [
  { name: 'pocket-projects', feature: 'projects', cli: 'board' },
  { name: 'pocket-files', feature: 'documents', cli: 'docs' },
];
const SRC = path.join(import.meta.dirname, 'skills');

// Claude Code's user skills folder always; Codex's only where Codex is installed for this user.
export function skillRoots(env = process.env) {
  const home = env.HOME || os.homedir();
  const roots = [path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'skills')];
  const codex = env.CODEX_HOME || path.join(home, '.codex');
  if (fs.existsSync(codex)) roots.push(path.join(codex, 'skills'));
  return roots;
}

// The repository copy names `pocket-board` / `pocket-docs`; the installed copy says how to run them on this server.
export function renderSkill(text, command, binName) {
  const block = `<!-- pocket:commands -->\nOn this server, run \`${binName}\` as \`node ${command}\`. Wherever this skill writes \`${binName}\`, use that command.\n<!-- /pocket:commands -->`;
  return text.replace(/<!-- pocket:commands -->[\s\S]*?<!-- \/pocket:commands -->/, block);
}

export function syncSkills({ settings, commands, env = process.env, roots = skillRoots(env), src = SRC, log = () => {} }) {
  const result = { installed: [], removed: [], skipped: [] };
  if (env.POCKET_SKILLS === '0') return result;
  for (const root of roots) for (const s of SKILLS) {
    const dir = path.join(root, s.name), mark = path.join(dir, MARKER), ours = fs.existsSync(mark);
    try {
      if (settings[s.feature]) {
        if (fs.existsSync(dir) && !ours) { result.skipped.push(dir); log(`skill ${dir} exists and is not Pocket's; left alone`); continue; }
        const bin = s.cli === 'board' ? 'pocket-board' : 'pocket-docs';
        const body = renderSkill(fs.readFileSync(path.join(src, s.name, 'SKILL.md'), 'utf8'), commands[s.cli], bin);
        const file = path.join(dir, 'SKILL.md');
        if (ours && fs.readFileSync(file, 'utf8') === body) continue;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file + '.tmp', body); fs.renameSync(file + '.tmp', file);
        fs.writeFileSync(mark, `Installed by Pocket Code from ${path.join(src, s.name)}.\nPocket rewrites this folder when it starts and removes it when the feature is turned off; edit the source instead.\n`);
        result.installed.push(dir);
      } else if (ours) {
        fs.rmSync(dir, { recursive: true, force: true });
        result.removed.push(dir);
      }
    } catch (e) { log(`skill ${dir}: ${e.message}`); }
  }
  if (result.installed.length || result.removed.length) log(`skills: installed ${result.installed.length}, removed ${result.removed.length}`);
  return result;
}
