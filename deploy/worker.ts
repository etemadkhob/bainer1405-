/**
 * Cloudflare Worker — پورت API سرور (server.ts) برای Workers + Assets — v2.0.0
 *
 * مسیرها:
 *   GET  /api/health                       سلامت + نسخه (+ Turso available)
 *   GET  /api/klines/:assetId?tf=5m|15m|1h کندل‌ها (بایننس→OKX→Bybit)
 *   GET  /api/tickers                      تیکرهای زنده
 *   GET  /api/depth?asset=...              دفتر سفارشات + عدم تعادل ±۲٪ + دیوارها
 *   GET  /api/news                         تقویم اقتصادی (کش ۱۵ دقیقه‌ای edge)
 *   GET  /api/signals?limit=100            تاریخچهٔ سروری (Turso)
 *   POST /api/signals                      upsert دسته‌ای تاریخچه (Turso)
 *   GET  /api/stats                        آمار برد/باخت واقعی سروری (Turso)
 *
 * Turso کاملاً اختیاری است: اگر secrets ست نشده باشند، مسیرهای DB با
 * {"available": false} پاسخ می‌دهند و کلاینت فقط localStorage دارد.
 */

import { createTursoClient, type Env } from './turso';

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

type Handler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
};

const BINANCE_SYMBOLS: Record<string, string> = {
  BTCUSDT: 'BTCUSDT',
  ETHUSDT: 'ETHUSDT',
  SOLUSDT: 'SOLUSDT',
  BNBUSDT: 'BNBUSDT',
  XRPUSDT: 'XRPUSDT',
  ADAUSDT: 'ADAUSDT',
  DOGEUSDT: 'DOGEUSDT',
  AVAXUSDT: 'AVAXUSDT',
  TRXUSDT: 'TRXUSDT',
  TONUSDT: 'TONUSDT',
  DOTUSDT: 'DOTUSDT',
  LINKUSDT: 'LINKUSDT',
  SUIUSDT: 'SUIUSDT',
  LTCUSDT: 'LTCUSDT',
  BCHUSDT: 'BCHUSDT',
  NEARUSDT: 'NEARUSDT',
  UNIUSDT: 'UNIUSDT',
  APTUSDT: 'APTUSDT',
  PAXGUSDT: 'PAXGUSDT',
  EURUSD: 'EURUSDT',
};

/** نگاشت tf به پارامترهای هر منبع */
const TF_MAP: Record<string, { binance: string; okx: string; bybit: string; ms: number }> = {
  '5m': { binance: '5m', okx: '5m', bybit: '5', ms: 300_000 },
  '15m': { binance: '15m', okx: '15m', bybit: '15', ms: 900_000 },
  '1h': { binance: '1h', okx: '1H', bybit: '60', ms: 3_600_000 },
};

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
}

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'Content-Type',
};

function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// ---------------------------------------------------------------------------
// کندل‌ها — با پارامتر تایم‌فریم
// ---------------------------------------------------------------------------
async function fetchBinanceKlines(symbol: string, tf: keyof typeof TF_MAP): Promise<Candle[]> {
  const cfg = TF_MAP[tf];
  const endpoints = [
    `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${cfg.binance}&limit=220`,
    `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${cfg.binance}&limit=220`,
  ];
  const diag: string[] = [];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'QuantOracle/2.0' },
        signal: AbortSignal.timeout(4500),
      });
      diag.push(`${new URL(url).host}:${res.status}`);
      if (!res.ok) continue;
      const raw = (await res.json()) as Array<[number, string, string, string, string, string]>;
      if (!Array.isArray(raw) || raw.length < 30) {
        diag.push('short');
        continue;
      }
      (workerDiag as Record<string, string[]>)[`${symbol}:${tf}`] = diag;
      return raw.map((row) => ({
        time: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      }));
    } catch {
      diag.push(`${new URL(url).host}:ERR`);
    }
  }
  (workerDiag as Record<string, string[]>)[`${symbol}:${tf}`] = diag;
  throw new Error('Binance unavailable');
}

