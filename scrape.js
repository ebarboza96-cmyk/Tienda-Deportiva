// Descarga las fotos de cada album de Yupoo y genera products.js con rutas locales.
const fs = require('fs');
const path = require('path');
const https = require('https');

const products = JSON.parse(fs.readFileSync('products.json', 'utf8'));
const MAX_PHOTOS = 8;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function get(url, asBuffer) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.yupoo.store/' }, timeout: 30000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location, asBuffer));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' ' + url)); }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(asBuffer ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('timeout ' + url)));
    req.on('error', reject);
  });
}

function extractPhotos(html) {
  const set = new Set();
  const order = [];
  const re = /data-origin-src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    let u = m[1];
    if (u.startsWith('//')) u = 'https:' + u;
    if (/\.(jpg|jpeg|png|webp)$/i.test(u) && !set.has(u)) { set.add(u); order.push(u); }
  }
  if (order.length === 0) {
    const re2 = /data-src="(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp))"/g;
    while ((m = re2.exec(html))) { const u = m[1]; if (!set.has(u)) { set.add(u); order.push(u); } }
  }
  return order;
}

(async () => {
  for (const p of products) {
    const dir = path.join('img', String(p.id));
    fs.mkdirSync(dir, { recursive: true });
    p.photos = [];
    try {
      const html = await get(p.album, false);
      const urls = extractPhotos(html).slice(0, MAX_PHOTOS);
      let n = 0;
      for (const u of urls) {
        const ext = (u.match(/\.(jpg|jpeg|png|webp)$/i) || ['', 'jpg'])[1].toLowerCase().replace('jpeg', 'jpg');
        const file = path.join(dir, (++n) + '.' + ext);
        try {
          const buf = await get(u, true);
          if (buf.length < 1200) { n--; continue; }
          fs.writeFileSync(file, buf);
          p.photos.push('img/' + p.id + '/' + n + '.' + ext);
        } catch (e) { n--; console.log('  img fail', p.id, e.message); }
      }
      console.log('#' + p.id, p.name.slice(0, 40), '->', p.photos.length, 'fotos');
    } catch (e) {
      console.log('#' + p.id, 'ALBUM FAIL', e.message);
    }
  }
  fs.writeFileSync('products.json', JSON.stringify(products, null, 2));
  fs.writeFileSync('products.js', 'window.PRODUCTS = ' + JSON.stringify(products) + ';');
  const tot = products.reduce((a, p) => a + (p.photos ? p.photos.length : 0), 0);
  console.log('LISTO. Total fotos:', tot, ' Productos:', products.length);
})();
