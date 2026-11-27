import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BarChart3, Eye, EyeOff, TrendingUp } from 'lucide-react';
import { AssetConfig, Candle, QuantPrediction } from '../types/trading';
import { BezierNeonOverlay } from './BezierNeonOverlay';
import { QuantPredictionChart } from './QuantPredictionChart';

interface TradingViewChartProps {
  asset: AssetConfig;
  candles: Candle[];
  liveCandle?: Candle;
  prediction: QuantPrediction | null;
  remainingSeconds: number;
}

type ChartMode = 'quant' | 'tradingview';

export function TradingViewChart({
  asset,
  candles,
  liveCandle,
  prediction,
  remainingSeconds,
}: TradingViewChartProps) {
  const [chartMode, setChartMode] = useState<ChartMode>('quant');
  const [showNeonOverlay, setShowNeonOverlay] = useState<boolean>(true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [widgetError, setWidgetError] = useState(false);

  // Merge live WebSocket candle once at parent level so both SVG chart and Canvas overlay share identical candle arrays
  const mergedCandles = useMemo(() => {
    if (candles.length === 0) return [];
    if (!liveCandle) return candles;
    const copy = candles.slice();
    const last = copy[copy.length - 1];
    if (liveCandle.time === last.time) {
      copy[copy.length - 1] = liveCandle;
    } else if (liveCandle.time > last.time) {
      copy.push(liveCandle);
    }
    return copy;
  }, [candles, liveCandle]);

  useEffect(() => {
    if (chartMode !== 'tradingview') return;
    const container = containerRef.current;
    if (!container) return;

    setWidgetError(false);
    container.innerHTML = '';

    const widgetHost = document.createElement('div');
    widgetHost.className = 'tradingview-widget-container__widget h-full w-full';
    container.appendChild(widgetHost);

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.onerror = () => setWidgetError(true);
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: asset.tvSymbol,
      interval: '5',
      timezone: 'Asia/Tehran',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: '#090D16',
      gridColor: 'rgba(30, 41, 59, 0.55)',
      allow_symbol_change: false,
      calendar: false,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      save_image: false,
      withdateranges: true,
      support_host: 'https://www.tradingview.com',
    });

    container.appendChild(script);

    return () => {
      container.innerHTML = '';
    };
  }, [asset.tvSymbol, chartMode]);

  return (
    <section
      aria-label={`نمودار زنده و پیش‌بینی ۵ دقیقه‌ای ${asset.label}`}
      className="flex h-[460px] flex-col overflow-hidden rounded-xl border border-[#1E293B] bg-[#111827]/80 backdrop-blur-md lg:h-full lg:min-h-[560px]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E293B] px-4 py-2">
        <div className="flex items-center gap-2 text-xs text-slate-300">
          {chartMode === 'quant' ? (
            <TrendingUp className="h-4 w-4 text-emerald-400" />
          ) : (
            <BarChart3 className="h-4 w-4 text-emerald-400" />
          )}
          <span className="font-medium">
            {chartMode === 'quant' ? 'نمودار پیش‌بینی کندل بعدی' : 'نمودار زنده TradingView'}
          </span>
          <span className="text-slate-600" aria-hidden="true">
            ·
          </span>
          <span dir="ltr" className="font-mono text-slate-400">
            {asset.label} · 5m
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Neon Canvas Trajectory Overlay Toggle */}
          <button
            type="button"
            onClick={() => setShowNeonOverlay((prev) => !prev)}
            aria-pressed={showNeonOverlay}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
              showNeonOverlay
                ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-300'
                : 'border-[#1E293B] bg-[#090D16] text-slate-400 hover:text-slate-200'
            }`}
          >
            {showNeonOverlay ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
            <span>مسیر نئون</span>
          </button>

          {/* Chart Mode Switcher */}
          <div className="flex items-center gap-1 rounded-lg border border-[#1E293B] bg-[#090D16] p-0.5">
            <button
              type="button"
              onClick={() => setChartMode('quant')}
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                chartMode === 'quant'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className="h-3 w-3" />
              <span>پیش‌بینی روی چارت</span>
            </button>
            <button
              type="button"
              onClick={() => setChartMode('tradingview')}
              className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                chartMode === 'tradingview'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              TradingView
            </button>
          </div>
        </div>
      </div>

      <div className="relative flex-1 bg-[#090D16]">
        {chartMode === 'quant' ? (
          <QuantPredictionChart
            asset={asset}
            candles={mergedCandles}
            prediction={prediction}
            remainingSeconds={remainingSeconds}
          />
        ) : widgetError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-400">
            <BarChart3 className="h-8 w-8 text-slate-500" />
            <p>امکان بارگذاری ویجت TradingView در این شبکه وجود ندارد.</p>
          </div>
        ) : (
          <div
            ref={containerRef}
            key={asset.tvSymbol}
            className="tradingview-widget-container h-full w-full"
          />
        )}

        {/* Optimized Canvas Overlay rendering smooth Bézier trajectory with Neon Glow & Fade-in/out */}
        <BezierNeonOverlay
          asset={asset}
          candles={mergedCandles}
          prediction={prediction}
          remainingSeconds={remainingSeconds}
          mode={chartMode}
          visible={showNeonOverlay}
        />
      </div>
    </section>
  );
}
