/**
 * تست شواهد فیلترهای هستهٔ استراتژی v2.0.0 — اجرا: npx tsx scripts/test_gate.ts
 * همهٔ توابع خالص: چاپینس، ADX، سایه/بدنه، ATR، EMA، همبستگی BTC، ترمز اضطراری،
 * بازهٔ ورود، اختلاف بروکر، خبر، OTC، وزن پویا و بک‌تست روی دادهٔ ساختگی قطعی.
 */
import {
  ADX_DEAD_THRESHOLD,
  atrGateVerdict,
  averageDirectionalIndex,
  brokerDeviationTooWide,
  breakerState,
  btcRecentMovePct,
  btcShockBlocksAltcoin,
  choppinessIndex,
  dynamicWeightAdjustment,
  ema,
  emaSlope,
  entryZone,
  isChoppyMarket,
  isOtcWeekend,
  isPriceInZone,
  mtfVerdict,
  newsBlockFor,
  NO_TRADE_SCORE,
  wickToBodyExcessive,
  type LayerStatsMap,
} from '../src/engine/filters';
import { backtestStrategy, runDecision, trimLayerStats } from '../src/engine/gatekeeper';
import { ASSET_MAP } from '../src/constants/assets';
import type { Candle, SignalRecord } from '../src/types/trading';

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected);
  if (ok) { pass++; console.log(`PASS  ${name} → ${String(actual)}`); }
  else { fail++; console.error(`FAIL  ${name} → got ${String(actual)}, expected ${String(expected)}`); }
}

// ---- سازندهٔ کندل ساختگی قطعی ----
function makeCandles(
  n: number,
  opts: { trendPct?: number; chop?: boolean; wicky?: boolean; start?: number } = {}
): Candle[] {
  const out: Candle[] = [];
  let price = opts.start ?? 100;
  for (let i = 0; i < n; i++) {
    const dir = opts.chop ? (i % 2 === 0 ? 1 : -1) : opts.trendPct ? 1 : i % 5 - 2;
    const step = opts.chop
      ? Math.sin(i * 1.7) * 0.4
      : dir * (opts.trendPct ?? 0.1) * 0.5;
    const open = price;
    const close = price * (1 + step / 100);
    const body = Math.abs(close - open);
    const wickScale = opts.wicky ? body * 1.6 : body * 0.3;
    const high = Math.max(open, close) + wickScale;
    const low = Math.min(open, close) - wickScale;
    out.push({ time: 1_700_000_000_000 + i * 300_000, open, high, low, close, volume: 100 + i });
    price = close;
  }
  return out;
}

const btc = ASSET_MAP.BTCUSDT;

// ژنراتورهای قطعی برای تست
function oscillatingCandles(n: number): Candle[] {
  // نوسان کامل ۱۰۰↔۱۰۱ با سایه‌های سنگین: sumTR/range بالا → CHOP نزدیک ۱۰۰
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const up = i % 2 === 0;
    const open = up ? 100 : 101;
    const close = up ? 101 : 100;
    out.push({ time: 1_700_000_000_000 + i * 300_000, open, close, high: 101.5, low: 98.5, volume: 100 });
  }
  return out;
}

function btcShockCandles(): Candle[] {
  // کندل‌های 0..8 بسته‌شده‌اند (کندل 9 در حال تشکیل) — حرکت کندل 8 نسبت به 7 برابر +۱٪ است
  const out = makeCandles(10);
  const prevClose = out[7].close;
  const shocked = prevClose * 1.01;
  out[8] = { time: out[8].time, open: prevClose, close: shocked, high: shocked * 1.001, low: prevClose * 0.999, volume: 500 };
  return out;
}

// ---- چاپینس ایندکس ----
const trendCandles = makeCandles(60, { trendPct: 0.4 });
const chopCandles = oscillatingCandles(30);
const chopTrend = choppinessIndex(trendCandles);
const chopChop = choppinessIndex(chopCandles);
check('CHOP رونددار < 61.8', chopTrend !== null && chopTrend < 61.8, true);
check('CHOP رنج/آشفته > 61.8', chopChop !== null && chopChop > 61.8, true);
check('isChoppyMarket روی رنج = true', isChoppyMarket(chopCandles), true);
check('isChoppyMarket روی روند = false', isChoppyMarket(trendCandles), false);

// ---- ADX ----
const adxTrend = averageDirectionalIndex(makeCandles(40, { trendPct: 0.6 }));
check('ADX روی روند قوی ≥ 0', adxTrend !== null && adxTrend >= 0, true);
check('آستانهٔ ADX مرده = 15', ADX_DEAD_THRESHOLD, 15);

// ---- سایه به بدنه ----
check('سایه/بدنه نرمال = false', wickToBodyExcessive(makeCandles(10)), false);
check('سایه/بدنه شدید = true', wickToBodyExcessive(makeCandles(10, { wicky: true, chop: true })), true);

