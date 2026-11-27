import { memo, useEffect, useMemo, useRef } from 'react';
import { FIVE_MINUTES_MS } from '../constants/assets';
import { AssetConfig, Candle, QuantPrediction } from '../types/trading';

interface BezierNeonOverlayProps {
  asset: AssetConfig;
  candles: Candle[];
  prediction: QuantPrediction | null;
  remainingSeconds: number;
  mode: 'quant' | 'tradingview';
  visible: boolean;
}

interface Point2D {
  x: number;
  y: number;
}

interface CachedScene {
  width: number;
  height: number;
  p0: Point2D;
  pEnd: Point2D;
  endAngle: number;
  dx: number;
  zoneTopY: number;
  plotBottomY: number;
  splineSamples: Point2D[];
  mainPath: Path2D;
  conePath: Path2D | null;
  upperFilamentPath: Path2D | null;
  lowerFilamentPath: Path2D | null;
  horizonLines: Array<{ x: number; topY: number; bottomY: number; label: string; isLast: boolean }>;
}

const SPLINE_SAMPLE_COUNT = 48;

function computeATR14(candles: Candle[]): number {
  if (candles.length < 2) return 0;
  const slice = candles.slice(-15);
  let trSum = 0;
  for (let i = 1; i < slice.length; i++) {
    const cur = slice[i];
    const prevClose = slice[i - 1].close;
    trSum += Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prevClose),
      Math.abs(cur.low - prevClose)
    );
  }
  return trSum / Math.max(1, slice.length - 1);
}

function evalCubicBezier(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D, t: number): Point2D {
  const inv = 1 - t;
  const inv2 = inv * inv;
  const t2 = t * t;
  return {
    x: inv2 * inv * p0.x + 3 * inv2 * t * p1.x + 3 * inv * t2 * p2.x + t2 * t * p3.x,
    y: inv2 * inv * p0.y + 3 * inv2 * t * p1.y + 3 * inv * t2 * p2.y + t2 * t * p3.y,
  };
}

function evalCubicBezierTangent(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  t: number
): Point2D {
  const inv = 1 - t;
  return {
    x:
      3 * inv * inv * (p1.x - p0.x) +
      6 * inv * t * (p2.x - p1.x) +
      3 * t * t * (p3.x - p2.x),
    y:
      3 * inv * inv * (p1.y - p0.y) +
      6 * inv * t * (p2.y - p1.y) +
      3 * t * t * (p3.y - p2.y),
  };
}

function sampleLookup(samples: Point2D[], u: number): Point2D {
  const clamped = u <= 0 ? 0 : u >= 1 ? 1 : u;
  const scaled = clamped * (samples.length - 1);
  const idx = Math.floor(scaled);
  const frac = scaled - idx;
  const a = samples[idx];
  const b = samples[Math.min(samples.length - 1, idx + 1)];
  return {
    x: a.x + (b.x - a.x) * frac,
    y: a.y + (b.y - a.y) * frac,
  };
}