/** diagnosing از آخرین تلاش‌ها (برای ?debug=1) */
const workerDiag: Record<string, string[]> = {};

async function fetchOkxKlines(instId: string, tf: keyof typeof TF_MAP): Promise<Candle[]> {
  const cfg = TF_MAP[tf];
  const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${cfg.okx}&limit=220`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'QuantOracle/2.0' },
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error(`OKX HTTP ${res.status}`);
  const payload = (await res.json()) as {
    code?: string;
    data?: Array<[string, string, string, string, string, string]>;
  };
  const rows = payload?.data;
  if (payload?.code !== '0' || !Array.isArray(rows) || rows.length < 30) {
    throw new Error('Insufficient OKX bars');
  }
  // OKX: نزولی (جدیدترین اول) → صعودی
  return rows
    .map((row) => ({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }))
    .reverse();
}

async function fetchBybitKlines(symbol: string, tf: keyof typeof TF_MAP): Promise<Candle[]> {
  const cfg = TF_MAP[tf];
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${encodeURIComponent(symbol)}&interval=${cfg.bybit}&limit=220`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'QuantOracle/2.0' },
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error(`Bybit HTTP ${res.status}`);
  const payload = (await res.json()) as {
    retCode?: number;
    result?: { list?: Array<[string, string, string, string, string, string, string]> };
  };
  const rows = payload?.result?.list;
  if (payload?.retCode !== 0 || !Array.isArray(rows) || rows.length < 30) {
    throw new Error('Insufficient Bybit bars');
  }
  return rows
    .map((row) => ({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }))
    .reverse();
}

async function fetchKlinesChain(
  symbol: string,
  instId: string,
  tf: keyof typeof TF_MAP
): Promise<{ candles: Candle[]; source: string; diag?: string[] }> {
  try {
    return { candles: await fetchBinanceKlines(symbol, tf), source: 'binance_vision' };
  } catch (binanceErr) {
    try {
      return { candles: await fetchOkxKlines(instId, tf), source: 'okx' };
    } catch (okxErr) {
      try {
        return {
          candles: await fetchBybitKlines(symbol, tf),
          source: 'bybit',
          diag: [`okx:${(okxErr as Error).message}`],
        };
      } catch (bybitErr) {
        throw new Error(
          `all sources failed: okx:${(okxErr as Error).message} bybit:${(bybitErr as Error).message} binance:${(binanceErr as Error).message}`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// تیکرها
// ---------------------------------------------------------------------------
async function fetchOkxTickers(): Promise<Record<string, { price: number; change24hPct: number }>> {
  const url = 'https://www.okx.com/api/v5/market/tickers?instType=SPOT';
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'QuantOracle/2.0' },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) return {};
  const payload = (await res.json()) as {
    code?: string;
    data?: Array<{ instId: string; last: string; open24h: string }>;
  };
  if (payload?.code !== '0' || !Array.isArray(payload.data)) return {};

  const wanted = new Set(
    Object.values(BINANCE_SYMBOLS).map((s) => `${s.replace(/USDT$/, '')}-USDT`)
  );
  const out: Record<string, { price: number; change24hPct: number }> = {};
  for (const row of payload.data) {
    if (!wanted.has(row.instId)) continue;
    const last = Number(row.last);
    const open24 = Number(row.open24h);
    if (!Number.isFinite(last)) continue;
    out[row.instId] = {
      price: last,
      change24hPct: open24 > 0 ? Number(((last - open24) / open24) * 100) : 0,
    };
  }
  return out;
}

async function fetchBinanceTickers(): Promise<Record<string, { price: number; change24hPct: number }>> {
  const symbols = JSON.stringify(Object.values(BINANCE_SYMBOLS));
  const endpoints = [
    `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbols)}`,
    `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbols)}`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'QuantOracle/2.0' },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const rows = (await res.json()) as Array<{
        symbol: string;
        lastPrice: string;
        priceChangePercent: string;
      }>;
      if (!Array.isArray(rows)) continue;
      const out: Record<string, { price: number; change24hPct: number }> = {};
      for (const row of rows) {
        out[row.symbol] = {
          price: Number(row.lastPrice),
          change24hPct: Number(row.priceChangePercent),
        };
      }
      return out;
    } catch {
      // endpoint بعدی
    }
  }
  return {};
}

// ---------------------------------------------------------------------------
// دفتر سفارشات — عدم تعادل ±۲٪ + دیوار خرید/فروش
// ---------------------------------------------------------------------------
interface DepthBook {
  bids: Array<[number, number]>; // [price, qty] نزولی
  asks: Array<[number, number]>; // [price, qty] صعودی
  source: string;
}

async function fetchBinanceDepth(symbol: string): Promise<DepthBook> {
  const url = `https://data-api.binance.vision/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=100`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'QuantOracle/2.0' },
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error(`Binance depth HTTP ${res.status}`);
  const payload = (await res.json()) as { bids?: Array<[string, string]>; asks?: Array<[string, string]> };
  if (!payload.bids?.length || !payload.asks?.length) throw new Error('empty book');
  return {
    bids: payload.bids.map(([p, q]) => [Number(p), Number(q)]),
    asks: payload.asks.map(([p, q]) => [Number(p), Number(q)]),
    source: 'binance_vision',
  };
}

