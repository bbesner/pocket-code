"""Pocket Code voice sidecar: local speech-to-text (faster-whisper) and text-to-speech (Kokoro).

Runs on 127.0.0.1 only and is started on demand by voice.mjs; nothing leaves the machine.
  GET  /health            -> {"ok": true, "stt": "...", "voices": [...]}
  POST /stt               body: raw 16-bit little-endian mono PCM at 16 kHz; header X-Prompt: optional vocabulary
                          -> {"text": "...", "seconds": n, "ms": n}
  POST /tts               JSON {"text": "...", "voice": "af_heart", "speed": 1.0} -> audio/wav (24 kHz mono)
Configuration (environment): VOICE_MODELS_DIR, VOICE_PORT, VOICE_STT_MODEL (small.en), VOICE_STT_THREADS (4),
VOICE_TTS_THREADS (4). Models are loaded once at startup; requests are serialized per engine.
"""
import io, json, os, sys, threading, time, wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

MODELS = os.environ.get('VOICE_MODELS_DIR') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models')
PORT = int(os.environ.get('VOICE_PORT', '0'))
STT_MODEL = os.environ.get('VOICE_STT_MODEL', 'small.en')
STT_THREADS = int(os.environ.get('VOICE_STT_THREADS', '4'))
TTS_THREADS = int(os.environ.get('VOICE_TTS_THREADS', '4'))
MAX_AUDIO_SECONDS = 90
MAX_TTS_CHARS = 1200

from faster_whisper import WhisperModel
import onnxruntime as ort
from kokoro_onnx import Kokoro

stt = WhisperModel(STT_MODEL, device='cpu', compute_type='int8', cpu_threads=STT_THREADS,
                   download_root=os.path.join(MODELS, 'whisper'))
opts = ort.SessionOptions(); opts.intra_op_num_threads = TTS_THREADS; opts.inter_op_num_threads = 1
# The fp32 model: the int8 export ran slower than real time on a 16-vCPU x86 server in testing.
tts = Kokoro.from_session(ort.InferenceSession(os.path.join(MODELS, 'kokoro-v1.0.onnx'), opts, providers=['CPUExecutionProvider']),
                          os.path.join(MODELS, 'voices-v1.0.bin'))
VOICES = sorted(v for v in tts.get_voices() if v[:2] in ('af', 'am', 'bf', 'bm'))
stt_lock, tts_lock = threading.Lock(), threading.Lock()
list(stt.transcribe(np.zeros(16000, dtype=np.float32), language='en')[0])  # warm both engines so the first request is quick
tts.create('Ready.', voice='af_heart')


def wav_bytes(samples, rate):
    pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes()
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm)
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):  # keep the parent's log clean; it records outcomes itself
        pass

    def reply(self, status, body, ctype='application/json'):
        data = json.dumps(body).encode() if ctype == 'application/json' else body
        self.send_response(status); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(data)))
        self.end_headers(); self.wfile.write(data)

    def body(self, limit):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > limit: return None
        return self.rfile.read(n)

    def do_GET(self):
        if self.path == '/health': return self.reply(200, {'ok': True, 'stt': STT_MODEL, 'voices': VOICES})
        self.reply(404, {'error': 'not_found'})

    def do_POST(self):
        try:
            if self.path == '/stt':
                raw = self.body(MAX_AUDIO_SECONDS * 16000 * 2)
                if raw is None or len(raw) < 3200: return self.reply(400, {'error': 'audio_missing_or_too_long'})
                audio = np.frombuffer(raw[: len(raw) // 2 * 2], dtype='<i2').astype(np.float32) / 32768
                prompt = (self.headers.get('X-Prompt') or '')[:400] or None
                t = time.time()
                with stt_lock:
                    segs, _ = stt.transcribe(audio, language='en', beam_size=1, condition_on_previous_text=False,
                                             vad_filter=True, initial_prompt=prompt)
                    text = ' '.join(s.text.strip() for s in segs).strip()
                return self.reply(200, {'text': text, 'seconds': round(len(audio) / 16000, 2), 'ms': round((time.time() - t) * 1000)})
            if self.path == '/tts':
                raw = self.body(64 * 1024)
                req = json.loads(raw or b'{}')
                text = str(req.get('text') or '').strip()[:MAX_TTS_CHARS]
                voice = req.get('voice') if req.get('voice') in VOICES else 'af_heart'
                speed = min(1.4, max(0.7, float(req.get('speed') or 1.0)))
                if not text: return self.reply(400, {'error': 'text_required'})
                with tts_lock:
                    samples, rate = tts.create(text, voice=voice, speed=speed, lang='en-gb' if voice.startswith('b') else 'en-us')
                return self.reply(200, wav_bytes(samples, rate), 'audio/wav')
            self.reply(404, {'error': 'not_found'})
        except Exception as e:  # report, never crash the sidecar
            self.reply(500, {'error': 'voice_engine_error', 'message': str(e)[:300]})


# Exit with the parent: if Pocket Code restarts or dies, this process must not linger holding ~1 GB.
PARENT = os.getppid()
def watch_parent():
    while True:
        if os.getppid() != PARENT: os._exit(0)
        time.sleep(2)
threading.Thread(target=watch_parent, daemon=True).start()

server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
print(json.dumps({'ready': True, 'port': server.server_address[1], 'stt': STT_MODEL, 'voices': len(VOICES)}), flush=True)
server.serve_forever()
