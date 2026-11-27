/**
 * فیلترهای هستهٔ استراتژی — کاهش سیگنال خطا (v2.0.0)
 * همهٔ توابع خالص‌اند: ورودی کندل‌ها/عدد، خروجی عدد/قضاوت — بدون DOM و بدون fetch.
 * اعداد آستانه از درخواست کاربر + کالیبراسیون بازار ۵ دقیقه‌ای.
 */

import type { Candle, SignalRecord, SignalDirection, QuantLayerResult } from '../types/trading';

// ---------------------------------------------------------------------------
// ۱) چاپینس ایندکس (Choppiness Index) — بازار رنج و آشفته > 61.8 → ممنوع معامله
// ---------------------------------------------------------------------------
export const CHOP_THRESHOLD = 61.8;

/** CHOP = 100 × log10(ΣTR / (maxHigh−minLow)) / log10(period) */
export function choppinessIndex(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const win = candles.slice(-(period + 1));
  let trSum = 0;
  for (let i = 1; i < win.length; i++) {
    const c = win[i];
    const prevClose = win[i - 1].close;
    trSum += Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  }
  const hi = Math.max(...win.slice(1).map((c) => c.high));
  const lo = Math.min(...win.slice(1).map((c) => c.low));
  const range = hi - lo;
  if (range <= 0 || trSum <= 0) return 100; // کاملاً هموار → رنج محض
  const denom = Math.log10(period);
  if (denom <= 0) return null;
  return (100 * Math.log10(trSum / range)) / denom;
}

export function isChoppyMarket(candles: Candle[], period = 14): boolean {
  const chop = choppinessIndex(candles, period);
  return chop !== null && chop > CHOP_THRESHOLD;
}

// ---------------------------------------------------------------------------
// ۲) ADX — تشخیص بازار رونددار از خنثی
// ---------------------------------------------------------------------------
export function averageDirectionalIndex(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const win = candles.slice(-(period + 1));
  const trs: number[] = [], plusDMs: number[] = [], minusDMs: number[] = [];

  for (let i = 1; i < win.length; i++) {
    const c = win[i], p = win[i - 1];
    const up = c.high - p.high;
    const down = p.low - c.low;
    const plusDM = up > down && up > 0 ? up : 0;
    const minusDM = down > up && down > 0 ? down : 0;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    trs.push(tr); plusDMs.push(plusDM); minusDMs.push(minusDM);
  }
  const n = trs.length;
  if (n !== period) return null;
  const trSum = trs.reduce((a, b) => a + b, 0);
  const plusSum = plusDMs.reduce((a, b) => a + b, 0);
  const minusSum = minusDMs.reduce((a, b) => a + b, 0);
  if (trSum <= 0) return null;

  const plusDI = (100 * plusSum) / trSum;
  const minusDI = (100 * minusSum) / trSum;
  const denom = plusDI + minusDI;
  return denom === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / denom;
}

/** زیر 15 = بازار کاملاً خنثی/مرده (حتی mean-reversion خطرناک است) */
export const ADX_DEAD_THRESHOLD = 15;

// ---------------------------------------------------------------------------
// ۳) نسبت سایه به بدنه — در ۳ کندل اخیر سایهٔ کل > ۲× بدنهٔ کل → ممنوع
// ---------------------------------------------------------------------------
export function wickToBodyExcessive(candles: Candle[], lookback = 3): boolean {
  const win = candles.slice(-lookback - 1, -1); // فقط کندل‌های بسته‌شده (نه کندل جاری)
  if (win.length < lookback) return false;
  let wickTotal = 0;
  let bodyTotal = 0;
  for (const c of win) {
    const body = Math.abs(c.close - c.open);
    const upper = c.high - Math.max(c.open, c.close);
    const lower = Math.min(c.open, c.close) - c.low;
    wickTotal += upper + lower;
    bodyTotal += body;
  }
  if (bodyTotal <= 0) return wickTotal > 0; // کندل‌های دوجی کامل → بی‌ثباتی محض
  return wickTotal > bodyTotal * 2;
}

// ---------------------------------------------------------------------------
// ۴) دروازه نوسان ATR — بازار مرده و بازار انفجاری
// ---------------------------------------------------------------------------
export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const win = candles.slice(-(period + 1));
  let sum = 0;
  for (let i = 1; i < win.length; i++) {
    const c = win[i], p = win[i - 1];
    sum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  return sum / period;
}

