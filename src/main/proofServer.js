'use strict';
const http = require('http'), crypto = require('crypto'), os = require('os'), EventEmitter = require('events');
const MAX_BYTES = 10 * 1024 * 1024;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prayer Pause</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0c10;color:#fff;text-align:center;padding:32px 20px}label.b{display:inline-block;background:#f1f1f3;color:#0b0c10;border-radius:14px;padding:16px 28px;font-size:18px}#m{margin-top:24px;font-size:17px}</style></head><body>
<h2>Prayer Pause</h2><p>Take a clear photo of your prayer mat (janamaz) on the floor.</p>
<label class="b">Open camera<input id="f" type="file" accept="image/*" capture="environment" hidden></label><p id="m"></p>
<script>
const f=document.getElementById('f'),m=document.getElementById('m');
f.addEventListener('change',async()=>{const file=f.files[0];if(!file)return;m.textContent='Uploading and checking...';
try{const r=await fetch(location.pathname+'/photo',{method:'POST',headers:{'Content-Type':file.type||'image/jpeg'},body:file});const j=await r.json();m.textContent=j.message}
catch(e){m.textContent='Upload failed. Make sure your phone is on the same Wi-Fi as the PC.'}f.value=''});
</script></body></html>`;

function lanIp() {
  const all = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal);
  const priv = all.find((i) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address));
  return (priv || all[0] || { address: '127.0.0.1' }).address;
}

/** Temporary LAN web page that accepts one photo at a time. Open only while an "end early" request is pending. */
class ProofServer extends EventEmitter {
  constructor() { super(); this.server = null; this.busy = false; this.url = ''; }
  async start() {
    if (this.server) return this.url;
    this.token = crypto.randomBytes(16).toString('hex');
    this.server = http.createServer((q, s) => this._handle(q, s));
    await new Promise((ok, no) => { this.server.once('error', no); this.server.listen(0, '0.0.0.0', ok); });
    this.url = `http://${lanIp()}:${this.server.address().port}/${this.token}`;
    this.timer = setTimeout(() => this.stop(), 10 * 60 * 1000);
    return this.url;
  }
  stop() {
    clearTimeout(this.timer);
    if (this.server) { this.server.close(); if (this.server.closeAllConnections) this.server.closeAllConnections(); this.server = null; }
    this.busy = false;
  }
  _handle(req, res) {
    const p = req.url.split('?')[0].replace(/\/+$/, '');
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'GET' && p === `/${this.token}`) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(PAGE);
    }
    if (req.method === 'POST' && p === `/${this.token}/photo`) {
      const type = (req.headers['content-type'] || '').split(';')[0];
      if (!['image/jpeg', 'image/png'].includes(type)) return json(415, { ok: false, message: 'Please send a JPEG or PNG photo.' });
      if (this.busy) return json(429, { ok: false, message: 'Still checking the last photo...' });
      this.busy = true;
      const chunks = []; let size = 0, dead = false;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) { if (!dead) { dead = true; this.busy = false; json(413, { ok: false, message: 'That photo is too large.' }); req.destroy(); } }
        else if (!dead) chunks.push(c);
      });
      req.on('end', () => { if (!dead) this.emit('photo', Buffer.concat(chunks), (r) => { this.busy = false; json(200, r); }); });
      return undefined;
    }
    res.writeHead(404); return res.end();
  }
}
module.exports = { ProofServer };
