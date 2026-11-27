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
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'QuantOracle/1.1' },
        signal: AbortSignal.timeout(4500),
      });
      if (!res.ok) continue;
      const raw = (await res.json()) as Array<[number, string, string, string, string, string]>;
      if (!Array.isArray(raw) || raw.length < 30) continue;
      return raw.map((row) => ({
        time: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      }));
    } catch {
      // endpoint بعدی
    }
  }
  throw new Error('Binance unavailable');
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
        return json({ error: 'Upstream market data unavailable' }, 503);
      }
    }

    if (url.pathname === '/api/tickers') {
      const map = await fetchBinanceTickers();
      const tickers: Record<
        string,
        { price: number; change24hPct: number; source: string; updatedAt: number }
      > = {};
      for (const [id, sym] of Object.entries(BINANCE_SYMBOLS)) {
        const row = map[sym];
        if (row) {
          tickers[id] = {
            price: row.price,
            change24hPct: Number(row.change24hPct.toFixed(2)),
            source: 'binance_vision',
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