/** ATR به‌صورت درصد از قیمت — برای آستانه‌های یکسان روی همهٔ دارایی‌ها */
export function atrPct(candles: Candle[], period = 14): number | null {
  const a = atr(candles, period);
  const ref = candles[candles.length - 1];
  if (a === null || !ref || ref.close <= 0) return null;
  return (a / ref.close) * 100;
}

/** مرده < 0.03٪ · انفجاری > 1.5٪ (کندل ۵ دقیقه‌ای کریپتو) */
export const ATR_DEAD_PCT = 0.03;
export const ATR_EXPLOSIVE_PCT = 1.5;

export function atrGateVerdict(candles: Candle[]): 'dead' | 'explosive' | 'ok' | 'unknown' {
  const pct = atrPct(candles);
  if (pct === null) return 'unknown';
  if (pct < ATR_DEAD_PCT) return 'dead';
  if (pct > ATR_EXPLOSIVE_PCT) return 'explosive';
  return 'ok';
}

// ---------------------------------------------------------------------------
// ۵) تاییدیه مولتی‌تایم‌فریم — شیب EMA50/EMA200 در 15m و 1h
// ---------------------------------------------------------------------------
export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
  }
  return e;
}

export type TrendSlope = 'up' | 'down' | 'flat' | 'unknown';

/** شیب EMA: مقایسهٔ EMA فعلی با ۳ کندل قبل (فقط کندل‌های بسته‌شده) */
export function emaSlope(candles: Candle[], period: number): TrendSlope {
  const closes = candles.map((c) => c.close);
  const now = ema(closes, period);
  const past = ema(closes.slice(0, -3), period);
  if (now === null || past === null) return 'unknown';
  if (past <= 0) return 'unknown';
  const drift = (now - past) / past;
  if (drift > 0.0004) return 'up';
  if (drift < -0.0004) return 'down';
  return 'flat';
}

/**
 * حکم مولتی‌تایم‌فریم: هر دو تایم‌فریم (15m و 1h) باید با جهت کاندید هم‌سو باشند.
 * flat/unknown → fail-open (فقط برای دارایی‌هایی که دادهٔ HTF ندارند مثل EURUSD)
 */
export function mtfVerdict(
  candles15m: Candle[] | undefined,
  candles1h: Candle[] | undefined,
  direction: 'CALL' | 'PUT'
): { pass: boolean; note: string; slope15: TrendSlope; slope1h: TrendSlope } {
  const slope15 = candles15m && candles15m.length >= 60
    ? (emaSlope(candles15m, 50) !== 'unknown' ? emaSlope(candles15m, 50) : 'flat')
    : 'unknown';
  const slope1h = candles1h && candles1h.length >= 60
    ? (emaSlope(candles1h, 50) !== 'unknown' ? emaSlope(candles1h, 50) : 'flat')
    : 'unknown';
  const need = direction === 'CALL' ? 'up' : 'down';

  if (slope15 === 'unknown' && slope1h === 'unknown') {
    return { pass: true, note: 'دادهٔ HTF در دسترس نیست — فیلتر مولتی‌تایم‌فریم نادیده گرفته شد', slope15, slope1h };
  }
  // شیب EMA200 هم بررسی می‌شود؛ بلوک فقط وقتی «هر دو» EMA خلاف جهت باشند (روند اصلی قطعی)
  const e15fast = slope15 !== 'unknown' ? emaSlope(candles15m!, 50) : 'unknown';
  const e15slow = candles15m && candles15m.length >= 210 ? emaSlope(candles15m, 200) : 'unknown';
  const e1hfast = slope1h !== 'unknown' ? emaSlope(candles1h!, 50) : 'unknown';
  const e1hslow = candles1h && candles1h.length >= 210 ? emaSlope(candles1h, 200) : 'unknown';

  const against15 = e15fast === (need === 'up' ? 'down' : 'up') && e15slow === (need === 'up' ? 'down' : 'up');
  const against1h = e1hfast === (need === 'up' ? 'down' : 'up') && e1hslow === (need === 'up' ? 'down' : 'up');
  const against = against15 || against1h;

  if (against) {
    return {
      pass: false,
      note: `روند اصلی خلاف جهت سیگنال (15m: ${slopeFa(e15fast)} · 1h: ${slopeFa(e1hfast)})`,
      slope15, slope1h,
    };
  }
  return { pass: true, note: `هم‌سویی مولتی‌تایم‌فریم برقرار (15m: ${slopeFa(e15fast)} · 1h: ${slopeFa(e1hfast)})`, slope15, slope1h };
}