async function fetchOkxDepth(instId: string): Promise<DepthBook> {
  const url = `https://www.okx.com/api/v5/market/books?instId=${encodeURIComponent(instId)}&sz=100`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'QuantOracle/2.0' },
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error(`OKX books HTTP ${res.status}`);
  const payload = (await res.json()) as {
    code?: string;
    data?: Array<{ asks?: Array<[string, string, string, string]>; bids?: Array<[string, string, string, string]> }>;
  };
  const book = payload?.data?.[0];
  if (payload?.code !== '0' || !book?.asks?.length || !book?.bids?.length) {
    throw new Error('empty OKX book');
  }
  const bids: Array<[number, number]> = book.bids
    .map((r) => [Number(r[0]), Number(r[1])] as [number, number])
    .filter(([p, q]) => Number.isFinite(p) && Number.isFinite(q))
    .sort((a, b) => b[0] - a[0]);
  const asks: Array<[number, number]> = book.asks
    .map((r) => [Number(r[0]), Number(r[1])] as [number, number])
    .filter(([p, q]) => Number.isFinite(p) && Number.isFinite(q))
    .sort((a, b) => a[0] - b[0]);
  if (bids.length === 0 || asks.length === 0) throw new Error('OKX book parse failed');
  return { bids, asks, source: 'okx' };
}

async function fetchBybitDepth(symbol: string): Promise<DepthBook> {
  const url = `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${encodeURIComponent(symbol)}&limit=50`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'QuantOracle/2.0' },
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error(`Bybit orderbook HTTP ${res.status}`);
  const payload = (await res.json()) as {
    retCode?: number;
    result?: { b?: Array<[string, string]>; a?: Array<[string, string]> };
  };
  const b = payload?.result?.b;
  const a = payload?.result?.a;
  if (payload?.retCode !== 0 || !b?.length || !a?.length) throw new Error('empty Bybit book');
  return {
    bids: b.map(([p, q]) => [Number(p), Number(q)] as [number, number]).sort((x, y) => y[0] - x[0]),
    asks: a.map(([p, q]) => [Number(p), Number(q)] as [number, number]).sort((x, y) => x[0] - y[0]),
    source: 'bybit',
  };
}

