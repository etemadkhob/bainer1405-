import { useState } from 'react';
import {
  BookmarkPlus,
  ChevronDown,
  Clock,
  Gauge,
  Layers,
  Lock,
  RefreshCw,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { AssetConfig, Candle, MarketDataSource } from '../types/trading';
import type { DecisionOutcome } from '../engine/gatekeeper';
import type { BacktestResult } from '../engine/gatekeeper';
import { brokerDeviationTooWide, isPriceInZone } from '../engine/filters';

interface SignalCardProps {
  asset: AssetConfig;
  prediction: DecisionOutcome | null;
  livePrice?: number;
  liveCandle?: Candle;
  loading: boolean;
  backtest?: BacktestResult;
  onManualAnalyze: () => void;
  onRecordSignal: (prediction: DecisionOutcome) => void;
}

const SOURCE_LABELS: Record<MarketDataSource, string> = {
  binance_ws: 'بایننس زنده (WebSocket)',
  binance_vision: 'بایننس آنلاین (Vision)',
  binance: 'بایننس اسپات (زنده)',
  okx: 'اوکی‌ایکس (پشتیبان)',
  bybit: 'بای‌بیت (پشتیبان)',
  yahoo_fx: 'نرخ زنده فارکس (Yahoo FX)',
  cryptocompare: 'کریپتوکامپر (پشتیبان)',
  synthetic: 'شبیه‌ساز آفلاین',
};

export function SignalCard({
  asset,
  prediction,
  livePrice,
  liveCandle,
  loading,
  backtest,
  onManualAnalyze,
  onRecordSignal,
}: SignalCardProps) {
  const [showLayers, setShowLayers] = useState(false);
  const [brokerPrice, setBrokerPrice] = useState('');

  if (!prediction) {
    return (
      <section className="flex flex-1 flex-col justify-between rounded-xl border border-[#1E293B] bg-[#111827]/80 p-5 backdrop-blur-md">
        <div className="space-y-4">
          <div className="h-5 w-36 animate-pulse rounded bg-slate-800" />
          <div className="h-20 w-full animate-pulse rounded-lg bg-slate-800/80" />
          <div className="h-12 w-full animate-pulse rounded-lg bg-slate-800/70" />
          <div className="space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-slate-800/60" />
            <div className="h-4 w-4/5 animate-pulse rounded bg-slate-800/60" />
          </div>
        </div>
      </section>
    );
  }

  const isCall = prediction.direction === 'CALL';
  const isPut = prediction.direction === 'PUT';

  const cardAccent = isCall
    ? 'border-emerald-500/40 bg-[#111827]/85'
    : isPut
    ? 'border-rose-500/40 bg-[#111827]/85'
    : 'border-amber-500/35 bg-[#111827]/85';

  const directionColor = isCall
    ? 'text-emerald-400'
    : isPut
    ? 'text-rose-400'
    : 'text-amber-400';

  const meterBg = isCall
    ? 'bg-emerald-500'
    : isPut
    ? 'bg-rose-500'
    : 'bg-amber-500';

  const formatNum = (val: number) =>
    val.toLocaleString('en-US', {
      minimumFractionDigits: asset.decimals,
      maximumFractionDigits: asset.decimals,
    });

  const displayPrice = livePrice ?? prediction.entryPrice;
  const c = liveCandle ?? prediction.latestCandle;

  return (
    <section
      aria-label="کارت سیگنال کوانت"
      className={`flex flex-1 flex-col justify-between rounded-xl border p-5 backdrop-blur-md transition-colors ${cardAccent}`}
    >
      <div>
        {/* Kicker metadata row */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-200">{asset.label}</span>
            <span aria-hidden="true">·</span>
            <span
              className={
                prediction.source === 'synthetic' ? 'text-amber-400' : 'text-emerald-400/90'
              }
            >
              {SOURCE_LABELS[prediction.source]}
            </span>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-300">
            <Lock className="h-3 w-3 text-slate-400" />
            {prediction.isOfficialTrigger ? 'قفل‌شده ثانیه ۰۵ — ورود روی کندل جدید' : 'تحلیل پایدار کندل فعلی'}
          </span>
        </div>

        {/* Hero Direction & Confidence */}
        <div className="mt-4 flex items-center justify-between gap-4 border-b border-[#1E293B] pb-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${
                isCall
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                  : isPut
                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-400'
                  : 'border-amber-500/40 bg-amber-500/15 text-amber-400'
              }`}
            >
              {isCall ? (
                <TrendingUp className="h-6 w-6" />
              ) : isPut ? (
                <TrendingDown className="h-6 w-6" />
              ) : (
                <Clock className="h-6 w-6" />
              )}
            </div>

            <div>
              <div className="text-xs text-slate-400">سیگنال کندل بعدی (۵ دقیقه)</div>
              <div
                dir="ltr"
                className={`mt-0.5 font-mono text-3xl font-extrabold tracking-tight ${directionColor}`}
              >
                {isCall ? 'CALL' : isPut ? 'PUT' : 'WAIT'}
              </div>
            </div>
          </div>

          <div className="text-left">
            <div className="text-xs text-slate-400">امتیاز هم‌پوشانی شرایط</div>
            <div
              dir="ltr"
              className={`mt-0.5 font-mono text-2xl font-bold tabular-nums ${directionColor}`}
            >
              {prediction.overlapScore}
              <span className="text-sm text-slate-500">/100</span>
            </div>
            {prediction.overlapScore < 80 && (
              <div className="mt-0.5 text-[10px] text-amber-400">در انتظار شرایط مناسب (حد نصاب ۸۰)</div>
            )}
          </div>
        </div>

        {/* نرخ برد واقعی استراتژی (بک‌تست ۱۰۰ کندل اخیر) */}
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-[#1E293B] bg-[#090D16]/60 px-3 py-2">
          <div className="flex items-center gap-2">
            <Gauge className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <span className="text-[11px] text-slate-300">نرخ برد واقعی استراتژی</span>
          </div>
          {backtest && backtest.samples >= 10 && backtest.winRate !== null ? (
            <div dir="ltr" className="text-right font-mono tabular-nums">
              <span
                className={`text-sm font-bold ${
                  backtest.winRate >= 60
                    ? 'text-emerald-400'
                    : backtest.winRate >= 50
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {backtest.winRate.toFixed(1)}%
              </span>
              <span className="ml-1.5 text-[10px] text-slate-500">
                {backtest.samples} کندل ({backtest.wins}W/{backtest.losses}L)
              </span>
            </div>
          ) : (
            <span className="text-[11px] text-slate-500">در حال محاسبه روی کندل‌های اخیر…</span>
          )}
        </div>

        {/* Confidence Gauge */}
        <div className="mt-3.5">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
            <span>آستانه مجاز ورود: ۶۸٪</span>
            <span dir="ltr" className="font-mono tabular-nums">
              CALL {prediction.callScore}pt / PUT {prediction.putScore}pt
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              style={{ width: `${((prediction.confidence - 50) / 36) * 100}%` }}
              className={`h-full rounded-full transition-all duration-300 ${meterBg}`}
            />
          </div>
        </div>

        {/* Live Price & 5m OHLC Parity Strip */}
        <div className="mt-4 rounded-lg border border-[#1E293B] bg-[#090D16]/75 p-3">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
              <Target className="h-3.5 w-3.5 text-slate-400" />
              <span>قیمت لحظه‌ای بازار</span>
            </span>
            <span dir="ltr" className="font-mono text-base font-bold text-slate-50 tabular-nums">
              {formatNum(displayPrice)}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
            <span>قیمت مبنای تحلیل سیگنال</span>
            <span dir="ltr" className="font-mono tabular-nums text-slate-300">
              {formatNum(prediction.entryPrice)}
            </span>
          </div>
          <div
            dir="ltr"
            className="mt-2 grid grid-cols-4 gap-2 border-t border-[#1E293B]/70 pt-2 font-mono text-[11px] tabular-nums"
          >
            <div>
              <span className="text-slate-500">O </span>
              <span className="text-slate-300">{formatNum(c.open)}</span>
            </div>
            <div>
              <span className="text-slate-500">H </span>
              <span className="text-emerald-400/90">{formatNum(c.high)}</span>
            </div>
            <div>
              <span className="text-slate-500">L </span>
              <span className="text-rose-400/90">{formatNum(c.low)}</span>
            </div>
            <div>
              <span className="text-slate-500">C </span>
              <span className="text-slate-100">{formatNum(c.close)}</span>
            </div>
          </div>
        </div>

        {/* Volatility Block Notice if active */}
        {prediction.volatilityBlocked && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span>دروازه نوسان (ATR14) سیگنال را برای محافظت از سرمایه مسدود کرد.</span>
          </div>
        )}

        {/* فیلترهای فعال (بخش اول — کاهش سیگنال خطا) */}
        {prediction.gateBlocks.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-rose-300">
              <XCircle className="h-3.5 w-3.5 shrink-0" />
              فیلترهای فعال این لحظه
            </div>
            <ul className="space-y-1">
              {prediction.gateBlocks.slice(0, 4).map((block, i) => (
                <li
                  key={i}
                  className="rounded-md border border-rose-500/25 bg-rose-950/20 px-2.5 py-1.5 text-[11px] leading-relaxed text-rose-200/90"
                >
                  {block}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* بازهٔ قیمت مجاز ورود + هشدار اختلاف بروکر */}
        {(isCall || isPut) && prediction.entryZone && (
          <div className="mt-3 rounded-lg border border-[#1E293B] bg-[#090D16]/75 p-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                <Target className="h-3.5 w-3.5 text-emerald-400" />
                <span>بازهٔ مجاز ورود (Valid Entry Zone)</span>
              </span>
              <span
                dir="ltr"
                className={`font-mono text-sm font-bold tabular-nums ${
                  livePrice !== undefined && !isPriceInZone(livePrice, prediction.entryZone)
                    ? 'text-rose-400'
                    : 'text-emerald-400'
                }`}
              >
                {formatNum(prediction.entryZone.low)} — {formatNum(prediction.entryZone.high)}
              </span>
            </div>

            {livePrice !== undefined && !isPriceInZone(livePrice, prediction.entryZone) && (
              <div className="mt-2 rounded-md border border-rose-500/40 bg-rose-950/25 px-2.5 py-1.5 text-[11px] font-medium text-rose-300">
                قیمت فعلی خارج از بازهٔ مجاز است — این سیگنال منقضی شده؛ ورود جدید نگیرید.
              </div>
            )}

            <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[#1E293B]/60 pt-2">
              <label className="text-[11px] text-slate-400" htmlFor="broker-price-input">
                قیمت بروکر شما (پاکت/کوتکس):
              </label>
              <input
                id="broker-price-input"
                type="number"
                inputMode="decimal"
                step="any"
                dir="ltr"
                value={brokerPrice}
                onChange={(e) => setBrokerPrice(e.target.value)}
                placeholder={formatNum(displayPrice)}
                className="h-7 w-32 rounded-md border border-[#1E293B] bg-[#111827] px-2 text-right font-mono text-[11px] text-slate-100 outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
              />
            </div>
            {brokerPrice !== '' &&
              brokerDeviationTooWide(Number(brokerPrice), displayPrice) && (
                <div className="mt-2 rounded-md border border-rose-500/50 bg-rose-950/30 px-2.5 py-1.5 text-[11px] font-bold text-rose-300">
                  اختلاف بروکر بیش از ۰.۰۵٪ — معامله نکنید!
                </div>
              )}
          </div>
        )}

        {/* Collapsible 8-Layer Quant Engine Status (Hidden by default) */}
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowLayers((prev) => !prev)}
            aria-expanded={showLayers}
            className="flex w-full items-center justify-between rounded-lg border border-[#1E293B] bg-[#090D16]/65 px-3 py-2.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-700 hover:bg-[#090D16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <span className="inline-flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-emerald-400/90" />
              <span>وضعیت ۹ لایه موتور کوانت</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
              <span>{showLayers ? 'بستن' : 'مشاهده جزئیات'}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform duration-150 ${
                  showLayers ? 'rotate-180 text-emerald-400' : ''
                }`}
              />
            </span>
          </button>

          {showLayers && (
            <div className="mt-2 space-y-2.5 rounded-lg border border-[#1E293B] bg-[#090D16]/80 p-3">
              <div className="grid grid-cols-3 gap-1.5">
                {prediction.layers.map((layer) => {
                  const badgeColor =
                    layer.sentiment === 'bullish'
                      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                      : layer.sentiment === 'bearish'
                      ? 'border-rose-500/35 bg-rose-500/10 text-rose-300'
                      : layer.sentiment === 'warning'
                      ? 'border-amber-500/35 bg-amber-500/10 text-amber-300'
                      : 'border-[#1E293B] bg-[#111827]/70 text-slate-300';

                  return (
                    <div
                      key={layer.id}
                      title={`${layer.index}. ${layer.name}: ${layer.summary}`}
                      className={`flex flex-col rounded-md border px-2 py-1.5 text-center ${badgeColor}`}
                    >
                      <span className="text-[10px] opacity-80">L{layer.index}</span>
                      <span dir="ltr" className="truncate font-mono text-[10px] font-semibold">
                        {layer.metricValue}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="max-h-52 space-y-1.5 overflow-y-auto border-t border-[#1E293B]/70 pt-2 text-xs">
                {prediction.layers.map((layer) => (
                  <div
                    key={layer.id}
                    className="flex items-start justify-between gap-3 border-b border-[#1E293B]/50 pb-1.5 last:border-b-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-200">
                        {layer.index}. {layer.name}
                      </div>
                      <div className="text-[11px] text-slate-400">{layer.summary}</div>
                    </div>
                    <span
                      dir="ltr"
                      className={`shrink-0 font-mono text-[11px] font-medium tabular-nums ${
                        layer.sentiment === 'bullish'
                          ? 'text-emerald-400'
                          : layer.sentiment === 'bearish'
                          ? 'text-rose-400'
                          : layer.sentiment === 'warning'
                          ? 'text-amber-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {layer.metricValue}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Matched Technical Reasons */}
        <div className="mt-4">
          <div className="mb-2 text-xs font-medium text-slate-300">دلایل تکنیکال هم‌سو</div>
          <ul className="space-y-1.5">
            {prediction.reasons.map((reason, index) => (
              <li
                key={index}
                className="flex items-center justify-between rounded-md border border-[#1E293B]/80 bg-[#090D16]/45 px-3 py-1.5 text-xs text-slate-300"
              >
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Footer Actions & 8-Layer Inspection */}
      <div className="mt-5 space-y-2.5 border-t border-[#1E293B] pt-3.5">
        {(isCall || isPut) && (
          <button
            type="button"
            onClick={() => onRecordSignal(prediction)}
            className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border px-4 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
              isCall
                ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                : 'border-rose-500/45 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
            }`}
          >
            <BookmarkPlus className="h-4 w-4" />
            <span>ثبت فوری این سیگنال در تاریخچه و ارزیابی کندل</span>
          </button>
        )}

        <button
          type="button"
          onClick={onManualAnalyze}
          disabled={loading}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#1E293B] bg-slate-800/70 px-4 text-xs font-medium text-slate-100 transition-colors hover:border-slate-600 hover:bg-slate-800 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'در حال تحلیل...' : 'تحلیل مجدد از بازار'}</span>
        </button>
      </div>
    </section>
  );
}
