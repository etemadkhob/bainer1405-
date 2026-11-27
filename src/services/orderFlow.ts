/**
 * جریان سفارشات (Order Flow) — بخش دوم ارتقا:
 *  ۱) عدم تعادل دفتر سفارشات تا عمق ±۲٪ (پروکسی Worker با زنجیرهٔ بایننس→اوکی‌ایکس→بای‌بیت)
 *  ۲) دلتای حجم تجمعی (CVD) از کندل‌های ۱ دقیقه‌ای بایننس Vision (حجم خریدار مارکت)
 * هر دو fail-open: نبودِ داده هرگز سیگنال نمی‌سازد، فقط یادداشت می‌گذارد.
 */

import { AssetId } from '../types/trading';

const DEPTH_TTL_MS = 20_000;
const CVD_TTL_MS = 60_000;

export interface DepthResponse {
  available: boolean;
  source?: string;
  imbalance?: number; // bid / (bid+ask) در محدودهٔ ±۲٪
  sellWall?: boolean;
  buyWall?: boolean;
}

export interface CvdResponse {
  available: boolean;
  deltaPct?: number;
  direction?: 'buy' | 'sell' | 'flat';
}

let depthCache: { key: string; at: number; value: DepthResponse } | null = null;
let cvdCache: { key: string; at: number; value: CvdResponse } | null = null;

export async function fetchDepthSnapshot(assetId: AssetId): Promise<DepthResponse> {
  const now = Date.now();
  if (depthCache && depthCache.key === assetId && now - depthCache.at < DEPTH_TTL_MS) {
    return depthCache.value;
  }
  try {
    const res = await fetch(`/api/depth?asset=${encodeURIComponent(assetId)}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`depth HTTP ${res.status}`);
    const payload = (await res.json()) as {
      available?: boolean;
      source?: string;
      imbalance?: number;
      sellWall?: boolean;
      buyWall?: boolean;
    };
    const value: DepthResponse = {
      available: Boolean(payload.available),
      source: payload.source,
      imbalance: payload.imbalance,
      sellWall: payload.sellWall,
      buyWall: payload.buyWall,
    };
    depthCache = { key: assetId, at: now, value };
    return value;
  } catch {
    const value: DepthResponse = { available: false };
    depthCache = { key: assetId, at: now, value };
    return value;
  }
}

/**
 * CVD روی کندل‌های ۱ دقیقه‌ای اخیر (۳۰ کندل = ۳۰ دقیقه):
 * ستون ۹ بایننس = حجم خریدار مارکت؛ دلتا = (takerBuy − takerSell) / total × ۱۰۰
 */
export async function fetchCvdSnapshot(assetId: AssetId, binanceSymbol: string): Promise<CvdResponse> {
  const now = Date.now();
  if (cvdCache && cvdCache.key === assetId && now - cvdCache.at < CVD_TTL_MS) {
    return cvdCache.value;
  }
  const empty: CvdResponse = { available: false };
  try {
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(
      binanceSymbol
    )}&interval=1m&limit=30`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`cvd HTTP ${res.status}`);
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows) || rows.length < 10) throw new Error('short klines');

    let total = 0;
    let takerBuy = 0;
    for (const row of rows as unknown[]) {
      if (!Array.isArray(row)) continue;
      const vol = Number(row[5]);
      const buy = Number(row[9]);
      if (!Number.isFinite(vol) || !Number.isFinite(buy) || vol < 0) continue;
      total += vol;
      takerBuy += Math.min(buy, vol);
    }
    if (total <= 0) throw new Error('no volume');

    const buyShare = (takerBuy / total) * 100;
    const deltaPct = (buyShare - 50) * 2; // −۱۰۰ تا +۱۰۰
    const value: CvdResponse = {
      available: true,
      deltaPct,
      direction: deltaPct > 4 ? 'buy' : deltaPct < -4 ? 'sell' : 'flat',
    };
    cvdCache = { key: assetId, at: now, value };
    return value;
  } catch {
    cvdCache = { key: assetId, at: now, value: empty };
    return empty;
  }
}
