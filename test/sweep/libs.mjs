// Layout sweep: the optional libraries beside sessions (Projects, Files, Tasks, the Vault and Coordination), each switched
// on by a fixture setting. Every name, address and secret here is made up. See test/layout-sweep.mjs for the harness.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {renderIntake, intakeBrand, intakeThemeCSS} from '../../intake-page.mjs';

export const area = 'libs';
const repo = path.join(import.meta.dirname, '..', '..');

// ---------- helpers ----------
const SHEET = '.sheet[role=dialog]';
const tap = (page, sel) => page.$eval(sel, e => e.click()); // a scripted tap: the cell is about the state it opens, not the route to it
const sheetUp = async (page, sel) => { await tap(page, sel); await page.waitForSelector(SHEET, {visible: true}); };
const post = async (base, url, body, headers = {}) => { const r = await fetch(base + url, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: typeof body === 'string' || body instanceof Buffer ? body : JSON.stringify(body)}); return r.json().catch(() => ({})); };
const boardAct = (base, body) => post(base, '/api/board/act', body);
const docId = (ctx, file) => ctx.docStore.documents.find(d => d.file === file && !d.trashedAt)?.id;
// A real 320x200 PNG with bands, so the image viewer has something to fit.
function pngStripes(w = 320, h = 200) {
  const crcTable = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3, band = Math.floor(x / 40) % 2; raw[o] = band ? 200 : 90; raw[o + 1] = band ? 150 : 110; raw[o + 2] = band ? 110 : 140; } }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Answer one GET with the fixture's own JSON, changed. Set before a reload, so the page reads the changed copy from the start.
async function patchJson(page, pathname, change) {
  await page.setRequestInterception(true);
  page.on('request', async r => {
    if (r.isInterceptResolutionHandled?.()) return;
    const u = new URL(r.url());
    if (u.pathname !== pathname || r.method() !== 'GET') return r.continue();
    try { const res = await fetch(r.url()); const j = await res.json(); r.respond({status: 200, contentType: 'application/json', body: JSON.stringify(change(j))}); } catch { r.continue(); }
  });
  await page.reload();
}
// The intake page is the server's own renderer; the fixture has no intake routes, so the page answers them itself.
const brand = intakeBrand({POCKET_INTAKE_ORG: 'Example Facilities', POCKET_INTAKE_ACCENT: '#9a4a2c'});
const intakeLink = {id: 'in-1', name: 'client-accounting-login', kind: 'login', fields: ['windows_password'], for: 'Pat Lee (Example IT)', from: 'Example Facilities', note: 'Accounting software review login', nonce: 'n0nce-fixture', expiresAt: new Date(Date.now() + 3 * 86400000).toISOString()};
async function intakePage(page, html) {
  await page.setRequestInterception(true);
  page.on('request', r => {
    if (r.isInterceptResolutionHandled?.()) return;
    const u = new URL(r.url());
    if (u.pathname === '/intake/intake.css') return r.respond({status: 200, contentType: 'text/css', body: fs.readFileSync(path.join(repo, 'public/intake/intake.css'), 'utf8')});
    if (u.pathname === '/intake/intake.js') return r.respond({status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(repo, 'public/intake/intake.js'), 'utf8')});
    if (u.pathname === '/intake/theme.css') return r.respond({status: 200, contentType: 'text/css', body: intakeThemeCSS(brand)});
    if (u.pathname.startsWith('/intake/')) return r.respond({status: 200, contentType: 'text/html', body: html});
    r.continue();
  });
  await page.goto(new URL('/intake/tok-fixture', page.url()).href);
  await page.waitForSelector('.card', {visible: true});
}
const intakeRows = [
  {id: 'in-1', name: 'client-accounting-login', kind: 'login', fields: ['windows_password'], for: 'Pat Lee (Example IT)', note: 'Accounting software review login', state: 'pending', created: new Date(Date.now() - 3600000).toISOString(), expiresAt: new Date(Date.now() + 3 * 86400000).toISOString()},
  {id: 'in-2', name: 'payroll-api', kind: 'api_key', for: 'Sam Rivera', note: '', state: 'filled', created: new Date(Date.now() - 86400000 * 2).toISOString(), endedAt: new Date(Date.now() - 86400000).toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString()},
  {id: 'in-3', name: 'old-router-admin', kind: 'login', for: '', note: '', state: 'expired', created: new Date(Date.now() - 86400000 * 6).toISOString(), expiresAt: new Date(Date.now() - 86400000 * 3).toISOString()},
];
// A run request with every 1.118 part: a changed file, Runs, Variables, an inline-code note and files to pin.
const pinRequest = () => ({id: 'req-pin-fixture', item: 'zeta-books', itemName: 'zeta-books', itemNames: ['zeta-books'], argv: ['node', 'scripts/post-invoices.mjs', '--input', 'exports/invoices-2026-10.csv', '--log', 'logs/post-invoices.log'], cwd: '/workspaces/warehouse',
  session: '11111111-1111-4111-8111-111111111111', sessionTitle: 'Warehouse stock report', created: new Date(Date.now() - 120000).toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), answer: null,
  runs: '/usr/bin/node', variables: [{v: 'ZETA_TOKEN', name: 'zeta-books', field: 'value'}, {v: 'ZETA_LOGIN', name: 'vendor-portal', field: 'password'}],
  changed: 'changed', changedFiles: [{path: '/workspaces/warehouse/scripts/post-invoices.mjs', how: 'changed'}],
  files: [{path: '/workspaces/warehouse/scripts/post-invoices.mjs', role: 'script', writable: true}, {path: '/workspaces/warehouse/exports/invoices-2026-10.csv', role: 'argument'}, {path: '/workspaces/warehouse/logs/post-invoices.log', role: 'argument'}]});