function analyzeBook(book: DepthBook): {
  imbalance: number;
  sellWall: boolean;
  buyWall: boolean;
} {
  const bestBid = book.bids[0][0];
  const bestAsk = book.asks[0][0];
  const mid = (bestBid + bestAsk) / 2;
  const zoneLow = mid * 0.98;
  const zoneHigh = mid * 1.02;

  const bidsIn = book.bids.filter(([p]) => p >= zoneLow);
  const asksIn = book.asks.filter(([p]) => p <= zoneHigh);
  const bidQty = bidsIn.reduce((s, [, q]) => s + q, 0);
  const askQty = asksIn.reduce((s, [, q]) => s + q, 0);
  const total = bidQty + askQty;
  const imbalance = total > 0 ? bidQty / total : 0.5;

  const median = (arr: Array<[number, number]>) => {
    if (arr.length === 0) return 0;
    const qs = arr.map(([, q]) => q).sort((x, y) => x - y);
    return qs[Math.floor(qs.length / 2)] ?? 0;
  };
  const bidMedian = median(bidsIn);
  const askMedian = median(asksIn);
  const maxBid = bidsIn.reduce((m, [, q]) => Math.max(m, q), 0);
  const maxAsk = asksIn.reduce((m, [, q]) => Math.max(m, q), 0);

  return {
    imbalance,
    sellWall: askMedian > 0 && maxAsk > askMedian * 5,
    buyWall: bidMedian > 0 && maxBid > bidMedian * 5,
  };
}

// ---------------------------------------------------------------------------
// تقویم اقتصادی — کش ۱۵ دقیقه‌ای روی edge
// ---------------------------------------------------------------------------
interface NewsCache {
  at: number;
  events: Array<{ title: string; currency: string; impact: string; time: number }>;
}
let newsCache: NewsCache | null = null;
const NEWS_TTL_MS = 15 * 60 * 1000;
let newsDiag: string[] = [];

