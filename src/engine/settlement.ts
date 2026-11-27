import { FIVE_MINUTES_MS } from '../constants/assets';
import { Candle, MarketDataSource, SignalDirection, SignalStatus } from '../types/trading';

/**
 * موتور تسویهٔ دقیق — منطق خالص و تست‌پذیر برای رفع خطای اعداد «ورود / تسویه»
 * در بخش تاریخچه و داوری روند صعودی / نزولی.
 *
 * قواعد طلایی:
 *  1) تسویه فقط با کندلِ «دقیقاً همان کندل هدف» و فقط پس از بسته‌شدن واقعی آن انجام می‌شود.
 *  2) داوری صعودی/نزولی روی همان اعدادی انجام می‌شود که در جدول نمایش داده می‌شوند (رُند به decimals).
 *  3) مساوی بودن ورود و تسویه «TIE / برابر» است — نه بازندهٔ ساختگی.
 *  4) دادهٔ ساختگی (synthetic) هرگز عدد تسویه تولید نمی‌کند.
 *  5) اگر کندل دقیق در دسترس نباشد، سیگنال PENDING می‌ماند؛ تسویهٔ تقریبی فقط بعد از ۱۰ دقیقه
 *     و با برچسب «تسویه تقریبی» مجاز است.
 */

/** تلورانس مطابقت زمان باز شدن کندل هدف (±۳۰ ثانیه) */
export const SETTLE_TOLERANCE_MS = 30_000;

/** چند ثانیه بعد از بسته‌شدن کندل، close خوراک REST قابل‌اعتماد تلقی می‌شود */
export const REST_FINAL_DELAY_MS = 3_500;

/** بعد از این مدت (۱۰ دقیقه) اگر کندل دقیق نیامد، تسویهٔ تقریبی با برچسب مجاز می‌شود */
export const APPROX_SETTLE_DELAY_MS = 10 * 60_000;

export interface SettleVerdict {
  status: SignalStatus;
  entryPrice: number;
  closePrice: number;
}

/** آیا این کندل همان کندل هدف سیگنال است؟ */
export function isExactCandle(c: Candle, candleOpenTime: number): boolean {
  return Math.abs(c.time - candleOpenTime) < SETTLE_TOLERANCE_MS;
}

/**
 * دقیق‌ترین کندلِ بسته‌شدهٔ هدف را از میان کندل‌های خوراک پیدا می‌کند.
 * بسته‌شدن واقعی یعنی: کندل بعدی در خوراک موجود است، یا زمان بسته‌شدن + ۳.۵ ثانیه گذشته است.
 */
export function pickExactClosedCandle(
  candles: Candle[],
  candleOpenTime: number,
  candleCloseTime: number,
  nowMs: number
): Candle | undefined {
  if (!Array.isArray(candles) || candles.length === 0) return undefined;
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const exact = sorted.find((c) => isExactCandle(c, candleOpenTime));
  if (!exact) return undefined;

  const hasNewerCandle = sorted.some(
    (c) => c.time >= candleOpenTime + FIVE_MINUTES_MS - SETTLE_TOLERANCE_MS
  );
  if (hasNewerCandle || nowMs >= candleCloseTime + REST_FINAL_DELAY_MS) {
    return exact;
  }
  return undefined;
}

/**
 * آخرین راه (فقط پس از ۱۰ دقیقه): نزدیک‌ترین کندل از نظر زمان — نه اولین مورد در آرایه.
 * خروجی باید همیشه با برچسب «تسویه تقریبی» نمایش داده شود.
 */
export function pickApproximateCandle(
  candles: Candle[],
  candleOpenTime: number
): Candle | undefined {
  if (!Array.isArray(candles) || candles.length === 0) return undefined;
  let best: Candle | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const c of candles) {
    const delta = Math.abs(c.time - candleOpenTime);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = c;
    }
  }
  if (best && bestDelta <= FIVE_MINUTES_MS) return best;
  return undefined;
}

/**
 * داوری روند صعودی/نزولی روی اعدادِ رُند‌شدهٔ نمایش‌دادنی.
 * تضمین می‌کند جدول هرگز با وضعیت تناقض نداشته باشد.
 */
export function judgeSignal(
  direction: SignalDirection,
  entryRaw: number,
  closeRaw: number,
  decimals: number
): SettleVerdict {
  const quantize = (value: number) => Number(value.toFixed(decimals));
  const entry = quantize(entryRaw);
  const close = quantize(closeRaw);

  if (entry === close) {
    return { status: 'TIE', entryPrice: entry, closePrice: close };
  }

  const isWin = direction === 'CALL' ? close > entry : close < entry;
  return {
    status: isWin ? 'WIN' : 'LOSS',
    entryPrice: entry,
    closePrice: close,
  };
}

/**
 * کیفیت تسویه بر اساس منبع داده:
 *  - binance_vision / binance → دقیق (همان منبع کندل‌های زنده و ورود)
 *  - yahoo_fx برای EURUSD → دقیق
 *  - cryptocompare یا هر منبع تجمیعی دیگر → تقریبی (قیمت با کارگزاری اختلاف basis دارد)
 *  - synthetic هرگز نباید برسد (در فراخوان مسدود شده است)
 */
export function settleQualityForSource(
  assetId: string,
  source: MarketDataSource | undefined
): 'exact' | 'approximate' {
  // EURUSD ورودش از yahoo_fx است؛ تسویه از بایننس (EURUSDT) مبنا دارد → تقریبی
  if (assetId === 'EURUSD') {
    return source === 'yahoo_fx' ? 'exact' : 'approximate';
  }
  if (source === 'binance_vision' || source === 'binance') return 'exact';
  return 'approximate';
}