// ---- ATR gate ----
check('ATR: کندل‌های میکروسکوپی → dead', atrGateVerdict(makeCandles(30, { trendPct: 0.001 })), 'dead');
check('ATR: کندل‌های نرمال → ok', atrGateVerdict(makeCandles(30, { trendPct: 0.3 })), 'ok');

// ---- EMA و شیب ----
const closesUp = trendCandles.map((c) => c.close);
check('EMA(50) روی دادهٔ کافی عدد است', ema(closesUp, 50) !== null, true);
check('EMA با دادهٔ ناکافی → null', ema(closesUp.slice(0, 10), 50), null);
check('شیب روند صعودی → up', emaSlope(trendCandles, 50), 'up');
const downTrend = makeCandles(60, { trendPct: -0.4 });
check('شیب روند نزولی → down', emaSlope(downTrend, 50), 'down');

// ---- مولتی‌تایم‌فریم (نیاز به ≥۲۱۰ کندل برای EMA200) ----
const mtfPass = mtfVerdict(makeCandles(220, { trendPct: 0.3 }), makeCandles(220, { trendPct: 0.3 }), 'CALL');
check('MTF: هر دو صعودی → CALL مجاز', mtfPass.pass, true);
const mtfBlock = mtfVerdict(makeCandles(220, { trendPct: -0.5 }), makeCandles(220, { trendPct: -0.5 }), 'CALL');
check('MTF: هر دو نزولی → CALL مسدود', mtfBlock.pass, false);
check('MTF: داده غایب → fail-open', mtfVerdict(undefined, undefined, 'PUT').pass, true);

// ---- همبستگی بیت‌کوین ----
const btcCalm = makeCandles(10, { trendPct: 0.1 });
const btcShock = btcShockCandles();
check('BTC آرام → بلوک نیست', btcShockBlocksAltcoin(btcRecentMovePct(btcCalm), 'NEARUSDT'), false);
check('BTC شارپ → بلوک آلت‌کوین', btcShockBlocksAltcoin(btcRecentMovePct(btcShock), 'NEARUSDT'), true);
check('BTC شارپ → BTC خودش بلوک نمی‌شود', btcShockBlocksAltcoin(btcRecentMovePct(btcShock), 'BTCUSDT'), false);

// ---- عدم معامله ----
check('حد نصاب عدم معامله = ۸۰', NO_TRADE_SCORE, 80);

// ---- ترمز اضطراری ----
const mkRec = (i: number, status: SignalRecord['status'], closeTime: number): SignalRecord => ({
  id: `T${i}`,
  issuedAt: closeTime - 300_000,
  candleOpenTime: closeTime - 300_000,
  candleCloseTime: closeTime,
  assetId: 'BTCUSDT',
  assetLabel: 'BTC',
  direction: 'CALL',
  confidence: 80,
  entryPrice: 100,
  status,
  reasons: [],
  decimals: 2,
});
const lossy = [0, 1, 2].map((i) => mkRec(i, 'LOSS', 1_700_010_000_000 + i * 1000));
const br1 = breakerState(lossy, 'BTCUSDT', 1_700_010_000_000 + 60_000);
check('ترمز: ۳ باخت متوالی → فعال', br1.active, true);
check('ترمز: ۳۰ دقیقه cooldown', br1.untilMs === 1_700_010_002_000 + 30 * 60 * 1000, true);
const br2 = breakerState(lossy, 'BTCUSDT', 1_700_010_000_000 + 31 * 60 * 1000);
check('ترمز: پس از ۳۰ دقیقه → غیرفعال', br2.active, false);
const mixed = [mkRec(0, 'WIN', 1_700_020_000_000), ...lossy];
const br3 = breakerState(mixed, 'BTCUSDT', 1_700_020_000_000 + 1000);
check('ترمز: برد وسط زنجیره → ریست', br3.active, false);
const br4 = breakerState([mkRec(0, 'LOSS', 1_700_030_000_000), mkRec(1, 'LOSS', 1_700_029_000_000)], 'BTCUSDT', 1_700_030_000_000 + 1000);
check('ترمز: فقط ۲ باخت → غیرفعال', br4.active, false);

// ---- بازهٔ ورود و اختلاف بروکر ----
const zone = entryZone(1000);
check('بازه: کف ≈ 999.5', Math.abs(zone.low - 999.5) < 0.001, true);
check('بازه: سقف ≈ 1000.5', Math.abs(zone.high - 1000.5) < 0.001, true);
check('درون بازه', isPriceInZone(1000.3, zone), true);
check('بیرون بازه', isPriceInZone(1001, zone), false);
check('بروکر ۱۰۰۰.2 vs 1000 → OK', brokerDeviationTooWide(1000.2, 1000), false);
check('بروکر 1001 vs 1000 → رد', brokerDeviationTooWide(1001, 1000), true);

