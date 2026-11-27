import { AssetConfig, Candle, MarketDataSource, QuantLayerResult, QuantPrediction } from '../types/trading';

function calcEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const seedLen = Math.min(
    values.length,
    Math.max(5, Math.min(period, Math.floor(values.length / 3)))
  );
  let seedSum = 0;
  for (let i = 0; i < seedLen; i++) {
    seedSum += values[i];
  }
  let ema = seedSum / seedLen;
  const series: number[] = [];

  for (let i = 0; i < values.length; i++) {
    if (i < seedLen) {
      series.push(ema);
    } else {
      ema = values[i] * k + ema * (1 - k);
      series.push(ema);
    }
  }
  return series;
}

function calcRSI(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcATRMetrics(
  candles: Candle[],
  liveBar: Candle
): {
  atr14: number;
  atr50: number;
  compressionRatio: number;
  avgBodyEfficiency3: number;
  boxRange5Atr: number;
  maxVolZScore: number;
} {
  if (candles.length === 0) {
    return {
      atr14: 0.0001,
      atr50: 0.0001,
      compressionRatio: 1,
      avgBodyEfficiency3: 0.5,
      boxRange5Atr: 2,
      maxVolZScore: 0,
    };
  }

  const trs: number[] = [Math.max(0, candles[0].high - candles[0].low)];
  const absMoves: number[] = [Math.abs(candles[0].close - candles[0].open)];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prevClose),
      Math.abs(cur.low - prevClose)
    );
    trs.push(tr);
    absMoves.push(Math.abs(cur.close - prevClose));
  }

  const wilder = (period: number): number => {
    let val = 0;
    const initCount = Math.min(period, trs.length);
    for (let i = 0; i < initCount; i++) val += trs[i];
    val /= Math.max(1, initCount);
    for (let i = initCount; i < trs.length; i++) {
      val = (val * (period - 1) + trs[i]) / period;
    }
    return val;
  };

  const atr14 = Math.max(wilder(14), 1e-10);
  const atr50 = Math.max(wilder(50), 1e-10);
  const compressionRatio = atr14 / atr50;

  // Measure body-to-range efficiency over last 3 closed candles to detect wick chop
  const closedSlice = candles.slice(Math.max(0, candles.length - 4), Math.max(1, candles.length - 1));
  let effSum = 0;
  let effCount = 0;
  for (const c of closedSlice) {
    const r = c.high - c.low;
    if (r > 0) {
      effSum += Math.abs(c.close - c.open) / r;
      effCount++;
    }
  }
  const avgBodyEfficiency3 = effCount > 0 ? effSum / effCount : 0.5;

  // Measure total 5-candle price envelope relative to ATR14 to detect tight flat boxes
  const box5 = candles.slice(-5);
  const boxHigh = Math.max(...box5.map((c) => c.high));
  const boxLow = Math.min(...box5.map((c) => c.low));
  const boxRange5Atr = (boxHigh - boxLow) / atr14;

  // Compute baseline Standard Deviation (σ) of True Range & Bar Returns (excluding the latest spike bar)
  const calcMeanStd = (arr: number[]) => {
    if (arr.length === 0) return { mean: 0.0001, std: 0.0001 };
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    const variance =
      arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / Math.max(1, arr.length - 1);
    const std = Math.max(Math.sqrt(variance), mean * 0.15, 1e-10);
    return { mean, std };
  };

  const baseStart = Math.max(0, trs.length - 41);
  const baseEnd = Math.max(baseStart + 5, trs.length - 1);
  const trStats = calcMeanStd(trs.slice(baseStart, baseEnd));
  const moveStats = calcMeanStd(absMoves.slice(baseStart, baseEnd));

  const lastTr = trs[trs.length - 1];
  const prevTr = trs[Math.max(0, trs.length - 2)];
  const liveTr = Math.max(
    liveBar.high - liveBar.low,
    Math.abs(liveBar.high - candles[candles.length - 1].close),
    Math.abs(liveBar.low - candles[candles.length - 1].close)
  );
  const liveAbsMove = Math.abs(liveBar.close - liveBar.open);
  const lastAbsMove = absMoves[absMoves.length - 1];

  const trZ = (Math.max(lastTr, prevTr, liveTr) - trStats.mean) / trStats.std;
  const moveZ = (Math.max(lastAbsMove, liveAbsMove) - moveStats.mean) / moveStats.std;
  const maxVolZScore = Math.max(0, trZ, moveZ);

  return {
    atr14,
    atr50,
    compressionRatio,
    avgBodyEfficiency3,
    boxRange5Atr,
    maxVolZScore,
  };
}

function calcBollingerBands(closes: number[], period = 20, mult = 2.2) {
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance =
    slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / slice.length;
  const stdDev = Math.sqrt(variance);
  return {
    basis: mean,
    upper: mean + mult * stdDev,
    lower: mean - mult * stdDev,
    stdDev,
  };
}

interface BbwAnomalyMetrics {
  bbwCurrent: number;
  bbwSma: number;
  bbwRatio: number;
  bbwZScore: number;
  bbwExpansionRate: number;
  isExtremeAnomaly: boolean;
  isElevatedAnomaly: boolean;
  isSqueeze: boolean;
}

function calcBollingerBandWidthAnomaly(
  closes: number[],
  liveClose: number,
  period = 20,
  mult = 2.2,
  maPeriod = 20
): BbwAnomalyMetrics {
  const bbwSeries: number[] = [];
  const startIdx = Math.max(period - 1, closes.length - (maPeriod + 10));

  for (let end = startIdx; end < closes.length; end++) {
    const win = closes.slice(end - period + 1, end + 1);
    const mean = win.reduce((s, v) => s + v, 0) / win.length;
    const variance = win.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / win.length;
    const std = Math.sqrt(variance);
    const bbw = (2 * mult * std) / Math.max(mean, 1e-10);
    bbwSeries.push(bbw);
  }

  // Also compute live bar BBW to catch sudden ongoing volatility spikes
  const liveWindow = [...closes.slice(-(period - 1)), liveClose];
  const liveMean = liveWindow.reduce((s, v) => s + v, 0) / liveWindow.length;
  const liveVar =
    liveWindow.reduce((s, v) => s + Math.pow(v - liveMean, 2), 0) / liveWindow.length;
  const liveBbw = (2 * mult * Math.sqrt(liveVar)) / Math.max(liveMean, 1e-10);

  if (bbwSeries.length < 5) {
    return {
      bbwCurrent: liveBbw,
      bbwSma: Math.max(liveBbw, 1e-10),
      bbwRatio: 1,
      bbwZScore: 0,
      bbwExpansionRate: 1,
      isExtremeAnomaly: false,
      isElevatedAnomaly: false,
      isSqueeze: false,
    };
  }

  const bbwCurrent = bbwSeries[bbwSeries.length - 1];
  const prevBbw = bbwSeries[Math.max(0, bbwSeries.length - 2)];
  const baseline = bbwSeries.slice(Math.max(0, bbwSeries.length - maPeriod - 1), -1);
  const bbwSma = Math.max(
    baseline.reduce((s, v) => s + v, 0) / Math.max(1, baseline.length),
    1e-10
  );
  const bbwVar =
    baseline.reduce((s, v) => s + Math.pow(v - bbwSma, 2), 0) /
    Math.max(1, baseline.length - 1);
  const bbwStd = Math.max(Math.sqrt(bbwVar), bbwSma * 0.15, 1e-10);

  const effectiveBbw = Math.max(bbwCurrent, liveBbw);
  const bbwRatio = effectiveBbw / bbwSma;
  const bbwZScore = (effectiveBbw - bbwSma) / bbwStd;
  const bbwExpansionRate = effectiveBbw / Math.max(prevBbw, 1e-10);

  const isExtremeAnomaly = bbwZScore >= 2.6 || bbwRatio >= 2.2;
  const isElevatedAnomaly =
    !isExtremeAnomaly &&
    (bbwZScore >= 1.75 || bbwRatio >= 1.65 || bbwExpansionRate >= 1.32);
  const isSqueeze = bbwRatio <= 0.58 || bbwZScore <= -1.35;

  return {
    bbwCurrent: effectiveBbw,
    bbwSma,
    bbwRatio,
    bbwZScore,
    bbwExpansionRate,
    isExtremeAnomaly,
    isElevatedAnomaly,
    isSqueeze,
  };
}

interface VolumeProfileMetrics {
  enabled: boolean;
  poc: number;
  vah: number;
  val: number;
  zone: 'ABOVE_VAH' | 'BELOW_VAL' | 'INSIDE_VA';
  nodeType: 'HVN' | 'LVN' | 'NORMAL';
  localDensityRelVol: number;
  distFromPocAtr: number;
}

function calcVolumeProfile(
  candles: Candle[],
  atr14: number,
  lookback = 72
): VolumeProfileMetrics {
  const slice = candles.slice(-lookback);
  const last = slice[slice.length - 1];
  if (!last || slice.length < 10) {
    return {
      enabled: false,
      poc: last?.close ?? 0,
      vah: last?.high ?? 0,
      val: last?.low ?? 0,
      zone: 'INSIDE_VA',
      nodeType: 'NORMAL',
      localDensityRelVol: 1,
      distFromPocAtr: 0,
    };
  }

  let totalVol = 0;
  let minLow = Infinity;
  let maxHigh = -Infinity;
  for (const c of slice) {
    totalVol += Math.max(0, c.volume);
    if (c.low < minLow) minLow = c.low;
    if (c.high > maxHigh) maxHigh = c.high;
  }

  if (totalVol <= 0 || maxHigh - minLow <= 1e-10) {
    return {
      enabled: false,
      poc: last.close,
      vah: maxHigh,
      val: minLow,
      zone: 'INSIDE_VA',
      nodeType: 'NORMAL',
      localDensityRelVol: 1,
      distFromPocAtr: 0,
    };
  }

  const bins = 24;
  const binSize = (maxHigh - minLow) / bins;
  const binVols = new Array<number>(bins).fill(0);

  const priceToBin = (p: number) =>
    Math.min(bins - 1, Math.max(0, Math.floor((p - minLow) / binSize)));

  for (const c of slice) {
    const vol = Math.max(0, c.volume);
    if (vol <= 0) continue;
    const typical = (c.high + c.low + c.close) / 3;
    const tpBin = priceToBin(typical);
    binVols[tpBin] += vol * 0.5;

    const lowBin = priceToBin(c.low);
    const highBin = priceToBin(c.high);
    const span = Math.max(1, highBin - lowBin + 1);
    const share = (vol * 0.5) / span;
    for (let b = lowBin; b <= highBin; b++) {
      binVols[b] += share;
    }
  }

  let pocIdx = 0;
  for (let i = 1; i < bins; i++) {
    if (binVols[i] > binVols[pocIdx]) pocIdx = i;
  }
  const poc = minLow + (pocIdx + 0.5) * binSize;

  // Expand Value Area outward from POC until 70% of total volume is captured
  const targetVaVol = totalVol * 0.7;
  let vaVol = binVols[pocIdx];
  let lowIdx = pocIdx;
  let highIdx = pocIdx;

  while (vaVol < targetVaVol && (lowIdx > 0 || highIdx < bins - 1)) {
    const nextLowVol = lowIdx > 0 ? binVols[lowIdx - 1] : -1;
    const nextHighVol = highIdx < bins - 1 ? binVols[highIdx + 1] : -1;
    if (nextHighVol >= nextLowVol && highIdx < bins - 1) {
      highIdx++;
      vaVol += binVols[highIdx];
    } else if (lowIdx > 0) {
      lowIdx--;
      vaVol += binVols[lowIdx];
    } else {
      break;
    }
  }

  const val = minLow + lowIdx * binSize;
  const vah = minLow + (highIdx + 1) * binSize;
  const curBin = priceToBin(last.close);
  const avgBinVol = totalVol / bins;

  let hoodSum = 0;
  let hoodCount = 0;
  for (let b = Math.max(0, curBin - 1); b <= Math.min(bins - 1, curBin + 1); b++) {
    hoodSum += binVols[b];
    hoodCount++;
  }
  const localDensityRelVol = avgBinVol > 0 ? hoodSum / hoodCount / avgBinVol : 1;

  const nodeType: VolumeProfileMetrics['nodeType'] =
    localDensityRelVol >= 1.35 ? 'HVN' : localDensityRelVol <= 0.65 ? 'LVN' : 'NORMAL';

  const zone: VolumeProfileMetrics['zone'] =
    last.close > vah ? 'ABOVE_VAH' : last.close < val ? 'BELOW_VAL' : 'INSIDE_VA';

  const distFromPocAtr = (last.close - poc) / Math.max(atr14, 1e-10);

  return {
    enabled: true,
    poc,
    vah,
    val,
    zone,
    nodeType,
    localDensityRelVol,
    distFromPocAtr,
  };
}