async function fetchNewsCalendar(): Promise<NewsCache['events']> {
  if (newsCache && Date.now() - newsCache.at < NEWS_TTL_MS) return newsCache.events;
  const endpoints = [
    'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    'https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json',
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'QuantOracle/2.0' },
        signal: AbortSignal.timeout(6000),
      });
      newsDiag.push(`${new URL(url).host}:${res.status}`);
      if (!res.ok) continue;
      const rows = (await res.json()) as Array<{
        title?: string;
        country?: string;
        currency?: string;
        date?: string;
        impact?: string;
      }>;
      if (!Array.isArray(rows)) continue;
      const events: NewsCache['events'] = [];
      for (const row of rows) {
        const t = row.date ? Date.parse(row.date) : NaN;
        if (!Number.isFinite(t)) continue;
        events.push({
          title: String(row.title ?? 'رویداد اقتصادی'),
          currency: String(row.currency ?? row.country ?? ''),
          impact: String(row.impact ?? ''),
          time: t,
        });
      }
      newsCache = { at: Date.now(), events };
      return events;
    } catch (e) {
      newsDiag.push(`${new URL(url).host}:ERR`);
      // endpoint بعدی
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Turso — تاریخچهٔ سروری
// ---------------------------------------------------------------------------
interface SignalWire {
  id: string;
  issued_at: number;
  candle_open_time: number;
  candle_close_time: number;
  asset_id: string;
  asset_label: string;
  direction: 'CALL' | 'PUT';
  confidence: number;
  entry_price: number;
  entry_quote: number | null;
  close_price: number | null;
  status: 'PENDING' | 'WIN' | 'LOSS' | 'TIE';
  settle_source: string | null;
  settle_quality: 'exact' | 'approximate' | null;
  decimals: number;
  reasons: string | null;
}

function signalWireGuard(r: unknown): SignalWire | null {
  const x = r as Partial<SignalWire>;
  if (
    typeof x?.id !== 'string' ||
    !Number.isFinite(x.issued_at) ||
    !Number.isFinite(x.candle_open_time) ||
    !Number.isFinite(x.candle_close_time) ||
    typeof x.asset_id !== 'string' ||
    (x.direction !== 'CALL' && x.direction !== 'PUT') ||
    !Number.isFinite(x.entry_price) ||
    !['PENDING', 'WIN', 'LOSS', 'TIE'].includes(String(x.status))
  ) {
    return null;
  }
  return {
    id: x.id,
    issued_at: x.issued_at!,
    candle_open_time: x.candle_open_time!,
    candle_close_time: x.candle_close_time!,
    asset_id: x.asset_id,
    asset_label: typeof x.asset_label === 'string' ? x.asset_label : x.asset_id,
    direction: x.direction,
    confidence: Number.isFinite(x.confidence) ? Math.round(x.confidence!) : 0,
    entry_price: x.entry_price!,
    entry_quote: Number.isFinite(x.entry_quote as number) ? (x.entry_quote as number) : null,
    close_price: Number.isFinite(x.close_price as number) ? (x.close_price as number) : null,
    status: x.status as SignalWire['status'],
    settle_source: typeof x.settle_source === 'string' ? x.settle_source : null,
    settle_quality: x.settle_quality === 'exact' || x.settle_quality === 'approximate' ? x.settle_quality : null,
    decimals: Number.isFinite(x.decimals) ? Math.round(x.decimals!) : 2,
    reasons: typeof x.reasons === 'string' ? x.reasons.slice(0, 2000) : null,
  };
}

async function getSignals(env: Env, limit: number): Promise<Response> {
  const db = createTursoClient(env);
  if (!db.available) return json({ available: false, records: [] });
  try {
    const safeLimit = Math.max(1, Math.min(200, limit));
    const result = await db.execute(
      `SELECT id, issued_at, candle_open_time, candle_close_time, asset_id, asset_label,
              direction, confidence, entry_price, entry_quote, close_price, status,
              settle_source, settle_quality, decimals, reasons
       FROM signal_records
       ORDER BY issued_at DESC
       LIMIT ${safeLimit}`
    );
    return json({ available: true, records: result.rows });
  } catch (e) {
    return json({ available: false, error: (e as Error).message }, 503);
  }
}

async function postSignals(env: Env, request: Request): Promise<Response> {
  const db = createTursoClient(env);
  if (!db.available) {
    return json({ available: false, note: 'Turso secrets not configured' }, 503);
  }
  try {
    const body = (await request.json()) as { records?: unknown[] };
    const wires = (body.records ?? [])
      .map(signalWireGuard)
      .filter((r): r is SignalWire => r !== null)
      .slice(0, 100);
    if (wires.length === 0) return json({ available: true, saved: 0 });

    const stmts = wires.map((r) => ({
      sql: `INSERT OR REPLACE INTO signal_records
            (id, issued_at, candle_open_time, candle_close_time, asset_id, asset_label,
             direction, confidence, entry_price, entry_quote, close_price, status,
             settle_source, settle_quality, decimals, reasons)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        r.id, r.issued_at, r.candle_open_time, r.candle_close_time,
        r.asset_id, r.asset_label, r.direction, r.confidence, r.entry_price,
        r.entry_quote, r.close_price, r.status, r.settle_source, r.settle_quality,
        r.decimals, r.reasons,
      ],
    }));
    await db.batch(stmts);
    return json({ available: true, saved: wires.length });
  } catch (e) {
    return json({ available: false, error: (e as Error).message }, 503);
  }
}

async function getStats(env: Env): Promise<Response> {
  const db = createTursoClient(env);
  if (!db.available) return json({ available: false, settled: 0, wins: 0, losses: 0, winRate: null });
  try {
    const result = await db.execute(
      `SELECT
         COUNT(*) AS settled,
         SUM(CASE WHEN status = 'WIN' THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN status = 'LOSS' THEN 1 ELSE 0 END) AS losses
       FROM signal_records
       WHERE status IN ('WIN', 'LOSS')`
    );
    const row = result.rows[0] ?? {};
    const settled = Number(row.settled ?? 0);
    const wins = Number(row.wins ?? 0);
    const losses = Number(row.losses ?? 0);
    return json({
      available: true,
      settled,
      wins,
      losses,
      winRate: settled > 0 ? Number((((wins / settled) * 100)).toFixed(1)) : null,
      updatedAt: Date.now(),
    });
  } catch (e) {
    return json({ available: false, error: (e as Error).message }, 503);
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const worker: Handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return preflight();

    if (url.pathname.startsWith('/api/klines/')) {
      const assetId = decodeURIComponent(url.pathname.slice('/api/klines/'.length));
      const tfParam = url.searchParams.get('tf') ?? '5m';
      const tf = (tfParam in TF_MAP ? tfParam : '5m') as keyof typeof TF_MAP;
      const symbol = BINANCE_SYMBOLS[assetId];
      if (!symbol) return json({ error: 'Unknown assetId' }, 400);
      const instId = symbol.replace(/USDT$/, '') + '-USDT';
      try {
        const { candles, source } = await fetchKlinesChain(symbol, instId, tf);
        return json({ candles, source, tf, fetchedAt: Date.now() });
      } catch (e) {
        return json(
          {
            error: 'Upstream market data unavailable',
            diag: url.searchParams.get('debug') === '1' ? (e as Error).message : undefined,
          },
          503
        );
      }
    }

    if (url.pathname === '/api/tickers') {
      let map = await fetchBinanceTickers();
      let source: string = 'binance_vision';
      if (Object.keys(map).length === 0) {
        map = await fetchOkxTickers();
        source = 'okx';
      }
      const tickers: Record<
        string,
        { price: number; change24hPct: number; source: string; updatedAt: number }
      > = {};
      for (const [id, sym] of Object.entries(BINANCE_SYMBOLS)) {
        const instId = `${sym.replace(/USDT$/, '')}-USDT`;
        const row = map[sym] ?? map[instId];
        if (row) {
          tickers[id] = {
            price: row.price,
            change24hPct: Number(row.change24hPct.toFixed(2)),
            source,
            updatedAt: Date.now(),
          };
        }
      }
      return json({ tickers, updatedAt: Date.now() });
    }

    if (url.pathname === '/api/depth') {
      const assetId = url.searchParams.get('asset') ?? '';
      const symbol = BINANCE_SYMBOLS[assetId];
      if (!symbol) return json({ error: 'Unknown assetId' }, 400);
      const instId = symbol.replace(/USDT$/, '') + '-USDT';
      try {
        const book = await fetchBinanceDepth(symbol);
        const r = analyzeBook(book);
        return json({ available: true, assetId, ...r, updatedAt: Date.now() });
      } catch (bErr) {
        try {
          const book = await fetchOkxDepth(instId);
          const r = analyzeBook(book);
          return json({ available: true, assetId, ...r, updatedAt: Date.now() });
        } catch {
          try {
            const book = await fetchBybitDepth(symbol);
            const r = analyzeBook(book);
            return json({ available: true, assetId, ...r, updatedAt: Date.now() });
          } catch (bbErr) {
            return json({
              available: false,
              diag: `${(bErr as Error).message} | ${(bbErr as Error).message}`,
            });
          }
        }
      }
    }

    if (url.pathname === '/api/news') {
      try {
        const events = await fetchNewsCalendar();
        const high = events.filter((e) => e.impact.toLowerCase() === 'high');
        return json({
          available: events.length > 0,
          events: events.slice(0, 60),
          highCount: high.length,
          diag: url.searchParams.get('debug') === '1' ? newsDiag : undefined,
        });
      } catch (e) {
        return json({ available: false, error: (e as Error).message });
      }
    }

    if (url.pathname === '/api/signals' && request.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? '100');
      return getSignals(env, Number.isFinite(limit) ? limit : 100);
    }

    if (url.pathname === '/api/signals' && request.method === 'POST') {
      return postSignals(env, request);
    }

    if (url.pathname === '/api/stats') {
      return getStats(env);
    }

    if (url.pathname === '/api/health') {
      const db = createTursoClient(env);
      return json({
        ok: true,
        service: 'quant-oracle',
        version: '2.0.0',
        db: db.available,
        gates: [
          'circuit-breaker', 'news-blocker', 'btc-shock', 'mtf-ema50-200',
          'choppiness', 'adx', 'wick-body', 'atr-gate', 'no-trade-80',
          'order-book-imbalance', 'cvd', 'dynamic-weights', 'backtest-winrate',
        ],
      });
    }

    // مسیرهای دیگر: از Assets (اسپا) سرو می‌شود
    return fetch(request);
  },
};

export default worker;
