// Stand-in for voice/voice_server.py: same HTTP API, no models. Transcribes any audio as a fixed phrase
// (or FAKE_VOICE_TEXT), echoes the vocabulary hint, and returns a tiny valid WAV for speech.
import http from 'node:http';
if (process.env.FAKE_VOICE_FAIL) { console.error('fake engine failed to load'); process.exit(3); }
const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40), Buffer.alloc(3200)]);
const server = http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (req.url === '/health') return res.end(JSON.stringify({ ok: true }));
    if (req.url === '/stt') {
      if (body.length < 3200) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'audio_missing_or_too_long' })); }
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ text: process.env.FAKE_VOICE_TEXT || 'tell it to run the unit tests', seconds: body.length / 32000, ms: 5, prompt: req.headers['x-prompt'] || '' }));
    }
    if (req.url === '/tts') { const j = JSON.parse(body || '{}'); res.setHeader('content-type', 'audio/wav'); res.setHeader('x-voice', j.voice); return res.end(wav); }
    res.statusCode = 404; res.end('{}');
  });
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ ready: true, port: server.address().port, stt: 'fake' })));
// Like the real sidecar: exit when the parent goes away (SIGTERM to Pocket does not run exit handlers).
const parent = process.ppid; setInterval(() => { if (process.ppid !== parent) process.exit(0); }, 500).unref();
