'use strict';
const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

function partsIn(ts, timeZone) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const o = {};
  for (const p of f.formatToParts(ts)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o;
}
/** Calendar date (in the given zone) for an instant. */
function dateParts(date, timeZone) {
  const { year, month, day } = partsIn(date, timeZone);
  return { y: year, m: month, d: day, key: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}
/** Wall-clock time in `timeZone` -> the real instant. Works for any zone, DST included. */
function zonedToUtc(y, m, d, hh, mm, timeZone) {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = partsIn(guess, timeZone);
    guess += wall - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) + (guess % 1000 === 0 ? 0 : 0);
  }
  return new Date(guess);
}

/**
 * Today's schedule for `at`. Mosque times (when enabled and filled in) win over calculated ones;
 * calculated ones get the per-prayer minute adjustment.
 */
function getSchedule(settings, at = new Date()) {
  const adhan = require('adhan'); // loaded lazily so the helpers above are testable without it
  const tz = settings.location.timezone;
  const { y, m, d, key } = dateParts(at, tz);
  const params = adhan.CalculationMethod[settings.method]();
  params.madhab = settings.asr === 'hanafi' ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
  // adhan reads the local Y/M/D of the Date it is given, so build it from the target zone's calendar day.
  const calc = new adhan.PrayerTimes(new adhan.Coordinates(settings.location.lat, settings.location.lng), new Date(y, m - 1, d), params);
  const prayers = PRAYERS.map((id) => {
    const mosque = settings.mosque.enabled ? settings.mosque.times[id] : '';
    if (mosque) {
      const [hh, mm] = mosque.split(':').map(Number);
      return { id, time: zonedToUtc(y, m, d, hh, mm, tz), source: 'mosque' };
    }
    return { id, time: new Date(calc[id].getTime() + settings.adjustments[id] * 60000), source: 'calculated' };
  });
  return { dateKey: key, prayers, validUntil: zonedToUtc(y, m, d + 1, 0, 0, tz) };
}
module.exports = { getSchedule, dateParts, zonedToUtc };