export const BezierNeonOverlay = memo(function BezierNeonOverlay({
  asset,
  candles,
  prediction,
  remainingSeconds,
  mode,
  visible,
}: BezierNeonOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const remainingRef = useRef<number>(remainingSeconds);
  const visibleRef = useRef<boolean>(visible);
  const masterAlphaRef = useRef<number>(visible ? 0 : 0);
  const signatureRef = useRef<string>('');
  const wakeLoopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    remainingRef.current = remainingSeconds;
  }, [remainingSeconds]);

  useEffect(() => {
    visibleRef.current = visible;
    if (visible && wakeLoopRef.current) {
      wakeLoopRef.current();
    }
  }, [visible]);

  const quantGeometry = useMemo(() => {
    if (!prediction || candles.length < 2) return null;

    const visibleCandles = candles.slice(-30);
    const last = visibleCandles[visibleCandles.length - 1];
    const atr14 = computeATR14(candles);
    const safeAtr = Math.max(atr14, last.close * asset.volatility * 0.8);

    const direction = prediction.direction;
    const confidence = prediction.confidence;
    const scoreDiff = Math.abs(prediction.callScore - prediction.putScore);

    const confNorm = Math.min(1, Math.max(0, (confidence - 50) / 36));
    const edgeNorm = Math.min(1, scoreDiff / 45);
    const intensity = Math.min(1, Math.max(0.22, confNorm * 0.65 + edgeNorm * 0.35));

    const atrLayer = prediction.layers.find((l) => l.id === 'atr');
    const atrRatio = atrLayer ? parseFloat(atrLayer.metricValue) || 1 : 1;

    const fisherLayer = prediction.layers.find((l) => l.id === 'fisher');
    const fisherVal = fisherLayer ? parseFloat(fisherLayer.metricValue) || 0 : 0;

    const open = last.close;
    const strength = 0.48 + intensity * 0.62;
    let targetClose = open;
    let projHigh = open + safeAtr * 0.22;
    let projLow = open - safeAtr * 0.22;

    if (direction === 'CALL') {
      targetClose = open + safeAtr * strength;
      projHigh = targetClose + safeAtr * 0.28;
      projLow = open - safeAtr * 0.16;
    } else if (direction === 'PUT') {
      targetClose = open - safeAtr * strength;
      projLow = targetClose - safeAtr * 0.28;
      projHigh = open + safeAtr * 0.16;
    }

    const zoneTop = projHigh + safeAtr * 0.14;
    const zoneBottom = projLow - safeAtr * 0.14;

    let minP = Infinity;
    let maxP = -Infinity;
    for (const c of visibleCandles) {
      if (c.low < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
    }
    minP = Math.min(minP, zoneBottom);
    maxP = Math.max(maxP, zoneTop);

    const span = Math.max(maxP - minP, 1e-8);
    const domainMin = minP - span * 0.12;
    const domainMax = maxP + span * 0.14;

    return {
      assetId: asset.id,
      visibleCount: visibleCandles.length,
      open,
      targetClose,
      zoneTop,
      zoneBottom,
      domainMin,
      domainMax,
      safeAtr,
      atrRatio,
      direction,
      confidence,
      intensity,
      fisherVal,
      decimals: asset.decimals,
      targetPriceLabel: targetClose.toLocaleString('en-US', {
        minimumFractionDigits: asset.decimals,
        maximumFractionDigits: asset.decimals,
      }),
      atrLabel: `ATR14: ${safeAtr.toFixed(asset.decimals)} · Intensity ${Math.round(
        intensity * 100
      )}%`,
    };
  }, [prediction, candles, asset.id, asset.volatility, asset.decimals]);

  // Smooth fade-in on asset, direction, or mode change
  useEffect(() => {
    if (!quantGeometry) return;
    const sig = `${quantGeometry.assetId}-${quantGeometry.direction}-${mode}`;
    if (signatureRef.current !== sig) {
      signatureRef.current = sig;
      if (visibleRef.current) {
        masterAlphaRef.current = Math.min(masterAlphaRef.current, 0.12);
      }
    }
  }, [quantGeometry, mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !quantGeometry) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let rafId = 0;
    let isRunning = false;
    let width = 0;
    let height = 0;
    let lastTs = performance.now();
    let cachedScene: CachedScene | null = null;
    let cachedBucket = -1;
    let cachedNextCloseStr = '';

    const buildScene = (w: number, h: number, closeLabel: string): CachedScene => {
      const {
        visibleCount,
        open,
        targetClose,
        zoneTop,
        zoneBottom,
        domainMin,
        domainMax,
        atrRatio,
        direction,
        intensity,
        fisherVal,
      } = quantGeometry;

      let startX: number;
      let endX: number;
      let plotBottomY: number;
      let priceToY: (p: number) => number;

      if (mode === 'quant') {
        const vbW = 920;
        const vbH = 470;
        const padTop = 76;
        const padBottom = 38;
        const padLeft = 18;
        const padRight = 88;
        const futureReserve = 148;
        const plotW = vbW - padLeft - padRight - futureReserve;
        const plotH = vbH - padTop - padBottom;
        const stepX = plotW / Math.max(1, visibleCount);
        const lastHistX = padLeft + (visibleCount - 0.5) * stepX;
        const projX = lastHistX + stepX * 2.15;

        startX = (lastHistX / vbW) * w;
        endX = (projX / vbW) * w;
        plotBottomY = ((vbH - padBottom) / vbH) * h;
        priceToY = (p: number) => {
          const r = (p - domainMin) / Math.max(domainMax - domainMin, 1e-10);
          const vbY = padTop + plotH - r * plotH;
          return (vbY / vbH) * h;
        };
      } else {
        const plotTop = 52;
        plotBottomY = h - 38;
        const plotHeight = Math.max(100, plotBottomY - plotTop);
        const tvRightMargin = 78;

        endX = Math.max(180, w - tvRightMargin - 28);
        startX = Math.max(90, endX - Math.min(155, w * 0.19));

        priceToY = (p: number) => {
          const r = (p - domainMin) / Math.max(domainMax - domainMin, 1e-10);
          return plotTop + plotHeight - r * plotHeight;
        };
      }

      const startY = priceToY(open);
      const endY = priceToY(targetClose);
      const zoneTopY = priceToY(zoneTop);
      const zoneBotY = priceToY(zoneBottom);

      const dx = endX - startX;
      const dy = endY - startY;
      const retestSign = direction === 'CALL' ? 1 : direction === 'PUT' ? -1 : Math.sin(fisherVal);
      const retestDepth =
        direction === 'WAIT'
          ? Math.sin(fisherVal) * 6
          : Math.min(28, Math.max(8, Math.abs(dy) * (0.24 + (1 - intensity) * 0.1))) * retestSign;

      const p0: Point2D = { x: startX, y: startY };
      const pMid: Point2D = {
        x: startX + dx * 0.42,
        y: startY + dy * 0.25 + retestDepth * 0.45,
      };
      const pEnd: Point2D = { x: endX, y: endY };

      const a1: Point2D = { x: startX + dx * 0.16, y: startY + retestDepth };
      const a2: Point2D = { x: pMid.x - dx * 0.14, y: pMid.y - dy * 0.12 };
      const b1: Point2D = { x: pMid.x + dx * 0.14, y: pMid.y + dy * 0.12 };
      const b2: Point2D = { x: endX - dx * 0.2, y: endY - dy * 0.06 };

      const mainPath = new Path2D();
      mainPath.moveTo(p0.x, p0.y);
      mainPath.bezierCurveTo(a1.x, a1.y, a2.x, a2.y, pMid.x, pMid.y);
      mainPath.bezierCurveTo(b1.x, b1.y, b2.x, b2.y, pEnd.x, pEnd.y);

      const splineSamples: Point2D[] = [];
      for (let i = 0; i <= SPLINE_SAMPLE_COUNT; i++) {
        const u = i / SPLINE_SAMPLE_COUNT;
        if (u <= 0.5) {
          splineSamples.push(evalCubicBezier(p0, a1, a2, pMid, u * 2));
        } else {
          splineSamples.push(evalCubicBezier(pMid, b1, b2, pEnd, (u - 0.5) * 2));
        }
      }

      const tan = evalCubicBezierTangent(pMid, b1, b2, pEnd, 0.98);
      const endAngle = Math.atan2(tan.y, tan.x);

      let conePath: Path2D | null = null;
      let upperFilamentPath: Path2D | null = null;
      let lowerFilamentPath: Path2D | null = null;
      const horizonLines: CachedScene['horizonLines'] = [];

      if (mode === 'tradingview') {
        const maxSpreadPx = Math.max(11, Math.abs(zoneBotY - zoneTopY) * 0.48);
        const atrMod = Math.min(1.35, Math.max(0.75, atrRatio * 0.85));
        const upperPts: Point2D[] = [];
        const lowerPts: Point2D[] = [];

        for (let i = 0; i < splineSamples.length; i++) {
          const u = i / (splineSamples.length - 1);
          const pt = splineSamples[i];
          const sp = maxSpreadPx * Math.sqrt(u) * atrMod;
          upperPts.push({ x: pt.x, y: pt.y - sp });
          lowerPts.push({ x: pt.x, y: pt.y + sp });
        }

        conePath = new Path2D();
        conePath.moveTo(upperPts[0].x, upperPts[0].y);
        for (let i = 1; i < upperPts.length; i++) conePath.lineTo(upperPts[i].x, upperPts[i].y);
        for (let i = lowerPts.length - 1; i >= 0; i--) conePath.lineTo(lowerPts[i].x, lowerPts[i].y);
        conePath.closePath();

        upperFilamentPath = new Path2D();
        upperFilamentPath.moveTo(upperPts[0].x, upperPts[0].y);
        for (let i = 1; i < upperPts.length; i++) {
          upperFilamentPath.lineTo(upperPts[i].x, upperPts[i].y);
        }

        lowerFilamentPath = new Path2D();
        lowerFilamentPath.moveTo(lowerPts[0].x, lowerPts[0].y);
        for (let i = 1; i < lowerPts.length; i++) {
          lowerFilamentPath.lineTo(lowerPts[i].x, lowerPts[i].y);
        }

        const topY = Math.min(startY, endY, zoneTopY) - 10;
        for (let m = 1; m <= 5; m++) {
          horizonLines.push({
            x: startX + dx * (m / 5),
            topY,
            bottomY: plotBottomY,
            label: m === 5 ? closeLabel : `+${m}m`,
            isLast: m === 5,
          });
        }
      }

      return {
        width: w,
        height: h,
        p0,
        pEnd,
        endAngle,
        dx,
        zoneTopY,
        plotBottomY,
        splineSamples,
        mainPath,
        conePath,
        upperFilamentPath,
        lowerFilamentPath,
        horizonLines,
      };
    };

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cachedScene = null;
    };

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(canvas);
    updateSize();

    const drawFrame = (timestamp: number) => {
      if (document.hidden && !reducedMotion) {
        lastTs = timestamp;
        rafId = requestAnimationFrame(drawFrame);
        return;
      }

      const dt = Math.min(0.05, Math.max(0.001, (timestamp - lastTs) / 1000));
      lastTs = timestamp;

      // Smooth Fade-In / Fade-Out interpolation
      const targetAlpha = visibleRef.current ? 1 : 0;
      if (reducedMotion) {
        masterAlphaRef.current = targetAlpha;
      } else {
        const fadeRate = visibleRef.current ? 4.4 : 5.4;
        masterAlphaRef.current +=
          (targetAlpha - masterAlphaRef.current) * Math.min(1, dt * fadeRate);
        if (Math.abs(targetAlpha - masterAlphaRef.current) < 0.004) {
          masterAlphaRef.current = targetAlpha;
        }
      }

      if (width <= 0 || height <= 0) {
        if (!reducedMotion && (visibleRef.current || masterAlphaRef.current > 0)) {
          rafId = requestAnimationFrame(drawFrame);
        } else {
          isRunning = false;
        }
        return;
      }

      ctx.clearRect(0, 0, width, height);

      const masterAlpha = masterAlphaRef.current;
      // Stop RAF completely when faded out to 0 for zero idle CPU usage
      if (masterAlpha <= 0.004 && !visibleRef.current) {
        isRunning = false;
        return;
      }

      const nowMs = Date.now();
      const bucket = Math.floor(nowMs / FIVE_MINUTES_MS);
      if (bucket !== cachedBucket) {
        cachedBucket = bucket;
        const nextCandleEnd = (bucket + 2) * FIVE_MINUTES_MS;
        cachedNextCloseStr = new Date(nextCandleEnd).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        });
        cachedScene = null;
      }

      if (!cachedScene || cachedScene.width !== width || cachedScene.height !== height) {
        cachedScene = buildScene(width, height, cachedNextCloseStr);
      }

      const {
        p0,
        pEnd,
        endAngle,
        plotBottomY,
        splineSamples,
        mainPath,
        conePath,
        upperFilamentPath,
        lowerFilamentPath,
        horizonLines,
      } = cachedScene;

      const {
        direction,
        confidence,
        intensity,
        targetPriceLabel,
        atrLabel,
      } = quantGeometry;

      const remSecs = Math.max(0, Math.min(299, remainingRef.current));
      const elapsedRatio = Math.min(1, Math.max(0, (300 - remSecs) / 300));
      const isTriggerWindow = remSecs <= 45;
      const isFinal15 = remSecs <= 15;

      const colors =
        direction === 'CALL'
          ? { main: '16, 185, 129', core: '167, 243, 208' }
          : direction === 'PUT'
          ? { main: '244, 63, 94', core: '254, 205, 211' }
          : { main: '245, 158, 11', core: '253, 230, 138' };

      const tSec = reducedMotion ? 0 : timestamp / 1000;
      const breathFreq = isFinal15 ? 5.2 : isTriggerWindow ? 3.6 : 2.2;
      const breathWave = reducedMotion
        ? 0.88
        : 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(tSec * breathFreq));

      const glowRadius = (10 + intensity * 22) * (isTriggerWindow ? 1.2 : 1);
      const primaryWidth = 3.2 + intensity * 2.6;
      const bloomWidth = 8 + intensity * 11;

      ctx.save();
      ctx.globalAlpha = masterAlpha;

      // 1. Cached Volatility Dispersion Cone & Horizon Lines (TradingView mode)
      if (mode === 'tradingview' && conePath && upperFilamentPath && lowerFilamentPath) {
        const coneGrad = ctx.createLinearGradient(p0.x, p0.y, pEnd.x, pEnd.y);
        coneGrad.addColorStop(0, `rgba(${colors.main}, 0.03)`);
        coneGrad.addColorStop(1, `rgba(${colors.main}, ${(0.1 + intensity * 0.1) * breathWave})`);

        ctx.fillStyle = coneGrad;
        ctx.fill(conePath);

        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = `rgba(${colors.main}, ${0.34 * breathWave})`;
        ctx.stroke(upperFilamentPath);
        ctx.stroke(lowerFilamentPath);

        ctx.font = '500 9.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.setLineDash([2, 4]);
        ctx.lineWidth = 1;
        for (const hLine of horizonLines) {
          ctx.strokeStyle = `rgba(${colors.main}, ${hLine.isLast ? 0.35 : 0.14})`;
          ctx.beginPath();
          ctx.moveTo(hLine.x, hLine.topY);
          ctx.lineTo(hLine.x, hLine.bottomY);
          ctx.stroke();

          ctx.fillStyle = hLine.isLast
            ? `rgba(${colors.core}, 0.92)`
            : 'rgba(148, 163, 184, 0.7)';
          ctx.fillText(hLine.label, hLine.x, hLine.bottomY - 6);
        }
        ctx.restore();
      }

      // 2. Wide Outer Neon Bloom Pass
      const bloomGrad = ctx.createLinearGradient(p0.x, p0.y, pEnd.x, pEnd.y);
      bloomGrad.addColorStop(0, `rgba(${colors.main}, ${0.1 * breathWave})`);
      bloomGrad.addColorStop(0.5, `rgba(${colors.main}, ${(0.22 + intensity * 0.16) * breathWave})`);
      bloomGrad.addColorStop(1, `rgba(${colors.main}, ${(0.18 + intensity * 0.12) * breathWave})`);

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = bloomGrad;
      ctx.lineWidth = bloomWidth;
      ctx.shadowColor = `rgba(${colors.main}, ${0.92 * breathWave})`;
      ctx.shadowBlur = glowRadius * 1.25;
      ctx.stroke(mainPath);

      // 3. Primary Bold Translucent Neon Trajectory Line
      const mainGrad = ctx.createLinearGradient(p0.x, p0.y, pEnd.x, pEnd.y);
      mainGrad.addColorStop(0, `rgba(${colors.main}, ${0.42 * breathWave})`);
      mainGrad.addColorStop(0.45, `rgba(${colors.main}, ${(0.72 + intensity * 0.22) * breathWave})`);
      mainGrad.addColorStop(1, `rgba(${colors.main}, ${0.78 * breathWave})`);

      ctx.strokeStyle = mainGrad;
      ctx.lineWidth = primaryWidth;
      ctx.shadowColor = `rgba(${colors.main}, 0.98)`;
      ctx.shadowBlur = glowRadius * 0.75;
      ctx.stroke(mainPath);

      // 4. Inner Animated Flowing Filament
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(${colors.core}, ${(0.78 + intensity * 0.2) * breathWave})`;
      ctx.lineWidth = 1.6 + intensity * 0.6;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -tSec * (24 + intensity * 26);
      ctx.stroke(mainPath);
      ctx.restore();

      // 5. O(1) Lookup-Sampled Neon Comet Photons
      if (!reducedMotion) {
        const particleCount = intensity >= 0.65 ? 2 : 1;
        const speed = 0.42 + intensity * 0.4;
        for (let idx = 0; idx < particleCount; idx++) {
          const u = (tSec * speed + idx * 0.5) % 1;
          const cometFade = u < 0.16 ? u / 0.16 : u > 0.84 ? (1 - u) / 0.16 : 1;

          for (let ts = 4; ts >= 1; ts--) {
            const tu = Math.max(0, u - ts * 0.025);
            const tp = sampleLookup(splineSamples, tu);
            ctx.globalAlpha = masterAlpha * cometFade * (0.28 * (1 - ts / 5));
            ctx.beginPath();
            ctx.arc(tp.x, tp.y, 3.5 - ts * 0.45, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${colors.main}, 0.9)`;
            ctx.fill();
          }

          const head = sampleLookup(splineSamples, u);
          ctx.save();
          ctx.globalAlpha = masterAlpha * cometFade;
          ctx.beginPath();
          ctx.arc(head.x, head.y, 4.4 + intensity * 1.2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${colors.core}, 1)`;
          ctx.shadowColor = `rgba(${colors.main}, 1)`;
          ctx.shadowBlur = 18;
          ctx.fill();
          ctx.restore();
        }
        ctx.globalAlpha = masterAlpha;
      }

      // 6. 5-Minute Cycle Progress Ring around Entry Anchor
      ctx.save();
      const ringRadius = 10.5;
      ctx.beginPath();
      ctx.arc(p0.x, p0.y, ringRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
      ctx.lineWidth = 2;
      ctx.stroke();

      const ringStartAngle = -Math.PI / 2;
      const ringEndAngle = ringStartAngle + elapsedRatio * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(p0.x, p0.y, ringRadius, ringStartAngle, ringEndAngle);
      ctx.strokeStyle = isFinal15
        ? 'rgba(244, 63, 94, 0.95)'
        : `rgba(${colors.core}, ${0.9 * breathWave})`;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = `rgba(${colors.main}, 0.85)`;
      ctx.shadowBlur = 9;
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(p0.x, p0.y, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${colors.core}, 0.98)`;
      ctx.fill();
      ctx.restore();

      // 7. Tangent-Aligned Neon Arrowhead
      const arrowLen = 11 + intensity * 2;
      ctx.save();
      ctx.translate(pEnd.x, pEnd.y);
      ctx.rotate(endAngle);
      ctx.beginPath();
      ctx.moveTo(4.5, 0);
      ctx.lineTo(-arrowLen, -6.2);
      ctx.lineTo(-arrowLen * 0.62, 0);
      ctx.lineTo(-arrowLen, 6.2);
      ctx.closePath();
      ctx.fillStyle = `rgba(${colors.core}, ${0.94 * breathWave})`;
      ctx.shadowColor = `rgba(${colors.main}, 1)`;
      ctx.shadowBlur = glowRadius * 0.8;
      ctx.fill();
      ctx.restore();

      // 8. Intensity & Forecast Card in TradingView Mode
      if (mode === 'tradingview') {
        const mins = Math.floor(remSecs / 60);
        const secs = remSecs % 60;
        const timerBadge = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        const labelStr =
          direction === 'WAIT'
            ? `WAIT ${confidence}% · ${timerBadge}`
            : `${direction} ${confidence}% → ${targetPriceLabel} · ${timerBadge}`;

        ctx.save();
        ctx.font = '600 11px "JetBrains Mono", monospace';
        const textWidth = ctx.measureText(labelStr).width;
        const barsW = 28;
        const boxW = textWidth + barsW + 28;
        const boxH = 26;
        const boxX = Math.min(width - boxW - 14, Math.max(14, pEnd.x - boxW / 2));
        const boxY =
          direction === 'PUT'
            ? Math.min(plotBottomY - boxH - 22, pEnd.y + 16)
            : Math.max(56, pEnd.y - boxH - 16);

        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 8);
        ctx.fillStyle = 'rgba(9, 13, 22, 0.9)';
        ctx.fill();
        ctx.strokeStyle = `rgba(${colors.main}, ${0.86 * breathWave})`;
        ctx.lineWidth = 1.3;
        ctx.shadowColor = `rgba(${colors.main}, 0.7)`;
        ctx.shadowBlur = glowRadius * 0.65;
        ctx.stroke();

        ctx.shadowBlur = 0;
        const activeBars = Math.max(1, Math.round(intensity * 4));
        for (let b = 0; b < 4; b++) {
          const bh = 4 + b * 2.5;
          const bx = boxX + 10 + b * 5;
          const by = boxY + boxH - 6 - bh;
          ctx.fillStyle =
            b < activeBars ? `rgba(${colors.core}, 0.95)` : 'rgba(148, 163, 184, 0.25)';
          ctx.fillRect(bx, by, 3, bh);
        }

        ctx.fillStyle = `rgba(${colors.core}, 0.98)`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelStr, boxX + barsW + 14, boxY + boxH / 2 + 0.5);

        ctx.font = '500 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.88)';
        ctx.fillText(atrLabel, boxX + boxW / 2, boxY + boxH + 11);
        ctx.restore();
      }

      ctx.restore(); // restore masterAlpha

      if (!reducedMotion) {
        rafId = requestAnimationFrame(drawFrame);
      } else {
        isRunning = false;
      }
    };

    const startLoop = () => {
      if (isRunning) return;
      isRunning = true;
      lastTs = performance.now();
      rafId = requestAnimationFrame(drawFrame);
    };

    wakeLoopRef.current = startLoop;
    startLoop();

    return () => {
      wakeLoopRef.current = null;
      isRunning = false;
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, [quantGeometry, mode]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 h-full w-full"
    />
  );
});