function calcFisherTransform(
  candles: Candle[],
  period = 11
): {
  current: number;
  previous: number;
  prev2: number;
  signal: number;
  delta: number;
} {
  let val = 0;
  let fisher = 0;
  let prevFisher = 0;
  let prev2Fisher = 0;

  for (let i = 0; i < candles.length; i++) {
    const start = Math.max(0, i - period + 1);
    let minLow = Infinity;
    let maxHigh = -Infinity;
    for (let j = start; j <= i; j++) {
      const hl2 = (candles[j].high + candles[j].low) / 2;
      if (hl2 < minLow) minLow = hl2;
      if (hl2 > maxHigh) maxHigh = hl2;
    }

    const hl2 = (candles[i].high + candles[i].low) / 2;
    const denom = Math.max(maxHigh - minLow, 1e-10);
    // Centered in [-1, 1] and volatility-damped (0.30 / 0.70) to curb single-wick false spikes
    const scaled = 2 * ((hl2 - minLow) / denom - 0.5);
    val = 0.30 * scaled + 0.70 * val;
    if (val > 0.995) val = 0.995;
    if (val < -0.995) val = -0.995;

    prev2Fisher = prevFisher;
    prevFisher = fisher;
    fisher = 0.5 * Math.log((1 + val) / (1 - val)) + 0.5 * fisher;
  }

  const signal = 0.55 * prevFisher + 0.45 * prev2Fisher;
  return {
    current: fisher,
    previous: prevFisher,
    prev2: prev2Fisher,
    signal,
    delta: fisher - prevFisher,
  };
}

interface KeySRMeanReversion {
  nearestSupport: number;
  nearestResistance: number;
  supportTouches: number;
  resistanceTouches: number;
  distToSupportAtr: number;
  distToResistanceAtr: number;
  meanZScore: number;
  atKeySupport: boolean;
  atKeyResistance: boolean;
  bullMeanRevAtSupport: boolean;
  bearMeanRevAtResistance: boolean;
}

function calcKeySRAndMeanReversion(
  candles: Candle[],
  atr14: number,
  bb: { basis: number; upper: number; lower: number; stdDev: number },
  vp: VolumeProfileMetrics
): KeySRMeanReversion {
  const n = candles.length;
  const last = candles[n - 1];
  const prev = candles[Math.max(0, n - 2)];
  const safeAtr = Math.max(atr14, 1e-10);
  const slice = candles.slice(Math.max(0, n - 64));

  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];
  for (let i = 2; i < slice.length - 2; i++) {
    const h = slice[i].high;
    const l = slice[i].low;
    if (
      h >= slice[i - 1].high &&
      h >= slice[i - 2].high &&
      h >= slice[i + 1].high &&
      h >= slice[i + 2].high
    ) {
      pivotHighs.push(h);
    }
    if (
      l <= slice[i - 1].low &&
      l <= slice[i - 2].low &&
      l <= slice[i + 1].low &&
      l <= slice[i + 2].low
    ) {
      pivotLows.push(l);
    }
  }

  const macroSlice = candles.slice(Math.max(0, n - 36), Math.max(1, n - 1));
  const macroHigh = Math.max(...macroSlice.map((c) => c.high));
  const macroLow = Math.min(...macroSlice.map((c) => c.low));
  pivotHighs.push(macroHigh);
  pivotLows.push(macroLow);
  if (vp.enabled) {
    pivotHighs.push(vp.vah);
    pivotLows.push(vp.val);
  }

  const clusterTol = safeAtr * 0.38;
  const clusterLevels = (levels: number[], isResistance: boolean) => {
    const clusters: Array<{ price: number; count: number }> = [];
    for (const lvl of levels) {
      const existing = clusters.find((c) => Math.abs(c.price - lvl) <= clusterTol);
      if (existing) {
        existing.price = (existing.price * existing.count + lvl) / (existing.count + 1);
        existing.count += 1;
      } else {
        clusters.push({ price: lvl, count: 1 });
      }
    }
    const filtered = clusters.filter((c) =>
      isResistance
        ? c.price >= last.close - safeAtr * 0.45
        : c.price <= last.close + safeAtr * 0.45
    );
    const pool = filtered.length > 0 ? filtered : clusters;
    pool.sort((a, b) => {
      const distA = Math.abs(a.price - last.close);
      const distB = Math.abs(b.price - last.close);
      // Prefer nearby multi-touch structural levels
      return distA - a.count * safeAtr * 0.25 - (distB - b.count * safeAtr * 0.25);
    });
    return pool[0] ?? { price: isResistance ? macroHigh : macroLow, count: 1 };
  };

  const bestRes = clusterLevels(pivotHighs, true);
  const bestSup = clusterLevels(pivotLows, false);

  const distToResistanceAtr = (bestRes.price - last.close) / safeAtr;
  const distToSupportAtr = (last.close - bestSup.price) / safeAtr;

  const meanZScore =
    (last.close - bb.basis) / Math.max(bb.stdDev, safeAtr * 0.35, 1e-10);

  const zoneTol = safeAtr * 0.26;
  const atKeyResistance =
    last.high >= bestRes.price - zoneTol ||
    prev.high >= bestRes.price - zoneTol ||
    distToResistanceAtr <= 0.24;
  const atKeySupport =
    last.low <= bestSup.price + zoneTol ||
    prev.low <= bestSup.price + zoneTol ||
    distToSupportAtr <= 0.24;

  const lastRange = Math.max(last.high - last.low, 1e-10);
  const lastUpperWick = last.high - Math.max(last.open, last.close);
  const lastLowerWick = Math.min(last.open, last.close) - last.low;

  const bearRejection =
    last.close < last.open ||
    lastUpperWick / lastRange >= 0.36 ||
    last.close < bestRes.price;
  const bullRejection =
    last.close > last.open ||
    lastLowerWick / lastRange >= 0.36 ||
    last.close > bestSup.price;

  const bullMeanRevAtSupport =
    atKeySupport && (meanZScore <= -1.45 || last.close <= bb.lower || prev.close <= bb.lower) && bullRejection;
  const bearMeanRevAtResistance =
    atKeyResistance && (meanZScore >= 1.45 || last.close >= bb.upper || prev.close >= bb.upper) && bearRejection;

  return {
    nearestSupport: bestSup.price,
    nearestResistance: bestRes.price,
    supportTouches: bestSup.count,
    resistanceTouches: bestRes.count,
    distToSupportAtr,
    distToResistanceAtr,
    meanZScore,
    atKeySupport,
    atKeyResistance,
    bullMeanRevAtSupport,
    bearMeanRevAtResistance,
  };
}

export interface SessionStatus {
  isOptimal: boolean;
  sessionName: string;
  penalty: number;
  minConfidence: number;
  minEdge: number;
  minAlignedLayers: number;
  tierLabel: string;
}

export function getSessionStatus(utcDate = new Date()): SessionStatus {
  const utcHour = utcDate.getUTCHours();

  // Peak London + NY overlap
  if (utcHour >= 12 && utcHour < 16) {
    return {
      isOptimal: true,
      sessionName: 'هم‌پوشانی لندن و نیویورک (اوج نقدینگی)',
      penalty: 1,
      minConfidence: 68,
      minEdge: 13,
      minAlignedLayers: 3,
      tierLabel: 'Overlap Peak',
    };
  }

  // London core session
  if (utcHour >= 7 && utcHour < 12) {
    return {
      isOptimal: true,
      sessionName: 'سشن لندن (نقدینگی مطلوب)',
      penalty: 0,
      minConfidence: 68,
      minEdge: 14,
      minAlignedLayers: 3,
      tierLabel: 'London',
    };
  }

  // New York core session
  if (utcHour >= 16 && utcHour < 20) {
    return {
      isOptimal: true,
      sessionName: 'سشن نیویورک (نقدینگی مطلوب)',
      penalty: 0,
      minConfidence: 68,
      minEdge: 14,
      minAlignedLayers: 3,
      tierLabel: 'New York',
    };
  }

  // Daily rollover & late NY liquidity drop (highest false-breakout risk)
  if (utcHour >= 20) {
    return {
      isOptimal: false,
      sessionName: 'انتهای نیویورک / رول‌اور (فیلتر سخت‌گیرانه)',
      penalty: -8,
      minConfidence: 73,
      minEdge: 20,
      minAlignedLayers: 4,
      tierLabel: 'Rollover (-8%)',
    };
  }

  // Thin Asian session (00:00 - 06:59 UTC)
  return {
    isOptimal: false,
    sessionName: 'سشن آسیا (نقدینگی کمتر · فیلتر تقویت‌شده)',
    penalty: -6,
    minConfidence: 71,
    minEdge: 18,
    minAlignedLayers: 4,
    tierLabel: 'Asian (-6%)',
  };
}

export interface ConfidenceMultiplierResult {
  isGoldenConfluence: boolean;
  bonus: number;
  multiplier: number;
}

export function calcConfidenceScoringMultiplier(params: {
  candidateDir: 'CALL' | 'PUT';
  bbCallPts: number;
  bbPutPts: number;
  fisherCallPts: number;
  fisherPutPts: number;
  hasFisherExtremeCurl: boolean;
  hasKeySrMeanReversion: boolean;
  alignedLayers: number;
  dominance: number;
  bbRatio: number;
  fisherDelta: number;
}): ConfidenceMultiplierResult {
  const {
    candidateDir,
    bbCallPts,
    bbPutPts,
    fisherCallPts,
    fisherPutPts,
    hasFisherExtremeCurl,
    hasKeySrMeanReversion,
    alignedLayers,
    dominance,
    bbRatio,
    fisherDelta,
  } = params;

  const bbDir: 'CALL' | 'PUT' | 'NONE' =
    bbCallPts > bbPutPts && bbCallPts >= 8
      ? 'CALL'
      : bbPutPts > bbCallPts && bbPutPts >= 8
      ? 'PUT'
      : 'NONE';

  const fisherDir: 'CALL' | 'PUT' | 'NONE' =
    fisherCallPts > fisherPutPts && fisherCallPts >= 7
      ? 'CALL'
      : fisherPutPts > fisherCallPts && fisherPutPts >= 7
      ? 'PUT'
      : 'NONE';

  if (bbDir !== candidateDir || fisherDir !== candidateDir) {
    return { isGoldenConfluence: false, bonus: 0, multiplier: 1 };
  }

  let dynamicScore = 5;
  if (hasFisherExtremeCurl || Math.abs(fisherDelta) >= 0.12) dynamicScore += 1;
  if (hasKeySrMeanReversion || bbRatio <= 0.22 || bbRatio >= 0.78) dynamicScore += 1;

  const pairPts =
    candidateDir === 'CALL' ? bbCallPts + fisherCallPts : bbPutPts + fisherPutPts;
  if (pairPts >= 34) dynamicScore += 1;
  if (alignedLayers >= 4) dynamicScore += 1;
  if (dominance >= 0.65) dynamicScore += 1;

  const bonus = Math.min(10, Math.max(5, Math.round(dynamicScore)));
  return {
    isGoldenConfluence: true,
    bonus,
    multiplier: Number((1 + bonus / 100).toFixed(2)),
  };
}

