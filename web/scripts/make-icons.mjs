// Génère les icônes PNG (aucune dépendance). Lancer : npm run icons
import fs from 'node:fs';
import zlib from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BG = hex('#1e1f22');
const RING = hex('#383a40');
const GREEN = hex('#23a55a');
const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);

// scale = taille relative du motif (0.7 pour les icônes "maskable" : zone de sécurité)
function render(size, scale) {
  const SS = 3;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = size / 2;
  const rGreen = size * 0.2 * scale;
  const rRing = size * 0.33 * scale;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const d = Math.hypot(x + (sx + 0.5) / SS - cx, y + (sy + 0.5) / SS - cx);
          const col = d <= rGreen ? GREEN : d <= rRing ? RING : BG;
          acc = acc.map((v, i) => v + col[i]);
        }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      acc.forEach((v, i) => (raw[o + i] = Math.round(v / (SS * SS))));
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/icon-192.png', render(192, 1));
fs.writeFileSync('public/icon-512.png', render(512, 1));
fs.writeFileSync('public/icon-maskable-512.png', render(512, 0.8));
fs.writeFileSync('public/apple-touch-icon.png', render(180, 1));
void mix;
console.log('Icônes générées dans public/');
