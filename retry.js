// Reintenta los álbumes con pocas/0 fotos, usando el referer del propio álbum.
const fs = require('fs');
const path = require('path');
const https = require('https');

const products = JSON.parse(fs.readFileSync('products.json', 'utf8'));
const MAX = 8;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function get(url, referer, asBuffer, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {
      'User-Agent': UA,
      'Referer': referer,
      'Accept': asBuffer ? 'image/avif,image/webp,image/*,*/*' : 'text/html,*/*',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
    };
    const req = https.get(url, { headers, timeout: 30000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume(); return resolve(get(new URL(res.headers.location, url).href, referer, asBuffer, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = []; res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(asBuffer ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function extract(html) {
  const set = new Set(); const order = []; let m;
  const re = /data-origin-src="([^"]+)"/g;
  while ((m = re.exec(html))) { let u = m[1]; if (u.startsWith('//')) u = 'https:' + u; if (/\.(jpg|jpeg|png|webp)$/i.test(u) && !set.has(u)) { set.add(u); order.push(u); } }
  if (!order.length) { const re2 = /data-src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp))"/g; while ((m = re2.exec(html))) { const u = m[1]; if (!set.has(u)) { set.add(u); order.push(u); } } }
  return order;
}

(async () => {
  const targets = products.filter(p => !p.photos || p.photos.length < 3);
  console.log('Reintentando:', targets.map(t => t.id).join(','));
  for (const p of targets) {
    const dir = path.join('img', String(p.id)); fs.mkdirSync(dir, { recursive: true });
    const origin = new URL(p.album).origin + '/';
    let html;
    for (let i = 0; i < 3 && !html; i++) {
      try { html = await get(p.album, origin, false); } catch (e) { console.log('#' + p.id, 'album try', i, e.message); await new Promise(r => setTimeout(r, 1500)); }
    }
    if (!html) { console.log('#' + p.id, 'album FAIL'); continue; }
    const urls = extract(html).slice(0, MAX);
    const photos = []; let n = 0;
    for (const u of urls) {
      const ext = (u.match(/\.(jpg|jpeg|png|webp)$/i) || ['', 'jpg'])[1].toLowerCase().replace('jpeg', 'jpg');
      const ref = u.includes('photo.yupoo.com') ? p.album : origin; // imágenes ez4buy: referer = álbum
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
        try {
          const buf = await get(u, ref, true);
          if (buf.length < 1200) throw new Error('tiny');
          n++; const file = path.join(dir, n + '.' + ext); fs.writeFileSync(file, buf);
          photos.push('img/' + p.id + '/' + n + '.' + ext); ok = true;
        } catch (e) { if (i === 2) console.log('  #' + p.id, 'img fail', e.message); await new Promise(r => setTimeout(r, 1200)); }
      }
    }
    if (photos.length) p.photos = photos;
    console.log('#' + p.id, p.name.slice(0, 36), '->', p.photos ? p.photos.length : 0, 'fotos');
  }
  fs.writeFileSync('products.json', JSON.stringify(products, null, 2));
  fs.writeFileSync('products.js', 'window.PRODUCTS = ' + JSON.stringify(products) + ';');
  console.log('Total fotos:', products.reduce((a, p) => a + (p.photos ? p.photos.length : 0), 0));
})();