export function slopeFa(s: TrendSlope): string {
  return s === 'up' ? 'صعودی' : s === 'down' ? 'نزولی' : s === 'flat' ? 'خنثی' : 'نامشخص';
}

// ---------------------------------------------------------------------------
// ۶) فیلتر همبستگی بیت‌کوین — حرکت شارپ BTC > 0.5٪ در ۵ دقیقه → توقف آلت‌کوین
// ---------------------------------------------------------------------------
export const BTC_SHARP_MOVE_PCT = 0.5;

/** درصد تغییر قیمت بیت‌کوین بین دو کندل ۵ دقیقه‌ای بسته‌شدهٔ اخیر */
export function btcRecentMovePct(btcCandles: Candle[] | undefined): number | null {
  if (!btcCandles || btcCandles.length < 2) return null;
  const closed = btcCandles.slice(0, -1); // کندل جاری را کنار بگذار
  const last = closed[closed.length - 1];
  const prev = closed[closed.length - 2];
  if (!last || !prev || prev.close <= 0) return null;
  return ((last.close - prev.close) / prev.close) * 100;
}

export function btcShockBlocksAltcoin(
  btcMovePct: number | null,
  assetId: string
): boolean {
  if (assetId === 'BTCUSDT' || assetId === 'PAXGUSDT' || assetId === 'EURUSD') return false;
  if (btcMovePct === null) return false;
  return Math.abs(btcMovePct) > BTC_SHARP_MOVE_PCT;
}

// ---------------------------------------------------------------------------
// ۷) دروازهٔ عدم معامله (No-Trade Zone) — امتیاز هم‌پوشانی < ۸۰ از ۱۰۰
// ---------------------------------------------------------------------------
export const NO_TRADE_SCORE = 80;

// ---------------------------------------------------------------------------
// ۸) وزن‌دهی پویا به اندیکاتورها — آمار ۵۰ نمونهٔ اخیر هر لایه
// ---------------------------------------------------------------------------
export interface LayerStat { wins: number; losses: number }
export type LayerStatsMap = Record<string, LayerStat>;
export const LAYER_STATS_WINDOW = 50;
export const LAYER_STATS_KEY = 'quant_oracle_layer_stats_v1';

/** ضریب وزن لایه بر اساس نرخ برد تاریخی رأی آن: 0.5 + winRate → [0.5, 1.5] */
export function layerWeight(stat: LayerStat | undefined): number {
  if (!stat) return 1;
  const total = stat.wins + stat.losses;
  if (total < 10) return 1; // آمار کافی نیست → خنثی
  const wr = stat.wins / total;
  return 0.5 + wr;
}

/** تنظیم امتیاز اطمینان بر اساس وزن پویای لایه‌های هم‌سو با جهت کاندید */
export function dynamicWeightAdjustment(
  layers: QuantLayerResult[],
  stats: LayerStatsMap,
  candidateDir: 'CALL' | 'PUT'
): { bonus: number; notes: string[] } {
  let bonus = 0;
  const notes: string[] = [];
  for (const l of layers) {
    const net = candidateDir === 'CALL' ? l.pointsCall - l.pointsPut : l.pointsPut - l.pointsCall;
    if (net <= 0) continue;
    const stat = stats[l.id];
    if (!stat) continue;
    const total = stat.wins + stat.losses;
    if (total < 10) continue;
    const wr = stat.wins / total;
    if (wr >= 0.6) {
      const pts = Math.min(4, Math.round((wr - 0.5) * 10));
      bonus += pts;
      notes.push(`${l.name}: نرخ برد رأی ${Math.round(wr * 100)}٪ در ${total} نمونهٔ اخیر (+${pts} وزن پویا)`);
    } else if (wr <= 0.42) {
      const pts = Math.max(-4, -Math.round((0.5 - wr) * 10));
      bonus += pts;
      notes.push(`${l.name}: ضعف تاریخی رأی (${Math.round(wr * 100)}٪ در ${total} نمونه) (${pts} وزن پویا)`);
    }
  }
  return { bonus: Math.max(-8, Math.min(8, bonus)), notes };
}

