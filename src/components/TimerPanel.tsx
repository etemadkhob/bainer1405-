import { AlarmClock, BellRing, Clock3, RefreshCw, Timer } from 'lucide-react';
import {
  BREAK_OPTIONS,
  RESCAN_OPTIONS,
  TIMEFRAMES_MS,
  TIMEFRAME_SHORT,
  elapsedPct,
  formatHMS,
  formatMS,
  remainingForTimeframe,
  secsUntilBreak,
  secsUntilOfficialTrigger,
  secsUntilRescan,
} from '../utils/timers';
import type { TimeframeMs } from '../utils/timers';

interface TimerPanelProps {
  nowMs: number;
  fiveMinRemainingSec: number;
  sessionStartMs: number;
  lastAutoTriggerAt: number | null;
  scanningAll: boolean;
  rescanIntervalSec: number;
  lastRescanAt: number;
  breakReminderMin: number;
  lastBreakAt: number;
  onChangeRescanInterval: (sec: number) => void;
  onChangeBreakReminder: (min: number) => void;
}

function TimerTile({
  nowMs,
  tfMs,
  isPrimary,
}: {
  nowMs: number;
  tfMs: TimeframeMs;
  isPrimary: boolean;
}) {
  const remSec = remainingForTimeframe(nowMs, tfMs);
  const pct = elapsedPct(nowMs, tfMs);
  const urgent = tfMs === 60_000 && remSec <= 10;

  return (
    <div
      className={`rounded-lg border p-2.5 transition-colors duration-200 ${
        urgent
          ? 'border-rose-500/50 bg-rose-950/20'
          : isPrimary
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-[#1E293B] bg-[#090D16]/60'
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={`text-[10px] font-medium ${
            isPrimary ? 'text-emerald-300' : 'text-slate-400'
          }`}
        >
          {TIMEFRAME_SHORT[tfMs]}
        </span>
        <Timer
          className={`h-3 w-3 shrink-0 ${
            urgent ? 'animate-pulse text-rose-400' : isPrimary ? 'text-emerald-400' : 'text-slate-500'
          }`}
        />
      </div>

      <div
        dir="ltr"
        className={`mt-1 font-mono text-lg font-bold leading-none tracking-tight tabular-nums ${
          urgent ? 'text-rose-300' : isPrimary ? 'text-emerald-300' : 'text-slate-200'
        }`}
      >
        {formatMS(remSec)}
      </div>

      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-800/90">
        <div
          style={{ width: `${pct}%` }}
          className={`h-full rounded-full transition-all duration-300 ${
            urgent ? 'bg-rose-500' : isPrimary ? 'bg-emerald-500' : 'bg-slate-500'
          }`}
        />
      </div>
    </div>
  );
}

export function TimerPanel({
  nowMs,
  fiveMinRemainingSec,
  sessionStartMs,
  lastAutoTriggerAt,
  scanningAll,
  rescanIntervalSec,
  lastRescanAt,
  breakReminderMin,
  lastBreakAt,
  onChangeRescanInterval,
  onChangeBreakReminder,
}: TimerPanelProps) {
  const secsToTrigger = secsUntilOfficialTrigger(fiveMinRemainingSec);
  const nextRescanIn = secsUntilRescan(rescanIntervalSec, lastRescanAt, nowMs);
  const nextBreakIn = secsUntilBreak(breakReminderMin, lastBreakAt, nowMs);
  const sessionElapsed = Math.max(0, nowMs - sessionStartMs);

  const selectClass =
    'h-7 rounded-md border border-[#1E293B] bg-[#090D16] px-1.5 text-[11px] text-slate-200 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-emerald-400';

  return (
    <div className="rounded-xl border border-[#1E293B] bg-[#111827]/80 p-4 backdrop-blur-md">
      {/* سرستون: عنوان + مدت سشن */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-emerald-400" />
          <span className="text-xs font-semibold text-slate-200">تایمرهای عملیاتی</span>
        </div>

        <div
          dir="ltr"
          title="مدت زمان حضور در سشن"
          className="rounded-md border border-[#1E293B] bg-[#090D16]/70 px-2 py-0.5 font-mono text-[11px] text-slate-300 tabular-nums"
        >
          {formatHMS(sessionElapsed)}
        </div>
      </div>

      {/* چهار تایم‌فریم: 1m / 5m / 15m / 1h */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        {TIMEFRAMES_MS.map((tfMs) => (
          <TimerTile key={tfMs} nowMs={nowMs} tfMs={tfMs} isPrimary={tfMs === 300_000} />
        ))}
      </div>

      {/* تریگر رسمی بعدی */}
      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-[#1E293B] bg-[#090D16]/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <AlarmClock className={`h-3.5 w-3.5 shrink-0 ${secsToTrigger <= 10 ? 'animate-pulse text-amber-400' : 'text-slate-400'}`} />
          <span className="text-[11px] text-slate-300">تا تریگر رسمی بعدی</span>
        </div>
        <div className="flex items-center gap-2">
          <span dir="ltr" className={`font-mono text-sm font-bold tabular-nums ${secsToTrigger <= 10 ? 'text-amber-300' : 'text-slate-100'}`}>
            {formatMS(secsToTrigger)}
          </span>
          {lastAutoTriggerAt && (
            <span dir="ltr" className="hidden font-mono text-[10px] text-slate-500 tabular-nums sm:inline">
              قبلی:{' '}
              {new Date(lastAutoTriggerAt).toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
          )}
        </div>
      </div>

      {/* بازاسکن دوره‌ای + یادآور استراحت */}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-[#1E293B] bg-[#090D16]/60 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-300" htmlFor="rescan-select">
              <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${scanningAll ? 'animate-spin text-emerald-400' : 'text-slate-400'}`} />
              بازاسکن دوره‌ای
            </label>
            <select
              id="rescan-select"
              value={rescanIntervalSec}
              onChange={(e) => onChangeRescanInterval(Number(e.target.value))}
              className={selectClass}
            >
              {RESCAN_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div dir="ltr" className="mt-1 text-left font-mono text-[11px] text-slate-400 tabular-nums">
            {scanningAll
              ? 'در حال اسکن…'
              : nextRescanIn !== null
              ? `بعدی: ${formatMS(nextRescanIn)}`
              : '—'}
          </div>
        </div>

        <div className="rounded-lg border border-[#1E293B] bg-[#090D16]/60 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-300" htmlFor="break-select">
              <BellRing className={`h-3.5 w-3.5 shrink-0 ${nextBreakIn !== null && nextBreakIn <= 10 ? 'animate-pulse text-amber-400' : 'text-slate-400'}`} />
              یادآور استراحت
            </label>
            <select
              id="break-select"
              value={breakReminderMin}
              onChange={(e) => onChangeBreakReminder(Number(e.target.value))}
              className={selectClass}
            >
              {BREAK_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div dir="ltr" className="mt-1 text-left font-mono text-[11px] text-slate-400 tabular-nums">
            {nextBreakIn !== null ? `بعدی: ${formatMS(nextBreakIn)}` : '—'}
          </div>
        </div>
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
        مرزهای تایم‌فریم‌ها بر مبنای UTC هم‌تراز است؛ برای حفظ دقت، بازاسکن در ۵۰ ثانیهٔ پایانی
        کندل خودکار به تعویق می‌افتد تا با تریگر رسمی تداخل نکند.
      </p>
    </div>
  );
}