export interface ConfidenceThresholdingResult {
  direction: QuantPrediction['direction'];
  blockedByHighVolatility: boolean;
  effectiveThreshold: number;
  reason?: string;
}

export function applyConfidenceThresholding(params: {
  proposedDirection: QuantPrediction['direction'];
  confidence: number;
  minConfRequired: number;
  atrRatio: number;
  maxVolZScore: number;
  bbwRatio: number;
  bbwZScore: number;
  liveRangeAtr: number;
}): ConfidenceThresholdingResult {
  const {
    proposedDirection,
    confidence,
    minConfRequired,
    atrRatio,
    maxVolZScore,
    bbwRatio,
    bbwZScore,
    liveRangeAtr,
  } = params;

  const isVeryHighVolatility =
    maxVolZScore >= 2.15 ||
    atrRatio >= 2.05 ||
    liveRangeAtr >= 2.1 ||
    (bbwRatio >= 1.85 && bbwZScore >= 2.0) ||
    (atrRatio >= 1.75 && bbwZScore >= 1.85);

  // During elevated-but-not-extreme volatility, dynamically raise required confidence threshold
  const volatilitySurcharge =
    maxVolZScore >= 1.75 || atrRatio >= 1.65 || bbwRatio >= 1.55 ? 4 : 0;
  const effectiveThreshold = Math.min(86, minConfRequired + volatilitySurcharge);

  if (isVeryHighVolatility) {
    return {
      direction: 'WAIT',
      blockedByHighVolatility: true,
      effectiveThreshold,
      reason: `Confidence Thresholding: نوسان بسیار بالا (${Math.max(atrRatio, liveRangeAtr).toFixed(2)}× ATR · ${maxVolZScore.toFixed(1)}σ) — تغییر خودکار به WAIT`,
    };
  }

  if (proposedDirection === 'WAIT' || confidence < effectiveThreshold) {
    return {
      direction: 'WAIT',
      blockedByHighVolatility: false,
      effectiveThreshold,
    };
  }

  return {
    direction: proposedDirection,
    blockedByHighVolatility: false,
    effectiveThreshold,
  };
}

