// 1.77.6: the commands print times the way the owner reads them: in the zone their browser reports to Pocket
// (`ownerTimezone` in <data dir>/pocket-settings.json, read only), else POCKET_TZ, else this box's, with the zone named
// ("Nov 11, 2026, 6:00 AM EST"). An agent relaying a time then never hands over the server's UTC by mistake.
import fs from 'node:fs';
import path from 'node:path';

const valid = tz => { if (typeof tz !== 'string' || !tz || tz.length > 64) return false; try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
export function ownerZone(dataDir, tzEnv) {
  try { const s = JSON.parse(fs.readFileSync(path.join(dataDir, 'pocket-settings.json'), 'utf8')); if (valid(s.ownerTimezone)) return s.ownerTimezone; } catch { }
  return valid(tzEnv) ? tzEnv : undefined;
}
const WHEN = { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
export const whenIn = tz => v => v ? new Date(v).toLocaleString('en-US', { ...WHEN, timeZone: tz }) : '';
