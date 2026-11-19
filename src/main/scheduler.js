'use strict';
const fs = require('fs'), EventEmitter = require('events');

/**
 * Ticks every second against the real clock (so sleep/wake and clock changes self-correct).
 * A prayer fires at most once per day (persisted), and a session always ends at prayerTime + duration,
 * so waking mid-window gives the remaining time rather than a fresh full session.
 */
class Scheduler extends EventEmitter {
  constructor({ getSettings, getSchedule, statePath, now = () => Date.now() }) {
    super();
    Object.assign(this, { getSettings, getSchedule, statePath, now });
    this.session = null; this.cache = null; this.timer = null; this.warned = {};
    this.fired = {}; this.resume = null;
    try {
      const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      this.fired = saved.fired || {};
      if (saved.session && saved.session.endsAt > now()) this.resume = saved.session; // app was closed mid-prayer
    } catch { /* first run */ }
  }
  start() {
    if (this.resume) { this.session = this.resume; this.resume = null; this.emit('session-start', this.session); }
    this.tick(); this.timer = setInterval(() => this.tick(), 1000);
  }
  stop() { clearInterval(this.timer); this.timer = null; }
  refresh() { this.cache = null; }

  schedule(at = this.now()) {
    const s = this.getSettings();
    const sig = JSON.stringify([s.location, s.method, s.asr, s.adjustments, s.mosque]);
    if (!this.cache || this.cache.sig !== sig || at >= this.cache.sched.validUntil.getTime()) {
      this.cache = { sig, sched: this.getSchedule(s, new Date(at)) };
    }
    return this.cache.sched;
  }
  _save() {
    const keys = Object.keys(this.fired).sort().slice(-30);
    this.fired = Object.fromEntries(keys.map((k) => [k, this.fired[k]]));
    try { fs.writeFileSync(this.statePath, JSON.stringify({ fired: this.fired, session: this.session && this.session.prayer !== 'test' ? this.session : null })); } catch { /* non-fatal */ }
  }
  _begin(prayer, endsAt, startedAt) {
    this.session = { prayer, startedAt, endsAt };
    this._save();
    this.emit('session-start', this.session);
  }
  _end(reason) {
    const s = this.session; if (!s) return;
    this.session = null;
    this._save();
    this.emit('session-end', s, reason);
  }
  startManual(minutes = this.getSettings().session.minutes) {
    if (this.session) return false;
    const t = this.now(); this._begin('test', t + minutes * 60000, t); return true;
  }
  endEarly() { this._end('ended-early'); }

  tick() {
    const now = this.now(), s = this.getSettings();
    try {
      const sched = this.schedule(now);
      if (this.session && now >= this.session.endsAt) this._end('completed');
      const dur = s.session.minutes * 60000;
      for (const p of sched.prayers) {
        if (!s.prayerEnabled[p.id]) continue;
        const id = `${sched.dateKey}:${p.id}`, t = p.time.getTime();
        if (!this.fired[id] && now >= t) {
          this.fired[id] = now; this._save();
          if (now < t + dur && !this.session) this._begin(p.id, t + dur, now);
          else this.emit('missed', p.id);
        } else if (!this.fired[id] && !this.warned[id] && s.session.warnMinutes > 0 && now >= t - s.session.warnMinutes * 60000) {
          this.warned[id] = true; this.emit('warning', p.id, t);
        }
      }
    } catch (e) { this.emit('error', e); }
    this.emit('tick', this.getState());
  }

  getState() {
    const now = this.now(), s = this.getSettings();
    const sched = this.schedule(now);
    const enabled = (p) => s.prayerEnabled[p.id];
    let next = sched.prayers.find((p) => enabled(p) && p.time.getTime() > now);
    if (!next) next = this.getSchedule(s, new Date(sched.validUntil.getTime() + 3600000)).prayers.find(enabled);
    return {
      now, timezone: s.location.timezone, location: s.location.name, sessionMinutes: s.session.minutes,
      prayers: sched.prayers.map((p) => ({ id: p.id, time: p.time.toISOString(), source: p.source, enabled: enabled(p) })),
      next: next ? { id: next.id, time: next.time.toISOString() } : null,
      session: this.session ? { ...this.session } : null,
    };
  }
}
module.exports = { Scheduler };
