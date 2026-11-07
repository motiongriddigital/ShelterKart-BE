'use strict';

module.exports = function register(app, c) {
  const { SITE_BASE } = c;

  /* Search engines: which pages may be found. Private reports, previews, the working pages, the API and the admin pages are
     never listed and are disallowed. The independence page is left out until its claim is restored. */
  const PUBLIC_PAGES = ['/', '/about.html', '/contact.html', '/corrections.html', '/delivery.html', '/evidence.html', '/methodology.html',
    '/pricing.html', '/privacy.html', '/refunds.html', '/terms.html', '/guide', '/guide/pdf', '/guide/card.pdf'];
  app.get('/robots.txt', (req, res) => {
    const base = SITE_BASE();
    res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    res.send(['User-agent: *', 'Allow: /', 'Disallow: /r/', 'Disallow: /api/', 'Disallow: /admin', 'Disallow: /start', 'Disallow: /investigate',
      base ? `Sitemap: ${base}/sitemap.xml` : ''].filter(Boolean).join('\n') + '\n');
  });
  app.get('/sitemap.xml', (req, res) => {
    const base = SITE_BASE(); if (!base) return res.status(404).type('text/plain').send('Set PUBLIC_BASE_URL to publish a sitemap.');
    const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const today = new Date().toISOString().slice(0, 10);
    const samples = ['celeste', 'london', 'dubai'].map(id => `/samples/${id}`);
    const urls = [...PUBLIC_PAGES, ...samples].map(p => `  <url><loc>${esc(base + p)}</loc><lastmod>${today}</lastmod></url>`);
    res.set({ 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  });
  app.get('/api/health', (req, res) => res.json({ ok: true, service: 'shelterkart-api', time: new Date().toISOString() }));
};
