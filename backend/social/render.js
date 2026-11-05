'use strict';
/**
 * The renderer: turns a media spec (template card_v1) into a JPEG file with a public address, named by the hash of its bytes, so
 * the same card is the same file, an approved image can never be swapped for another, and a rendered card is immutable and cacheable.
 * Rasterising needs a library: `sharp` (SVG via librsvg, fonts from the system) is the production choice; if it is not installed the
 * renderer refuses, and the post simply waits unrendered rather than going out without its image. Video is not built yet.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { cardSvg, parseCardText } = require('./cards');
function sharpRasterizer() {
  let sharp; try { sharp = require('sharp'); } catch { return null; }
  return async ({ svg }) => ({ bytes: await sharp(Buffer.from(svg), { density: 72 }).jpeg({ quality: 90, mozjpeg: true }).toBuffer(), mime: 'image/jpeg', ext: 'jpg' });
}
function makeRenderer({ dir, baseUrl = '', rasterize = sharpRasterizer() } = {}) {
  return {
    available: Boolean(rasterize),
    async render({ template, kind, text, alt, lang, market, platform }) {
      if (kind === 'video') throw Object.assign(new Error('video rendering is not built yet'), { code: 'video_unsupported' });
      if (template !== 'card_v1') throw Object.assign(new Error('unknown template ' + template), { code: 'unknown_template' });
      if (!rasterize) throw Object.assign(new Error('no rasteriser is installed (npm install sharp)'), { code: 'no_rasterizer' });
      const parts = parseCardText(text), marketName = require('./schedule').marketByCode(market);
      const card = cardSvg({ lang, market: (marketName && marketName.name) || market, ...parts, platform, alt });
      if (!card.fits) throw Object.assign(new Error('the text does not fit the card at its smallest size, and a card is never clipped'), { code: 'text_does_not_fit' });
      const out = await rasterize({ svg: card.svg, width: card.width, height: card.height }), sha256 = crypto.createHash('sha256').update(out.bytes).digest('hex');
      fs.mkdirSync(dir, { recursive: true }); const file = path.join(dir, `${sha256}.${out.ext}`); if (!fs.existsSync(file)) { fs.writeFileSync(file + '.tmp', out.bytes); fs.renameSync(file + '.tmp', file); }
      return { sha256, url: `${baseUrl.replace(/\/$/, '')}/social-media/${sha256}.${out.ext}`, mime: out.mime, width: card.width, height: card.height };
    },
  };
}
module.exports = { makeRenderer, sharpRasterizer };