export function runQuantEngine(
  asset: AssetConfig,
  rawCandles: Candle[],
  source: MarketDataSource,
  isOfficialTrigger = false
): QuantPrediction {
  const liveBar = rawCandles[rawCandles.length - 1];
  // Evaluate indicators exclusively on confirmed closed candles mid-timer to eliminate repainting/direction flips;
  // at the :45 official trigger, include the 85%-formed trigger candle for the next-candle forecast.
  const candles =
    !isOfficialTrigger && rawCandles.length >= 35
      ? rawCandles.slice(0, -1)
      : rawCandles;

  const n = candles.length;
  const last = candles[n - 1];
  const prev = candles[Math.max(0, n - 2)];
  const prev2 = candles[Math.max(0, n - 3)];
  const closes = candles.map((c) => c.close);

  let callScore = 0;
  let putScore = 0;
  const reasons: string[] = [];
  const layers: QuantLayerResult[] = [];

  // Precompute relative volume (skip when asset feed like FX has 0 volume)
  const volSlice = candles.slice(Math.max(0, n - 21), n - 1).map((c) => c.volume);
  const avgVol =
    volSlice.length > 0 ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 0;
  const hasVolume = avgVol > 0 && last.volume > 0;
  const relVolume = hasVolume ? last.volume / avgVol : 1;

  // ---------------------------------------------------------------------------
  // Layer 1: Adaptive Session Guard
  // ---------------------------------------------------------------------------
  const session = getSessionStatus(new Date());
  layers.push({
    id: 'session',
    index: 1,
    name: 'نگهبان سشن معاملاتی',
    metricLabel: 'UTC Session',
    metricValue: session.tierLabel,
    sentiment: session.isOptimal ? 'bullish' : 'warning',
    summary: session.sessionName,
    pointsCall: 0,
    pointsPut: 0,
  });
  if (!session.isOptimal) {
    reasons.push(`${session.sessionName} (حداقل ${session.minAlignedLayers} لایه هم‌سو)`);
  } else {
    reasons.push(session.sessionName);
  }

  // ---------------------------------------------------------------------------
  // Layer 2: Multi-Horizon Volatility, Flat-Price & StdDev Shock Gate
  // ---------------------------------------------------------------------------
  const {
    atr14,
    compressionRatio,
    avgBodyEfficiency3,
    boxRange5Atr,
    maxVolZScore,
  } = calcATRMetrics(candles, liveBar);
  const formingRange = Math.max(0, last.high - last.low);
  const closedRange = Math.max(0, prev.high - prev.low);
  const effectiveRange = Math.max(formingRange, closedRange);
  const atrRatio = effectiveRange / Math.max(atr14, 1e-10);
  const liveMoveAtr = (liveBar.close - liveBar.open) / Math.max(atr14, 1e-10);
  const atrPct = atr14 / Math.max(last.close, 1e-10);

  const isDeadFlat =
    atrRatio < 0.48 ||
    compressionRatio < 0.62 ||
    boxRange5Atr < 1.32 ||
    atrPct < asset.volatility * 0.25;
  const isLowVolatility =
    !isDeadFlat && (atrRatio < 0.72 || compressionRatio < 0.78 || boxRange5Atr < 1.65);
  const isExtremeVolatility = maxVolZScore >= 2.75;
  const isElevatedVolatility = !isExtremeVolatility && maxVolZScore >= 2.0;
  const isChoppyWickMarket = avgBodyEfficiency3 < 0.25 && atrRatio < 0.95;
  const volatilityBlocked = isDeadFlat || isExtremeVolatility;

  let volCallPts = 0;
  let volPutPts = 0;
  let atrHealthBonus = 0;
  let volSummary = `نوسان متعادل (${atrRatio.toFixed(2)}× ATR14 · انحراف ${maxVolZScore.toFixed(1)}σ)`;
  let volSentiment: QuantLayerResult['sentiment'] = 'neutral';

  if (isDeadFlat) {
    volSummary = `فشردگی و فلت‌بودن قیمت (${atrRatio.toFixed(2)}× ATR14 · باکس ${boxRange5Atr.toFixed(1)}×) — توقف اجباری`;
    volSentiment = 'warning';
    atrHealthBonus = -7;
    reasons.push('دروازه ATR: قیمت در وضعیت فلت و فشردگی شدید قرار دارد');
  } else if (isExtremeVolatility) {
    volSummary = `شوک خبری و نوسان شدید (${maxVolZScore.toFixed(2)}σ ≥ 2.75σ StdDev) — توقف اجباری`;
    volSentiment = 'warning';
    atrHealthBonus = -9;
    reasons.push(`فیلتر انحراف معیار: نوسان خبری شدید (${maxVolZScore.toFixed(2)}σ)`);
  } else if (isElevatedVolatility) {
    volSummary = `افزایش غیرعادی دامنه نوسان (${maxVolZScore.toFixed(2)}σ StdDev) — احتیاط`;
    volSentiment = 'warning';
    atrHealthBonus = -4;
    reasons.push(`هشدار انحراف معیار: افزایش تنش نوسانی (${maxVolZScore.toFixed(1)}σ)`);
  } else if (isLowVolatility) {
    volSummary = `نوسان ضعیف و کم‌رمق (${atrRatio.toFixed(2)}× ATR14 · باکس ${boxRange5Atr.toFixed(1)}×)`;
    volSentiment = 'warning';
    atrHealthBonus = -4;
    reasons.push('هشدار ATR: نوسان کم و احتمال ورود کاذب در رنج باریک');
  } else if (isChoppyWickMarket) {
    volSummary = `بازار سایه‌دار و فرسایشی (کارایی بدنه ${Math.round(avgBodyEfficiency3 * 100)}٪) — احتیاط`;
    volSentiment = 'warning';
    atrHealthBonus = -5;
    reasons.push('فیلتر ATR: شدوهای متوالی و رنج بی‌جهت');
  } else if (atrRatio >= 0.82 && atrRatio <= 1.85 && compressionRatio >= 0.84) {
    atrHealthBonus = 3;
    const refCandle = formingRange >= atr14 * 0.48 ? last : prev;
    const refRange = Math.max(refCandle.high - refCandle.low, 1e-10);
    const refEfficiency = Math.abs(refCandle.close - refCandle.open) / refRange;
    const volBonus = hasVolume && relVolume >= 1.25 ? 2 : 0;

    if (refEfficiency >= 0.44) {
      if (refCandle.close > refCandle.open) {
        volCallPts = 6 + volBonus;
        volSentiment = 'bullish';
        volSummary = `گسترش سالم نوسان صعودی (${atrRatio.toFixed(2)}× ATR · ${maxVolZScore.toFixed(1)}σ)`;
      } else if (refCandle.close < refCandle.open) {
        volPutPts = 6 + volBonus;
        volSentiment = 'bearish';
        volSummary = `گسترش سالم نوسان نزولی (${atrRatio.toFixed(2)}× ATR · ${maxVolZScore.toFixed(1)}σ)`;
      }
    } else {
      volSummary = `نوسان در محدوده سالم (${atrRatio.toFixed(2)}× ATR14 · ${maxVolZScore.toFixed(1)}σ)`;
    }
  }

  callScore += volCallPts;
  putScore += volPutPts;

  layers.push({
    id: 'atr',
    index: 2,
    name: 'دروازه نوسان پیشرفته (ATR + StdDev)',
    metricLabel: 'ATR / StdDev',
    metricValue: `${atrRatio.toFixed(2)}x (${maxVolZScore.toFixed(1)}σ)`,
    sentiment: volSentiment,
    summary: volSummary,
    pointsCall: volCallPts,
    pointsPut: volPutPts,
  });

  // ---------------------------------------------------------------------------
  // Layer 3: Multi-EMA Trend Ribbon & EMA 200 Magnet Filter
  // ---------------------------------------------------------------------------
  const ema9Series = calcEMA(closes, 9);
  const ema21Series = calcEMA(closes, 21);
  const ema50Series = calcEMA(closes, 50);
  const ema200Series = calcEMA(closes, 200);
  const ema9 = ema9Series[ema9Series.length - 1];
  const ema21 = ema21Series[ema21Series.length - 1];
  const ema21Prev = ema21Series[Math.max(0, ema21Series.length - 3)];
  const ema50 = ema50Series[ema50Series.length - 1];
  const ema50Prev = ema50Series[Math.max(0, ema50Series.length - 4)];
  const ema200 = ema200Series[ema200Series.length - 1];
  const ema200Prev = ema200Series[Math.max(0, ema200Series.length - 8)];

  const ema21SlopeUp = ema21 > ema21Prev;
  const ema50SlopeUp = ema50 > ema50Prev;
  const distFromEma200Atr = (last.close - ema200) / Math.max(atr14, 1e-10);
  const ema200SlopeAtr = (ema200 - ema200Prev) / Math.max(atr14, 1e-10);
  const ema200Bias: 'CALL' | 'PUT' | 'FLAT' =
    distFromEma200Atr > 0.35 && ema200SlopeAtr >= 0
      ? 'CALL'
      : distFromEma200Atr < -0.35 && ema200SlopeAtr <= 0
      ? 'PUT'
      : 'FLAT';
  const isFlatEma200Zone =
    Math.abs(distFromEma200Atr) < 0.55 && Math.abs(ema200SlopeAtr) < 0.08;

  // Count consecutive same-direction candles to guard against trend exhaustion
  let bullStreak = 0;
  let bearStreak = 0;
  for (let i = n - 1; i >= Math.max(0, n - 6); i--) {
    if (candles[i].close > candles[i].open) {
      if (bearStreak > 0) break;
      bullStreak++;
    } else if (candles[i].close < candles[i].open) {
      if (bullStreak > 0) break;
      bearStreak++;
    } else {
      break;
    }
  }
  const distFromEma21Atr = (last.close - ema21) / Math.max(atr14, 1e-10);

  let trendCallPts = 0;
  let trendPutPts = 0;
  let macroBias: 'CALL' | 'PUT' | 'NEUTRAL' = 'NEUTRAL';
  let trendSummary = 'روند خنثی / رنج ماکرو';
  let trendSentiment: QuantLayerResult['sentiment'] = 'neutral';

  if (last.close > ema21 && ema21 > ema50 && ema50 > ema200) {
    trendCallPts = ema21SlopeUp && ema50SlopeUp ? 18 : 14;
    trendPutPts = -12;
    macroBias = 'CALL';
    trendSummary = 'هم‌ترازی کامل صعودی (EMA 21 > 50 > 200)';
    trendSentiment = 'bullish';
    reasons.push('هم‌راستایی کامل با روند صعودی EMA 21/50/200');
  } else if (last.close < ema21 && ema21 < ema50 && ema50 < ema200) {
    trendPutPts = !ema21SlopeUp && !ema50SlopeUp ? 18 : 14;
    trendCallPts = -12;
    macroBias = 'PUT';
    trendSummary = 'هم‌ترازی کامل نزولی (EMA 21 < 50 < 200)';
    trendSentiment = 'bearish';
    reasons.push('هم‌راستایی کامل با روند نزولی EMA 21/50/200');
  } else if (last.close > ema50 && ema21SlopeUp) {
    trendCallPts = ema200Bias === 'CALL' ? 12 : 9;
    macroBias = 'CALL';
    trendSummary = 'برتری خریداران بالای میانگین EMA 50';
    trendSentiment = 'bullish';
    reasons.push('حمایت قیمت بالای میانگین EMA 50');
  } else if (last.close < ema50 && !ema21SlopeUp) {
    trendPutPts = ema200Bias === 'PUT' ? 12 : 9;
    macroBias = 'PUT';
    trendSummary = 'برتری فروشندگان زیر میانگین EMA 50';
    trendSentiment = 'bearish';
    reasons.push('فشار فروش زیر میانگین EMA 50');
  }

  const emaSpreadAtr = Math.abs(ema21 - ema50) / Math.max(atr14, 1e-10);
  const emaSlopeAtr = Math.abs(ema21 - ema21Prev) / Math.max(atr14, 1e-10);
  const isSideways =
    macroBias === 'NEUTRAL' ||
    isFlatEma200Zone ||
    (emaSpreadAtr < 0.72 && emaSlopeAtr < 0.18);

  if (isFlatEma200Zone) {
    atrHealthBonus -= 3;
    trendSummary = 'چسبندگی قیمت روی EMA 200 افقی (منطقه فلت و پرریسک)';
    reasons.push('هشدار EMA 200: چسبندگی قیمت روی میانگین ۲۰۰ بدون شیب');
  } else if (isSideways && macroBias === 'NEUTRAL') {
    trendSummary = 'بازار ساید / رنج (اولویت برگشت در کف و سقف محدوده)';
    reasons.push('تشخیص رژیم بازار ساید (اولویت نوسان‌گیری در کف و سقف)');
  }

  callScore += trendCallPts;
  putScore += trendPutPts;

  layers.push({
    id: 'ema',
    index: 3,
    name: 'روند ماکرو (EMA 21 / 50 / 200)',
    metricLabel: 'Trend Ribbon',
    metricValue: isSideways
      ? 'Sideways'
      : macroBias === 'CALL'
      ? 'Bullish'
      : 'Bearish',
    sentiment: trendSentiment,
    summary: trendSummary,
    pointsCall: trendCallPts,
    pointsPut: trendPutPts,
  });

  // ---------------------------------------------------------------------------
  // Layer 4: Mean Reversion Channel, Key S/R & RSI(14) Confluence
  // ---------------------------------------------------------------------------
  const bb = calcBollingerBands(closes, 20, 2.2);
  const rsi14 = calcRSI(closes, 14);
  const vp = calcVolumeProfile(candles, atr14, 72);
  const srMeanRev = calcKeySRAndMeanReversion(candles, atr14, bb, vp);

  const bandWidth = Math.max(bb.upper - bb.lower, 1e-10);
  const bbRatio = (last.close - bb.lower) / bandWidth;
  const bbPct = Math.round(bbRatio * 100);

  let bbCallPts = 0;
  let bbPutPts = 0;
  let bbSummary = `میانه کانال بولینگر (${bbPct}٪ · Z ${srMeanRev.meanZScore.toFixed(1)})`;
  let bbSentiment: QuantLayerResult['sentiment'] = 'neutral';
  const hasKeySrMeanReversion =
    srMeanRev.bullMeanRevAtSupport || srMeanRev.bearMeanRevAtResistance;

  if (srMeanRev.bullMeanRevAtSupport && rsi14 <= 42) {
    bbCallPts = isSideways ? 25 : macroBias === 'PUT' ? 15 : 22;
    bbSummary = `بازگشت قیمتی شدید (Mean Reversion) روی حمایت کلیدی (${srMeanRev.supportTouches} برخورد · Z ${srMeanRev.meanZScore.toFixed(1)})`;
    bbSentiment = 'bullish';
    reasons.push(`بازگشت Mean Reversion از سطح کلیدی حمایت (Z ${srMeanRev.meanZScore.toFixed(1)})`);
  } else if (srMeanRev.bearMeanRevAtResistance && rsi14 >= 58) {
    bbPutPts = isSideways ? 25 : macroBias === 'CALL' ? 15 : 22;
    bbSummary = `بازگشت قیمتی شدید (Mean Reversion) روی مقاومت کلیدی (${srMeanRev.resistanceTouches} برخورد · Z +${srMeanRev.meanZScore.toFixed(1)})`;
    bbSentiment = 'bearish';
    reasons.push(`بازگشت Mean Reversion از سطح کلیدی مقاومت (Z +${srMeanRev.meanZScore.toFixed(1)})`);
  } else if ((last.close <= bb.lower || prev.close <= bb.lower) && rsi14 <= 35) {
    bbCallPts = isSideways ? 23 : macroBias === 'PUT' ? 13 : 21;
    bbSummary = `اشباع فروش تاییدشده در کف بولینگر (RSI ${Math.round(rsi14)})`;
    bbSentiment = 'bullish';
    reasons.push(`واکنش کف بولینگر همراه با اشباع RSI (${Math.round(rsi14)})`);
  } else if ((last.low <= bb.lower || bbRatio <= 0.18 || srMeanRev.atKeySupport) && rsi14 <= 43) {
    bbCallPts = isSideways ? (srMeanRev.atKeySupport ? 18 : 15) : macroBias === 'PUT' ? 8 : 14;
    bbSummary = srMeanRev.atKeySupport
      ? `آزمون حمایت کلیدی و کف کانال (${bbPct}٪)`
      : `فشار کف کانال بولینگر (${bbPct}٪)`;
    bbSentiment = 'bullish';
    reasons.push('نزدیکی به سطح حمایتی و باند پایینی بولینگر');
  } else if ((last.close >= bb.upper || prev.close >= bb.upper) && rsi14 >= 65) {
    bbPutPts = isSideways ? 23 : macroBias === 'CALL' ? 13 : 21;
    bbSummary = `اشباع خرید تاییدشده در سقف بولینگر (RSI ${Math.round(rsi14)})`;
    bbSentiment = 'bearish';
    reasons.push(`واکنش سقف بولینگر همراه با اشباع RSI (${Math.round(rsi14)})`);
  } else if ((last.high >= bb.upper || bbRatio >= 0.82 || srMeanRev.atKeyResistance) && rsi14 >= 57) {
    bbPutPts = isSideways ? (srMeanRev.atKeyResistance ? 18 : 15) : macroBias === 'CALL' ? 8 : 14;
    bbSummary = srMeanRev.atKeyResistance
      ? `آزمون مقاومت کلیدی و سقف کانال (${bbPct}٪)`
      : `فشار سقف کانال بولینگر (${bbPct}٪)`;
    bbSentiment = 'bearish';
    reasons.push('نزدیکی به سطح مقاومتی و باند بالایی بولینگر');
  } else if (!isSideways && bbRatio > 0.54 && rsi14 >= 52 && rsi14 < 68 && macroBias === 'CALL') {
    bbCallPts = 10;
    bbSummary = `تداوم مومنتوم صعودی بالای خط میانی (${bbPct}٪)`;
    bbSentiment = 'bullish';
  } else if (!isSideways && bbRatio < 0.46 && rsi14 <= 48 && rsi14 > 32 && macroBias === 'PUT') {
    bbPutPts = 10;
    bbSummary = `تداوم مومنتوم نزولی زیر خط میانی (${bbPct}٪)`;
    bbSentiment = 'bearish';
  }

  if (rsi14 > 70) {
    reasons.push(`فیلتر RSI(14): ناحیه اشباع خرید (${Math.round(rsi14)} > ۷۰) — توقف ورود`);
  } else if (rsi14 < 30) {
    reasons.push(`فیلتر RSI(14): ناحیه اشباع فروش (${Math.round(rsi14)} < ۳۰) — توقف ورود`);
  }

  callScore += bbCallPts;
  putScore += bbPutPts;

  layers.push({
    id: 'bb',
    index: 4,
    name: 'کانال آماری، RSI(14) و حمایت/مقاومت',
    metricLabel: 'RSI14 / Z-Mean',
    metricValue: `R${Math.round(rsi14)} · ${bbPct}% · Z${srMeanRev.meanZScore.toFixed(1)}`,
    sentiment: rsi14 > 70 || rsi14 < 30 ? 'warning' : bbSentiment,
    summary:
      rsi14 > 70
        ? `اشباع خرید RSI(14) = ${Math.round(rsi14)} (خارج از بازه ۳۰ تا ۷۰)`
        : rsi14 < 30
        ? `اشباع فروش RSI(14) = ${Math.round(rsi14)} (خارج از بازه ۳۰ تا ۷۰)`
        : bbSummary,
    pointsCall: bbCallPts,
    pointsPut: bbPutPts,
  });

  // ---------------------------------------------------------------------------
  // Layer 5: Anomaly Detection via Bollinger Band Width Moving Average (BBW MA)
  // ---------------------------------------------------------------------------
  const bbwAnomaly = calcBollingerBandWidthAnomaly(closes, liveBar.close, 20, 2.2, 20);
  let bbwSentiment: QuantLayerResult['sentiment'] = 'neutral';
  let bbwSummary = `پهنای باند نرمال (${bbwAnomaly.bbwRatio.toFixed(2)}× میانگین BBW · ${bbwAnomaly.bbwZScore.toFixed(1)}σ)`;

  if (bbwAnomaly.isExtremeAnomaly) {
    bbwSentiment = 'warning';
    atrHealthBonus -= 8;
    bbwSummary = `ناهنجاری شدید پهنای باند بولینگر (${bbwAnomaly.bbwRatio.toFixed(2)}× BBW MA · ${bbwAnomaly.bbwZScore.toFixed(1)}σ) — توقف ورود`;
    reasons.push(`تشخیص ناهنجاری BBW: جهش شدید پهنای باند (${bbwAnomaly.bbwRatio.toFixed(2)}× میانگین)`);
  } else if (bbwAnomaly.isElevatedAnomaly) {
    bbwSentiment = 'warning';
    atrHealthBonus -= 4;
    bbwSummary = `گسترش غیرعادی پهنای باند (${bbwAnomaly.bbwRatio.toFixed(2)}× BBW MA · ${bbwAnomaly.bbwZScore.toFixed(1)}σ) — فیلتر سخت‌گیرانه`;
    reasons.push(`هشدار BBW Anomaly: نوسان بیش از میانگین انحراف معیار (${bbwAnomaly.bbwZScore.toFixed(1)}σ)`);
  } else if (bbwAnomaly.isSqueeze) {
    bbwSentiment = 'warning';
    atrHealthBonus -= 3;
    bbwSummary = `فشردگی شدید باند بولینگر (${bbwAnomaly.bbwRatio.toFixed(2)}× BBW MA) — احتیاط در رنج`;
  }

  layers.push({
    id: 'bbw_anomaly',
    index: 5,
    name: 'تشخیص ناهنجاری نوسان (BBW Anomaly)',
    metricLabel: 'BBW / MA20',
    metricValue: `${(bbwAnomaly.bbwCurrent * 100).toFixed(2)}% (${bbwAnomaly.bbwRatio.toFixed(2)}x)`,
    sentiment: bbwSentiment,
    summary: bbwSummary,
    pointsCall: 0,
    pointsPut: 0,
  });

  // ---------------------------------------------------------------------------
  // Layer 6: Calibrated Fisher Transform & Overbought / Oversold Confluence
  // ---------------------------------------------------------------------------
  const fisherPeriod = isSideways ? 9 : 12;
  const fisher = calcFisherTransform(candles, fisherPeriod);
  const fisherObThreshold = isSideways ? 1.2 : 1.45;
  const fisherOsThreshold = -fisherObThreshold;
  const fisherDeepThreshold = 2.05;

  let fisherCallPts = 0;
  let fisherPutPts = 0;
  let fisherSummary = `مومنتوم متعادل (${fisher.current.toFixed(2)})`;
  let fisherSentiment: QuantLayerResult['sentiment'] = 'neutral';
  let hasFisherExtremeCurl = false;

  const fisherDelta = fisher.delta;
  const curlingUp = fisherDelta > 0.03;
  const curlingDown = fisherDelta < -0.03;
  const freshBullCross = curlingUp && fisher.previous <= fisher.prev2 && fisher.current >= fisher.signal;
  const freshBearCross = curlingDown && fisher.previous >= fisher.prev2 && fisher.current <= fisher.signal;
  const strongSnapback = Math.abs(fisherDelta) >= 0.12;
  const isFisherOverbought = fisher.current >= fisherObThreshold;
  const isFisherOversold = fisher.current <= fisherOsThreshold;

  const hasStrongSupport =
    srMeanRev.atKeySupport &&
    (srMeanRev.supportTouches >= 2 || (vp.enabled && vp.zone === 'BELOW_VAL'));
  const hasStrongResistance =
    srMeanRev.atKeyResistance &&
    (srMeanRev.resistanceTouches >= 2 || (vp.enabled && vp.zone === 'ABOVE_VAH'));

  let hasSupportFisherConfluence = false;
  let hasResistanceFisherConfluence = false;

  if (isDeadFlat) {
    fisherSummary = `غیرفعال در قیمت فلت (${fisher.current.toFixed(2)})`;
  } else if (isFisherOversold) {
    const vpDemandAlign =
      vp.enabled && (vp.zone === 'BELOW_VAL' || (vp.nodeType === 'HVN' && last.close >= prev.low));
    if (curlingUp && (rsi14 <= 46 || bbRatio <= 0.35 || vpDemandAlign || srMeanRev.atKeySupport)) {
      hasFisherExtremeCurl = true;
      const baseExtreme = isSideways ? 21 : 18;
      const crossBonus = freshBullCross ? 4 : strongSnapback ? 3 : 0;
      const ema200AlignBonus = ema200Bias === 'CALL' && atrRatio >= 0.72 ? 3 : 0;
      const vpSupportBonus = vpDemandAlign ? 3 : 0;
      const srSupportBonus = hasStrongSupport ? 6 : srMeanRev.atKeySupport ? 4 : 0;
      const lowVolDiscount = isLowVolatility ? -5 : 0;
      fisherCallPts = Math.max(
        10,
        baseExtreme +
          crossBonus +
          ema200AlignBonus +
          vpSupportBonus +
          srSupportBonus +
          lowVolDiscount
      );
      fisherPutPts = -9;
      if (srMeanRev.atKeySupport) {
        hasSupportFisherConfluence = true;
        fisherSummary = `تلاقی حمایت قوی (${srMeanRev.supportTouches}×) و بازگشت صعودی Fisher 5m (${fisher.current.toFixed(2)})`;
        reasons.push(`تلاقی حمایت قوی و بازگشت Fisher Transform (${fisher.current.toFixed(2)})`);
      } else {
        fisherSummary = vpDemandAlign
          ? `چرخش صعودی فیشر از اشباع فروش روی حمایت پروفیل حجم (${fisher.current.toFixed(2)})`
          : `چرخش تاییدشده صعودی فیشر از اشباع فروش (${fisher.current.toFixed(2)})`;
        reasons.push(`چرخش صعودی Fisher از ناحیه اشباع فروش (${fisher.current.toFixed(2)})`);
      }
      fisherSentiment = 'bullish';
    } else {
      // Oversold without valid reversal curl -> block/penalize PUT chasing
      fisherPutPts = fisher.current <= -fisherDeepThreshold ? -13 : -8;
      fisherCallPts = isLowVolatility ? 2 : 5;
      fisherSummary = `ناحیه اشباع فروش فیشر (${fisher.current.toFixed(2)}) — فیلتر ورود نزولی`;
      fisherSentiment = 'warning';
    }
  } else if (isFisherOverbought) {
    const vpSupplyAlign =
      vp.enabled && (vp.zone === 'ABOVE_VAH' || (vp.nodeType === 'HVN' && last.close <= prev.high));
    if (curlingDown && (rsi14 >= 54 || bbRatio >= 0.65 || vpSupplyAlign || srMeanRev.atKeyResistance)) {
      hasFisherExtremeCurl = true;
      const baseExtreme = isSideways ? 21 : 18;
      const crossBonus = freshBearCross ? 4 : strongSnapback ? 3 : 0;
      const ema200AlignBonus = ema200Bias === 'PUT' && atrRatio >= 0.72 ? 3 : 0;
      const vpResistBonus = vpSupplyAlign ? 3 : 0;
      const srResistBonus = hasStrongResistance ? 6 : srMeanRev.atKeyResistance ? 4 : 0;
      const lowVolDiscount = isLowVolatility ? -5 : 0;
      fisherPutPts = Math.max(
        10,
        baseExtreme +
          crossBonus +
          ema200AlignBonus +
          vpResistBonus +
          srResistBonus +
          lowVolDiscount
      );
      fisherCallPts = -9;
      if (srMeanRev.atKeyResistance) {
        hasResistanceFisherConfluence = true;
        fisherSummary = `تلاقی مقاومت قوی (${srMeanRev.resistanceTouches}×) و بازگشت نزولی Fisher 5m (+${fisher.current.toFixed(2)})`;
        reasons.push(`تلاقی مقاومت قوی و بازگشت Fisher Transform (+${fisher.current.toFixed(2)})`);
      } else {
        fisherSummary = vpSupplyAlign
          ? `چرخش نزولی فیشر از اشباع خرید روی مقاومت پروفیل حجم (+${fisher.current.toFixed(2)})`
          : `چرخش تاییدشده نزولی فیشر از اشباع خرید (+${fisher.current.toFixed(2)})`;
        reasons.push(`چرخش نزولی Fisher از ناحیه اشباع خرید (+${fisher.current.toFixed(2)})`);
      }
      fisherSentiment = 'bearish';
    } else {
      // Overbought without valid reversal curl -> block/penalize CALL chasing
      fisherCallPts = fisher.current >= fisherDeepThreshold ? -13 : -8;
      fisherPutPts = isLowVolatility ? 2 : 5;
      fisherSummary = `ناحیه اشباع خرید فیشر (+${fisher.current.toFixed(2)}) — فیلتر ورود صعودی`;
      fisherSentiment = 'warning';
    }
  } else if (
    hasStrongSupport &&
    fisher.current <= -0.65 &&
    curlingUp &&
    (freshBullCross || strongSnapback || last.close > last.open)
  ) {
    // High-win-rate 5m Strong Support + Fisher curl confluence even before deep Fisher threshold
    hasFisherExtremeCurl = true;
    hasSupportFisherConfluence = true;
    fisherCallPts =
      18 +
      (srMeanRev.supportTouches >= 3 ? 3 : 0) +
      (freshBullCross ? 3 : 1) +
      (isLowVolatility ? -4 : 0);
    fisherPutPts = -6;
    fisherSummary = `هم‌گرایی حمایت قوی (${srMeanRev.supportTouches}×) و بازگشت صعودی Fisher 5m (${fisher.current.toFixed(2)})`;
    fisherSentiment = 'bullish';
    reasons.push(`تلاقی حمایت قوی و بازگشت Fisher در تایم‌فریم ۵ دقیقه (${fisher.current.toFixed(2)})`);
  } else if (
    hasStrongResistance &&
    fisher.current >= 0.65 &&
    curlingDown &&
    (freshBearCross || strongSnapback || last.close < last.open)
  ) {
    // High-win-rate 5m Strong Resistance + Bearish Fisher curl confluence
    hasFisherExtremeCurl = true;
    hasResistanceFisherConfluence = true;
    fisherPutPts =
      18 +
      (srMeanRev.resistanceTouches >= 3 ? 3 : 0) +
      (freshBearCross ? 3 : 1) +
      (isLowVolatility ? -4 : 0);
    fisherCallPts = -6;
    fisherSummary = `هم‌گرایی مقاومت قوی (${srMeanRev.resistanceTouches}×) و بازگشت نزولی Fisher 5m (+${fisher.current.toFixed(2)})`;
    fisherSentiment = 'bearish';
    reasons.push(`تلاقی مقاومت قوی و بازگشت Fisher در تایم‌فریم ۵ دقیقه (+${fisher.current.toFixed(2)})`);
  } else if (isLowVolatility || (isSideways && Math.abs(fisher.current) < 0.85)) {
    // Suppress mid-zone Fisher noise during low-ATR / flat sideways oscillations
    fisherSummary = `مومنتوم خنثی فیشر در رنج کم‌رمق (${fisher.current.toFixed(2)})`;
  } else if (curlingUp) {
    const nearObDiscount = fisher.current >= 0.9 ? -3 : 0;
    fisherCallPts = Math.max(
      4,
      (fisher.previous < -0.35 ? (macroBias === 'CALL' ? 14 : 11) : 7) + nearObDiscount
    );
    fisherSummary = `شتاب صعودی Fisher (${fisher.current.toFixed(2)})`;
    fisherSentiment = 'bullish';
    if (fisherCallPts >= 13) reasons.push(`تقاطع صعودی Fisher Transform (${fisherPeriod})`);
  } else if (curlingDown) {
    const nearOsDiscount = fisher.current <= -0.9 ? -3 : 0;
    fisherPutPts = Math.max(
      4,
      (fisher.previous > 0.35 ? (macroBias === 'PUT' ? 14 : 11) : 7) + nearOsDiscount
    );
    fisherSummary = `شتاب نزولی Fisher (${fisher.current.toFixed(2)})`;
    fisherSentiment = 'bearish';
    if (fisherPutPts >= 13) reasons.push(`تقاطع نزولی Fisher Transform (${fisherPeriod})`);
  }

  callScore += fisherCallPts;
  putScore += fisherPutPts;

  layers.push({
    id: 'fisher',
    index: 6,
    name: `مومنتوم و اشباع (Fisher ${fisherPeriod})`,
    metricLabel: `Fisher (${fisherPeriod})`,
    metricValue: `${fisher.current.toFixed(2)}${isFisherOverbought ? ' OB' : isFisherOversold ? ' OS' : ''}`,
    sentiment: fisherSentiment,
    summary: fisherSummary,
    pointsCall: fisherCallPts,
    pointsPut: fisherPutPts,
  });

  // ---------------------------------------------------------------------------
  // Layer 6: Smart Money (10-Bar Liquidity Sweep, 2-Bar Reclaim, OB & BOS)
  // ---------------------------------------------------------------------------
  let smcCallPts = 0;
  let smcPutPts = 0;
  const smcNotes: string[] = [];
  let smcTag = 'Balanced';
  let hasStrongSmcReversal = false;

  const minSweepPierce = atr14 * 0.06;
  const minWickReject = atr14 * 0.2;
  const sweepPts = isSideways ? 23 : 19;

  if (n >= 12) {
    // 1) Single-candle institutional wick sweep across 10-bar swing boundary
    for (const idx of [n - 1, n - 2]) {
      const c = candles[idx];
      const swingSlice = candles.slice(Math.max(0, idx - 10), idx);
      const swingHigh = Math.max(...swingSlice.map((x) => x.high));
      const swingLow = Math.min(...swingSlice.map((x) => x.low));
      const cRange = Math.max(c.high - c.low, 1e-10);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const upperWick = c.high - Math.max(c.open, c.close);
      const closeFromLow = (c.close - c.low) / cRange;
      const closeFromHigh = (c.high - c.close) / cRange;

      if (
        smcCallPts === 0 &&
        c.low <= swingLow - minSweepPierce &&
        c.close > swingLow &&
        lowerWick >= minWickReject &&
        closeFromLow >= 0.42
      ) {
        smcCallPts += sweepPts;
        smcTag = 'Bull Sweep';
        hasStrongSmcReversal = true;
        smcNotes.push('شکار نقدینگی معتبر کف محدوده (Bullish Sweep)');
        reasons.push('شکار نقدینگی و بازگشت فوری از کف ۱۰ کندل (Liquidity Sweep)');
      }

      if (
        smcPutPts === 0 &&
        c.high >= swingHigh + minSweepPierce &&
        c.close < swingHigh &&
        upperWick >= minWickReject &&
        closeFromHigh >= 0.42
      ) {
        smcPutPts += sweepPts;
        smcTag = 'Bear Sweep';
        hasStrongSmcReversal = true;
        smcNotes.push('شکار نقدینگی معتبر سقف محدوده (Bearish Sweep)');
        reasons.push('شکار نقدینگی و بازگشت فوری از سقف ۱۰ کندل (Liquidity Sweep)');
      }
    }

    // 2) Two-candle stop-hunt reclaim (prev pierces 10-bar swing, last closes cleanly back inside)
    if (smcCallPts === 0 || smcPutPts === 0) {
      const swingSlice2 = candles.slice(Math.max(0, n - 12), n - 2);
      const swingHigh2 = Math.max(...swingSlice2.map((x) => x.high));
      const swingLow2 = Math.min(...swingSlice2.map((x) => x.low));

      if (
        smcCallPts === 0 &&
        prev.low <= swingLow2 - minSweepPierce &&
        last.close > swingLow2 &&
        last.close > last.open
      ) {
        smcCallPts += sweepPts - 2;
        smcTag = 'Bull Reclaim';
        hasStrongSmcReversal = true;
        smcNotes.push('تله شکست کف و بازگشت ۲ کندلی (Stop-Hunt Reclaim)');
        reasons.push('تله شکست کف محدوده و بازپس‌گیری نقدینگی');
      }

      if (
        smcPutPts === 0 &&
        prev.high >= swingHigh2 + minSweepPierce &&
        last.close < swingHigh2 &&
        last.close < last.open
      ) {
        smcPutPts += sweepPts - 2;
        smcTag = 'Bear Reclaim';
        hasStrongSmcReversal = true;
        smcNotes.push('تله شکست سقف و بازگشت ۲ کندلی (Stop-Hunt Reclaim)');
        reasons.push('تله شکست سقف محدوده و بازپس‌گیری نقدینگی');
      }
    }
  }

  const scanStart = Math.max(0, n - 18);
  const obTolerance = atr14 * 0.15;
  for (let i = n - 3; i >= scanStart; i--) {
    const obCandle = candles[i];
    const disp = candles[i + 1];
    const dispBody = Math.abs(disp.close - disp.open);
    if (dispBody < atr14 * 0.85) continue;

    if (obCandle.close < obCandle.open && disp.close > disp.open && disp.close > obCandle.high) {
      if (last.low <= obCandle.high + obTolerance && last.close >= obCandle.low - obTolerance) {
        smcCallPts += 15;
        smcTag = smcTag === 'Balanced' ? 'Bull OB' : `${smcTag} + OB`;
        hasStrongSmcReversal = true;
        smcNotes.push('واکنش به اردر بلاک صعودی');
        reasons.push('واکنش به اردر بلاک معتبر صعودی (Bullish OB)');
        break;
      }
    }
    if (obCandle.close > obCandle.open && disp.close < disp.open && disp.close < obCandle.low) {
      if (last.high >= obCandle.low - obTolerance && last.close <= obCandle.high + obTolerance) {
        smcPutPts += 15;
        smcTag = smcTag === 'Balanced' ? 'Bear OB' : `${smcTag} + OB`;
        hasStrongSmcReversal = true;
        smcNotes.push('واکنش به اردر بلاک نزولی');
        reasons.push('واکنش به اردر بلاک معتبر نزولی (Bearish OB)');
        break;
      }
    }
  }

  // BOS: active only in trending markets; in sideways markets avoid fakeout breakout bias
  if (!isSideways && smcCallPts === 0 && smcPutPts === 0 && n >= 8) {
    const lookback5 = candles.slice(n - 7, n - 2);
    const swingHigh = Math.max(...lookback5.map((x) => x.high));
    const swingLow = Math.min(...lookback5.map((x) => x.low));
    if (prev.close > swingHigh || last.close > swingHigh) {
      smcCallPts = 11;
      smcTag = 'Bull BOS';
      smcNotes.push('شکست ساختار صعودی (BOS)');
    } else if (prev.close < swingLow || last.close < swingLow) {
      smcPutPts = 11;
      smcTag = 'Bear BOS';
      smcNotes.push('شکست ساختار نزولی (BOS)');
    }
  } else if (isSideways && smcCallPts === 0 && smcPutPts === 0) {
    if (srMeanRev.bullMeanRevAtSupport) {
      smcCallPts = 18;
      smcTag = 'S/R Reclaim';
      hasStrongSmcReversal = true;
      smcNotes.push(`بازگشت قوی از حمایت کلیدی (${srMeanRev.supportTouches}×)`);
    } else if (srMeanRev.bearMeanRevAtResistance) {
      smcPutPts = 18;
      smcTag = 'S/R Reject';
      hasStrongSmcReversal = true;
      smcNotes.push(`رد قیمت از مقاومت کلیدی (${srMeanRev.resistanceTouches}×)`);
    } else {
      smcTag = 'Range Hold';
      smcNotes.push('در انتظار شکار نقدینگی در سقف یا کف رنج');
    }
  } else if (isSideways) {
    // Boost Smart Money reversal score when aligned with multi-touch Key Support/Resistance
    if (smcCallPts > 0 && srMeanRev.atKeySupport) {
      smcCallPts += 4;
      smcNotes.push('تطابق با سطح کلیدی حمایت');
    }
    if (smcPutPts > 0 && srMeanRev.atKeyResistance) {
      smcPutPts += 4;
      smcNotes.push('تطابق با سطح کلیدی مقاومت');
    }
  }

  callScore += smcCallPts;
  putScore += smcPutPts;

  layers.push({
    id: 'smc',
    index: 7,
    name: 'اسمارت مانی (Sweep & Order Blocks)',
    metricLabel: 'SMC Structure',
    metricValue: smcTag,
    sentiment: smcCallPts > smcPutPts ? 'bullish' : smcPutPts > smcCallPts ? 'bearish' : 'neutral',
    summary: smcNotes.length > 0 ? smcNotes.join(' · ') : 'حفظ ساختار تعادلی نقدینگی',
    pointsCall: smcCallPts,
    pointsPut: smcPutPts,
  });

  // ---------------------------------------------------------------------------
  // Layer 7: Candlestick Patterns & Volume Profile Confluence
  // ---------------------------------------------------------------------------
  let candleCallPts = 0;
  let candlePutPts = 0;
  const candleNotes: string[] = [];
  let hasPriceActionConfirmation = false;

  const targetCandle = formingRange >= atr14 * 0.45 ? last : prev;
  const baseCandle = targetCandle === last ? prev : prev2;
  const targetRange = Math.max(0, targetCandle.high - targetCandle.low);
  const body = Math.abs(targetCandle.close - targetCandle.open);
  const upperWick = targetCandle.high - Math.max(targetCandle.open, targetCandle.close);
  const lowerWick = Math.min(targetCandle.open, targetCandle.close) - targetCandle.low;
  const baseBody = Math.abs(baseCandle.close - baseCandle.open);
  const gapTol = atr14 * 0.12;
  const volMultPts = hasVolume && relVolume >= 1.2 ? 3 : hasVolume && relVolume < 0.65 ? -3 : 0;

  const isBullishEngulfing =
    baseCandle.close < baseCandle.open &&
    targetCandle.close > targetCandle.open &&
    targetCandle.open <= baseCandle.close + gapTol &&
    targetCandle.close >= baseCandle.open - gapTol &&
    body > baseBody * 1.05;

  const isBearishEngulfing =
    baseCandle.close > baseCandle.open &&
    targetCandle.close < targetCandle.open &&
    targetCandle.open >= baseCandle.close - gapTol &&
    targetCandle.close <= baseCandle.open + gapTol &&
    body > baseBody * 1.05;

  if (isBullishEngulfing) {
    candleCallPts += Math.max(10, 16 + volMultPts);
    hasPriceActionConfirmation = true;
    candleNotes.push('اینگالفینگ صعودی');
    reasons.push('الگوی پوشای صعودی (Bullish Engulfing)');
  } else if (isBearishEngulfing) {
    candlePutPts += Math.max(10, 16 + volMultPts);
    hasPriceActionConfirmation = true;
    candleNotes.push('اینگالفینگ نزولی');
    reasons.push('الگوی پوشای نزولی (Bearish Engulfing)');
  }

  if (targetRange > 0) {
    const minBodyRef = Math.max(body, targetRange * 0.08);
    const closePosFromLow = (targetCandle.close - targetCandle.low) / targetRange;
    const closePosFromHigh = (targetCandle.high - targetCandle.close) / targetRange;

    if (
      !isBearishEngulfing &&
      lowerWick > 1.55 * minBodyRef &&
      lowerWick > upperWick * 1.4 &&
      closePosFromLow >= 0.5
    ) {
      candleCallPts += 15;
      hasPriceActionConfirmation = true;
      candleNotes.push('پین‌بار صعودی');
      reasons.push('الگوی کندلی پین‌بار صعودی (رد قیمت از کف)');
    }
    if (
      !isBullishEngulfing &&
      upperWick > 1.55 * minBodyRef &&
      upperWick > lowerWick * 1.4 &&
      closePosFromHigh >= 0.5
    ) {
      candlePutPts += 15;
      hasPriceActionConfirmation = true;
      candleNotes.push('پین‌بار نزولی');
      reasons.push('الگوی کندلی پین‌بار نزولی (رد قیمت از سقف)');
    }

    if (candleCallPts === 0 && candlePutPts === 0 && targetRange >= atr14 * 0.65) {
      const bodyRatio = body / targetRange;
      if (bodyRatio >= 0.62) {
        if (targetCandle.close > targetCandle.open) {
          candleCallPts = Math.max(6, 10 + volMultPts);
          candleNotes.push('کندل قدرت صعودی');
        } else {
          candlePutPts = Math.max(6, 10 + volMultPts);
          candleNotes.push('کندل قدرت نزولی');
        }
      }
    }
  }

  // Volume Profile (POC / VAH / VAL / LVN-HVN) adjustment for OB/OS exhaustion & rejection
  if (vp.enabled) {
    const atUpperExtreme = vp.zone === 'ABOVE_VAH' || last.high >= vp.vah - atr14 * 0.1;
    const atLowerExtreme = vp.zone === 'BELOW_VAL' || last.low <= vp.val + atr14 * 0.1;

    if (atUpperExtreme && (isFisherOverbought || rsi14 >= 63 || bbRatio >= 0.78)) {
      if (last.close < last.open || curlingDown || vp.nodeType === 'LVN') {
        candlePutPts += vp.nodeType === 'LVN' || relVolume < 1.0 ? 8 : 6;
        candleCallPts -= 7;
        candleNotes.push(
          vp.nodeType === 'LVN' ? 'کم‌حجمی بالای VAH (اشباع خرید)' : 'رد قیمت از سقف ارزش VAH'
        );
        reasons.push('پروفیل حجم: تخلیه مومنتوم صعودی بالای ناحیه ارزش (VAH)');
      } else if (relVolume < 1.15) {
        candleCallPts -= 5;
        candleNotes.push('واگرایی حجم در سقف VAH');
      }
    } else if (atLowerExtreme && (isFisherOversold || rsi14 <= 37 || bbRatio <= 0.22)) {
      if (last.close > last.open || curlingUp || vp.nodeType === 'LVN') {
        candleCallPts += vp.nodeType === 'LVN' || relVolume < 1.0 ? 8 : 6;
        candlePutPts -= 7;
        candleNotes.push(
          vp.nodeType === 'LVN' ? 'کم‌حجمی زیر VAL (اشباع فروش)' : 'حمایت در کف ارزش VAL'
        );
        reasons.push('پروفیل حجم: جذب نقدینگی و حمایت زیر ناحیه ارزش (VAL)');
      } else if (relVolume < 1.15) {
        candlePutPts -= 5;
        candleNotes.push('واگرایی حجم در کف VAL');
      }
    } else if (isSideways && Math.abs(vp.distFromPocAtr) >= 1.15) {
      if (last.close > vp.poc && curlingDown) {
        candlePutPts += 4;
        candleNotes.push('بازگشت به POC');
      } else if (last.close < vp.poc && curlingUp) {
        candleCallPts += 4;
        candleNotes.push('بازگشت به POC');
      }
    } else if (isSideways && Math.abs(vp.distFromPocAtr) < 0.2 && vp.nodeType === 'HVN') {
      atrHealthBonus -= 2;
      candleNotes.push('تعادل پرحجم روی POC');
    }
  }

  callScore += candleCallPts;
  putScore += candlePutPts;

  const vpZoneLabel = !vp.enabled
    ? candleNotes.length > 0
      ? candleNotes[0]
      : 'Neutral Bar'
    : `${vp.zone === 'ABOVE_VAH' ? 'VAH+' : vp.zone === 'BELOW_VAL' ? 'VAL-' : 'VA'} · ${vp.nodeType}`;

  layers.push({
    id: 'candles',
    index: 8,
    name: 'الگوهای کندلی و پروفیل حجم (VP)',
    metricLabel: 'Pattern / VP',
    metricValue: candleNotes.length > 0 && !vp.enabled ? candleNotes[0] : vpZoneLabel,
    sentiment:
      candleCallPts > candlePutPts
        ? 'bullish'
        : candlePutPts > candleCallPts
        ? 'bearish'
        : 'neutral',
    summary: candleNotes.length > 0 ? candleNotes.join(' · ') : 'تعادل حجم و پرایس‌اکشن در ناحیه ارزش',
    pointsCall: candleCallPts,
    pointsPut: candlePutPts,
  });

  // ---------------------------------------------------------------------------
  // Layer 8: Calibrated Confidence, OB/OS Volume Filter & Chop Protection Gate
  // ---------------------------------------------------------------------------
  const safeCall = Math.max(0, callScore);
  const safePut = Math.max(0, putScore);
  const totalScore = safeCall + safePut;
  const maxScore = Math.max(safeCall, safePut);
  const scoreDiff = Math.abs(safeCall - safePut);
  const dominance = totalScore > 0 ? scoreDiff / totalScore : 0;
  const candidateDir: 'CALL' | 'PUT' = safeCall >= safePut ? 'CALL' : 'PUT';

  const alignedLayers = layers.filter((l) =>
    candidateDir === 'CALL' ? l.pointsCall > l.pointsPut : l.pointsPut > l.pointsCall
  ).length;

  const isCounterMacroTrend =
    (macroBias === 'CALL' && candidateDir === 'PUT') ||
    (macroBias === 'PUT' && candidateDir === 'CALL');

  const isSrFisherConfluence =
    (candidateDir === 'CALL' && hasSupportFisherConfluence) ||
    (candidateDir === 'PUT' && hasResistanceFisherConfluence);

  const hasCandleBounceConfirm =
    (candidateDir === 'CALL' &&
      (last.close > last.open ||
        Math.min(last.open, last.close) - last.low >= Math.abs(last.close - last.open))) ||
    (candidateDir === 'PUT' &&
      (last.close < last.open ||
        last.high - Math.max(last.open, last.close) >= Math.abs(last.close - last.open)));

  const counterTrendConfirmed =
    !isCounterMacroTrend ||
    (hasStrongSmcReversal && hasPriceActionConfirmation) ||
    (isSrFisherConfluence && hasCandleBounceConfirm && alignedLayers >= 4);

  const hasSidewaysBoundaryEdge =
    !isSideways ||
    isSrFisherConfluence ||
    hasKeySrMeanReversion ||
    hasStrongSmcReversal ||
    hasFisherExtremeCurl ||
    Math.abs(bbCallPts - bbPutPts) >= 16;

  // Exhaustion & EMA9 Fast Alignment Guard: avoid chasing 4+ candle runs or stretched EMA21 moves
  const exhaustionBlocked =
    (candidateDir === 'CALL' && (bullStreak >= 4 || distFromEma21Atr > 2.2)) ||
    (candidateDir === 'PUT' && (bearStreak >= 4 || distFromEma21Atr < -2.2));

  // Key Support / Resistance Mean Reversion Gate:
  // Prevent entering CALL straight into Key Resistance rejection or PUT straight into Key Support bounce
  const srMeanRevBlocked =
    (candidateDir === 'CALL' &&
      srMeanRev.atKeyResistance &&
      (srMeanRev.meanZScore >= 1.35 || bbRatio >= 0.78 || srMeanRev.bearMeanRevAtResistance) &&
      !(last.close > srMeanRev.nearestResistance + atr14 * 0.22 && relVolume >= 1.5 && !isSideways)) ||
    (candidateDir === 'PUT' &&
      srMeanRev.atKeySupport &&
      (srMeanRev.meanZScore <= -1.35 || bbRatio <= 0.22 || srMeanRev.bullMeanRevAtSupport) &&
      !(last.close < srMeanRev.nearestSupport - atr14 * 0.22 && relVolume >= 1.5 && !isSideways));

  // Combined Overbought / Oversold + Volume Profile Filter
  const isObZoneConfluence =
    (isFisherOverbought && (rsi14 >= 62 || bbRatio >= 0.76)) ||
    (rsi14 >= 71 && bbRatio >= 0.86);
  const isOsZoneConfluence =
    (isFisherOversold && (rsi14 <= 38 || bbRatio <= 0.24)) ||
    (rsi14 <= 29 && bbRatio <= 0.14);

  const hasHealthyBullBreakoutVol =
    !isSideways &&
    hasVolume &&
    relVolume >= 1.45 &&
    (!vp.enabled || vp.nodeType !== 'LVN') &&
    fisher.current < fisherDeepThreshold;
  const hasHealthyBearBreakoutVol =
    !isSideways &&
    hasVolume &&
    relVolume >= 1.45 &&
    (!vp.enabled || vp.nodeType !== 'LVN') &&
    fisher.current > -fisherDeepThreshold;

  const obOsChasingBlocked =
    (candidateDir === 'CALL' &&
      isObZoneConfluence &&
      (!hasHealthyBullBreakoutVol || (vp.enabled && vp.zone === 'ABOVE_VAH' && relVolume < 1.55))) ||
    (candidateDir === 'PUT' &&
      isOsZoneConfluence &&
      (!hasHealthyBearBreakoutVol || (vp.enabled && vp.zone === 'BELOW_VAL' && relVolume < 1.55)));

  const unconfirmedObOsReversalBlocked =
    (candidateDir === 'PUT' && isFisherOverbought && !curlingDown && !hasStrongSmcReversal) ||
    (candidateDir === 'CALL' && isFisherOversold && !curlingUp && !hasStrongSmcReversal);

  // Fast EMA9 check for trend-following entries (prevents buying after short-term momentum already rolled over)
  const fastMomentumMismatch =
    !isCounterMacroTrend &&
    !isSideways &&
    ((candidateDir === 'CALL' && ema9 < ema21 * 0.9994 && last.close < ema9) ||
      (candidateDir === 'PUT' && ema9 > ema21 * 1.0006 && last.close > ema9));

  // Mid-candle anti-chasing guard: if live candle already jumped >1.15x ATR or broke >0.95x ATR against us
  const liveChasingBlocked =
    !isOfficialTrigger &&
    ((candidateDir === 'CALL' && (liveMoveAtr >= 1.15 || liveMoveAtr <= -0.95)) ||
      (candidateDir === 'PUT' && (liveMoveAtr <= -1.15 || liveMoveAtr >= 0.95)));

  const flatMagnetBlocked =
    (isFlatEma200Zone && atrRatio < 0.85 && !(hasStrongSmcReversal && hasFisherExtremeCurl)) ||
    (isLowVolatility && !hasFisherExtremeCurl && !hasStrongSmcReversal && !hasKeySrMeanReversion);

  const rsiOverboughtBlocked = rsi14 > 70;
  const rsiOversoldBlocked = rsi14 < 30;
  const rsiOutOfRangeBlocked = rsiOverboughtBlocked || rsiOversoldBlocked;
  const bbwAnomalyBlocked = bbwAnomaly.isExtremeAnomaly;

  // Ranging Mean-Reversion Calibration: compensate absent Trend Ribbon points when Mean Reversion at Key S/R aligns
  const isCleanRangingReversal =
    isSideways &&
    !volatilityBlocked &&
    !bbwAnomalyBlocked &&
    !rsiOutOfRangeBlocked &&
    !srMeanRevBlocked &&
    !obOsChasingBlocked &&
    !flatMagnetBlocked &&
    alignedLayers >= 3 &&
    (isSrFisherConfluence || hasKeySrMeanReversion || (hasStrongSmcReversal && hasFisherExtremeCurl));

  const sidewaysPrecisionBonus = isCleanRangingReversal
    ? (hasKeySrMeanReversion || isSrFisherConfluence) &&
      (hasStrongSmcReversal || hasFisherExtremeCurl)
      ? 11
      : 8
    : isSideways && hasStrongSmcReversal && hasFisherExtremeCurl
    ? 6
    : 0;

  const confluenceBonus = alignedLayers >= 4 ? 4 : alignedLayers === 3 ? 1 : -5;
  const dominanceBoost = dominance >= 0.72 ? 3 : dominance < 0.35 ? -4 : 0;

  const confidenceScoring = calcConfidenceScoringMultiplier({
    candidateDir,
    bbCallPts,
    bbPutPts,
    fisherCallPts,
    fisherPutPts,
    hasFisherExtremeCurl,
    hasKeySrMeanReversion,
    alignedLayers,
    dominance,
    bbRatio,
    fisherDelta,
  });

  const anyHardBlock =
    volatilityBlocked ||
    bbwAnomalyBlocked ||
    rsiOutOfRangeBlocked ||
    exhaustionBlocked ||
    srMeanRevBlocked ||
    obOsChasingBlocked ||
    unconfirmedObOsReversalBlocked ||
    liveChasingBlocked ||
    flatMagnetBlocked;

  const goldenConfluenceBonus = !anyHardBlock ? confidenceScoring.bonus : 0;
  const srFisherWeightBonus =
    !anyHardBlock && isSrFisherConfluence && hasCandleBounceConfirm
      ? (candidateDir === 'CALL' ? hasStrongSupport : hasStrongResistance)
        ? 6
        : 4
      : 0;

  if (confidenceScoring.isGoldenConfluence && !anyHardBlock) {
    reasons.unshift(
      `هم‌گرایی طلایی Fisher و Bollinger Bands (+${goldenConfluenceBonus}٪ ضریب اطمینان)`
    );
  }
  if (srFisherWeightBonus > 0) {
    reasons.unshift(
      candidateDir === 'CALL'
        ? `تایید هم‌گرایی حمایت قوی ۵ دقیقه‌ای و بازگشت Fisher (+${srFisherWeightBonus}٪ وزن)`
        : `تایید هم‌گرایی مقاومت قوی ۵ دقیقه‌ای و بازگشت Fisher (+${srFisherWeightBonus}٪ وزن)`
    );
  }

  const rawConfidence = Math.round(
    50 +
      maxScore * 0.4 +
      scoreDiff * 0.28 +
      dominance * 6 +
      confluenceBonus +
      dominanceBoost +
      sidewaysPrecisionBonus +
      goldenConfluenceBonus +
      srFisherWeightBonus +
      atrHealthBonus +
      session.penalty
  );

  const confidence = anyHardBlock
    ? Math.min(64, Math.max(50, rawConfidence - 8))
    : isCleanRangingReversal && counterTrendConfirmed
    ? Math.min(86, Math.max(76, rawConfidence))
    : Math.min(86, Math.max(50, rawConfidence));

  const minEdgeRequired = Math.max(
    session.minEdge,
    isCounterMacroTrend ? 19 : 14,
    isChoppyWickMarket || isLowVolatility || bbwAnomaly.isElevatedAnomaly ? 20 : 14
  );
  const minLayersRequired = Math.max(
    session.minAlignedLayers,
    isChoppyWickMarket || isLowVolatility || bbwAnomaly.isElevatedAnomaly ? 4 : 3
  );
  const minConfRequired = isSideways ? Math.max(session.minConfidence, 75) : session.minConfidence;

  const proposedDirection: QuantPrediction['direction'] =
    !anyHardBlock &&
    !fastMomentumMismatch &&
    alignedLayers >= minLayersRequired &&
    counterTrendConfirmed &&
    hasSidewaysBoundaryEdge &&
    confidence >= minConfRequired &&
    scoreDiff >= minEdgeRequired
      ? candidateDir
      : 'WAIT';

  const liveRangeAtr = Math.max(0, liveBar.high - liveBar.low) / Math.max(atr14, 1e-10);
  const thresholdResult = applyConfidenceThresholding({
    proposedDirection,
    confidence,
    minConfRequired,
    atrRatio,
    maxVolZScore,
    bbwRatio: bbwAnomaly.bbwRatio,
    bbwZScore: bbwAnomaly.bbwZScore,
    liveRangeAtr,
  });

  const direction: QuantPrediction['direction'] = thresholdResult.direction;
  if (thresholdResult.blockedByHighVolatility && thresholdResult.reason) {
    reasons.unshift(thresholdResult.reason);
  }
  const effectiveVolatilityBlocked =
    volatilityBlocked || thresholdResult.blockedByHighVolatility;

  let gateSummary = 'شرط هم‌گرایی کامل برقرار نیست — حفظ سرمایه (WAIT)';
  if (volatilityBlocked) {
    gateSummary = 'مسدودشده توسط دروازه نوسان پیشرفته ATR / StdDev';
  } else if (thresholdResult.blockedByHighVolatility) {
    gateSummary = `تغییر خودکار به WAIT توسط Confidence Thresholding (نوسان شدید خبری · اطمینان ${confidence}٪ نادیده گرفته شد)`;
  } else if (bbwAnomalyBlocked) {
    gateSummary = `مسدودشده توسط لایه تشخیص ناهنجاری BBW (${bbwAnomaly.bbwRatio.toFixed(2)}× میانگین)`;
  } else if (rsiOutOfRangeBlocked) {
    gateSummary = rsiOverboughtBlocked
      ? `مسدودشده توسط فیلتر RSI(14): اشباع خرید (${Math.round(rsi14)} > ۷۰)`
      : `مسدودشده توسط فیلتر RSI(14): اشباع فروش (${Math.round(rsi14)} < ۳۰)`;
  } else if (srMeanRevBlocked) {
    gateSummary =
      candidateDir === 'CALL'
        ? 'فیلتر بازگشت Mean Reversion: برخورد قیمت با مقاومت کلیدی'
        : 'فیلتر بازگشت Mean Reversion: برخورد قیمت با حمایت کلیدی';
  } else if (obOsChasingBlocked) {
    gateSummary =
      candidateDir === 'CALL'
        ? 'فیلتر اشباع خرید و پروفیل حجم (ریسک بازگشت در سقف VAH / Fisher OB)'
        : 'فیلتر اشباع فروش و پروفیل حجم (ریسک بازگشت در کف VAL / Fisher OS)';
  } else if (unconfirmedObOsReversalBlocked) {
    gateSummary = 'سیگنال بازگشتی اشباع خرید/فروش بدون تایید چرخش Fisher — فیلتر شد';
  } else if (flatMagnetBlocked) {
    gateSummary = 'جلوگیری از ورود کاذب در قیمت فلت / چسبندگی به EMA 200';
  } else if (exhaustionBlocked) {
    gateSummary = 'فیلتر اشباع روند (حرکت متوالی بیش از حد — ریسک برگشت میانه کندل)';
  } else if (liveChasingBlocked) {
    gateSummary = 'جهش بیش از حد قیمت در کندل جاری — جلوگیری از ورود دیرهنگام';
  } else if (fastMomentumMismatch) {
    gateSummary = 'واگرایی مومنتوم کوتاه‌مدت EMA9 با جهت روند — انتظار برای تایید';
  } else if (!counterTrendConfirmed && scoreDiff >= 12) {
    gateSummary = 'سیگنال خلاف روند بدون تایید هم‌زمان اسمارت‌مانی و پرایس‌اکشن — فیلتر شد';
  } else if (!hasSidewaysBoundaryEdge && scoreDiff >= 12) {
    gateSummary = 'در بازار رنج تنها سیگنال بازگشتی در سطوح کلیدی حمایت/مقاومت مجاز است';
  } else if (alignedLayers < minLayersRequired) {
    gateSummary = `تعداد لایه‌های هم‌سو کافی نیست (${alignedLayers} از ${minLayersRequired} لایه الزامی این سشن)`;
  } else if (direction !== 'WAIT') {
    gateSummary = confidenceScoring.isGoldenConfluence
      ? `سیگنال طلایی ${direction} (هم‌گرایی Fisher+BB +${goldenConfluenceBonus}٪ · ${alignedLayers} لایه · اطمینان ${confidence}٪)`
      : `تایید ورود ${direction} (${alignedLayers} لایه هم‌سو · خالص ${Math.round(dominance * 100)}٪ · اطمینان ${confidence}٪)`;
  } else {
    gateSummary = `ضریب اطمینان ${confidence}٪ (حداقل ${thresholdResult.effectiveThreshold}٪ و اختلاف ${minEdgeRequired} امتیاز در شرایط فعلی)`;
  }

  layers.push({
    id: 'gate',
    index: 9,
    name: 'دروازه دقت نهایی و فیلتر سشن',
    metricLabel: 'Confluence / Conf',
    metricValue: `${alignedLayers}L · ${scoreDiff}pt · ${confidence}%`,
    sentiment:
      direction === 'CALL'
        ? 'bullish'
        : direction === 'PUT'
        ? 'bearish'
        : 'warning',
    summary: gateSummary,
    pointsCall: safeCall,
    pointsPut: safePut,
  });

  return {
    assetId: asset.id,
    direction,
    confidence,
    entryPrice: liveBar.close,
    latestCandle: liveBar,
    callScore: safeCall,
    putScore: safePut,
    reasons: reasons.slice(0, 5),
    layers,
    sessionName: session.sessionName,
    isOptimalSession: session.isOptimal,
    volatilityBlocked: effectiveVolatilityBlocked,
    source,
    evaluatedAt: Date.now(),
    isOfficialTrigger,
  };
}

