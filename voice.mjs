// Optional voice mode. Speech-to-text (Whisper) and text-to-speech (Kokoro) run in a local Python sidecar
// (voice/voice_server.py) that this module starts on first use and stops after it has been idle, so an
// install that never speaks pays nothing and an idle one gives its ~1 GB back. Nothing leaves the machine.
// Install with scripts/voice-setup.sh; POCKET_VOICE=off disables it even when installed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

export const VOICES = [
  ['af_heart', 'American female'], ['af_bella', 'American female (Bella)'], ['am_michael', 'American male'],
  ['bf_emma', 'British female'], ['bm_george', 'British male (George)'], ['bm_lewis', 'British male (Lewis)'],
];
export const DEFAULT_VOICE = 'af_heart';

export class VoiceService {
  constructor({ home = process.env.POCKET_VOICE_HOME || path.join(os.homedir(), '.local/share/pocket-code/voice'),
    command, idleMs = Number(process.env.POCKET_VOICE_IDLE_MS || 15 * 60000), startTimeoutMs = 120000,
    disabled = process.env.POCKET_VOICE === 'off', log = () => {} } = {}) {
    this.home = home; this.idleMs = idleMs; this.startTimeoutMs = startTimeoutMs; this.disabled = disabled; this.log = log;
    // POCKET_VOICE_COMMAND (a JSON array) replaces the sidecar, for tests or a custom engine speaking the same HTTP API.
    const custom = process.env.POCKET_VOICE_COMMAND ? JSON.parse(process.env.POCKET_VOICE_COMMAND) : null;
    this.command = command || custom || [path.join(home, 'venv/bin/python'), path.join(import.meta.dirname, 'voice/voice_server.py')];
    this.custom = Boolean(command || custom);
    this.proc = null; this.port = null; this.starting = null; this.idleTimer = null; this.lastError = null;
  }

  status() {
    if (this.disabled) return { available: false, reason: 'Voice is turned off on this server (POCKET_VOICE=off).' };
    const [bin] = this.command;
    const models = path.join(this.home, 'models');
    const installed = fs.existsSync(bin) && (this.custom || ['kokoro-v1.0.onnx', 'voices-v1.0.bin'].every(f => fs.existsSync(path.join(models, f))));
    if (!installed) return { available: false, reason: 'Voice is not installed on this server. Run scripts/voice-setup.sh, then restart Pocket Code.' };
    return { available: true, running: Boolean(this.port), voices: VOICES.map(([id, label]) => ({ id, label })), defaultVoice: DEFAULT_VOICE,
      ...(this.lastError ? { lastError: this.lastError } : {}) };
  }

  async ensure() {
    if (this.port && this.proc && this.proc.exitCode === null) return this.port;
    if (this.starting) return this.starting;
    if (!this.status().available) throw Object.assign(new Error(this.status().reason), { status: 503, code: 'voice_unavailable' });
    this.starting = new Promise((resolve, reject) => {
      const [bin, ...args] = this.command;
      const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, VOICE_MODELS_DIR: path.join(this.home, 'models'), VOICE_PORT: '0', PYTHONUNBUFFERED: '1' } });
      let stderr = '';
      const fail = message => { clearTimeout(timer); this.lastError = message; this.starting = null; try { proc.kill(); } catch { } reject(Object.assign(new Error(message), { status: 503, code: 'voice_start_failed' })); };
      const timer = setTimeout(() => fail('The voice engine did not start in time.'), this.startTimeoutMs);
      proc.stderr.on('data', d => { stderr = (stderr + d).slice(-2000); });
      proc.on('error', e => fail(`The voice engine could not start: ${e.message}`));
      proc.on('exit', code => {
        if (this.proc === proc) { this.proc = null; this.port = null; }
        if (this.starting) fail(`The voice engine exited during startup (code ${code}). ${stderr.trim().split('\n').at(-1) || ''}`.trim());
        else this.log(`voice engine exited (${code})`);
      });
      readline.createInterface({ input: proc.stdout }).on('line', line => {
        let msg; try { msg = JSON.parse(line); } catch { return; }
        if (!msg.ready || this.port) return;
        clearTimeout(timer); this.proc = proc; this.port = msg.port; this.starting = null; this.lastError = null;
        this.log(`voice engine ready on 127.0.0.1:${msg.port} (${msg.stt || 'stt'})`);
        resolve(msg.port);
      });
    });
    return this.starting;
  }

  touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { this.log('voice engine idle; stopping'); this.stop(); }, this.idleMs);
    this.idleTimer.unref?.();
  }

  stop() {
    clearTimeout(this.idleTimer);
    const p = this.proc; this.proc = null; this.port = null;
    if (p && p.exitCode === null) p.kill('SIGTERM');
  }

  async call(route, init) {
    const port = await this.ensure();
    this.touch();
    const r = await fetch(`http://127.0.0.1:${port}${route}`, { ...init, signal: AbortSignal.timeout(60000) });
    if (!r.ok) {
      let detail = ''; try { detail = (await r.json()).error; } catch { }
      throw Object.assign(new Error(detail === 'audio_missing_or_too_long' ? 'The recording was empty or too long.' : 'The voice engine could not process that.'), { status: r.status === 400 ? 400 : 502, code: detail || 'voice_engine_error' });
    }
    return r;
  }

  async transcribe(pcm, prompt = '') {
    // Headers must be printable ASCII; the vocabulary hint is advisory, so anything else is dropped.
    const hint = String(prompt).replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
    const r = await this.call('/stt', { method: 'POST', body: pcm,
      headers: { 'Content-Type': 'application/octet-stream', ...(hint ? { 'X-Prompt': hint } : {}) } });
    return r.json();
  }

  async speak(text, voice = DEFAULT_VOICE, speed = 1) {
    const r = await this.call('/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: String(text).slice(0, 1200), voice: VOICES.some(([id]) => id === voice) ? voice : DEFAULT_VOICE, speed }) });
    return Buffer.from(await r.arrayBuffer());
  }
}
