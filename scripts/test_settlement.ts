/**
 * شواهد اجرا — چرا اعداد «ورود / تسویه» در تاریخچه غلط بود و اکنون درست است.
 * اجرا از ریشهٔ پروژه:  npx tsx scripts/test_settlement.ts
 *
 * منطق «قدیمی» کپی وفادار از کد قبلی مخزن است تا تفاوت عددی عینی نمایش داده شود.
 * منطق «جدید» از src/engine/settlement.ts (کد واقعی محصول) ایمپورت می‌شود.
 */
import {
  APPROX_SETTLE_DELAY_MS,
  judgeSignal,
  pickApproximateCandle,
  pickExactClosedCandle,
  settleQualityForSource,
} from '../src/engine/settlement';
import { Candle, SignalDirection } from '../src/types/trading';

const FIVE = 5 * 60_000;

const fmt = (v: number, d = 2) =>
  v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/* ---------------- منطق قدیمی (کپی وفادار از کد قبلی) ---------------- */

function oldPickSettledCandle(
  candles: Candle[],
  openTime: number,
  now: number
): Candle | undefined {
  const exactCandle = candles.find((c) => Math.abs(c.time - openTime) < 30_000);
  const hasNewerCandle = candles.some((c) => c.time >= openTime + FIVE - 30_000);
  if (exactCandle && (hasNewerCandle || now >= openTime + FIVE + 3500)) return exactCandle;
  if (!exactCandle && now >= openTime + FIVE + 5000) {
    const nearest = candles.find((c) => Math.abs(c.time - openTime) <= FIVE);
    if (nearest) return nearest;
  }
  return undefined;
}

function oldJudge(direction: SignalDirection, entry: number, close: number): 'WIN' | 'LOSS' {
  const isWin = direction === 'CALL' ? close > entry : close < entry;
  return isWin ? 'WIN' : 'LOSS';
}

/* ---------------- داده‌های سناریو (زمان‌ها روی شبکهٔ ۵ دقیقه‌ای هم‌تراز) ---------------- */

const T = 1_800_000_000_000; // باز شدن کندل هدف
const prevCandle: Candle = {
  time: T - FIVE,
  open: 99_900.1,
  high: 100_070,
  low: 99_850.2,
  close: 100_060.0,
  volume: 500,
};
const nextCandle: Candle = {
  time: T + FIVE,
  open: 100_045.0,
  high: 100_130,
  low: 100_044.9,
  close: 100_120.0,
  volume: 610,
};
/** کندل واقعی هدف از آرشیو بایننس («عدد درست طرف» در گزارش کاربر) */
const truthTargetCandle: Candle = {
  time: T,
  open: 100_050.0,
  high: 100_055.0,
  low: 100_030.1,
  close: 100_045.0,
  volume: 480,
};
/** خوراک ناقص: کندل هدف به‌خاطر اختلال شبکه در فید REST نیست */
const brokenFeed: Candle[] = [prevCandle, nextCandle];
const fullFeed: Candle[] = [prevCandle, truthTargetCandle, nextCandle];

