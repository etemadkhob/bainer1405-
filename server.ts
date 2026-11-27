import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type AssetId =
  | 'BTCUSDT'
  | 'ETHUSDT'
  | 'SOLUSDT'
  | 'BNBUSDT'
  | 'XRPUSDT'
  | 'ADAUSDT'
  | 'DOGEUSDT'
  | 'AVAXUSDT'
  | 'TRXUSDT'
  | 'TONUSDT'
  | 'DOTUSDT'
  | 'LINKUSDT'
  | 'SUIUSDT'
  | 'LTCUSDT'
  | 'BCHUSDT'
  | 'NEARUSDT'
  | 'UNIUSDT'
  | 'APTUSDT'
  | 'PAXGUSDT'
  | 'EURUSD';

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TickerInfo {
  price: number;
  change24hPct: number;
  source: string;
  updatedAt: number;
}

const BINANCE_SYMBOLS: Record<AssetId, string> = {
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

const ASSET_IDS = Object.keys(BINANCE_SYMBOLS) as AssetId[];

async function fetchBinanceKlines(
  baseUrl: string,
  symbol: string
): Promise<Candle[]> {
  const url = `${baseUrl}/api/v3/klines?symbol=${encodeURIComponent(
    symbol
  )}&interval=5m&limit=220`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'QuantOracle/1.0' },
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) {
    throw new Error(`Binance ${baseUrl} HTTP ${res.status}`);
  }
  const raw = (await res.json()) as Array<[number, string, string, string, string, string]>;
  if (!Array.isArray(raw) || raw.length < 30) {
    throw new Error('Insufficient Binance klines');
  }
  return raw.map((row) => ({
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

async function fetchYahooEurUsdKlines(): Promise<{
  candles: Candle[];
  regularMarketPrice: number;
  previousClose: number;
}> {
  const url =
    'https://query1.finance.yahoo.com/v8/finance/chart/EURUSD=X?interval=5m&range=1d';
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) {
    throw new Error(`Yahoo HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    chart?: {
      result?: Array<{
        meta?: {
          regularMarketPrice?: number;
          chartPreviousClose?: number;
          previousClose?: number;
        };
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
    };
  };

  const result = json?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  if (!result || !Array.isArray(timestamps) || !quote) {
    throw new Error('Invalid Yahoo FX response');
  }

  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    if (
      o === null ||
      o === undefined ||
      h === null ||
      h === undefined ||
      l === null ||
      l === undefined ||
      c === null ||
      c === undefined
    ) {
      continue;
    }
    candles.push({
      time: timestamps[i] * 1000,
      open: Number(o.toFixed(5)),
      high: Number(h.toFixed(5)),
      low: Number(l.toFixed(5)),
      close: Number(c.toFixed(5)),
      volume: Number(quote.volume?.[i] ?? 0),
    });
  }

  if (candles.length < 30) {
    throw new Error('Insufficient Yahoo FX candles');
  }

  const lastBarAgeMs = Date.now() - candles[candles.length - 1].time;
  // If FX market is closed (e.g. weekend > 20m stale), reject so Binance EURUSDT takes over
  if (lastBarAgeMs > 20 * 60 * 1000) {
    throw new Error('Yahoo FX market closed / stale');
  }

  const sliced = candles.slice(-220);
  const regularPrice =
    Number(result.meta?.regularMarketPrice) || sliced[sliced.length - 1].close;
  const prevClose =
    Number(result.meta?.chartPreviousClose ?? result.meta?.previousClose) ||
    sliced[0].open;

  // Ensure the live bar close reflects regularMarketPrice
  sliced[sliced.length - 1] = {
    ...sliced[sliced.length - 1],
    close: Number(regularPrice.toFixed(5)),
    high: Number(Math.max(sliced[sliced.length - 1].high, regularPrice).toFixed(5)),
    low: Number(Math.min(sliced[sliced.length - 1].low, regularPrice).toFixed(5)),
  };

  return {
    candles: sliced,
    regularMarketPrice: Number(regularPrice.toFixed(5)),
    previousClose: prevClose,
  };
}

async function fetchBinance24hTickers(): Promise<
  Record<string, { price: number; change24hPct: number }>
> {
  const symbols = JSON.stringify(Object.values(BINANCE_SYMBOLS));
  const endpoints = [
    `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbols)}`,
    `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbols)}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'QuantOracle/1.0' },
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
      // Try next endpoint
    }
  }
  return {};
}

async function createServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/klines/:assetId', async (req, res) => {
    const assetId = req.params.assetId as AssetId;
    if (!ASSET_IDS.includes(assetId)) {
      res.status(400).json({ error: 'Unknown assetId' });
      return;
    }

    const fetchedAt = Date.now();

    if (assetId === 'EURUSD') {
      try {
        const fx = await fetchYahooEurUsdKlines();
        res.json({ candles: fx.candles, source: 'yahoo_fx', fetchedAt });
        return;
      } catch {
        // Fallback to Binance EURUSDT if FX closed/unavailable
      }
    }

    const symbol = BINANCE_SYMBOLS[assetId];
    for (const [baseUrl, sourceName] of [
      ['https://data-api.binance.vision', 'binance_vision'],
      ['https://api.binance.com', 'binance'],
    ] as const) {
      try {
        const candles = await fetchBinanceKlines(baseUrl, symbol);
        res.json({ candles, source: sourceName, fetchedAt });
        return;
      } catch {
        // Try next
      }
    }

    res.status(503).json({ error: 'Upstream market data unavailable' });
  });

  app.get('/api/tickers', async (_req, res) => {
    const now = Date.now();
    const [binanceMap, yahooFx] = await Promise.all([
      fetchBinance24hTickers(),
      fetchYahooEurUsdKlines().catch(() => null),
    ]);

    const tickers: Partial<Record<AssetId, TickerInfo>> = {};

    for (const id of ASSET_IDS) {
      if (id === 'EURUSD' && yahooFx) {
        const prev = yahooFx.previousClose || yahooFx.regularMarketPrice;
        const pct = prev > 0 ? ((yahooFx.regularMarketPrice - prev) / prev) * 100 : 0;
        tickers.EURUSD = {
          price: yahooFx.regularMarketPrice,
          change24hPct: Number(pct.toFixed(2)),
          source: 'yahoo_fx',
          updatedAt: now,
        };
        continue;
      }

      const bRow = binanceMap[BINANCE_SYMBOLS[id]];
      if (bRow) {
        tickers[id] = {
          price: bRow.price,
          change24hPct: Number(bRow.change24hPct.toFixed(2)),
          source: 'binance_vision',
          updatedAt: now,
        };
      }
    }

    res.json({ tickers, updatedAt: now });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Quant Oracle server running on http://0.0.0.0:${PORT}`);
  });
}

createServer();