// ---------------------------------------------------------------------------
// ۹) ترمز اضطراری (Circuit Breaker) — ۳ باخت متوالی روی یک دارایی → توقف ۳۰ دقیقه
// ---------------------------------------------------------------------------
export const BREAKER_LOSS_STREAK = 3;
export const BREAKER_COOLDOWN_MS = 30 * 60 * 1000;

/** تعداد باخت‌های متوالی آخرین دارایی از روی رکوردهای تسویه‌شده (جدید به قدیم) */
export function consecutiveLosses(signals: SignalRecord[], assetId: string): number {
  let count = 0;
  const sorted = [...signals]
    .filter((s) => s.assetId === assetId && (s.status === 'WIN' || s.status === 'LOSS'))
    .sort((a, b) => b.candleCloseTime - a.candleCloseTime);
  for (const s of sorted) {
    if (s.status === 'LOSS') count++;
    else break;
  }
  return count;
}

export interface BreakerState {
  active: boolean;
  untilMs: number | null;
  losses: number;
}

export function breakerState(signals: SignalRecord[], assetId: string, nowMs: number): BreakerState {
  const losses = consecutiveLosses(signals, assetId);
  if (losses < BREAKER_LOSS_STREAK) return { active: false, untilMs: null, losses };
  const sorted = [...signals]
    .filter((s) => s.assetId === assetId && s.status === 'LOSS')
    .sort((a, b) => b.candleCloseTime - a.candleCloseTime);
  const lastLossAt = sorted[0]?.candleCloseTime ?? nowMs;
  const until = lastLossAt + BREAKER_COOLDOWN_MS;
  return { active: nowMs < until, untilMs: until, losses };
}

// ---------------------------------------------------------------------------
// ۱۰) بازهٔ قیمت مجاز ورود + هشدار اختلاف بروکر
// ---------------------------------------------------------------------------
export const ENTRY_ZONE_PCT = 0.05; // ±0.05٪
export const BROKER_DEVIATION_PCT = 0.05;

export function entryZone(entryPrice: number): { low: number; high: number } {
  return {
    low: entryPrice * (1 - ENTRY_ZONE_PCT / 100),
    high: entryPrice * (1 + ENTRY_ZONE_PCT / 100),
  };
}

export function isPriceInZone(price: number, zone: { low: number; high: number }): boolean {
  return price >= zone.low && price <= zone.high;
}

export function brokerDeviationPct(brokerPrice: number, sitePrice: number): number | null {
  if (!Number.isFinite(brokerPrice) || brokerPrice <= 0 || sitePrice <= 0) return null;
  return (Math.abs(brokerPrice - sitePrice) / sitePrice) * 100;
}

export function brokerDeviationTooWide(brokerPrice: number, sitePrice: number): boolean {
  const d = brokerDeviationPct(brokerPrice, sitePrice);
  return d !== null && d > BROKER_DEVIATION_PCT;
}

// ---------------------------------------------------------------------------
// ۱۱) فیلتر تقویم اقتصادی — بلوک ±۱۵ دقیقه اخبار مهم
// ---------------------------------------------------------------------------
export const NEWS_BLOCK_MINUTES = 15;

export interface NewsEvent {
  title: string;
  currency: string;
  impact: string;
  time: number; // ms epoch
}

export function newsBlockFor(
  events: NewsEvent[] | undefined,
  nowMs: number
): { blocked: boolean; event?: NewsEvent } {
  if (!events || events.length === 0) return { blocked: false };
  const windowMs = NEWS_BLOCK_MINUTES * 60 * 1000;
  for (const ev of events) {
    if (ev.impact.toLowerCase() !== 'high') continue;
    if (Math.abs(nowMs - ev.time) <= windowMs) return { blocked: true, event: ev };
  }
  return { blocked: false };
}

// ---------------------------------------------------------------------------
// ۱۲) تشخیص بازار OTC — شنبه/یکشنبه تهران
// ---------------------------------------------------------------------------
export function isOtcWeekend(nowMs: number): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tehran',
    weekday: 'short',
  }).format(new Date(nowMs));
  return weekday === 'Sat' || weekday === 'Sun';
}