export interface RankedOpportunitySummary {
  best: QuantPrediction;
  rankScore: number;
  actionableCount: number;
  totalScanned: number;
}

export function scoreQuantOpportunity(pred: QuantPrediction): number {
  const isActionable = pred.direction === 'CALL' || pred.direction === 'PUT';
  const dir =
    pred.direction === 'CALL'
      ? 'CALL'
      : pred.direction === 'PUT'
      ? 'PUT'
      : pred.callScore >= pred.putScore
      ? 'CALL'
      : 'PUT';

  const edge = Math.abs(pred.callScore - pred.putScore);
  const alignedLayers = pred.layers.filter((l) =>
    dir === 'CALL' ? l.pointsCall > l.pointsPut : l.pointsPut > l.pointsCall
  ).length;

  return (
    (isActionable ? 1000 : 0) +
    (!pred.volatilityBlocked ? 150 : 0) +
    pred.confidence * 3.5 +
    edge * 1.4 +
    alignedLayers * 8 +
    (pred.source !== 'synthetic' ? 30 : 0)
  );
}

export function selectBestOpportunity(
  predictions: Partial<Record<AssetConfig['id'], QuantPrediction>>
): RankedOpportunitySummary | null {
  const list = Object.values(predictions).filter(
    (item): item is QuantPrediction => Boolean(item)
  );
  if (list.length === 0) return null;

  let best = list[0];
  let bestScore = scoreQuantOpportunity(best);
  let actionableCount = 0;

  for (const item of list) {
    if (item.direction === 'CALL' || item.direction === 'PUT') {
      actionableCount += 1;
    }
    const sc = scoreQuantOpportunity(item);
    if (sc > bestScore) {
      best = item;
      bestScore = sc;
    }
  }

  return {
    best,
    rankScore: bestScore,
    actionableCount,
    totalScanned: list.length,
  };
}
