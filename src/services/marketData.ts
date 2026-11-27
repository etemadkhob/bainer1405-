import { ASSETS, FIVE_MINUTES_MS } from '../constants/assets';
import { AssetConfig, AssetId, Candle, MarketDataSource, MarketFeedResult } from '../types/trading';

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return x - Math.floor(x);
}

function assetHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) % 100000;
  }
  return h;
}

export function generateSyntheticCandles(asset: AssetConfig, count = 220): Candle[] {
  const now = Date.now();
  const currentBucket = Math.floor(now / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
  const startBucket = currentBucket - (count - 1) * FIVE_MINUTES_MS;
  const seedOffset = assetHash(asset.id);
  const candles: Candle[] = [];

  let price = asset.basePrice;
  const daySeed = Math.floor(startBucket / (FIVE_MINUTES_MS * 288));
  price = price * (1 + (seededRandom(daySeed + seedOffset) - 0.5) * 0.02);

  for (let i = 0; i < count; i++) {
    const bucketTime = startBucket + i * FIVE_MINUTES_MS;
    const bucketIdx = Math.floor(bucketTime / FIVE_MINUTES_MS);
    const r1 = seededRandom(bucketIdx + seedOffset * 1.13);
    const r2 = seededRandom(bucketIdx * 1.7 + seedOffset * 2.41);
    const r3 = seededRandom(bucketIdx * 2.3 + seedOffset * 3.17);
    const r4 = seededRandom(bucketIdx * 3.1 + seedOffset * 4.09);

    const wave = Math.sin(bucketIdx * 0.18 + seedOffset) * asset.volatility * 0.85;
    const changePct = (r1 - 0.5) * asset.volatility * 2.4 + wave;

    const open = price;
    let close = open * (1 + changePct);

    if (i === count - 1) {
      const microPhase = (now % FIVE_MINUTES_MS) / 1000;
      const liveOsc =
        Math.sin(microPhase * 0.45 + seedOffset) * asset.volatility * 0.45 +
        Math.cos(microPhase * 0.19) * asset.volatility * 0.25;
      close = close * (1 + liveOsc);
    }

    const bodyHigh = Math.max(open, close);
    const bodyLow = Math.min(open, close);
    const wickScale = Math.max(Math.abs(close - open), open * asset.volatility * 0.55);

    const high = bodyHigh + wickScale * (0.25 + r2 * 0.85);
    const low = bodyLow - wickScale * (0.25 + r3 * 0.85);
    const volume = Number((120 + r4 * 980).toFixed(2));

    const round = (val: number) => Number(val.toFixed(asset.decimals));
    candles.push({
      time: bucketTime,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume,
    });

    price = close;
  }

  return candles;
}

async function fetchFromServerProxy(asset: AssetConfig): Promise<MarketFeedResult> {
  const response = await fetch(`/api/klines/${encodeURIComponent(asset.id)}`, {
    signal: AbortSignal.timeout(5000),
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Proxy HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    candles?: Candle[];
    source?: MarketDataSource;
    fetchedAt?: number;
  };

  if (!Array.isArray(data.candles) || data.candles.length < 30) {
    throw new Error('Invalid proxy payload');
  }

  return {
    candles: data.candles,
    source: data.source ?? 'binance_vision',
    fetchedAt: data.fetchedAt ?? Date.now(),
  };
}

async function fetchFromBinanceEndpoint(
  baseUrl: string,
  symbol: string
): Promise<Candle[]> {
  const url = `${baseUrl}/api/v3/klines?symbol=${encodeURIComponent(
    symbol
  )}&interval=5m&limit=220`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(4500),
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Binance HTTP ${response.status}`);
  }

  const raw = (await response.json()) as Array<[number, string, string, string, string, string]>;
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

async function fetchFromCryptoCompare(asset: AssetConfig): Promise<Candle[]> {
  const url = `https://min-api.cryptocompare.com/data/v2/histominute?fsym=${encodeURIComponent(
    asset.ccFsym
  )}&tsym=${encodeURIComponent(asset.ccTsym)}&limit=60&aggregate=5`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(4500),
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`CryptoCompare HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    Response?: string;
    Data?: {
      Data?: Array<{
        time: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volumefrom: number;
      }>;
    };
  };

  const rows = payload?.Data?.Data;
  if (payload?.Response === 'Error' || !Array.isArray(rows) || rows.length < 30) {
    throw new Error('Insufficient CryptoCompare bars');
  }

  return rows.slice(-220).map((bar) => ({
    time: bar.time * 1000,
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: Number(bar.volumefrom ?? 0),
  }));
}

