'use strict';
// Generates the app/tray icon (crescent on night-blue) with no image files or extra packages.
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function sample(u, v) {
  const dx = Math.max(Math.abs(u - 0.5) - 0.28, 0), dy = Math.max(Math.abs(v - 0.5) - 0.28, 0);
  if (dx * dx + dy * dy > 0.22 * 0.22) return null;
  const moon = (u - 0.46) ** 2 + (v - 0.5) ** 2 <= 0.3 ** 2 && (u - 0.58) ** 2 + (v - 0.43) ** 2 > 0.25 ** 2;
  return moon ? [232, 135, 58] : [43, 42, 76];
}
function iconPng(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const c = sample((x + ox) / size, (y + oy) / size);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const i = (y * size + x) * 4;
    if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; px[i + 3] = (a / 4) * 255; }
  }
  return encodePng(size, size, px);
}
function makeIcon(size) {
  const { nativeImage } = require('electron');
  const img = nativeImage.createFromPath(require('path').join(__dirname, '..', 'assets', 'icon.png'));
  if (img.isEmpty()) return nativeImage.createFromBuffer(iconPng(size)); // fallback: generated crescent
  return img.resize({ width: size, height: size, quality: 'best' });
}
module.exports = { iconPng, makeIcon };
