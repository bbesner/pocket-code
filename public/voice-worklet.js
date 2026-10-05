/* Voice mode capture: batches microphone frames (~43 ms) and posts them with their level to the page. */
class PocketCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          let p = 0; for (let j = 0; j < this.n; j++) p += this.buf[j] * this.buf[j];
          this.port.postMessage({ samples: this.buf.slice(0), rms: Math.sqrt(p / this.n) });
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pocket-capture', PocketCapture);
