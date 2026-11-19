'use strict';
const $ = (id) => document.getElementById(id);
const NAMES = { fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha', test: 'Test session' };
let state = null, chimed = false;

function chime(volume) { // soft three-note chime generated in code (no audio files needed)
  try {
    const ctx = new AudioContext();
    [[523.25, 0], [659.25, 0.35], [783.99, 0.7]].forEach(([f, t]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), at = ctx.currentTime + t;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(Math.max(0.0001, volume * 0.4), at + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 1.6);
      o.connect(g).connect(ctx.destination); o.start(at); o.stop(at + 1.7);
    });
  } catch { /* audio unavailable: stay silent */ }
}
function render() {
  if (!state || !state.session) return;
  const left = Math.max(0, Math.ceil((state.session.endsAt - Date.now()) / 1000));
  $('count').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  $('title').textContent = `Time for ${NAMES[state.session.prayer]}`;
  const isTest = state.session.prayer === 'test';
  $('end').textContent = isTest ? 'End test session' : 'End early with a photo of my prayer mat';
  $('end').hidden = !$('proof').hidden;
  if (!$('proof').hidden) $('proofMsg').textContent = state.endFlow ? state.endFlow.message : 'Scan the code with your phone, then photograph your prayer mat.';
  if (!chimed && state.sound && state.sound.enabled) { chimed = true; chime(state.sound.volume); }
}
window.prayerPause.getState().then((s) => { state = s; render(); });
window.prayerPause.onState((s) => { state = s; render(); });
setInterval(render, 250);
$('end').addEventListener('click', async () => {
  if (state && state.session && state.session.prayer === 'test') { window.prayerPause.endSession(); return; }
  const r = await window.prayerPause.requestEndEarly();
  if (!r.ok) { $('note').textContent = r.error; return; }
  $('qr').hidden = !r.qr; if (r.qr) $('qr').src = r.qr;
  $('url').textContent = r.url; $('proof').hidden = false; $('end').hidden = true;
});
$('cancelProof').addEventListener('click', async () => {
  await window.prayerPause.cancelEndEarly(); $('proof').hidden = true; $('end').hidden = false;
});
