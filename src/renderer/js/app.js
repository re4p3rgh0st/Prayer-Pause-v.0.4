'use strict';
const $ = (id) => document.getElementById(id);
const NAMES = { fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha', test: 'Test' };
const ICONS = { fajr: '◐', dhuhr: '☀', asr: '◑', maghrib: '◒', isha: '☾' };
const METHODS = { Karachi: 'University of Islamic Sciences, Karachi', MuslimWorldLeague: 'Muslim World League', Egyptian: 'Egyptian General Authority', UmmAlQura: 'Umm al-Qura, Makkah', Dubai: 'Dubai', MoonsightingCommittee: 'Moonsighting Committee', NorthAmerica: 'ISNA (North America)', Kuwait: 'Kuwait', Qatar: 'Qatar', Singapore: 'Singapore', Tehran: 'Tehran', Turkey: 'Turkey (Diyanet)' };
const MS_APPS = { word: 'Word', excel: 'Excel', powerpoint: 'PowerPoint', outlook: 'Outlook', onenote: 'OneNote', teams: 'Teams', edge: 'Microsoft Edge', xbox: 'Xbox app', skype: 'Skype' };
let state = null;

const hm = (ms) => { const m = Math.max(0, Math.ceil(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
const hms = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const t12 = (d, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);

function render() {
  if (!state) return;
  const now = new Date(), tz = state.timezone;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).formatToParts(now);
  $('clock').textContent = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
  $('ampm').textContent = (parts.find((p) => p.type === 'dayPeriod') || {}).value || '';
  $('date').textContent = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(now);
  $('loc').textContent = state.location;
  if (state.next) {
    $('nextName').textContent = NAMES[state.next.id];
    $('nextIn').textContent = `◷ in ${hm(new Date(state.next.time) - now)}`;
    $('nextNote').textContent = `Will activate for ${state.sessionMinutes} minutes at ${NAMES[state.next.id]}.`;
  } else { $('nextName').textContent = 'None'; $('nextIn').textContent = ''; $('nextNote').textContent = 'All prayers are turned off in Settings.'; }
  const ul = $('list'); ul.replaceChildren();
  for (const p of state.prayers) {
    const li = document.createElement('li');
    li.className = !p.enabled ? 'off' : state.next && state.next.id === p.id ? 'on' : '';
    const n = document.createElement('div'); n.className = 'n'; n.textContent = NAMES[p.id];
    if (p.source === 'mosque') { const m = document.createElement('span'); m.className = 'mt'; m.textContent = 'mosque'; n.append(m); }
    const i = document.createElement('div'); i.className = 'i'; i.textContent = ICONS[p.id];
    const t = document.createElement('div'); t.className = 't'; t.textContent = t12(new Date(p.time), tz);
    li.append(n, i, t); ul.append(li);
  }
  $('updated').textContent = state.prayers.some((p) => p.source === 'mosque') ? 'Using mosque timings' : 'Calculated automatically';
  const s = state.session, r = state.restriction || {};
  $('ring').className = s ? 'ring live' : 'ring';
  $('status').textContent = s ? 'Session active' : 'Active';
  $('statusSub').textContent = s
    ? `${hms(s.endsAt - now)} left` + (r.denied && r.denied.length ? ` · couldn't close ${r.denied.join(', ')} (needs administrator)` : '')
    : 'No restrictions at the moment.';
}

// ---- navigation ----
function show(page) {
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  if (page === 'mosque' || page === 'settings') loadSettings();
}
document.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => show(b.dataset.page)));

// ---- settings forms ----
function fill(root, s) {
  root.querySelectorAll('[data-path]').forEach((el) => {
    const v = el.dataset.path.split('.').reduce((o, k) => (o ? o[k] : undefined), s);
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
  });
}
function collect(root) {
  const patch = {};
  root.querySelectorAll('[data-path]').forEach((el) => {
    if (el.disabled) return;
    const keys = el.dataset.path.split('.');
    const v = el.type === 'checkbox' ? el.checked : (el.type === 'number' || el.type === 'range') ? el.valueAsNumber : el.value;
    let o = patch;
    for (const k of keys.slice(0, -1)) o = (o[k] = o[k] || {});
    o[keys[keys.length - 1]] = typeof v === 'string' && el.type === 'text' ? v.trim() : v;
  });
  return patch;
}
async function loadSettings() {
  const s = await window.prayerPause.getSettings();
  fill($('mosqueForm'), s); fill($('settingsForm'), s);
  document.querySelectorAll('#msApps input').forEach((c) => { c.checked = s.restrictions.microsoft.includes(c.dataset.ms); });
  $('custom').value = s.restrictions.custom.join('\n');
  const k = await window.prayerPause.getKeyStatus();
  $('keyStatus').textContent = k.hasKey ? 'A key is saved: photos are checked by AI.' : 'No key saved: any photo will end the session.';
}
$('saveKey').addEventListener('click', async () => {
  const res = await window.prayerPause.setApiKey($('apiKey').value);
  $('keyMsg').className = res.ok ? 'msg' : 'msg err'; $('keyMsg').textContent = res.ok ? 'Saved.' : res.error;
  if (res.ok) { $('apiKey').value = ''; loadSettings(); }
});
document.querySelectorAll('[data-save]').forEach((btn) => btn.addEventListener('click', async () => {
  const root = $(btn.dataset.save), msg = btn.nextElementSibling;
  const patch = collect(root);
  if (root.id === 'mosqueForm' && patch.mosque && Object.values(patch.mosque.times || {}).some(Boolean)) {
    patch.mosque.enabled = true; // times were entered, so use them
    root.querySelector('[data-path="mosque.enabled"]').checked = true;
  }
  if (root.id === 'settingsForm') {
    patch.restrictions = patch.restrictions || {};
    patch.restrictions.microsoft = [...document.querySelectorAll('#msApps input:checked')].map((c) => c.dataset.ms);
    patch.restrictions.custom = $('custom').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  }
  const res = await window.prayerPause.saveSettings(patch);
  msg.className = res.ok ? 'msg' : 'msg err';
  msg.textContent = res.ok ? 'Saved.' : res.error;
  if (res.ok) { state = await window.prayerPause.getState(); render(); setTimeout(() => { msg.textContent = ''; }, 2500); }
}));

for (const [k, v] of Object.entries(METHODS)) { const o = document.createElement('option'); o.value = k; o.textContent = v; $('method').append(o); }
for (const [k, v] of Object.entries(MS_APPS)) {
  const l = document.createElement('label'), c = document.createElement('input');
  c.type = 'checkbox'; c.dataset.ms = k; l.append(c, ` ${v}`); $('msApps').append(l);
}
window.prayerPause.getState().then((s) => { state = s; render(); });
window.prayerPause.onState((s) => { state = s; render(); });
setInterval(render, 1000);
$('test').addEventListener('click', () => window.prayerPause.startTestSession());