export async function fetchMarketCandles(asset: AssetConfig): Promise<MarketFeedResult> {
  const fetchedAt = Date.now();

  try {
    return await fetchFromServerProxy(asset);
  } catch {
    // Fallback to direct client APIs
  }

  try {
    const candles = await fetchFromBinanceEndpoint(
      'https://data-api.binance.vision',
      asset.binanceSymbol
    );
    return { candles, source: 'binance_vision', fetchedAt };
  } catch {
    // Try api.binance.com
  }

  try {
    const candles = await fetchFromBinanceEndpoint(
      'https://api.binance.com',
      asset.binanceSymbol
    );
    return { candles, source: 'binance', fetchedAt };
  } catch {
    // Try CryptoCompare
  }

  try {
    const candles = await fetchFromCryptoCompare(asset);
    return { candles, source: 'cryptocompare', fetchedAt };
  } catch {
    // Fallback to synthetic
  }

  return {
    candles: generateSyntheticCandles(asset, 220),
    source: 'synthetic',
    fetchedAt,
  };
}

export async function fetchExactCandleByOpenTime(
  asset: AssetConfig,
  openTimeMs: number
): Promise<Candle | null> {
  if (asset.id === 'EURUSD') {
    return null;
  }

  for (const baseUrl of ['https://data-api.binance.vision', 'https://api.binance.com']) {
    try {
      const url = `${baseUrl}/api/v3/klines?symbol=${encodeURIComponent(
        asset.binanceSymbol
      )}&interval=5m&startTime=${openTimeMs}&endTime=${openTimeMs + FIVE_MINUTES_MS - 1}&limit=2`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(4000),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) continue;
      const raw = (await res.json()) as Array<[number, string, string, string, string, string]>;
      if (!Array.isArray(raw) || raw.length === 0) continue;
      const match = raw.find((row) => Math.abs(Number(row[0]) - openTimeMs) < 60_000);
      if (!match) continue;
      return {
        time: Number(match[0]),
        open: Number(match[1]),
        high: Number(match[2]),
        low: Number(match[3]),
        close: Number(match[4]),
        volume: Number(match[5]),
      };
    } catch {
      // Try next endpoint
    }
  }
  return null;
}

export interface ServerTickerMap {
  tickers: Partial<
    Record<
      AssetId,
      {
        price: number;
        change24hPct: number;
        source: string;
        updatedAt: number;
      }
    >
  >;
}

export async function fetchLiveTickers(): Promise<ServerTickerMap['tickers']> {
  try {
    const res = await fetch('/api/tickers', {
      signal: AbortSignal.timeout(4000),
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = (await res.json()) as ServerTickerMap;
      if (data?.tickers && Object.keys(data.tickers).length > 0) {
        return data.tickers;
      }
    }
  } catch {
    // Direct fallback below
  }

  try {
    const symbols = JSON.stringify(ASSETS.map((a) => a.binanceSymbol));
    const url = `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${encodeURIComponent(
      symbols
    )}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const rows = (await res.json()) as Array<{
        symbol: string;
        lastPrice: string;
        priceChangePercent: string;
      }>;
      const out: ServerTickerMap['tickers'] = {};
      for (const asset of ASSETS) {
        const match = rows.find((r) => r.symbol === asset.binanceSymbol);
        if (match) {
          out[asset.id] = {
            price: Number(match.lastPrice),
            change24hPct: Number(Number(match.priceChangePercent).toFixed(2)),
            source: 'binance_vision',
            updatedAt: Date.now(),
          };
        }
      }
      return out;
    }
  } catch {
    // Ignore
  }

  return {};
}
