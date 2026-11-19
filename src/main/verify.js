'use strict';
/** Asks Claude whether the photo shows a prayer mat. Needs the user's own API key and internet. */
async function verifyPrayerMat(jpegBuffer, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-5-5', max_tokens: 10,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBuffer.toString('base64') } },
        { type: 'text', text: 'Does this photo clearly show a Muslim prayer mat (janamaz / prayer rug) laid out on the floor? Answer with exactly YES or NO.' },
      ] }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 401) throw new Error('The saved API key was rejected. Check it in Settings.');
  if (!res.ok) throw new Error(`Photo check unavailable (error ${res.status}). Try again.`);
  const j = await res.json();
  const text = ((j.content || []).find((c) => c.type === 'text') || {}).text || '';
  return text.trim().toUpperCase().startsWith('YES');
}
module.exports = { verifyPrayerMat };