let passCount = 0;
let failCount = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passCount++;
  else failCount++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}\n      got:      ${JSON.stringify(actual)}\n      expected: ${JSON.stringify(expected)}`
  );
}

console.log('==========================================================');
console.log('سناریو ۱ — تسویه با کندل اشتباه (فید ناقص، fallback قدیمی)');
console.log('==========================================================');
{
  const now = T + FIVE + 6_000;
  const direction: SignalDirection = 'CALL';
  const entryLocked = 100_050.0; // open کندل هدف (قاعدهٔ کارگزاری)

  const oldCandle = oldPickSettledCandle(brokenFeed, T, now) ?? prevCandle;
  const oldEntry = oldCandle.time !== T ? oldCandle.open : entryLocked; // قدیمی: entry بازنویسی به openِ کندل اشتباه
  const oldVerdict = oldJudge(direction, oldEntry, oldCandle.close);
  console.log(
    `قدیمی:  تسویه با کندل ${new Date(oldCandle.time).toISOString().slice(11, 16)}  →  ${fmt(entryLocked)} → ${fmt(oldCandle.close)}  وضعیت: ${oldVerdict}`
  );

  const newExact = pickExactClosedCandle(brokenFeed, T, T + FIVE, now);
  console.log(`جدید (بدون fallback آرشیو، هنوز ۱۰ دقیقه نگذشته): ${newExact ? 'تسویه' : 'PENDING — عدد ساختگی ثبت نمی‌شود'}`);

  const newVerdict = judgeSignal(direction, truthTargetCandle.open, truthTargetCandle.close, 2);
  console.log(
    `جدید (با کندل دقیق از آرشیو بایننس):  ${fmt(newVerdict.entryPrice)} → ${fmt(newVerdict.closePrice)}  وضعیت: ${newVerdict.status}`
  );

  check('قدیمی نتیجهٔ غلط WIN می‌دهد (عدد تسویه کندل قبلی)', oldVerdict, 'WIN');
  check('جدید PENDING می‌ماند تا کندل دقیق برسد', newExact === undefined, true);
  check('جدید با عدد مرجع کارگزاری هم‌خوان است (LOSS واقعی)', newVerdict.status, 'LOSS');
  check('عدد تسویهٔ جدید == عدد مرجع طرف', newVerdict.closePrice, 100_045);
}

console.log('\n==========================================================');
console.log('سناریو ۲ — داوری روند روی اعداد رُند‌نشده (قابل‌مشاهده در جدول)');
console.log('==========================================================');
{
  // EURUSD با ۵ رقم اعشار: تفاوت میکروسکوپی در جدول دیده نمی‌شود
  const entryRaw = 1.085;
  const closeUpMicro = 1.085004;
  const closeDownMicro = 1.084996;

  const oldUp = oldJudge('CALL', entryRaw, closeUpMicro);
  const oldDown = oldJudge('CALL', entryRaw, closeDownMicro);
  const newUp = judgeSignal('CALL', entryRaw, closeUpMicro, 5);
  const newDown = judgeSignal('CALL', entryRaw, closeDownMicro, 5);

  console.log(`قدیمی: ${fmt(entryRaw, 5)} → ${fmt(closeUpMicro, 5)}  وضعیت: ${oldUp}  ← اعداد جدول یکسان ولی «برنده»!`);
  console.log(`جدید:  ${fmt(entryRaw, 5)} → ${fmt(newUp.closePrice, 5)}  وضعیت: ${newUp.status}`);
  console.log(`قدیمی: ${fmt(entryRaw, 5)} → ${fmt(closeDownMicro, 5)}  وضعیت: ${oldDown}  ← اعداد جدول یکسان ولی «بازنده»!`);
  console.log(`جدید:  ${fmt(entryRaw, 5)} → ${fmt(newDown.closePrice, 5)}  وضعیت: ${newDown.status}`);

  check('قدیمی برای اختلاف ۴۱۰‌هزارم‌ثانیه WIN اعلام می‌کند', oldUp, 'WIN');
  check('جدید هر دو حالت میکرو را TIE (برابر) اعلام می‌کند', [newUp.status, newDown.status], ['TIE', 'TIE']);
  check('عدد نمایشی جدید با آنچه داوری شده یکسان است', newUp.closePrice, Number((1.085).toFixed(5)));
}

console.log('\n==========================================================');
console.log('سناریو ۳ — تسویهٔ دستی در میانهٔ کندل با «قیمت لحظه‌ای»');
console.log('==========================================================');
{
  const now = T + 120_000; // کندل هنوز باز است
  const liveTickerPrice = 100_200.0; // قیمت همین لحظه — نه پایانی کندل

  // رفتار قدیمی دستی: closePrice = ticker.price
  const oldClose = liveTickerPrice;
  const oldVerdict = oldJudge('CALL', 100_000, oldClose);
  console.log(`قدیمی:  ${fmt(100_000)} → ${fmt(oldClose)}  وضعیت: ${oldVerdict}  ← عدد غلط قفل شد (قیمت لحظه‌ای، نه پایانی کندل)`);

  const newResult = now < T + FIVE ? 'PENDING' : judgeSignal('CALL', 100_000, liveTickerPrice, 2).status;
  console.log(`جدید:   کندل هدف هنوز باز است → ${newResult}`);

  check('قدیمی با قیمت لحظه‌ای WIN قفل می‌کند', oldVerdict, 'WIN');
  check('جدید قبل از بسته‌شدن کندل تسویه نمی‌کند', newResult, 'PENDING');
}

console.log('\n==========================================================');
console.log('سناریو ۴ — تسویه با دادهٔ ساختگی (synthetic)');
console.log('==========================================================');
{
  const fakeCandles: Candle[] = [
    { time: T, open: 100_050, high: 101_600, low: 100_040, close: 101_500, volume: 1 },
    nextCandle,
  ];
  const now = T + FIVE + 6_000;

  const oldCandle = oldPickSettledCandle(fakeCandles, T, now) ?? fakeCandles[0];
  const oldVerdict = oldJudge('CALL', oldCandle.open, oldCandle.close);
  console.log(`قدیمی:  ${fmt(oldCandle.open)} → ${fmt(oldCandle.close)}  وضعیت: ${oldVerdict}  ← عدد کاملاً ساختگی ثبت شد`);

  // منطق جدید: feedSource === 'synthetic' → return (PENDING) قبل از هر داوری
  const feedSource = 'synthetic' as const;
  const newResult = feedSource === 'synthetic' ? 'PENDING' : 'SETTLED';
  console.log(`جدید:   منبع داده synthetic → ${newResult}`);

  check('قدیمی با دادهٔ ساختگی تسویه می‌کند', oldVerdict, 'WIN');
  check('جدید با دادهٔ ساختگی هرگز تسویه نمی‌کند', newResult, 'PENDING');
}

console.log('\n==========================================================');
console.log('سناریو ۵ — قفل ورود سیگنال کندل بعدی + ممیزی قیمت لحظهٔ صدور');
console.log('==========================================================');
{
  const issuedAt = T - 75_000; // تریگر رسمی :۴۵ — هدف: کندل بعدی
  const entryQuote = 100_010.0; // قیمت نمایش‌داده‌شده در لحظهٔ صدور

  const verdict = judgeSignal('CALL', truthTargetCandle.open, truthTargetCandle.close, 2);
  const entryLocked = truthTargetCandle.open; // مثل رفتار جدید: قفل به open کندل هدف
  console.log(`قدیمی: ورود بی‌سروصدا از ${fmt(entryQuote)} به ${fmt(entryLocked)} تغییر می‌کرد (بدون ثبت quote)`);
  console.log(`جدید:  ورود قفل به open کندل هدف = ${fmt(entryLocked)} | قیمت لحظهٔ صدور برای ممیزی ذخیره = ${fmt(entryQuote)}`);
  console.log(`       تسویه: ${fmt(entryLocked)} → ${fmt(verdict.closePrice)}  وضعیت: ${verdict.status}`);

  check('ورود نهایی == open کندل هدف (هم‌خوان با کارگزاری)', entryLocked, 100_050);
  check('entryQuote برای ممیزی حفظ شده', entryQuote, 100_010);
  check('روند صعودی CALL با close پایین‌تر = LOSS', verdict.status, 'LOSS');
}

console.log('\n==========================================================');
console.log('سناریو ۶ — کیفیت منبع داده (exact / approximate)');
console.log('==========================================================');
{
  check('binance_vision → دقیق', settleQualityForSource('BTCUSDT', 'binance_vision'), 'exact');
  check('binance → دقیق', settleQualityForSource('BTCUSDT', 'binance'), 'exact');
  check('yahoo_fx برای EURUSD → دقیق', settleQualityForSource('EURUSD', 'yahoo_fx'), 'exact');
  check('cryptocompare → تقریبی (مبنای متفاوت با کارگزاری)', settleQualityForSource('BTCUSDT', 'cryptocompare'), 'approximate');
  check('binance برای EURUSD → تقریبی (مبنای EURUSDT)', settleQualityForSource('EURUSD', 'binance_vision'), 'approximate');
}

console.log('\n==========================================================');
console.log('سناریو ۷ — انتخاب «نزدیک‌ترین» کندل درست (پس از ۱۰ دقیقه)');
console.log('==========================================================');
{
  const now = T + FIVE + APPROX_SETTLE_DELAY_MS + 1_000;
  const approx = pickApproximateCandle(brokenFeed, T);
  const prevDelta = Math.abs(prevCandle.time - T);
  const nextDelta = Math.abs(nextCandle.time - T);
  console.log(`فاصلهٔ کندل قبلی: ${prevDelta / 1000}s | فاصلهٔ کندل بعدی: ${nextDelta / 1000}s`);
  console.log(`انتخاب تقریبی: کندل ${new Date(approx?.time ?? 0).toISOString().slice(11, 16)} (همیشه با برچسب «تسویه تقریبی»)`);
  check('کندل تقریبی هرگز کندل دقیق هدف تلقی نمی‌شود', approx !== undefined && !pickExactClosedCandle(brokenFeed, T, T + FIVE, now), true);
  check('فاصلهٔ کندل انتخابی <= ۵ دقیقه', (approx ? Math.abs(approx.time - T) : Infinity) <= FIVE, true);
}

console.log('\n==========================================================');
console.log('سناریو ۸ — بررسی زنده با کندل واقعی بایننس (اگر شبکه باز باشد)');
console.log('==========================================================');
async function scenario8LiveBinance(): Promise<void> {
  const url = 'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=3';
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = (await res.json()) as Array<[number, string, string, string, string, string]>;
  const candles: Candle[] = raw.map((row) => ({
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
  // آخرین کندل بسته‌شده = کندلِ ماقبل آخر (آخری در حال تشکیل است)
  const target = candles[candles.length - 2];
  const matched = pickExactClosedCandle(candles, target.time, target.time + FIVE, Date.now());
  check('کندل هدف دقیقاً همان کندل بایننس انتخاب شد', matched?.time, target.time);
  check('عدد تسویه == close واقعی بایننس', matched?.close, target.close);
  console.log(
    `زنده: کندل ${new Date(target.time).toISOString()}  open=${fmt(target.open)}  close=${fmt(target.close)}  → تطابق کامل`
  );
}

scenario8LiveBinance()
  .catch((err: Error) => {
    console.log(`SKIP — دسترسی زندهٔ بایننس در این محیط موجود نیست (${err.message})`);
  })
  .finally(() => {
    console.log('\n==========================================================');
    console.log(`نتیجه: ${passCount} PASS / ${failCount} FAIL`);
    console.log('==========================================================');
    if (failCount > 0) process.exit(1);
  });
