/**
 * دروازهٔ تصمیم‌گیری v2.0.0 — لایهٔ نهایی بین موتور ۹ لایه و صدور سیگنال.
 *
 * زنجیرهٔ گیت‌ها (ارزان به گران، قطعی):
 *   0) ترمز اضطراری (Circuit Breaker)
 *   1) فیلتر تقویم اقتصادی (±۱۵ دقیقه اخبار مهم)
 *   2) همبستگی بیت‌کوین (حرکت شارپ > 0.5٪ → توقف آلت‌کوین)
 *   3) تاییدیه مولتی‌تایم‌فریم (EMA50/200 شیب 15m و 1h)
 *   4) چاپینس ایندکس (> 61.8)
 *   5) ADX خنثی (< 15)
 *   6) نسبت سایه به بدنه (۳ کندل اخیر)
 *   7) دروازهٔ نوسان ATR (مرده / انفجاری)
 *   8) موتور ۹ لایه (شامل دروازه‌های داخلی خودش)
 *   9) عدم تعادل دفتر سفارشات + دیوار خرید/فروش (±۲٪)
 *  10) هم‌جهتی CVD
 *  11) دروازهٔ عدم معامله (امتیاز هم‌پوشانی ≥ ۸۰ از ۱۰۰)
 *
 * خروجی همیشه «تصمیم» است: CALL / PUT / WAIT با دلایل کامل، بازهٔ ورود مجاز
 * و (در صورت اجرای بک‌تست) نرخ برد واقعی استراتژی روی کندل‌های اخیر.
 *
 * همهٔ داده‌های بیرونی (دپت، CVD، خبر، HTF، بیت‌کوین) به‌صورت context تزریق
 * می‌شوند تا این ماژول خالص و تست‌پذیر بماند. نبودِ داده = fail-open با یادداشت.
 */

import { runQuantEngine } from './quantEngine';
import {
  ADX_DEAD_THRESHOLD,
  atrGateVerdict,
  averageDirectionalIndex,
  btcRecentMovePct,
  btcShockBlocksAltcoin,
  dynamicWeightAdjustment,
  entryZone,
  isChoppyMarket,
  mtfVerdict,
  newsBlockFor,
  NO_TRADE_SCORE,
  wickToBodyExcessive,
  type BreakerState,
  type LayerStatsMap,
  type NewsEvent,
} from './filters';
import { judgeSignal } from './settlement';
import {
  type AssetConfig,
  type Candle,
  type MarketDataSource,
  type QuantPrediction,
  type SignalDirection,
  type SignalRecord,
} from '../types/trading';

export interface DepthSnapshot {
  available: boolean;
  source?: string;
  imbalance?: number; // bid/(bid+ask) در محدودهٔ ±۲٪
  sellWall?: boolean;
  buyWall?: boolean;
}

export interface CvdSnapshot {
  available: boolean;
  deltaPct?: number; // درصد دلتای خریدار مارکت نسبت به کل حجم
  direction?: 'buy' | 'sell' | 'flat';
}

export interface DecisionContext {
  candles5m: Candle[];
  source?: MarketDataSource;
  candles15m?: Candle[];
  candles1h?: Candle[];
  btcCandles?: Candle[];
  depth?: DepthSnapshot;
  cvd?: CvdSnapshot;
  news?: NewsEvent[];
  layerStats?: LayerStatsMap;
  breakerOverride?: BreakerState;
  nowMs?: number;
}

export interface DecisionOutcome extends QuantPrediction {
  finalDirection: SignalDirection;
  gateBlocks: string[];
  gateNotes: string[];
  entryZone: { low: number; high: number };
  overlapScore: number; // امتیاز هم‌پوشانی شرایط موتور (مبنای عدم معامله)
  dynamicBonus: number;
  realWinRate?: number;
  backtestSamples?: number;
  confidenceSource: 'engine' | 'backtest';
  breaker?: BreakerState;
  newsEvent?: string;
}

function pushBlock(blocks: string[], note: string) {
  blocks.push(note);
}

/**
 * هستهٔ تصمیم — از کندل‌ها + کانتکست، یک DecisionOutcome می‌سازد.
 */
