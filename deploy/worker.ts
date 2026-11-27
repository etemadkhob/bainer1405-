/**
 * Cloudflare Worker — پورت API سرور (server.ts) برای Workers + Assets
 * بدون هیچ کلید مخفی: فقط APIهای عمومی بایننس/یاهو.
 *
 * استقرار:
 *   npm run build && npx wrangler deploy
 */

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface Env {
  // بدون متغیر الزامی. اختیاری برای همگام‌سازی آیندهٔ تاریخچه با Turso:
  // TURSO_DATABASE_URL?: string;
  // TURSO_AUTH_TOKEN?: string;
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

async function fetchBinanceKlines(symbol: string): Promise<Candle[]> {
  const endpoints = [
    `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=5m&limit=220`,
    `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=5m&limit=220`,
  ];
  const diag: string[] = [];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'QuantOracle/1.1' },
        signal: AbortSignal.timeout(4500),
      });
      diag.push(`${new URL(url).host}:${res.status}`);
      if (!res.ok) continue;
      const raw = (await res.json()) as Array<[number, string, string, string, string, string]>;
      if (!Array.isArray(raw) || raw.length < 30) {
        diag.push('short');
        continue;
      }
      (workerDiag as Record<string, string[]>)[symbol] = diag;
      return raw.map((row) => ({
        time: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      }));
    } catch (e) {
      diag.push(`${new URL(url).host}:ERR`);
    }
  }
  (workerDiag as Record<string, string[]>)[symbol] = diag;
  throw new Error('Binance unavailable');
}

/** diagnosing از آخرین تلاش‌ها (برای ?debug=1) */
const workerDiag: Record<string, string[]> = {};

/** fallback وقتی بایننس از edge کلودفلر بلاک است (۴۰۳) — مبنای OKX کمی متفاوت است؛ کلاینت approximate برچسب می‌زند */
async function fetchOkxKlines(instId: string): Promise<Candle[]> {
  const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=5m&limit=220`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'QuantOracle/1.1' },
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

/** تیکر OKX وقتی بایننس از edge بلاک است */
async function fetchOkxTickers(): Promise<Record<string, { price: number; change24hPct: number }>> {
  const url = 'https://www.okx.com/api/v5/market/tickers?instType=SPOT';
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'QuantOracle/1.1' },
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
        headers: { Accept: 'application/json', 'User-Agent': 'QuantOracle/1.1' },
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


/** منبع سوم: Bybit — معمولاً از edge کلودفلر در دسترس است */
async function fetchBybitKlines(symbol: string): Promise<Candle[]> {
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${encodeURIComponent(symbol)}&interval=5&limit=220`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'QuantOracle/1.1' },
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
  // Bybit: نزولی → صعودی؛ ستون‌ها: [startTime, open, high, low, close, volume, turnover]
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

const worker: Handler = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,OPTIONS',
        },
      });
    }

    if (url.pathname.startsWith('/api/klines/')) {
      const assetId = decodeURIComponent(url.pathname.slice('/api/klines/'.length));
      const symbol = BINANCE_SYMBOLS[assetId];
      if (!symbol) return json({ error: 'Unknown assetId' }, 400);
      try {
        const candles = await fetchBinanceKlines(symbol);
        return json({ candles, source: 'binance_vision', fetchedAt: Date.now() });
      } catch {
        // بایننس از edge محدود است (403) → OKX (کلاینت آن را approximate برچسب می‌زند)
        try {
          const instId = symbol.replace(/USDT$/, '') + '-USDT';
          const candles = await fetchOkxKlines(instId);
          return json({
            candles,
            source: 'okx',
            fetchedAt: Date.now(),
            diag: url.searchParams.get('debug') === '1' ? workerDiag[symbol] : undefined,
          });
        } catch (okxErr) {
          try {
            const candles = await fetchBybitKlines(symbol);
            return json({
              candles,
              source: 'bybit',
              fetchedAt: Date.now(),
              diag: url.searchParams.get('debug') === '1'
                ? [...(workerDiag[symbol] ?? []), `okx:${(okxErr as Error).message}`]
                : undefined,
            });
          } catch (bybitErr) {
            return json({
              error: 'Upstream market data unavailable',
              diag: url.searchParams.get('debug') === '1'
                ? [...(workerDiag[symbol] ?? []), `okx:${(okxErr as Error).message}`, `bybit:${(bybitErr as Error).message}`]
                : undefined,
            }, 503);
          }
        }
      }
    }

    if (url.pathname === '/api/tickers') {
      let map = await fetchBinanceTickers();
      let source: string = 'binance_vision';
      if (Object.keys(map).length === 0) {
        // بایننس از edge بلاک است → تیکر OKX (کلاینت مبنا را approximate برچسب می‌زند)
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

    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'quant-oracle', version: '1.1.0' });
    }

    // مسیرهای دیگر: از Assets (اسپا) سرو می‌شود
    return fetch(request);
  },
};

export default worker;
