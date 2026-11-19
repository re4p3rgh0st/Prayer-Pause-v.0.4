'use strict';
const fs = require('fs'), path = require('path'), EventEmitter = require('events');
const { PROTECTED, CATALOG } = require('./restrictions');

const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const METHODS = ['Karachi', 'MuslimWorldLeague', 'Egyptian', 'UmmAlQura', 'Dubai', 'MoonsightingCommittee',
  'NorthAmerica', 'Kuwait', 'Qatar', 'Singapore', 'Tehran', 'Turkey'];
const per = (v) => Object.fromEntries(PRAYERS.map((p) => [p, v]));

const DEFAULTS = {
  location: { name: 'Lahore, Pakistan', lat: 31.5497, lng: 74.3436, timezone: 'Asia/Karachi' },
  method: 'Karachi',
  asr: 'hanafi',
  adjustments: per(0),
  mosque: { enabled: false, times: per('') },
  prayerEnabled: per(true),
  session: { minutes: 15, allowEarlyEnd: true, warnMinutes: 2 },
  restrictions: { enabled: true, roblox: true, steam: true, microsoft: [], custom: [], forceClose: true },
  notifications: true,
  sound: { enabled: true, volume: 0.6 },
  startup: { asked: false, openAtLogin: false },
};

const bad = (m) => { throw new Error(m); };
const num = (min, max, int) => (v) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? (int ? Math.round(v) : v) : bad(`must be a number ${min}-${max}`));
const bool = (v) => (typeof v === 'boolean' ? v : bad('must be true or false'));
const str = (n) => (v) => (typeof v === 'string' && v.length > 0 && v.length <= n ? v : bad(`must be text up to ${n} chars`));
const oneOf = (l) => (v) => (l.includes(v) ? v : bad('invalid choice'));
const hhmm = (v) => (v === '' || (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) ? v : bad('use 24-hour HH:MM or leave blank'));
const tz = (v) => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return v; } catch { return bad('unknown time zone'); } };
const exe = (v) => (typeof v === 'string' && /^[\w .()-]{1,60}\.exe$/i.test(v) && !PROTECTED.has(v.toLowerCase()) ? v : bad('must be a safe .exe name that is not a protected Windows process'));
const list = (item, max) => (v) => (Array.isArray(v) && v.length <= max ? [...new Set(v.map(item))] : bad(`must be a list of up to ${max}`));

const SCHEMA = {
  location: { name: str(80), lat: num(-90, 90), lng: num(-180, 180), timezone: tz },
  method: oneOf(METHODS), asr: oneOf(['hanafi', 'shafi']),
  adjustments: per(num(-60, 60, true)),
  mosque: { enabled: bool, times: per(hhmm) },
  prayerEnabled: per(bool),
  session: { minutes: num(1, 60, true), allowEarlyEnd: bool, warnMinutes: num(0, 10, true) },
  restrictions: { enabled: bool, roblox: bool, steam: bool, microsoft: list(oneOf(CATALOG.map((c) => c.id)), 20), custom: list(exe, 20), forceClose: bool },
  notifications: bool,
  sound: { enabled: bool, volume: num(0, 1) },
  startup: { asked: bool, openAtLogin: bool },
};

/** Validate `patch` against `schema` and return a new object = base + patch. Unknown keys are rejected. */
function apply(schema, patch, base, where = '') {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) bad(`${where || 'settings'} must be an object`);
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (!Object.hasOwn(schema, k)) bad(`Unknown setting: ${where}${k}`);
    const rule = schema[k];
    if (typeof rule === 'function') { try { out[k] = rule(v); } catch (e) { bad(`${where}${k}: ${e.message}`); } }
    else out[k] = apply(rule, v, base[k], `${where}${k}.`);
  }
  return out;
}

class Store extends EventEmitter {
  constructor(file) { super(); this.file = file; this.data = structuredClone(DEFAULTS); this._load(); }
  _load() {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return; }
    for (const [k, v] of Object.entries(raw || {})) { try { this.data = apply(SCHEMA, { [k]: v }, this.data); } catch { /* ignore bad entry, keep default */ } }
  }
  get() { return this.data; }
  update(patch) {
    this.data = apply(SCHEMA, patch, this.data);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
    this.emit('change', this.data);
    return this.data;
  }
}
module.exports = { Store, DEFAULTS, PRAYERS, METHODS, apply, SCHEMA };