export function runDecision(
  asset: AssetConfig,
  ctx: DecisionContext,
  isOfficialTrigger: boolean
): DecisionOutcome {
  const nowMs = ctx.nowMs ?? Date.now();
  const base = runQuantEngine(asset, ctx.candles5m, ctx.source ?? 'binance', isOfficialTrigger);
  const blocks: string[] = [];
  const notes: string[] = [];

  // 0) Circuit Breaker
  let breaker: BreakerState | undefined;
  if (ctx.breakerOverride) {
    breaker = ctx.breakerOverride;
    if (breaker.active && breaker.untilMs) {
      pushBlock(
        blocks,
        `ترمز اضطراری: ${breaker.losses} باخت متوالی روی این دارایی — توقف صدور تا ${new Date(
          breaker.untilMs
        ).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}`
      );
    }
  }

  // 1) تقویم اقتصادی
  const newsHit = newsBlockFor(ctx.news, nowMs);
  if (newsHit.blocked && newsHit.event) {
    pushBlock(
      blocks,
      `پنجرهٔ خبر مهم: «${newsHit.event.title}» (${newsHit.event.currency}) — توقف تا ۱۵ دقیقه پس از خبر`
    );
  }

  const candidateDir =
    base.direction === 'WAIT'
      ? base.callScore >= base.putScore
        ? 'CALL'
        : 'PUT'
      : base.direction;

  // 2) همبستگی بیت‌کوین
  const btcMove = btcRecentMovePct(ctx.btcCandles);
  if (btcShockBlocksAltcoin(btcMove, asset.id)) {
    pushBlock(
      blocks,
      `حرکت شارپ بیت‌کوین (${btcMove!.toFixed(2)}٪ در ۵ دقیقه) — صدور سیگنال آلت‌کوین موقتاً متوقف شد`
    );
  }

  // 3) مولتی‌تایم‌فریم
  const mtf = mtfVerdict(ctx.candles15m, ctx.candles1h, candidateDir);
  if (!mtf.pass) {
    pushBlock(blocks, `فیلتر مولتی‌تایم‌فریم: ${mtf.note}`);
  } else if (mtf.slope15 !== 'unknown' || mtf.slope1h !== 'unknown') {
    notes.push(mtf.note);
  } else {
    notes.push(mtf.note);
  }

  // 4) چاپینس
  if (isChoppyMarket(ctx.candles5m)) {
    pushBlock(blocks, 'شاخص Choppiness بالای 61.8 — بازار رنج و در حال شکار استاپ (لغو همهٔ سیگنال‌ها)');
  }

  // 5) ADX
  const adx = averageDirectionalIndex(ctx.candles5m);
  if (adx !== null && adx < ADX_DEAD_THRESHOLD) {
    pushBlock(blocks, `ADX خنثی (${adx.toFixed(1)} < ${ADX_DEAD_THRESHOLD}) — بازار بدون روند قابل معامله`);
  }

  // 6) سایه به بدنه
  if (wickToBodyExcessive(ctx.candles5m)) {
    pushBlock(blocks, 'نسبت سایه به بدنه در ۳ کندل اخیر بیش از ۲ برابر — بی‌ثباتی شدید قیمت');
  }

  // 7) ATR gate
  const atrV = atrGateVerdict(ctx.candles5m);
  if (atrV === 'dead') {
    pushBlock(blocks, 'دروازهٔ ATR: بازار مرده (کندل‌های بسیار کوچک) — اسپرد و ریسک نامتوازن');
  } else if (atrV === 'explosive') {
    pushBlock(blocks, 'دروازهٔ ATR: نوسان انفجاری — خارج از ظرفیت پیش‌بینی ۵ دقیقه‌ای');
  }

  // وزن پویا روی امتیاز اطمینان موتور
  const dyn = dynamicWeightAdjustment(base.layers, ctx.layerStats ?? {}, candidateDir);
  notes.push(...dyn.notes);
  const adjustedConfidence = Math.max(50, Math.min(92, base.confidence + dyn.bonus));

  // 8) عدم تعادل دفتر سفارشات
  if (ctx.depth?.available && base.direction !== 'WAIT') {
    const d = ctx.depth;
    if (d.sellWall && candidateDir === 'CALL') {
      pushBlock(blocks, 'دیوار فروش سنگین در دفتر سفارشات (عمق ±۲٪) — سیگنال خرید مسدود شد');
    }
    if (d.buyWall && candidateDir === 'PUT') {
      pushBlock(blocks, 'دیوار خرید سنگین در دفتر سفارشات (عمق ±۲٪) — سیگنال فروش مسدود شد');
    }
    if (typeof d.imbalance === 'number') {
      if (candidateDir === 'CALL' && d.imbalance < 0.35) {
        pushBlock(blocks, `عدم تعادل شدید به سمت فروش (تعادل خرید ${(d.imbalance * 100).toFixed(0)}٪)`);
      }
      if (candidateDir === 'PUT' && d.imbalance > 0.65) {
        pushBlock(blocks, `عدم تعادل شدید به سمت خرید (تعادل خرید ${(d.imbalance * 100).toFixed(0)}٪)`);
      }
    }
    notes.push(`دفتر سفارشات (${d.source}): تعادل خرید ${((d.imbalance ?? 0.5) * 100).toFixed(0)}٪`);
  } else if (ctx.depth && !ctx.depth.available) {
    notes.push('دادهٔ دفتر سفارشات در دسترس نیست — این گیت نادیده گرفته شد');
  }

  // 9) CVD
  if (ctx.cvd?.available && base.direction !== 'WAIT') {
    const c = ctx.cvd;
    const dir: 'buy' | 'sell' | 'flat' = c.direction ?? 'flat';
    const aligned =
      (candidateDir === 'CALL' && dir === 'buy') || (candidateDir === 'PUT' && dir === 'sell');
    if (!aligned && dir !== 'flat') {
      pushBlock(
        blocks,
        `CVD هم‌جهت نیست (${dir === 'buy' ? 'فشار خریدار مارکت' : 'فشار فروشندهٔ مارکت'} ${(
          Math.abs(c.deltaPct ?? 0)
        ).toFixed(1)}٪) — تایید جریان سفارشات گرفته نشد`
      );
    } else if (aligned) {
      notes.push(`تایید CVD: جریان سفارشات هم‌سو با سیگنال (${(c.deltaPct ?? 0).toFixed(1)}٪)`);
    }
  } else if (ctx.cvd && !ctx.cvd.available) {
    notes.push('دادهٔ CVD در دسترس نیست — این گیت نادیده گرفته شد');
  }

  // 11) دروازهٔ عدم معامله — امتیاز هم‌پوشانی ≥ ۸۰ از ۱۰۰
  const overlapScore = Math.max(base.callScore, base.putScore);
  const overlapPass = overlapScore >= NO_TRADE_SCORE;
  const finalDirection: SignalDirection =
    blocks.length > 0 || base.direction === 'WAIT' || !overlapPass
      ? 'WAIT'
      : base.direction;

  if (!overlapPass && base.direction !== 'WAIT' && blocks.length === 0) {
    pushBlock(
      blocks,
      `امتیاز هم‌پوشانی شرایط ${overlapScore} از ${NO_TRADE_SCORE} — در انتظار شرایط مناسب`
    );
  }

  const zone = entryZone(base.entryPrice);
  const confidenceForDisplay = Math.round(adjustedConfidence);

  const gateSummary = buildGateSummary(finalDirection, blocks, overlapScore, dyn.bonus);

  return {
    ...base,
    confidence: confidenceForDisplay,
    direction: finalDirection,
    finalDirection,
    gateBlocks: blocks,
    gateNotes: notes.slice(0, 6),
    entryZone: zone,
    overlapScore,
    dynamicBonus: dyn.bonus,
    confidenceSource: 'engine',
    breaker,
    newsEvent: newsHit.event?.title,
    reasons: buildReasons(base.reasons, gateSummary, notes),
    evaluatedAt: nowMs,
  };
}