// ---- فیلتر خبر ----
const now = 1_700_000_000_000;
const evs = [{ title: 'NFP', currency: 'USD', impact: 'High', time: now + 5 * 60_000 }];
check('خبر: داخل پنجره ±۱۵دقیقه → بلوک', newsBlockFor(evs, now).blocked, true);
check('خبر: خارج پنجره → آزاد', newsBlockFor(evs, now + 40 * 60_000).blocked, false);
check('خبر: اهمیت متوسط → بلوک نیست', newsBlockFor([{ title: 'x', currency: 'USD', impact: 'Medium', time: now }], now).blocked, false);

// ---- OTC ----
// شنبه تهران (2024-01-06T10:00Z = شنبه 13:30 تهران)
check('OTC: شنبه تهران → true', isOtcWeekend(Date.parse('2024-01-06T10:00:00Z')), true);
check('OTC: دوشنبه تهران → false', isOtcWeekend(Date.parse('2024-01-08T10:00:00Z')), false);

// ---- وزن پویا ----
const stats: LayerStatsMap = {
  strong: { wins: 40, losses: 10 }, // wr=0.8 → +3
  weak: { wins: 4, losses: 36 }, // wr=0.1 → -4
};
const layersFake = [
  { id: 'strong', index: 1, name: 'قوی', metricLabel: '', metricValue: '', sentiment: 'bullish' as const, summary: '', pointsCall: 10, pointsPut: 0 },
  { id: 'weak', index: 2, name: 'ضعیف', metricLabel: '', metricValue: '', sentiment: 'bullish' as const, summary: '', pointsCall: 8, pointsPut: 0 },
  { id: 'empty', index: 3, name: 'بدون آمار', metricLabel: '', metricValue: '', sentiment: 'bullish' as const, summary: '', pointsCall: 5, pointsPut: 0 },
];
const dyn = dynamicWeightAdjustment(layersFake, stats, 'CALL');
check('وزن پویا: جمع بونوس = -1', dyn.bonus, -1);
check('وزن پویا: آمار کمتر از ۱۰ نادیده', dynamicWeightAdjustment([{ id: 'x', index: 1, name: 'x', metricLabel: '', metricValue: '', sentiment: 'bullish', summary: '', pointsCall: 9, pointsPut: 0 }], { x: { wins: 3, losses: 3 } }, 'CALL').bonus, 0);
const trimmed = trimLayerStats({ a: { wins: 300, losses: 100 } });
check('تریم آمار لایه به ۵۰ نمونه (۴۰۰→۵۰)', trimmed.a.wins + trimmed.a.losses, 50);
check('نسبت در تریم حفظ می‌شود', trimmed.a.wins, 38); // 75% از 50

// ---- بک‌تست روی دادهٔ ساختگی (روند قوی صعودی) ----
const bt = backtestStrategy(btc, makeCandles(260, { trendPct: 0.35 }), { candles: 100 });
check('بک‌تست: اجرا بدون خطا و ارزیابی انجام شد', bt.evaluatedCandles > 0, true);
check('بک‌تست: نمونه‌ها ≤ ۱۰۰', bt.samples <= 100, true);
check('بک‌تست: نرخ برد یا null (نمونهٔ ناکافی) سازگار است', bt.winRate === null ? bt.samples < 10 : bt.winRate >= 0 && bt.winRate <= 100, true);

// ---- runDecision انتها به انتها ----
const decision = runDecision(btc, { candles5m: makeCandles(230, { trendPct: 0.3 }) }, false);
check('تصمیم: خروجی دارای بازهٔ ورود', decision.entryZone.low > 0 && decision.entryZone.high > decision.entryZone.low, true);
check('تصمیم: overlapScore عددی است', Number.isFinite(decision.overlapScore), true);
check('تصمیم: gateBlocks آرایه است', Array.isArray(decision.gateBlocks), true);
const dBlocked = runDecision(btc, { candles5m: [...makeCandles(200, { trendPct: 0.3, start: 100 }), ...oscillatingCandles(30)] }, false);
check('تصمیم: بازار رنج → WAIT', dBlocked.finalDirection === 'WAIT', true);
check('تصمیم: دلیل بلوک چاپینس ثبت شده', dBlocked.gateBlocks.some((b) => b.includes('Choppiness')), true);
const dNews = runDecision(btc, { candles5m: makeCandles(230, { trendPct: 0.3 }), news: [{ title: 'CPI', currency: 'USD', impact: 'High', time: Date.now() }] }, false);
check('تصمیم: خبر مهم → WAIT', dNews.finalDirection === 'WAIT', true);

console.log(`\nنتایج: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
