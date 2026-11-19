'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const { Scheduler } = require('../src/main/scheduler');
const { zonedToUtc, dateParts } = require('../src/main/prayerTimes');
const { Store, DEFAULTS } = require('../src/main/settings');
const { buildTargets, parseTasklist, Restrictor } = require('../src/main/restrictions');

const TZ = 'Asia/Karachi';
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pp-')), 'x.json');
const T0 = zonedToUtc(2026, 11, 9, 12, 0, TZ).getTime();

function rig(startNow) {
  const clock = { t: startNow }, events = [];
  const settings = structuredClone(DEFAULTS);
  const sched = { dateKey: '2026-11-09', validUntil: new Date(T0 + 12 * 3600e3),
    prayers: ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].map((id, i) => ({ id, source: 'calculated', time: new Date(T0 + i * 3600e3) })) };
  const make = (statePath) => {
    const s = new Scheduler({ getSettings: () => settings, getSchedule: () => sched, statePath, now: () => clock.t });
    s.on('session-start', (x) => events.push(['start', x.prayer, x.endsAt - clock.t])).on('session-end', (_x, r) => events.push(['end', r]));
    return s;
  };
  return { clock, events, settings, make };
}

test('timezone maths: 12:00 Karachi = 07:00 UTC, no matter the PC zone', () => {
  assert.strictEqual(new Date(T0).toISOString(), '2026-11-09T07:00:00.000Z');
  assert.strictEqual(dateParts(new Date('2026-11-09T20:30:00Z'), TZ).key, '2026-11-10');
});
test('one session per prayer, ends after 15 min, no duplicates after restart', () => {
  const r = rig(T0 - 5000), file = tmp(), s = r.make(file);
  s.tick(); assert.deepStrictEqual(r.events, []);
  r.clock.t = T0 + 1000; s.tick(); s.tick();
  assert.strictEqual(r.events.filter((e) => e[0] === 'start').length, 1);
  r.clock.t = T0 + 15 * 60e3; s.tick(); assert.deepStrictEqual(r.events.at(-1), ['end', 'completed']);
  const s2 = r.make(file); r.clock.t = T0 + 15 * 60e3 + 1000; s2.tick(); // simulated app restart
  assert.strictEqual(r.events.filter((e) => e[0] === 'start').length, 1);
});
test('waking mid-window gives the remaining time; waking after it is skipped', () => {
  let r = rig(T0 - 60e3), s = r.make(tmp()); s.tick();
  r.clock.t = T0 + 10 * 60e3; s.tick();
  assert.deepStrictEqual(r.events[0].slice(0, 2), ['start', 'fajr']);
  assert.strictEqual(r.events[0][2], 5 * 60e3);
  r = rig(T0 - 60e3); s = r.make(tmp()); s.tick();
  r.clock.t = T0 + 40 * 60e3; s.tick(); assert.deepStrictEqual(r.events, []);
});
test('early end works; invalid settings rejected; protected exes never targeted', () => {
  const r = rig(T0), s = r.make(tmp()); s.startManual(); s.endEarly(); assert.strictEqual(r.events.at(-1)[1], 'ended-early');
  const st = new Store(tmp());
  assert.throws(() => st.update({ restrictions: { custom: ['explorer.exe'] } }));
  assert.throws(() => st.update({ session: { minutes: 999 } }));
  assert.throws(() => st.update({ nope: 1 }));
  st.update({ mosque: { enabled: true, times: { fajr: '05:12' } }, restrictions: { microsoft: ['word'], custom: ['game.exe'] } });
  assert.strictEqual(new Store(st.file).get().mosque.times.fajr, '05:12');
  const t = buildTargets(st.get());
  assert.ok(t.has('winword.exe') && t.has('robloxplayerbeta.exe') && t.has('steam.exe') && t.has('game.exe') && !t.has('explorer.exe'));
});
test('restrictor closes targets politely, forces after grace, stops cleanly', async () => {
  const calls = []; let procs = [{ name: 'steam.exe', pid: 11 }, { name: 'explorer.exe', pid: 4 }];
  const st = structuredClone(DEFAULTS);
  const R = new Restrictor({ getSettings: () => st, platform: 'win32', list: async () => procs, kill: async (pid, f) => { calls.push([pid, f]); } });
  R.active = true; await R.poll();
  assert.deepStrictEqual(calls, [[11, false]]);
  R.firstSeen.set(11, Date.now() - 9000); await R.poll();
  assert.deepStrictEqual(calls.at(-1), [11, true]);
  procs = []; await R.poll(); R.stop(); assert.strictEqual(R.status().active, false);
  assert.strictEqual(parseTasklist('"a.exe","12","Console","1","5 K"\r\n')[0].pid, 12);
});

test('a real session resumes after the app is closed and reopened mid-prayer', () => {
  const r = rig(T0 - 5000), file = tmp(), s = r.make(file);
  r.clock.t = T0 + 1000; s.tick();
  assert.strictEqual(r.events.filter((e) => e[0] === 'start').length, 1);
  r.clock.t = T0 + 5 * 60e3;
  const s2 = r.make(file); s2.start(); s2.stop(); // "relaunch"
  const starts = r.events.filter((e) => e[0] === 'start');
  assert.strictEqual(starts.length, 2);
  assert.strictEqual(starts[1][2], 10 * 60e3); // only the remaining 10 minutes
  s2.endEarly(); const s3 = r.make(file); r.clock.t += 1000; s3.start(); s3.stop();
  assert.strictEqual(r.events.filter((e) => e[0] === 'start').length, 2); // ended sessions don't resume
});
test('photo server: page loads, photo reaches the app, wrong type and wrong token are refused', async () => {
  const { ProofServer } = require('../src/main/proofServer');
  const ps = new ProofServer(); const url = await ps.start();
  const base = url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${new URL(url).port}`);
  try {
    assert.match(await (await fetch(base)).text(), /capture="environment"/);
    assert.strictEqual((await fetch(base.replace(/\/[^/]+$/, '/nope'))).status, 404);
    assert.strictEqual((await fetch(`${base}/photo`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' })).status, 415);
    ps.once('photo', (buf, reply) => { assert.strictEqual(buf.length, 3); reply({ ok: true, message: 'yes' }); });
    const r = await fetch(`${base}/photo`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: Buffer.from([1, 2, 3]) });
    assert.deepStrictEqual(await r.json(), { ok: true, message: 'yes' });
  } finally { ps.stop(); }
});