function buildGateSummary(
  direction: SignalDirection,
  blocks: string[],
  overlapScore: number,
  dynBonus: number
): string {
  if (direction !== 'WAIT') {
    const dynPart = dynBonus !== 0 ? ` · وزن پویا ${dynBonus >= 0 ? '+' : ''}${dynBonus}` : '';
    return `سیگنال تأیید نهایی ${direction} (هم‌پوشانی ${overlapScore}/100${dynPart})`;
  }
  if (blocks.length > 0) return blocks[0];
  return 'در انتظار شرایط مناسب — هیچ هم‌گرایی قابل معامله‌ای فعال نیست';
}

function buildReasons(baseReasons: string[], gateSummary: string, notes: string[]): string[] {
  return [gateSummary, ...baseReasons, ...notes].slice(0, 8);
}

// ---------------------------------------------------------------------------
// بک‌تست — نرخ برد واقعی استراتژی روی کندل‌های بسته‌شدهٔ اخیر + آمار لایه‌ها
// ---------------------------------------------------------------------------

export interface BacktestResult {
  winRate: number | null;
  samples: number;
  wins: number;
  losses: number;
  ties: number;
  layerStats: LayerStatsMap;
  evaluatedCandles: number;
}

/**
 * روی N کندل بسته‌شدهٔ اخیر، همان زنجیرهٔ تصمیم (فقط گیت‌های متعلق به کندل:
 * چاپینس، ADX، سایه/بدنه، ATR، عدم معامله + موتور) اجرا می‌شود و با کندل بعدی تسویه می‌شود.
 * گیت‌های کانتکستی (دپت/CVD/خبر/MTF/بیت‌کوین/ترمز) در بک‌تست لحاظ نمی‌شوند —
 * چون تاریخچهٔ آن‌ها در دسترس نیست؛ نرخ برد نتیجه کمی خوش‌بینانه است و برچسب می‌خورد.
 */
