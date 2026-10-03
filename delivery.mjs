// One daemon owns this store. Reserve before dispatch; never replay an ambiguous
// in-flight request after a restart. These are receipts, not a second transcript.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export class DeliveryReceipts {
  constructor(file) {
    this.file = file;
    this.pending = new Map();
    try { this.records = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; this.records = {}; }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.records), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  async run(key, payload, action) {
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const prior = this.records[key];
    if (prior) {
      if (prior.hash !== hash) return { status: 409, body: { error: 'This message identifier was already used for different content.', code: 'message_conflict' } };
      if (this.pending.has(key)) return this.pending.get(key);
      if (prior.response) return prior.response;
      return { status: 409, body: { error: 'Delivery is uncertain after a server interruption. Check the conversation before sending again.', code: 'delivery_uncertain' } };
    }
    this.records[key] = { hash, at: Date.now() };
    try { this.save(); }
    catch { delete this.records[key]; return { status: 503, body: { error: 'Could not save a delivery receipt. No message was dispatched.', code: 'receipt_unavailable' } }; }
    // Defer action one microtask so the reservation is visible to simultaneous sends.
    const promise = Promise.resolve().then(action).then(response => {
      this.records[key].response = response;
      try { this.save(); }
      catch {
        delete this.records[key].response;
        return { status: 503, body: { error: 'The message may have been dispatched, but its receipt could not be saved. Check the conversation.', code: 'delivery_uncertain' } };
      }
      return response;
    }).catch(() => ({ status: 503, body: { error: 'Delivery could not be confirmed. Check the conversation before sending again.', code: 'delivery_uncertain' } }))
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
}

export function withDeliveryReceipt(store, handler) {
  return async (req, res) => {
    const id = req.body?.clientMessageId;
    if (!id) return handler(req, res); // existing clients remain compatible
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(id)) return res.status(400).json({ error: 'Invalid message identifier' });
    const { clientMessageId, ...payload } = req.body;
    const result = await store.run(`${req.path}:${id}`, payload, async () => {
      const capture = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
      await handler(req, capture);
      if (!capture.body) throw new Error('Missing delivery response');
      return { status: capture.statusCode, body: capture.body };
    });
    res.status(result.status).json(result.body);
  };
}
