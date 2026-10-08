import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {stripVTControlCharacters} from 'node:util';

const pending = new Set(['starting','waiting','verifying']);
const failure = (message, code = 409) => Object.assign(new Error(message), {code,status:code});

export function loginUrl(output) {
  for (const match of output.matchAll(/https:\/\/[^\s<>"']+(?=[\s<>"'])/g)) {
    try {
      const url = new URL(match[0]);
      if (['claude.ai','claude.com'].includes(url.hostname) && ['/oauth/authorize','/cai/oauth/authorize'].includes(url.pathname)
        && !url.username && !url.password && !url.port && url.searchParams.get('state') && url.searchParams.get('code_challenge')) return url.href;
    } catch {}
  }
  return null;
}

export class ClaudeLogin {
  constructor({bin, env, cwd, busy = () => false, prepare = () => {}, identify, onSuccess = () => {}, spawnProcess = spawn, timeoutMs = 10 * 60_000}) {
    Object.assign(this, {bin, env, cwd, busy, prepare, identify, onSuccess, spawnProcess, timeoutMs});
    this.flow = null;
  }
  get active() { return pending.has(this.flow?.status); }
  snapshot() {
    const flow = this.flow;
    return flow ? {id:flow.id,status:flow.status,url:flow.url,expiresAt:flow.expiresAt,message:flow.message,account:flow.account || null} : {status:'idle'};
  }
  start() {
    if (this.active) return this.snapshot();
    if (this.flow?.child?.exitCode === null && this.flow.child.signalCode === null) throw failure('The previous sign-in is closing. Wait a moment, then try again.');
    if (this.busy()) throw failure('Claude is still working. Let its turns and background jobs finish, then try again. Codex can keep running.');
    const flow = this.flow = {id:randomUUID(),status:'starting',url:null,expiresAt:Date.now()+this.timeoutMs,message:'Preparing sign-in…',output:''};
    try {
      this.prepare();
      flow.child = this.spawnProcess(this.bin, ['auth','login','--claudeai'], {cwd:this.cwd,env:{...this.env,BROWSER:'/bin/true'},stdio:['pipe','pipe','pipe']});
      flow.child.stdin.on('error', () => this.finish(flow,'error','The sign-in process closed. Start again.'));
      flow.child.on('error', () => this.finish(flow,'error','Could not start Claude sign-in. Check that the installed CLI supports claude auth login.'));
      for (const stream of [flow.child.stdout,flow.child.stderr]) stream.on('data', data => {
        if (this.flow !== flow || !this.active || flow.status !== 'starting') return;
        flow.output = (flow.output + stripVTControlCharacters(data.toString())).slice(-16384);
        const url = loginUrl(flow.output);
        if (url) { flow.url = url; flow.output = ''; flow.status = 'waiting'; flow.message = 'Open the sign-in link, choose your account, then paste the code here.'; }
      });
      flow.child.on('close', async code => {
        if (this.flow !== flow || !this.active) return;
        if (code !== 0) return this.finish(flow,'error','Claude sign-in failed. Start again for a new link and code.');
        flow.status = 'verifying'; flow.url = null; flow.message = 'Checking the signed-in account…';
        try {
          const account = await this.identify();
          if (this.flow !== flow || !this.active) return;
          if (account.signedIn !== true || account.method !== 'claude.ai') return this.finish(flow,'error','Sign-in finished, but the Claude subscription login could not be verified. Refresh Accounts and check for configured API credentials.');
          flow.account = account;
          this.onSuccess();
          this.finish(flow,'success','Claude Code is signed in.');
        } catch { this.finish(flow,'error','Sign-in finished, but the account could not be verified. Refresh Accounts before trying again.'); }
      });
      flow.timer = setTimeout(() => this.finish(flow,'expired','This sign-in expired. Start again for a new link.'),this.timeoutMs);
      flow.timer.unref?.();
    } catch { this.finish(flow,'error','Could not start Claude sign-in. Start again or check the server installation.'); }
    return this.snapshot();
  }
  submit(id, value) {
    const flow = this.flow;
    if (!flow || flow.id !== id || flow.status !== 'waiting') throw failure('This sign-in is no longer waiting for a code. Refresh its status.');
    const code = typeof value === 'string' ? value.trim() : '';
    if (!code || code.length > 4096 || /\s|[\x00-\x1f\x7f]/.test(code) || code.startsWith('http')) throw failure('Paste only the code from Claude’s sign-in page.',400);
    if (!flow.child.stdin.writable || flow.child.stdin.destroyed) throw failure('The sign-in process closed. Start again.');
    flow.status = 'verifying'; flow.url = null; flow.message = 'Finishing sign-in…';
    flow.child.stdin.write(code+'\n');
    return this.snapshot();
  }
  cancel(id) {
    if (!this.flow || this.flow.id !== id) throw failure('This sign-in has already ended. Refresh its status.');
    if (this.active) this.finish(this.flow,'cancelled','Sign-in cancelled. Refresh Accounts to check the current login.');
    return this.snapshot();
  }
  finish(flow, status, message) {
    if (this.flow !== flow || !pending.has(flow.status)) return;
    flow.status = status; flow.message = message; flow.url = null; flow.output = '';
    clearTimeout(flow.timer);
    if (flow.child && flow.child.exitCode === null) {
      flow.child.kill('SIGTERM');
      const timer = setTimeout(() => { if (flow.child.exitCode === null && flow.child.signalCode === null) flow.child.kill('SIGKILL'); },2000);
      timer.unref?.();
    }
  }
  dispose() { if (this.active) this.finish(this.flow,'cancelled','The server restarted. Start sign-in again.'); }
}
