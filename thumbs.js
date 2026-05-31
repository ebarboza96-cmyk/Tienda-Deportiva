// Genera miniaturas webp ligeras: cover (450px) para tarjetas y thumb (90px) para galería.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

(async () => {
  const products = JSON.parse(fs.readFileSync('products.json', 'utf8'));
  let made = 0;
  for (const p of products) {
    if (!p.photos || !p.photos.length) { p.cover = null; p.thumbs = []; continue; }
    const dir = path.join('img', String(p.id));
    // cover desde la primera foto
    const first = p.photos[0];
    const coverOut = path.join(dir, 'cover.webp');
    try {
      await sharp(first).resize(450, 450, { fit: 'cover' }).webp({ quality: 78 }).toFile(coverOut);
      p.cover = 'img/' + p.id + '/cover.webp'; made++;
    } catch (e) { p.cover = first; console.log('cover fail', p.id, e.message); }
    // thumbs pequeños para la tira de galería
    p.thumbs = [];
    for (let i = 0; i < p.photos.length; i++) {
      const out = path.join(dir, 'th' + (i + 1) + '.webp');
      try {
        await sharp(p.photos[i]).resize(140, 140, { fit: 'cover' }).webp({ quality: 72 }).toFile(out);
        p.thumbs.push('img/' + p.id + '/th' + (i + 1) + '.webp'); made++;
      } catch (e) { p.thumbs.push(p.photos[i]); }
    }
  }
  fs.writeFileSync('products.json', JSON.stringify(products, null, 2));
  fs.writeFileSync('products.js', 'window.PRODUCTS = ' + JSON.stringify(products) + ';');
  console.log('Miniaturas generadas:', made);
})();
