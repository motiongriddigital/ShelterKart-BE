// In-memory stand-in for Postgres, precise enough to exercise the real
// payment and idempotency SQL paths without a database. Purposefully
// simulates the ONE behavior that matters most here: a unique index on
// idempotency_key rejects a second row with the same key (error code
// 23505, exactly as real Postgres reports it), so the server's own
// race-condition handling is exercised for real, not just its
// read-first happy path.
const db = { purchases: [], events: new Set(), briefs: new Map(), aliases: new Map(), daily: new Map(), health: new Map(), analyticsEvents: [], salt: new Map(), translations: new Map(), quotes: new Map(), pricingEvents: [], ledger: new Map(), refunds: [], counters: new Map(), invoices: [] };
function delBriefs(match) { const out = []; for (const [ref, r] of db.briefs) if (match(r)) { db.briefs.delete(ref); out.push({ cache_key: r.cache_key }); } return out; } let n = 0;
const uuid = () => (++n).toString(16).padStart(8,'0') + '-0000-4000-8000-000000000000';
async function query(sql, p=[]) {
  const q = sql.replace(/\s+/g,' ');

  // ---- durable research (migration 018): the exact statements persistence.js issues ----
  if (/INSERT INTO research_briefs \(ref, cache_key, brief, page_urls, page_hosts, created_at\)/.test(q)) {
    if (typeof p[2] !== 'string') throw new Error('brief must be sent as a JSON string for the ::jsonb cast');
    if (!Array.isArray(p[3]) || !Array.isArray(p[4])) throw new Error('page_urls and page_hosts must be arrays');
    db.briefs.set(p[0], { cache_key:p[1], brief: JSON.parse(p[2]), page_urls:p[3], page_hosts:p[4], created_at: new Date() });
    return { rows: [] };
  }
  if (/SELECT brief, created_at FROM research_briefs WHERE ref = \$1/.test(q)) {
    const r = db.briefs.get(p[0]); return { rows: r ? [{ brief: JSON.parse(JSON.stringify(r.brief)), created_at: r.created_at }] : [] };
  }
  if (/SELECT cache_key, brief, created_at FROM research_briefs WHERE created_at > \$1 ORDER BY created_at ASC LIMIT \$2/.test(q))
    return { rows: [...db.briefs.values()].filter(r => r.created_at > p[0]).sort((a,b)=>a.created_at-b.created_at).slice(0, p[1])
      .map(r => ({ cache_key:r.cache_key, brief: JSON.parse(JSON.stringify(r.brief)), created_at:r.created_at })) };
  if (/DELETE FROM research_briefs WHERE \$1 = ANY\(page_urls\) RETURNING cache_key/.test(q))
    return { rows: delBriefs(r => r.page_urls.includes(p[0])) };
  if (/DELETE FROM research_briefs WHERE \$1 = ANY\(page_hosts\) RETURNING cache_key/.test(q))
    return { rows: delBriefs(r => r.page_hosts.includes(p[0])) };
  if (/DELETE FROM research_briefs WHERE created_at < \$1 RETURNING cache_key/.test(q))
    return { rows: delBriefs(r => r.created_at < p[0]) };
  if (/INSERT INTO research_aliases \(alias, cache_key, location, ambiguous, updated_at\)/.test(q)) {
    if (typeof p[3] !== 'boolean') throw new Error('ambiguous must be a boolean');
    db.aliases.set(p[0], { cache_key:p[1], location:p[2], ambiguous:p[3] }); return { rows: [] };
  }
  if (/SELECT alias, cache_key, location, ambiguous FROM research_aliases/.test(q))
    return { rows: [...db.aliases].map(([alias, v]) => ({ alias, ...v })) };
  if (/DELETE FROM research_aliases WHERE cache_key = ANY\(\$1\)/.test(q)) {
    if (!Array.isArray(p[0])) throw new Error('ANY($1) needs an array');
    for (const [a, v] of db.aliases) if (p[0].includes(v.cache_key)) db.aliases.delete(a); return { rows: [] };
  }
  if (/DELETE FROM research_aliases WHERE cache_key = \$1/.test(q)) {
    for (const [a, v] of db.aliases) if (v.cache_key === p[0]) db.aliases.delete(a); return { rows: [] };
  }
  if (/INSERT INTO research_daily \(day, count\) VALUES \(\$1, 1\)/.test(q)) { db.daily.set(p[0], (db.daily.get(p[0]) || 0) + 1); return { rows: [] }; }
  if (/SELECT count FROM research_daily WHERE day = \$1/.test(q)) return { rows: db.daily.has(p[0]) ? [{ count: String(db.daily.get(p[0])) }] : [] };
  if (/INSERT INTO source_health \(market, state, reason, consecutive_failures, ever_healthy, detail, last_ok_at, checked_at\)/.test(q)) {
    if (typeof p[3] !== 'number' || typeof p[4] !== 'boolean') throw new Error('consecutive_failures must be a number and ever_healthy a boolean');
    db.health.set(p[0], { market:p[0], state:p[1], reason:p[2], consecutive_failures:p[3], ever_healthy:p[4], detail:p[5], last_ok_at:p[6], checked_at:new Date() }); return { rows: [] };
  }
  if (/SELECT market, state, reason, consecutive_failures, ever_healthy, detail, last_ok_at, checked_at FROM source_health/.test(q)) return { rows: [...db.health.values()] };
  if (/INSERT INTO analytics_events \(at, day, event, visitor/.test(q)) {
    if (p.length !== 19) throw new Error('analytics_events insert expects 19 parameters, got ' + p.length);
    if (p[15] !== null && typeof p[15] !== 'number') throw new Error('value must be a number or null');
    const cols = ['at','day','event','visitor','path','channel','referrer','utm_source','utm_medium','utm_campaign','country','device','market','ref','query','value','currency','detail','lang'];
    const row = {}; cols.forEach((c, i) => { row[c] = p[i]; });
    // return types the way pg does: DATE as a Date, NUMERIC as a string
    row.day = new Date(p[1] + 'T00:00:00Z'); row.value = p[15] == null ? null : String(p[15]);
    db.analyticsEvents.push(row); return { rows: [] };
  }
  if (/SELECT at, day, event, visitor, path, channel, referrer, utm_source, utm_medium, utm_campaign,\s*country, device, market, ref, query, value, currency, detail, lang\s*FROM analytics_events WHERE at >= \$1 ORDER BY at ASC LIMIT \$2/.test(q))
    return { rows: db.analyticsEvents.filter(e => e.at >= p[0]).sort((a, b) => a.at.localeCompare(b.at)).slice(0, p[1]).map(e => ({ ...e })) };
  if (/DELETE FROM analytics_events WHERE at < \$1/.test(q)) { db.analyticsEvents = db.analyticsEvents.filter(e => e.at >= p[0]); return { rows: [] }; }
  if (/INSERT INTO analytics_salt \(day, salt\)/.test(q)) { db.salt.set(p[0], p[1]); return { rows: [] }; }
  if (/DELETE FROM analytics_salt WHERE day <> \$1/.test(q)) { for (const d of [...db.salt.keys()]) if (d !== p[0]) db.salt.delete(d); return { rows: [] }; }
  if (/SELECT salt FROM analytics_salt WHERE day = \$1/.test(q)) return { rows: db.salt.has(p[0]) ? [{ salt: db.salt.get(p[0]) }] : [] };
  if (/SELECT key, text FROM translation_cache WHERE key = ANY\(\$1\)/.test(q)) {
    if (!Array.isArray(p[0])) throw new Error('ANY($1) needs an array');
    return { rows: p[0].filter(k => db.translations.has(k)).map(k => ({ key: k, text: db.translations.get(k).text })) };
  }
  if (/INSERT INTO translation_cache \(key, lang, text, created_at\)/.test(q)) { db.translations.set(p[0], { lang: p[1], text: p[2] }); return { rows: [] }; }
  if (/DELETE FROM translation_cache WHERE created_at < \$1/.test(q)) return { rows: [] };
  if (/research_briefs|research_aliases|research_daily|source_health|analytics_|translation_cache/.test(q)) throw new Error('stub does not recognise this research statement: ' + q.slice(0, 80));

  // ---- pricing v2 (migration 022): the exact statements pricing/store.js, payments/refunds.js and server.js issue ----
  if (/INSERT INTO report_purchases \(report_ref, amount, currency, status, provider, idempotency_key, quote_id, buyer_country, billing_country, amount_net, tax_amount, tax_rate_bps, tax_mode, price_book_version, buyer_kind, tax_id\)/.test(q)) {
    if (p.length !== 15) throw new Error('purchase insert expects 15 parameters, got ' + p.length);
    if (typeof p[1] !== 'number' || typeof p[8] !== 'number' || typeof p[9] !== 'number') throw new Error('amounts must be numbers');
    if (p[4] != null && db.purchases.some(x => x.idempotency_key === p[4])) { const err = new Error('duplicate key value violates unique constraint "uq_report_purchases_idempotency_key"'); err.code = '23505'; throw err; }
    const id = uuid();
    db.purchases.push({ id, report_ref:p[0], amount:p[1], currency:p[2], status:'pending_payment', provider:p[3], idempotency_key:p[4], quote_id:p[5], buyer_country:p[6], billing_country:p[7],
      amount_net:p[8], tax_amount:p[9], tax_rate_bps:p[10], tax_mode:p[11], price_book_version:p[12], buyer_kind:p[13], tax_id:p[14], net_revenue:null, provider_fee:null });
    return { rows:[{id}] };
  }
  if (/SELECT id, report_ref, amount, currency, status, provider, provider_payment_id, buyer_country, amount_net, tax_amount, net_revenue, quote_id FROM report_purchases WHERE id=\$1/.test(q))
    return { rows: db.purchases.filter(x => x.id === p[0]).map(x => ({ ...x, amount: String(x.amount), amount_net: x.amount_net == null ? null : String(x.amount_net), tax_amount: x.tax_amount == null ? null : String(x.tax_amount), net_revenue: x.net_revenue == null ? null : String(x.net_revenue) })) };
  if (/UPDATE report_purchases SET status=\$2, net_revenue = COALESCE\(net_revenue, 0\) - \$3 WHERE id=\$1/.test(q)) {
    db.purchases.filter(x => x.id === p[0]).forEach(x => { x.status = p[1]; x.net_revenue = (x.net_revenue || 0) - p[2]; }); return { rows: [] };
  }
  if (/UPDATE report_purchases SET provider_fee=\$2, net_revenue=amount_net-\$2 WHERE id=\$1 AND net_revenue IS NULL/.test(q)) {
    db.purchases.filter(x => x.id === p[0] && x.net_revenue == null).forEach(x => { x.provider_fee = p[1]; x.net_revenue = x.amount_net - p[1]; }); return { rows: [] };
  }
  if (/INSERT INTO quotes \(id, report_ref, buyer_session,/.test(q)) {
    if (p.length !== 23) throw new Error('quote insert expects 23 parameters, got ' + p.length);
    if (![10, 11, 12].every(i => Number.isInteger(p[i]))) throw new Error('quote amounts must be integers in the smallest unit');
    if (typeof p[22] !== 'string') throw new Error('quote body must be JSON text for the ::jsonb column');
    db.quotes.set(p[0], { body: JSON.parse(p[22]), status: p[19], ref: p[1], session: p[2] }); return { rows: [] };
  }
  if (/SELECT body, status FROM quotes WHERE id = \$1/.test(q)) { const r = db.quotes.get(p[0]); return { rows: r ? [{ body: JSON.parse(JSON.stringify(r.body)), status: r.status }] : [] }; }
  if (/UPDATE quotes SET status = 'superseded' WHERE report_ref = \$1 AND buyer_session = \$2 AND status = 'open' AND id <> \$3/.test(q)) {
    for (const [id, r] of db.quotes) if (r.ref === p[0] && r.session === p[1] && r.status === 'open' && id !== p[2]) r.status = 'superseded'; return { rows: [] };
  }
  if (/UPDATE quotes SET status = \$2 WHERE id = \$1/.test(q)) { const r = db.quotes.get(p[0]); if (r) r.status = p[1]; return { rows: [] }; }
  if (/INSERT INTO pricing_events \(at, type, quote_id, report_ref, details\)/.test(q)) {
    if (typeof p[3] !== 'string') throw new Error('details must be JSON text'); db.pricingEvents.push({ at: new Date().toISOString(), type: p[0], quote_id: p[1], report_ref: p[2], details: JSON.parse(p[3]) }); return { rows: [] };
  }
  if (/SELECT at, type, quote_id, report_ref, details FROM pricing_events/.test(q))
    return { rows: db.pricingEvents.filter(e => (p[0] == null || e.type === p[0]) && (p[1] == null || e.quote_id === p[1])).map(e => ({ ...e })) };
  if (/INSERT INTO tax_ledger \(country, month, gross_sales, tax_collected, currency\)/.test(q) && /ON CONFLICT \(country, month, currency\)/.test(q)) {
    const k = p[0] + '|' + p[1] + '|' + p[4], cur = db.ledger.get(k) || { country: p[0], month: p[1], currency: p[4], gross_sales: 0, tax_collected: 0 };
    cur.gross_sales += p[2]; cur.tax_collected += p[3]; db.ledger.set(k, cur); return { rows: [] };
  }
  if (/SELECT country, month, gross_sales, tax_collected, currency FROM tax_ledger WHERE month >= \$1/.test(q))
    return { rows: [...db.ledger.values()].filter(r => r.month >= p[0]).map(r => ({ ...r, gross_sales: String(r.gross_sales), tax_collected: String(r.tax_collected) })) };
  if (/INSERT INTO refunds \(purchase_id, amount, currency, tax_reversed, reason, provider_ref, status\)/.test(q)) { db.refunds.push({ purchase_id: p[0], amount: p[1], currency: p[2], tax_reversed: p[3], reason: p[4], provider_ref: p[5], status: p[6] }); return { rows: [] }; }
  if (/SELECT COALESCE\(SUM\(amount\), 0\) AS refunded FROM refunds WHERE purchase_id = \$1/.test(q)) return { rows: [{ refunded: String(db.refunds.filter(r => r.purchase_id === p[0]).reduce((a, r) => a + r.amount, 0)) }] };
  if (/INSERT INTO invoice_counters \(series, last\) VALUES \(\$1, 1\) ON CONFLICT \(series\) DO UPDATE SET last = invoice_counters.last \+ 1 RETURNING last/.test(q)) { const n = (db.counters.get(p[0]) || 0) + 1; db.counters.set(p[0], n); return { rows: [{ last: n }] }; }
  if (/INSERT INTO invoices \(purchase_id, number, kind, country, currency, amount_net, tax_amount, amount_gross, tax_rate_bps, body, issued_at\)/.test(q)) {
    if (db.invoices.some(i => i.number === p[1])) { const err = new Error('duplicate invoice number'); err.code = '23505'; throw err; }
    db.invoices.push({ purchase_id: p[0], number: p[1], kind: p[2], country: p[3], currency: p[4], amount_gross: p[7], body: JSON.parse(p[9]) }); return { rows: [] };
  }
  if (/SELECT number, kind, country, currency, amount_gross FROM invoices/.test(q)) return { rows: db.invoices.map(i => ({ ...i })) };
  if (/\bquotes\b|pricing_events|tax_ledger|refunds|invoice_counters|invoices/.test(q) && !/audit_log/.test(q)) throw new Error('stub does not recognise this pricing statement: ' + q.slice(0, 100));

  if (/SELECT id, amount, currency, (provider, )?provider_order_id, status(, quote_id, billing_country)? FROM report_purchases WHERE idempotency_key=\$1/.test(q))
    return { rows: db.purchases.filter(x => x.idempotency_key === p[0]) };

  if (/INSERT INTO report_purchases \(report_ref, amount, currency, status, provider, idempotency_key\)/.test(q)) {
    if (p[3] != null && db.purchases.some(x => x.idempotency_key === p[3])) {
      const err = new Error('duplicate key value violates unique constraint "uq_report_purchases_idempotency_key"');
      err.code = '23505'; throw err;
    }
    const id = uuid();
    db.purchases.push({ id, report_ref:p[0], amount:p[1], currency:p[2], status:'pending_payment', provider:'razorpay', idempotency_key:p[3] ?? null });
    return { rows:[{id}] };
  }
  if (/INSERT INTO report_purchases/.test(q)) { const id = uuid(); db.purchases.push({ id, report_ref:p[0], amount:p[1], currency:p[2], status:'pending_payment', provider: /'razorpay'/.test(q)?'razorpay':null }); return { rows:[{id}] }; }

  if (/SELECT amount FROM report_purchases WHERE id=\$1 AND report_ref=\$2/.test(q)) return { rows: db.purchases.filter(x => x.id === p[0] && x.report_ref === p[1]).map(x => ({ amount: String(x.amount) })) };
  if (/SELECT report_ref FROM report_purchases WHERE provider_payment_id=\$1 AND status='paid'/.test(q)) return { rows: db.purchases.filter(x => x.provider_payment_id === p[0] && x.status === 'paid').map(x => ({ report_ref: x.report_ref })) };
  if (/UPDATE report_purchases SET attribution=\$2 WHERE id=\$1/.test(q)) { db.purchases.filter(x => x.id === p[0]).forEach(x => { x.attribution = JSON.parse(p[1]); }); return { rows: [] }; }
  if (/SELECT attribution FROM report_purchases WHERE id=\$1/.test(q)) return { rows: db.purchases.filter(x => x.id === p[0]).map(x => ({ attribution: x.attribution || {} })) };
  if (/SET provider_order_id=\$2 WHERE id=\$1/.test(q)) { db.purchases.filter(x=>x.id===p[0]).forEach(x=>x.provider_order_id=p[1]); return { rows:[] }; }
  if (/SELECT status, provider, provider_order_id, amount, currency FROM report_purchases WHERE id=\$1 AND report_ref=\$2/.test(q)) return { rows: db.purchases.filter(x=>x.id===p[0]&&x.report_ref===p[1]) };
  if (/SELECT id, report_ref, amount, currency, status FROM report_purchases WHERE id=\$1 AND provider='mor'/.test(q)) return { rows: db.purchases.filter(x=>x.id===p[0]&&x.provider==='mor') };
  if (/SELECT status, provider_order_id FROM report_purchases/.test(q)) return { rows: db.purchases.filter(x=>x.id===p[0]&&x.report_ref===p[1]).map(x=>({status:x.status, provider_order_id:x.provider_order_id})) };
  if (/SELECT status FROM report_purchases/.test(q)) return { rows: db.purchases.filter(x=>x.id===p[0]&&x.report_ref===p[1]).map(x=>({status:x.status})) };
  if (/SELECT id, report_ref, amount, currency, status FROM report_purchases WHERE provider='razorpay' AND provider_order_id=\$1/.test(q)) return { rows: db.purchases.filter(x=>x.provider==='razorpay'&&x.provider_order_id===p[0]) };
  if (/SET status='paid', provider_payment_id=\$3/.test(q)) { const r = db.purchases.filter(x=>x.id===p[0]&&x.report_ref===p[1]&&x.status==='pending_payment'); r.forEach(x=>{x.status='paid'; x.provider_payment_id=p[2];}); return { rows: r.map(x=>({id:x.id, amount:String(x.amount), currency:x.currency, quote_id:x.quote_id ?? null, buyer_country:x.buyer_country ?? null, billing_country:x.billing_country ?? null, buyer_kind:x.buyer_kind ?? null, tax_id:x.tax_id ?? null})) }; }
  if (/INSERT INTO payment_events/.test(q)) { const lit = /'razorpay'/.test(q) ? 'razorpay' : /'mor'/.test(q) ? 'mor' : null, k = (lit || p[0]) + '|' + (lit ? p[0] : p[1]); if (db.events.has(k)) return { rows:[] }; db.events.add(k); return { rows:[{id:db.events.size}] }; }
  if (/SELECT u\.email FROM report_purchases p JOIN users u ON u\.id = p\.user_id WHERE p\.id=\$1/.test(q)) { const e = db.payerEmail && db.payerEmail[p[0]]; return { rows: e ? [{ email: e }] : [] }; }
  if (/UPDATE report_purchases SET user_id=\$2 WHERE id=\$1/.test(q)) { db.purchases.filter(x => x.id === p[0]).forEach(x => { x.user_id = p[1]; }); return { rows: [] }; }
  if (/SELECT 1 FROM report_purchases WHERE user_id=\$1 AND status='paid'( AND created_at >= \$2)? LIMIT 1/.test(q)) return { rows: db.purchases.filter(x => x.user_id === p[0] && x.status === 'paid').slice(0, 1).map(() => ({ '?column?': 1 })) };
  if (/SELECT 1 FROM report_purchases WHERE user_id=\$1 AND report_ref=\$2 AND status='paid'/.test(q)) return { rows: db.purchases.filter(x => x.user_id === p[0] && x.report_ref === p[1] && x.status === 'paid').slice(0, 1).map(() => ({ '?column?': 1 })) };
  if (/SELECT 1 FROM report_purchases WHERE id=\$1 AND user_id=\$2/.test(q)) return { rows: db.purchases.filter(x => x.id === p[0] && x.user_id === p[1]).map(() => ({ '?column?': 1 })) };
  if (/SELECT report_ref, amount, currency, status, created_at FROM report_purchases WHERE user_id=\$1/.test(q)) return { rows: db.purchases.filter(x => x.user_id === p[0]).map(x => ({ report_ref: x.report_ref, amount: x.amount, currency: x.currency, status: x.status, created_at: new Date() })) };
  return { rows: [] };
}
module.exports = { Pool: class { query(s,p){ return query(s,p); } async connect(){ return { query, release(){} }; } async end(){} }, _db: db };