export function backtestStrategy(
  asset: AssetConfig,
  candles: Candle[],
  opts: { candles?: number; source?: MarketDataSource } = {}
): BacktestResult {
  const N = opts.candles ?? 100;
  const stats: LayerStatsMap = {};
  let wins = 0, losses = 0, ties = 0, evaluated = 0;

  const start = Math.max(220, candles.length - N - 1);
  for (let i = start; i < candles.length - 1; i++) {
    const slice = candles.slice(0, i + 1);
    if (slice.length < 220) continue; // موتور به دادهٔ کافی نیاز دارد
    const base = runQuantEngine(asset, slice, 'binance', false);
    const candidateDir =
      base.direction === 'WAIT' ? (base.callScore >= base.putScore ? 'CALL' : 'PUT') : base.direction;

    // گیت‌های متعلق به کندل
    if (base.direction === 'WAIT') { evaluated++; continue; }
    if (isChoppyMarket(slice)) { evaluated++; continue; }
    const adx = averageDirectionalIndex(slice);
    if (adx !== null && adx < ADX_DEAD_THRESHOLD) { evaluated++; continue; }
    if (wickToBodyExcessive(slice)) { evaluated++; continue; }
    if (atrGateVerdict(slice) !== 'ok') { evaluated++; continue; }
    const overlapScore = Math.max(base.callScore, base.putScore);
    if (overlapScore < NO_TRADE_SCORE) { evaluated++; continue; }

    const next = candles[i + 1];
    const verdict = judgeSignal(candidateDir, candles[i].close, next.close, asset.decimals);
    evaluated++;
    if (verdict.status === 'WIN') wins++;
    else if (verdict.status === 'LOSS') losses++;
    else ties++;

    // آمار لایه‌ها: هر لایه که با جهت نهایی رأی داده — برد/باخت رأی ثبت می‌شود
    for (const l of base.layers) {
      const vote = candidateDir === 'CALL' ? l.pointsCall - l.pointsPut : l.pointsPut - l.pointsCall;
      if (vote <= 0) continue;
      const st = stats[l.id] ?? { wins: 0, losses: 0 };
      if (verdict.status === 'WIN') st.wins++;
      else if (verdict.status === 'LOSS') st.losses++;
      stats[l.id] = st;
    }
  }

  const settled = wins + losses;
  return {
    winRate: settled >= 10 ? (wins / settled) * 100 : null,
    samples: settled,
    wins,
    losses,
    ties,
    layerStats: stats,
    evaluatedCandles: evaluated,
  };
}

/** بریدن آمار لایه‌ها به پنجرهٔ ۵۰ نمونهٔ اخیر (برای ذخیره‌سازی و وزن‌دهی پویا) */
export function trimLayerStats(stats: LayerStatsMap): LayerStatsMap {
  const out: LayerStatsMap = {};
  for (const [id, st] of Object.entries(stats)) {
    const total = st.wins + st.losses;
    if (total <= 50) { out[id] = st; continue; }
    const keep = 50;
    const ratio = st.wins / total;
    const wins = Math.round(ratio * keep);
    out[id] = { wins, losses: keep - wins };
  }
  return out;
}
