import { useMemo, useRef, useState } from 'react';
import { Clock, Crosshair, Layers, Target, TrendingDown, TrendingUp } from 'lucide-react';
import { AssetConfig, Candle, QuantPrediction } from '../types/trading';

interface QuantPredictionChartProps {
  asset: AssetConfig;
  candles: Candle[];
  prediction: QuantPrediction | null;
  remainingSeconds: number;
}

function computeBollingerSeries(candles: Candle[], period = 20, mult = 2.2) {
  return candles.map((_, idx) => {
    const start = Math.max(0, idx - period + 1);
    const slice = candles.slice(start, idx + 1);
    const mean = slice.reduce((acc, c) => acc + c.close, 0) / slice.length;
    const variance =
      slice.reduce((acc, c) => acc + Math.pow(c.close - mean, 2), 0) / slice.length;
    const std = Math.sqrt(variance);
    return {
      basis: mean,
      upper: mean + mult * std,
      lower: mean - mult * std,
    };
  });
}

function computeATR14Value(candles: Candle[]): number {
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

export function QuantPredictionChart({
  asset,
  candles,
  prediction,
  remainingSeconds,
}: QuantPredictionChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const visibleCount = 30;
  const bbAll = useMemo(() => computeBollingerSeries(candles, 20, 2.2), [candles]);
  const atr14 = useMemo(() => computeATR14Value(candles), [candles]);

  const visibleCandles = useMemo(() => candles.slice(-visibleCount), [candles]);
  const visibleBB = useMemo(() => bbAll.slice(-visibleCount), [bbAll]);

  const width = 920;
  const height = 470;
  const padTop = 76;
  const padBottom = 38;
  const padLeft = 18;
  const padRight = 88;
  const futureReserve = 148;

  const plotWidth = width - padLeft - padRight - futureReserve;
  const plotHeight = height - padTop - padBottom;

  const lastCandle = visibleCandles[visibleCandles.length - 1];
  const direction = prediction?.direction ?? 'WAIT';
  const confidence = prediction?.confidence ?? 50;

  // Projected Next Candle Geometry
  const projected = useMemo(() => {
    if (!lastCandle) return null;
    const safeAtr = Math.max(atr14, lastCandle.close * asset.volatility * 0.8);
    const open = lastCandle.close;
    const strength = 0.5 + Math.max(0, confidence - 50) / 80;

    if (direction === 'CALL') {
      const close = open + safeAtr * strength;
      const high = close + safeAtr * 0.28;
      const low = open - safeAtr * 0.16;
      const zoneTop = high + safeAtr * 0.14;
      const zoneBottom = low - safeAtr * 0.08;
      return { open, close, high, low, zoneTop, zoneBottom };
    }
    if (direction === 'PUT') {
      const close = open - safeAtr * strength;
      const low = close - safeAtr * 0.28;
      const high = open + safeAtr * 0.16;
      const zoneTop = high + safeAtr * 0.08;
      const zoneBottom = low - safeAtr * 0.14;
      return { open, close, high, low, zoneTop, zoneBottom };
    }
    const half = safeAtr * 0.22;
    return {
      open,
      close: open,
      high: open + half,
      low: open - half,
      zoneTop: open + half * 1.45,
      zoneBottom: open - half * 1.45,
    };
  }, [lastCandle, atr14, asset.volatility, direction, confidence]);

  const { minPrice, maxPrice } = useMemo(() => {
    if (visibleCandles.length === 0) return { minPrice: 0, maxPrice: 1 };
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < visibleCandles.length; i++) {
      const c = visibleCandles[i];
      const b = visibleBB[i];
      lo = Math.min(lo, c.low, b ? b.lower : c.low);
      hi = Math.max(hi, c.high, b ? b.upper : c.high);
    }
    if (projected) {
      lo = Math.min(lo, projected.zoneBottom);
      hi = Math.max(hi, projected.zoneTop);
    }
    const span = Math.max(hi - lo, 1e-8);
    return {
      minPrice: lo - span * 0.08,
      maxPrice: hi + span * 0.1,
    };
  }, [visibleCandles, visibleBB, projected]);

  const priceToY = (p: number) => {
    const ratio = (p - minPrice) / Math.max(maxPrice - minPrice, 1e-10);
    return padTop + plotHeight - ratio * plotHeight;
  };

  const stepX = visibleCandles.length > 0 ? plotWidth / visibleCandles.length : 20;
  const candleWidth = Math.max(7, Math.min(18, stepX * 0.62));
  const indexToX = (idx: number) => padLeft + (idx + 0.5) * stepX;

  const lastHistX =
    visibleCandles.length > 0 ? indexToX(visibleCandles.length - 1) : padLeft + plotWidth;
  const projectedCenterX = lastHistX + stepX * 2.15;

  const formatNum = (val: number) =>
    val.toLocaleString('en-US', {
      minimumFractionDigits: asset.decimals,
      maximumFractionDigits: asset.decimals,
    });

  const bbUpperPath = visibleBB
    .map((b, i) => `${i === 0 ? 'M' : 'L'} ${indexToX(i).toFixed(1)} ${priceToY(b.upper).toFixed(1)}`)
    .join(' ');
  const bbLowerPath = visibleBB
    .map((b, i) => `${i === 0 ? 'M' : 'L'} ${indexToX(i).toFixed(1)} ${priceToY(b.lower).toFixed(1)}`)
    .join(' ');
  const bbBasisPath = visibleBB
    .map((b, i) => `${i === 0 ? 'M' : 'L'} ${indexToX(i).toFixed(1)} ${priceToY(b.basis).toFixed(1)}`)
    .join(' ');

  const bbAreaPath =
    visibleBB.length > 1
      ? `${bbUpperPath} ${visibleBB
          .slice()
          .reverse()
          .map(
            (b, revI) =>
              `L ${indexToX(visibleBB.length - 1 - revI).toFixed(1)} ${priceToY(b.lower).toFixed(1)}`
          )
          .join(' ')} Z`
      : '';

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => minPrice + (maxPrice - minPrice) * t);

  const clampedSecs = Math.max(0, Math.min(299, remainingSeconds));
  const timerStr = `${String(Math.floor(clampedSecs / 60)).padStart(2, '0')}:${String(
    clampedSecs % 60
  ).padStart(2, '0')}`;

  const projColor =
    direction === 'CALL'
      ? '#10B981'
      : direction === 'PUT'
      ? '#F43F5E'
      : '#F59E0B';

  const hoveredCandle = hoverIdx !== null ? visibleCandles[hoverIdx] : null;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || visibleCandles.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const idx = Math.floor((relX - padLeft) / stepX);
    if (idx >= 0 && idx < visibleCandles.length) {
      setHoverIdx(idx);
    } else {
      setHoverIdx(null);
    }
  };

  if (visibleCandles.length === 0 || !lastCandle || !projected) {
    return (
      <div className="flex h-full items-center justify-center bg-[#090D16] text-xs text-slate-400">
        در حال بارگذاری کندل‌های زنده...
      </div>
    );
  }

  const liveY = priceToY(lastCandle.close);
  const isLiveBull = lastCandle.close >= lastCandle.open;
  const projOpenY = priceToY(projected.open);
  const projCloseY = priceToY(projected.close);
  const projHighY = priceToY(projected.high);
  const projLowY = priceToY(projected.low);
  const projBodyTop = Math.min(projOpenY, projCloseY);
  const projBodyHeight = Math.max(5, Math.abs(projCloseY - projOpenY));
  const zoneTopY = priceToY(projected.zoneTop);
  const zoneBottomY = priceToY(projected.zoneBottom);

  const projCandleW = candleWidth + 4;
  const zoneLeftX = projectedCenterX - 42;
  const zoneWidth = 84;
  const projectedAnchorY = Math.min(projHighY, zoneTopY) - 6;

  const projPctDelta =
    projected.open > 0 ? ((projected.close - projected.open) / projected.open) * 100 : 0;

  // Position floating HTML callout card above the projected candle in chart-relative %
  const calloutRightPct = Math.max(
    11,
    Math.min(28, ((width - projectedCenterX) / width) * 100 - 4)
  );

  // Build curved SVG probability cone from live close to projected ATR zone
  const conePath = `M ${lastHistX.toFixed(1)} ${liveY.toFixed(1)} L ${zoneLeftX.toFixed(
    1
  )} ${zoneTopY.toFixed(1)} L ${(zoneLeftX + zoneWidth).toFixed(1)} ${zoneTopY.toFixed(
    1
  )} L ${(zoneLeftX + zoneWidth).toFixed(1)} ${zoneBottomY.toFixed(1)} L ${zoneLeftX.toFixed(
    1
  )} ${zoneBottomY.toFixed(1)} Z`;

  return (
    <div dir="ltr" className="relative h-full w-full select-none overflow-hidden bg-[#090D16]">
      {/* Top-Left Live Inspector Strip */}
      <div className="pointer-events-none absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2.5 rounded-lg border border-[#1E293B] bg-[#090D16]/90 px-3 py-1.5 font-mono text-[11px] backdrop-blur-md">
        <Crosshair className="h-3.5 w-3.5 text-slate-400" />
        <span className="font-semibold text-slate-200">{asset.label} · 5m</span>
        <span className="text-slate-600" aria-hidden="true">
          |
        </span>
        {hoveredCandle ? (
          <>
            <span className="text-slate-400">
              {new Date(hoveredCandle.time).toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span className="text-slate-400">
              O <span className="text-slate-200">{formatNum(hoveredCandle.open)}</span>
            </span>
            <span className="text-slate-400">
              H <span className="text-emerald-400">{formatNum(hoveredCandle.high)}</span>
            </span>
            <span className="text-slate-400">
              L <span className="text-rose-400">{formatNum(hoveredCandle.low)}</span>
            </span>
            <span className="text-slate-400">
              C <span className="text-slate-100">{formatNum(hoveredCandle.close)}</span>
            </span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-blue-400/90">
            <Layers className="h-3.5 w-3.5" />
            <span>BB (20, 2.2)</span>
            <span className="text-slate-600">·</span>
            <Target className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-slate-300">Target {formatNum(projected.close)}</span>
          </span>
        )}
      </div>

      {/* Top-Right Countdown Overlay */}
      <div
        className={`pointer-events-none absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-xs font-semibold tabular-nums backdrop-blur-md ${
          clampedSecs <= 15
            ? 'animate-pulse border-rose-500/60 bg-rose-950/75 text-rose-300'
            : 'border-[#1E293B] bg-[#111827]/90 text-amber-300'
        }`}
      >
        <Clock className="h-3.5 w-3.5" />
        <span>{timerStr}</span>
      </div>

      {/* Professional Projected Candle Callout Badge (HTML overlay with Lucide icons) */}
      <div
        dir="rtl"
        style={{ right: `${calloutRightPct}%`, top: '12px' }}
        className={`pointer-events-none absolute z-10 flex items-center gap-2 rounded-xl border px-3 py-1.5 shadow-lg backdrop-blur-md ${
          direction === 'CALL'
            ? 'border-emerald-500/55 bg-emerald-950/85 text-emerald-50 shadow-emerald-950/50'
            : direction === 'PUT'
            ? 'border-rose-500/55 bg-rose-950/85 text-rose-50 shadow-rose-950/50'
            : 'border-amber-500/50 bg-amber-950/80 text-amber-50 shadow-amber-950/50'
        }`}
      >
        <div
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
            direction === 'CALL'
              ? 'bg-emerald-500/20 text-emerald-400'
              : direction === 'PUT'
              ? 'bg-rose-500/20 text-rose-400'
              : 'bg-amber-500/20 text-amber-400'
          }`}
        >
          {direction === 'CALL' ? (
            <TrendingUp className="h-3.5 w-3.5" />
          ) : direction === 'PUT' ? (
            <TrendingDown className="h-3.5 w-3.5" />
          ) : (
            <Clock className="h-3.5 w-3.5" />
          )}
        </div>

        <div className="flex flex-col leading-tight">
          <div className="flex items-center gap-1.5 text-[11px] font-bold">
            <span>
              {direction === 'CALL'
                ? 'صعودی (CALL)'
                : direction === 'PUT'
                ? 'نزولی (PUT)'
                : 'خنثی (WAIT)'}
            </span>
            <span dir="ltr" className="font-mono text-xs tabular-nums">
              {confidence}%
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-300">
            <span>کندل پیش‌بینی‌شده</span>
            {direction !== 'WAIT' && (
              <span
                dir="ltr"
                className={`font-mono tabular-nums ${
                  direction === 'CALL' ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                ({projPctDelta >= 0 ? `+${projPctDelta.toFixed(2)}%` : `${projPctDelta.toFixed(2)}%`})
              </span>
            )}
          </div>
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
        className="h-full w-full"
      >
        <defs>
          <filter id="liveCandleGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="projectedCandleGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <linearGradient id="projCallGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10B981" stopOpacity="0.52" />
            <stop offset="100%" stopColor="#10B981" stopOpacity="0.14" />
          </linearGradient>

          <linearGradient id="projPutGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F43F5E" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#F43F5E" stopOpacity="0.52" />
          </linearGradient>

          <linearGradient id="projWaitGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.12" />
          </linearGradient>

          <linearGradient id="projConeGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={projColor} stopOpacity="0.14" />
            <stop offset="100%" stopColor={projColor} stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {/* Horizontal Gridlines & Y-Axis Ticks */}
        {yTicks.map((tick, idx) => {
          const y = priceToY(tick);
          return (
            <g key={idx}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="rgba(30, 41, 59, 0.55)"
                strokeWidth="1"
              />
              <text
                x={width - padRight + 8}
                y={y + 4}
                fill="#94A3B8"
                fontSize="11"
                fontFamily="JetBrains Mono, monospace"
              >
                {formatNum(tick)}
              </text>
            </g>
          );
        })}

        {/* Vertical Divider separating Real-Time Market from Projected Future Bar */}
        <line
          x1={lastHistX + stepX * 0.9}
          y1={padTop}
          x2={lastHistX + stepX * 0.9}
          y2={height - padBottom}
          stroke="rgba(148, 163, 184, 0.16)"
          strokeDasharray="2 4"
          strokeWidth="1"
        />

        {/* X-Axis Timestamps */}
        {visibleCandles.map((c, idx) => {
          if (idx % 6 !== 0 && idx !== visibleCandles.length - 1) return null;
          const x = indexToX(idx);
          const timeLabel = new Date(c.time).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
          });
          return (
            <g key={c.time}>
              <line
                x1={x}
                y1={padTop}
                x2={x}
                y2={height - padBottom}
                stroke="rgba(30, 41, 59, 0.35)"
                strokeWidth="1"
              />
              <text
                x={x}
                y={height - 14}
                textAnchor="middle"
                fill="#64748B"
                fontSize="10.5"
                fontFamily="JetBrains Mono, monospace"
              >
                {timeLabel}
              </text>
            </g>
          );
        })}

        {/* Bollinger Band Channel */}
        {bbAreaPath && <path d={bbAreaPath} fill="rgba(59, 130, 246, 0.08)" />}
        {bbBasisPath && (
          <path
            d={bbBasisPath}
            fill="none"
            stroke="rgba(59, 130, 246, 0.35)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}
        {bbUpperPath && (
          <path d={bbUpperPath} fill="none" stroke="rgba(59, 130, 246, 0.72)" strokeWidth="1.35" />
        )}
        {bbLowerPath && (
          <path d={bbLowerPath} fill="none" stroke="rgba(59, 130, 246, 0.72)" strokeWidth="1.35" />
        )}

        {/* Historical & Live Candles */}
        {visibleCandles.map((c, idx) => {
          const x = indexToX(idx);
          const isBull = c.close >= c.open;
          const color = isBull ? '#10B981' : '#F43F5E';
          const yHigh = priceToY(c.high);
          const yLow = priceToY(c.low);
          const yOpen = priceToY(c.open);
          const yClose = priceToY(c.close);
          const bodyTop = Math.min(yOpen, yClose);
          const bodyHeight = Math.max(2, Math.abs(yClose - yOpen));
          const isLive = idx === visibleCandles.length - 1;

          return (
            <g key={c.time} filter={isLive ? 'url(#liveCandleGlow)' : undefined}>
              <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth="1.6" />
              <rect
                x={x - candleWidth / 2}
                y={bodyTop}
                width={candleWidth}
                height={bodyHeight}
                rx="1.5"
                fill={color}
              />
            </g>
          );
        })}

        {/* Crosshair on Hover */}
        {hoverIdx !== null && visibleCandles[hoverIdx] && (
          <g>
            <line
              x1={indexToX(hoverIdx)}
              y1={padTop}
              x2={indexToX(hoverIdx)}
              y2={height - padBottom}
              stroke="rgba(148, 163, 184, 0.4)"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
            <line
              x1={padLeft}
              y1={priceToY(visibleCandles[hoverIdx].close)}
              x2={width - padRight}
              y2={priceToY(visibleCandles[hoverIdx].close)}
              stroke="rgba(148, 163, 184, 0.35)"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
          </g>
        )}

        {/* ================================================================= */}
        {/* PROJECTED NEXT CANDLE & CONFIDENCE CONE                           */}
        {/* ================================================================= */}
        <g>
          {/* Probability Fan Cone radiating from Live Close to ATR Target Zone */}
          <path d={conePath} fill="url(#projConeGrad)" />

          {/* Target Box Envelope */}
          <rect
            x={zoneLeftX}
            y={zoneTopY}
            width={zoneWidth}
            height={Math.max(14, zoneBottomY - zoneTopY)}
            rx="6"
            fill="rgba(9, 13, 22, 0.25)"
            stroke={projColor}
            strokeWidth="0.9"
            strokeDasharray="4 4"
            opacity="0.65"
          />

          {/* Trajectory Line from Live Close to Projected Close */}
          <line
            x1={lastHistX}
            y1={liveY}
            x2={projectedCenterX}
            y2={projCloseY}
            stroke={projColor}
            strokeWidth="1.75"
            strokeDasharray="4 3"
            opacity="0.85"
          />

          {/* Projected Close Target Horizontal Guide to Y-Axis */}
          {direction !== 'WAIT' && (
            <>
              <line
                x1={projectedCenterX}
                y1={projCloseY}
                x2={width - padRight}
                y2={projCloseY}
                stroke={projColor}
                strokeWidth="1"
                strokeDasharray="2 3"
                opacity="0.7"
              />
              <g transform={`translate(${width - padRight + 2}, ${projCloseY - 10})`}>
                <rect
                  width={padRight - 6}
                  height={20}
                  rx="4"
                  fill="#090D16"
                  stroke={projColor}
                  strokeWidth="1.1"
                />
                <text
                  x={(padRight - 6) / 2}
                  y={13.5}
                  textAnchor="middle"
                  fill={projColor}
                  fontSize="10.5"
                  fontWeight="600"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {formatNum(projected.close)}
                </text>
              </g>
            </>
          )}

          {/* Projected Ghost Candlestick with Gradient Fill & Soft Glow */}
          <g filter="url(#projectedCandleGlow)">
            <line
              x1={projectedCenterX}
              y1={projHighY}
              x2={projectedCenterX}
              y2={projLowY}
              stroke={projColor}
              strokeWidth="1.8"
              strokeDasharray="3 2.5"
            />
            <rect
              x={projectedCenterX - projCandleW / 2}
              y={projBodyTop}
              width={projCandleW}
              height={projBodyHeight}
              rx="2.5"
              fill={
                direction === 'CALL'
                  ? 'url(#projCallGrad)'
                  : direction === 'PUT'
                  ? 'url(#projPutGrad)'
                  : 'url(#projWaitGrad)'
              }
              stroke={projColor}
              strokeWidth="1.75"
              strokeDasharray="4 2.5"
            />
          </g>

          {/* Entry Anchor Pulse Dot & Target Dot */}
          <circle cx={lastHistX} cy={liveY} r="3.5" fill={isLiveBull ? '#10B981' : '#F43F5E'} />
          <circle cx={projectedCenterX} cy={projCloseY} r="3.5" fill={projColor} />

          {/* Vertical Connector from Projected Candle Up to Callout Card */}
          <line
            x1={projectedCenterX}
            y1={projectedAnchorY}
            x2={projectedCenterX}
            y2={58}
            stroke={projColor}
            strokeWidth="1.25"
            strokeDasharray="3 3"
            opacity="0.85"
          />
          <circle cx={projectedCenterX} cy={projectedAnchorY} r="3" fill={projColor} />

          {/* X-Axis label under projected candle */}
          <text
            x={projectedCenterX}
            y={height - 14}
            textAnchor="middle"
            fill={projColor}
            fontSize="10.5"
            fontWeight="600"
            fontFamily="Vazirmatn, sans-serif"
          >
            کندل بعدی (+5m)
          </text>
        </g>

        {/* Live Price Horizontal Dashed Line & Y-Axis Badge (drawn last so always crisp on top) */}
        <line
          x1={padLeft}
          y1={liveY}
          x2={width - padRight}
          y2={liveY}
          stroke={isLiveBull ? '#10B981' : '#F43F5E'}
          strokeWidth="1.2"
          strokeDasharray="4 4"
          opacity="0.85"
        />
        <g transform={`translate(${width - padRight + 2}, ${liveY - 11})`}>
          <rect
            width={padRight - 6}
            height={22}
            rx="4"
            fill={isLiveBull ? '#10B981' : '#F43F5E'}
          />
          <text
            x={(padRight - 6) / 2}
            y={15}
            textAnchor="middle"
            fill="#090D16"
            fontSize="11"
            fontWeight="700"
            fontFamily="JetBrains Mono, monospace"
          >
            {formatNum(lastCandle.close)}
          </text>
        </g>
      </svg>
    </div>
  );
}