const P = {projects: true}, D = {documents: true, projects: true}, T = {tasks: true}, V = {vault: true}, C = {coordination: true};
const card = id => '#/projects/' + id;
const W = 'warehouse-stock-report';
const conductorOn = async ctx => { const {project} = await boardAct(ctx.base, {action: 'update', project: W, mode: 'conductor', doneWhen: 'Aisle 4 has no unaccounted units and the stock adjustment is posted in the ledger.', worksIn: ['/workspaces/warehouse', 'https://staging.example.test/stock']});
  const step = project?.tasks?.find(x => !x.done); if (step) await boardAct(ctx.base, {action: 'task-update', project: W, task: step.id, check: 'The aisle 4 recount sheet is saved in Files and matches the ledger.'}); };
const phoneDesk = ['phone', 'desktop'];
// Accepted measurements, matched against the described element:
// .vault-sr is the screen-reader-only word (clipped on purpose); a request's command line is a focusable <code> that
// scrolls sideways, not a tap target; a reply that scrolls under the sticky bar is not covered.
const VAULT_ALLOW = {cut: [/span\.vault-sr/], small: [/code\.vault-cmd/]};

export const surfaces = [
  // ---------- Projects ----------
  {name: 'projects-list', route: '#/projects', ready: '.project-item', settings: P,
    open: async page => { await page.$eval('.project-group details, details.project-group', d => { d.open = true; }).catch(() => {}); }},
  {name: 'projects-list-with-tasks', route: '#/projects', ready: '.project-item', settings: {...P, ...T}, layouts: phoneDesk},
  {name: 'projects-empty', route: '#/projects', ready: '.project-empty', settings: P, before: ctx => { ctx.board.projects.length = 0; }},
  {name: 'projects-scheduled', route: '#/projects/scheduled', ready: '.reminder-item', settings: P},
  {name: 'project-card-active', route: card(W), ready: '.project-card', settings: P,
    open: async page => { await page.$eval('.project-history', d => { d.open = true; }); }},
  {name: 'project-card-waiting', route: card('camera-ordering-review'), ready: '.project-card', settings: P},
  {name: 'project-card-done', route: card('monthly-warehouse-summary'), ready: '.project-card', settings: P},
  {name: 'project-card-conductor', route: card(W), ready: '.project-card .task-pass', settings: P, before: conductorOn,
    open: async page => { await tap(page, '.project-card [data-conductor-info]'); await page.waitForSelector('.project-card .conductor-about:not([hidden])'); }},
  {name: 'project-card-no-top-model', route: card(W), ready: '.project-card [data-mode][aria-disabled=true]', settings: P, layouts: phoneDesk,
    before: ctx => { const was = ctx.modes.conductor; ctx.modes.conductor = {claude: null, codex: null}; return () => { ctx.modes.conductor = was; }; }},
  {name: 'project-options', route: card(W), ready: '.project-card', settings: P, scope: SHEET, open: page => sheetUp(page, '#pmore')},
  {name: 'project-edit', route: card(W), ready: '.project-card', settings: P, scope: SHEET, before: conductorOn, open: page => sheetUp(page, '.project-card [data-edit]')},
  {name: 'project-track', route: '#/projects', ready: '#pj-track', settings: P, scope: SHEET, open: page => sheetUp(page, '#pj-track')},
  {name: 'project-step-options', route: card(W), ready: '.project-card [data-task-more]', settings: P, scope: SHEET, layouts: phoneDesk, open: page => sheetUp(page, '.project-card [data-task-more]')},
  {name: 'project-step-edit', route: card(W), ready: '.project-card [data-task-more]', settings: P, scope: SHEET, before: conductorOn,
    open: async page => { await sheetUp(page, '.project-card .task-row:not(.completed) [data-task-more]'); await tap(page, `${SHEET} [data-edit]`); await page.waitForSelector(`${SHEET} #step-check`, {visible: true}); }},
  {name: 'project-reminder', route: card(W), ready: '.project-card [data-remind]', settings: P, scope: SHEET, open: page => sheetUp(page, '.project-card [data-remind]')},
  {name: 'project-finish-confirm', route: card(W), ready: '.project-card [data-finish]', settings: P, scope: SHEET, layouts: phoneDesk, open: page => sheetUp(page, '.project-card [data-finish]')},
  {name: 'project-linked-session', route: card(W), ready: '.project-card [data-session-more]', settings: P, scope: SHEET, layouts: phoneDesk, open: page => sheetUp(page, '.project-card [data-session-more]')},
  // 409: the card changes on "another device" while the edit sheet is open, then Save.
  {name: 'project-conflict', route: card(W), ready: '.project-card', settings: P, scope: SHEET, layouts: phoneDesk,
    open: async (page, h) => {
      await sheetUp(page, '.project-card [data-edit]');
      await boardAct(h.base, {action: 'update', project: W, summary: 'Changed on another device: aisle 4 recount finished.'});
      await page.$eval(`${SHEET} [name=next]`, e => { e.value = 'Post the adjustment today.'; });
      await tap(page, `${SHEET} button.primary`);
      await page.waitForFunction(() => /changed since/.test(document.querySelector('#toast')?.textContent || ''));
    }},
  {name: 'project-start-conversation', route: card(W), ready: '.project-card [data-start]', settings: P, allow: {covered: [/#c-approval/]}, // at 344 px the chip sits inside the composer's own sideways scroller, under its arrow
    open: async page => { await tap(page, '.project-card [data-start]'); await page.waitForSelector('#first, #box', {visible: true}); }},
  {name: 'project-start-a-project', route: '#/new', ready: '#first', settings: P, scope: SHEET,
    open: async page => { await page.evaluate(() => startProjectSheet({name: 'Aisle 4 recount', directory: '/workspaces/warehouse'})); await page.waitForSelector(`${SHEET} [name=doneWhen]`, {visible: true}); }},

  // ---------- Files ----------
  {name: 'files-grid', route: '#/documents', ready: '.doc-card, .document-item', settings: D, before: async ctx => { await post(ctx.base, '/api/documents', pngStripes(), {'content-type': 'application/octet-stream', 'x-filename': 'shelf-photo.png'}); }},
  {name: 'files-list', route: '#/documents', ready: '#documents-main .session-home-head', settings: D,
    open: async page => { await page.evaluate(() => localStorage.setItem('pc-documents-layout', '"list"')); await page.reload(); await page.waitForSelector('.document-item', {visible: true}); }},
  {name: 'files-empty', route: '#/documents', ready: '#documents-main .session-home-head', settings: D,
    open: async page => { await patchJson(page, '/api/documents', j => ({...j, documents: [], trash: [], requests: []})); await page.waitForSelector('.project-empty', {visible: true}); }},
  {name: 'files-no-match', route: '#/documents', ready: '#doc-query', settings: D, layouts: phoneDesk,
    open: async page => { await page.type('#doc-query', 'zzz-no-such-file'); await page.waitForFunction(() => /No files match/.test(document.querySelector('#documents-main').textContent)); }},
  {name: 'files-filtered', route: '#/documents', ready: '#doc-query', settings: D, layouts: phoneDesk,
    open: async page => { await tap(page, '[data-vis="private"]'); await page.select('#doc-kind', (await page.$$eval('#doc-kind option', o => o.map(x => x.value)))[1]); }},
  {name: 'files-view-html', route: ctx => '#/documents/' + docId(ctx, 'ops-dashboard.html'), ready: '.doc-frame', settings: D},
  {name: 'files-view-md', route: ctx => '#/documents/' + docId(ctx, 'weekly-summary.md'), ready: '.doc-md', settings: D},
  {name: 'files-view-csv', route: ctx => '#/documents/' + docId(ctx, 'count-sheet.csv'), ready: '.doc-table', settings: D},
  {name: 'files-view-image', route: ctx => '#/documents/' + docId(ctx, 'shelf-photo.png'), ready: 'img.doc-media', settings: D,
    before: async ctx => { await post(ctx.base, '/api/documents', pngStripes(), {'content-type': 'application/octet-stream', 'x-filename': 'shelf-photo.png'}); }},
  {name: 'files-share-private', route: ctx => '#/documents/' + docId(ctx, 'weekly-summary.md'), ready: '.doc-tools [data-share]', settings: D, scope: SHEET, open: page => sheetUp(page, '.doc-tools [data-share]')},
  {name: 'files-share-link', route: ctx => '#/documents/' + docId(ctx, 'weekly-summary.md'), ready: '.doc-tools [data-share]', settings: D, scope: SHEET,
    open: async page => { await sheetUp(page, '.doc-tools [data-share]'); await tap(page, `${SHEET} [data-v=link]`); await page.waitForSelector(`${SHEET} #share-expiry`, {visible: true}); }},
  {name: 'files-share-link-later', route: ctx => '#/documents/' + docId(ctx, 'weekly-summary.md'), ready: '.doc-tools [data-share]', settings: D, scope: SHEET, layouts: phoneDesk,
    before: async ctx => { await post(ctx.base, '/api/documents/' + docId(ctx, 'weekly-summary.md'), {visibility: 'link'}); },
    open: page => sheetUp(page, '.doc-tools [data-share]')},
  {name: 'files-share-public', route: ctx => '#/documents/' + docId(ctx, 'count-sheet.csv'), ready: '.doc-tools [data-share]', settings: D, scope: SHEET,
    before: async ctx => { await post(ctx.base, '/api/documents/' + docId(ctx, 'count-sheet.csv'), {visibility: 'public'}); },
    open: page => sheetUp(page, '.doc-tools [data-share]')},
  {name: 'files-request', route: '#/documents', ready: '[data-doc-request]', settings: D,
    before: async ctx => { await post(ctx.base, '/api/documents/requests/seed', {doc: docId(ctx, 'count-sheet.csv'), change: {to: 'link', expiresAt: new Date(Date.now() + 7 * 86400000).toISOString()}}); await post(ctx.base, '/api/documents/requests/seed', {doc: docId(ctx, 'ops-dashboard.html'), change: {to: 'public'}}); }},
  {name: 'files-select', route: '#/documents', ready: '#doc-select', settings: D,
    open: async page => { await tap(page, '#doc-select'); await page.waitForSelector('[data-pick]'); await page.$eval('[data-pick]', e => e.click()); }},
  {name: 'files-remove-confirm', route: '#/documents', ready: '#doc-select', settings: D, scope: SHEET, layouts: phoneDesk,
    open: async page => { await tap(page, '#doc-select'); await page.waitForSelector('[data-pick]'); await page.$eval('[data-pick]', e => e.click()); await sheetUp(page, '#doc-pick-remove'); }},
  {name: 'files-trash', route: '#/documents', ready: '.doc-trash', settings: D, allow: {covered: [/doc-query/]}, // scrolled to the Trash, the search field sits under the sticky bar
    before: async ctx => { const id = docId(ctx, 'ops-dashboard.html'); await post(ctx.base, '/api/documents/' + id, {action: 'trash'}); return () => post(ctx.base, '/api/documents/' + id, {action: 'restore'}); }, // the reset does not bring a trashed file back
    open: async page => { await page.$eval('.doc-trash', d => { d.open = true; }); await page.$eval('.doc-trash', d => d.scrollIntoView({block: 'start'})); }},
  {name: 'files-options', route: '#/documents', ready: '[data-document-more]', settings: D, scope: SHEET, open: page => sheetUp(page, '[data-document-more]')},
  {name: 'files-in-conversation', route: ctx => '#/chat/' + ctx.rows[0].id, ready: '#box', settings: D, layouts: phoneDesk, allow: {covered: [/report-table/]}, // the reply scrolls under the sticky bar
    open: async page => { await page.waitForFunction(() => /Kept in Files/.test(document.body.textContent)); await page.evaluate(() => { const m = document.querySelector('main.scroll'); if (m) m.scrollTop = m.scrollHeight; }); }},

  // ---------- Tasks ----------
  {name: 'tasks-list', route: '#/tasks', ready: '.task-item', settings: T,
    open: async page => { await page.$eval('#tasks-main details', d => { d.open = true; }).catch(() => {}); }},
  {name: 'tasks-with-reminders', route: '#/tasks', ready: '.reminder-item', settings: {...T, ...P}},
  {name: 'tasks-empty', route: '#/tasks', ready: '.project-empty', settings: T, before: ctx => { ctx.taskStore.tasks.length = 0; }},
  {name: 'task-sheet-from-session', route: '#/tasks', ready: '.task-item', settings: T, scope: SHEET, open: page => sheetUp(page, '[data-task-open]')},
  {name: 'task-edit', route: '#/tasks', ready: '.task-item', settings: T, scope: SHEET,
    open: async page => { await sheetUp(page, '[data-task-open]'); await tap(page, `${SHEET} [data-edit]`); await page.waitForSelector(`${SHEET} [name=summary]`, {visible: true}); }},
  {name: 'task-new', route: '#/tasks', ready: '#tk-add', settings: T, scope: SHEET, layouts: phoneDesk, open: page => sheetUp(page, '#tk-add')},
  {name: 'task-later', route: '#/tasks', ready: '.task-item', settings: T, scope: SHEET, layouts: phoneDesk,
    open: async page => { await sheetUp(page, '[data-task-open]'); await tap(page, `${SHEET} [data-later]`); await page.waitForSelector(`${SHEET} [data-pick]`, {visible: true}); }},
  {name: 'task-from-conversation', route: ctx => '#/chat/' + ctx.rows[3].id, ready: '#box', settings: T, scope: SHEET, layouts: phoneDesk,
    open: async page => { await page.evaluate(() => addTaskFromSession(allSessions.find(s => s.id === chatId) || {id: chatId, title: 'Monthly warehouse summary', cwd: '/workspaces/warehouse'})); await page.waitForSelector(`${SHEET} [data-summarize]`, {visible: true}); }},

  // ---------- Vault ----------
  {name: 'vault-list', route: '#/vault', ready: '.vault-item', settings: V, allow: VAULT_ALLOW},
  {name: 'vault-request-pinned', route: '#/vault', ready: '[data-request="req-pin-fixture"]', settings: V, allow: VAULT_ALLOW,
    before: ctx => { ctx.vaultFixture.extraRequests.push(pinRequest()); },
    open: async page => { await page.$eval('[data-request="req-pin-fixture"]', e => e.scrollIntoView({block: 'start'})); }},
  {name: 'vault-empty', route: '#/vault', ready: '.vault-list-head', settings: V, allow: VAULT_ALLOW,
    open: async page => { await patchJson(page, '/api/vault', j => ({...j, items: [], trash: [], requests: []})); await page.waitForSelector('.project-empty', {visible: true}); }},
  {name: 'vault-search-none', route: '#/vault', ready: '#vault-query', settings: V, allow: VAULT_ALLOW, layouts: phoneDesk,
    open: async page => { await page.type('#vault-query', 'no-such-secret'); await page.waitForSelector('[data-vault-none]:not([hidden])'); }},
  {name: 'vault-trash', route: '#/vault', ready: '.vault-item', settings: V, allow: VAULT_ALLOW, layouts: phoneDesk,
    open: async page => { await page.$$eval('#vault-main details', ds => ds.forEach(d => { d.open = true; d.scrollIntoView({block: 'start'}); })); }},
  {name: 'vault-item-api-key', route: '#/vault', ready: '.vault-item', settings: V, allow: VAULT_ALLOW, scope: SHEET,
    open: async page => { await sheetUp(page, '.vault-item[data-item] [data-vault-open]'); await tap(page, `${SHEET} [data-show]`); await page.waitForSelector(`${SHEET} .vault-value.shown`); }},
  {name: 'vault-item-credentials', route: '#/vault', ready: '.vault-item', settings: V, allow: VAULT_ALLOW, scope: SHEET, layouts: phoneDesk,
    open: async page => { await page.evaluate(() => vaultSheet(vaultSnap.items.find(i => i.name === 'acme-oauth').id)); await page.waitForSelector(SHEET, {visible: true}); }},
  {name: 'vault-item-expiring', route: '#/vault', ready: '.vault-item', settings: V, allow: VAULT_ALLOW, scope: SHEET, layouts: phoneDesk,
    open: async page => { await page.evaluate(() => vaultSheet(vaultSnap.items.find(i => i.name === 'vendor-portal').id)); await page.waitForSelector(SHEET, {visible: true}); }},
  {name: 'vault-policy', route: '#/vault', ready: '.vault-item', settings: V, allow: VAULT_ALLOW, scope: SHEET, layouts: phoneDesk,
    open: async page => { await sheetUp(page, '.vault-item[data-item] [data-vault-open]'); await tap(page, `${SHEET} [data-policy]`); await page.waitForFunction(() => /Who can use it/.test(document.querySelector('.sheet[role=dialog] h2')?.textContent || '')); }},
  ...['api_key', 'token', 'login', 'credentials', 'note'].map(kind => ({name: 'vault-add-' + kind.replace('_', '-'), route: '#/vault', ready: '#vt-add', settings: V, allow: {...VAULT_ALLOW, covered: [/input "billing, zeta"|input "https:\/\/"/]}, scope: SHEET, layouts: kind === 'api_key' ? undefined : phoneDesk, // the last field shows half-scrolled at the foot of the sheet's own scroller
    open: async page => { await sheetUp(page, '#vt-add'); await page.select(`${SHEET} select[name=kind]`, kind); await tap(page, `${SHEET} [data-add-field]`); await page.waitForSelector(`${SHEET} [data-new-field]`); }})),
  {name: 'vault-add-errors', route: '#/vault', ready: '#vt-add', settings: V, allow: VAULT_ALLOW, scope: SHEET, layouts: phoneDesk,
    open: async page => { await sheetUp(page, '#vt-add'); await page.type(`${SHEET} [name=name]`, 'Bad Name!'); await tap(page, `${SHEET} button.primary`); await page.waitForFunction(() => document.querySelector('.sheet[role=dialog] .vault-form-error')?.textContent.trim()); }},
  {name: 'vault-locked', route: '#/vault', ready: '.vault-locked', settings: V, allow: VAULT_ALLOW, before: ctx => { ctx.vaultFixture.passphrase = 'fixture-passphrase-1'; Object.assign(ctx.settingsState(), {vaultMode: 'passphrase', vaultLocked: true}); }},
  {name: 'vault-unlock', route: '#/vault', ready: '#vt-unlock', settings: V, scope: SHEET, before: ctx => { ctx.vaultFixture.passphrase = 'fixture-passphrase-1'; Object.assign(ctx.settingsState(), {vaultMode: 'passphrase', vaultLocked: true}); },
    open: async page => { await sheetUp(page, '#vt-unlock'); const inp = await page.$(`${SHEET} input[type=password]`); await inp.type('wrong-passphrase'); await page.keyboard.press('Enter'); await page.waitForFunction(() => /Wrong passphrase/.test(document.querySelector('.sheet[role=dialog]')?.textContent || '')); }},
  {name: 'vault-recovery-key', route: '#/vault', ready: '.vault-item', settings: V, allow: VAULT_ALLOW, scope: SHEET, layouts: phoneDesk,
    open: async page => { await page.evaluate(() => vaultShowRecoveryKey()); await page.waitForSelector(`${SHEET} .vault-key`, {visible: true}); }},
  {name: 'vault-import', route: '#/vault', ready: '.vault-item', settings: V, allow: VAULT_ALLOW, scope: SHEET, layouts: phoneDesk,
    open: async page => { await page.evaluate(() => vaultImportSheet()); await page.waitForSelector(SHEET, {visible: true}); }},
  {name: 'vault-ask', route: '#/vault', ready: '#vt-ask', settings: V, allow: VAULT_ALLOW, scope: SHEET,
    open: async page => { await sheetUp(page, '#vt-ask'); await page.select(`${SHEET} select[name=kind]`, 'credentials'); await tap(page, `${SHEET} button.primary`); await page.waitForFunction(() => document.querySelector('.sheet[role=dialog] .vault-form-error')?.textContent.trim()); }},
  {name: 'vault-links-sent', route: '#/vault', ready: '.vault-item', settings: V, allow: VAULT_ALLOW,
    open: async page => { await patchJson(page, '/api/vault', j => ({...j, intakes: intakeRows})); await page.waitForSelector('.vault-intakes', {visible: true}); await page.$eval('.vault-intakes', e => e.scrollIntoView({block: 'start'})); }},
  {name: 'vault-link-once', route: '#/vault', ready: '.vault-item', settings: V, allow: VAULT_ALLOW, scope: SHEET, layouts: phoneDesk,
    open: async page => { await page.evaluate(r => vaultIntakeLinkSheet({intake: r, url: location.origin + '/intake/2b7c9e04f1a35d6e8c0b4a29f7e1d3c5a8b6f0e2d4c7a9b1'}), intakeRows[0]); await page.waitForSelector(`${SHEET} .vault-key`, {visible: true}); }},
  {name: 'vault-access-setting', route: '#/vault', ready: '.vault-item', settings: V, allow: {...VAULT_ALLOW, covered: [/#s-vault\.opt|#s-inbox\.opt|#s-documents-open/]}, scope: SHEET, // rows scrolled above the settings sheet's own scroller
    open: async page => { await page.evaluate(() => settingsSheet({category: 'f-vault'})); await page.waitForSelector('#s-vault-access', {visible: true}); await page.$eval('#s-vault-more', e => e.scrollIntoView({block: 'start'})); }},
  {name: 'intake-form', layouts: ['cover', 'phone', 'desktop'], route: '#/', ready: '#app',
    open: page => intakePage(page, renderIntake('form', {brand, r: intakeLink, token: 'tok-fixture', expires: 'Thursday, November 26 at 3:00 PM EST'}))},
  {name: 'intake-error', layouts: ['phone', 'desktop'], route: '#/', ready: '#app',
    open: page => intakePage(page, renderIntake('form', {brand, r: intakeLink, token: 'tok-fixture', expires: 'Thursday, November 26 at 3:00 PM EST', error: 'Enter the password.', errorField: 'password'}))},
  {name: 'intake-received', layouts: ['phone', 'desktop'], route: '#/', ready: '#app', open: page => intakePage(page, renderIntake('received', {brand}))},
  {name: 'intake-inactive', layouts: ['phone', 'desktop'], route: '#/', ready: '#app', open: page => intakePage(page, renderIntake('inactive', {brand}))},
  // The composer holds a message that looks like it carries a secret.
  {name: 'composer-secret-held', route: ctx => '#/chat/' + ctx.rows[3].id, ready: '#box', settings: V, scope: '.secret-sheet', layouts: phoneDesk,
    open: async page => { await page.evaluate(() => setSecretGuard(true)); await page.type('#box', 'Use this key for the books sync: sk-ant-api03-Fix7ureFix7ureFix7ureFix7ureAA'); await page.$eval('#send', e => e.click()); await page.waitForSelector('.secret-sheet', {visible: true}); }},
  {name: 'composer-secret-no-vault', route: ctx => '#/chat/' + ctx.rows[3].id, ready: '#box', scope: '.secret-sheet', layouts: phoneDesk,
    open: async page => { await page.evaluate(() => setSecretGuard(true)); await page.type('#box', 'Use this key for the books sync: sk-ant-api03-Fix7ureFix7ureFix7ureFix7ureAA'); await page.$eval('#send', e => e.click()); await page.waitForSelector('.secret-sheet', {visible: true}); }},

  // ---------- Coordination ----------
  {name: 'coord-holds', route: '#/coordination', ready: '.coord-row', settings: C},
  {name: 'coord-empty', route: '#/coordination', ready: '.project-empty', settings: C, before: ctx => { ctx.coord.reset([]); ctx.coord.recent = []; return () => ctx.coord.reset(); }},
  {name: 'coord-long', route: '#/coordination', ready: '.coord-row', settings: C,
    before: ctx => { const ago = m => Date.now() - m * 60000; ctx.coord.reset([{name: 'warehouse-recorder-firmware-rollout-north-building', reason: 'Upgrading the recorder firmware on every camera in the north building, one camera at a time, checking each stream comes back before moving to the next, which takes most of the afternoon', holder: {kind: 'conversation', session: 'f00d0000-0000-4000-8000-0000000000ac', title: 'North building recorder firmware rollout with a long conversation title'}, heldAt: ago(400), expiresAt: Date.now() + 80 * 60000, ttlMs: 28800000, waiters: [{id: 'w1', kind: 'conversation', session: 'f00d0000-0000-4000-8000-0000000000ad', at: ago(30), block: false, title: 'Camera ordering review'}, {id: 'w2', kind: 'terminal', session: null, at: ago(10), block: false, title: ''}, {id: 'w3', kind: 'conversation', session: 'f00d0000-0000-4000-8000-0000000000ae', at: ago(5), block: false, title: 'Monthly warehouse summary'}]}]); return () => ctx.coord.reset(); }},
  {name: 'coord-held-line', route: '#/', ready: '.session-held:not([hidden])', settings: C, layouts: phoneDesk, allow: {small: [/button "All"/]}}, // the session filter chips belong to the sessions sweep
];
