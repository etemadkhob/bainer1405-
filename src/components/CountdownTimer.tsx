import { Timer } from 'lucide-react';

interface CountdownTimerProps {
  remainingSeconds: number;
  lastAutoTriggerAt: number | null;
}

export function CountdownTimer({ remainingSeconds, lastAutoTriggerAt }: CountdownTimerProps) {
  const clamped = Math.max(0, Math.min(299, remainingSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  // Progress from 0% (at 04:59) to 100% (at 00:00)
  const progressPct = Math.min(100, Math.max(0, ((300 - clamped) / 300) * 100));
  const isFinal15 = clamped <= 15;
  const isTriggerZone = clamped <= 45 && clamped > 15;

  return (
    <div
      className={`rounded-xl border p-4 backdrop-blur-md transition-colors duration-200 ${
        isFinal15
          ? 'border-rose-500/60 bg-rose-950/20 shadow-[0_0_24px_rgba(244,63,94,0.18)]'
          : 'border-[#1E293B] bg-[#111827]/80'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Timer
            className={`h-4 w-4 ${
              isFinal15 ? 'animate-pulse text-rose-400' : 'text-slate-400'
            }`}
          />
          <span className="text-xs font-medium text-slate-300">زمان‌سنج اتمیک کندل ۵ دقیقه</span>
        </div>

        <span className="text-[11px] text-slate-400">
          {isFinal15
            ? 'آماده بسته‌شدن کندل'
            : isTriggerZone
            ? 'پنجره ورود سیگنال فعال'
            : 'تریگر خودکار در 00:05'}
        </span>
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-4">
        <div
          dir="ltr"
          className={`font-mono text-4xl font-bold tracking-tight tabular-nums sm:text-[42px] ${
            isFinal15 ? 'text-rose-400' : 'text-slate-50'
          }`}
        >
          {formatted}
        </div>

        <div className="text-left text-xs text-slate-400">
          <div>دوره ۵ دقیقه‌ای UTC</div>
          {lastAutoTriggerAt && (
            <div dir="ltr" className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
              آخرین تریگر:{' '}
              {new Date(lastAutoTriggerAt).toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </div>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-3.5 h-2 w-full overflow-hidden rounded-full bg-slate-800/90">
        <div
          style={{ width: `${progressPct}%` }}
          className={`h-full rounded-full transition-all duration-300 ${
            isFinal15
              ? 'animate-pulse bg-rose-500 shadow-[0_0_14px_rgba(244,63,94,0.95)]'
              : isTriggerZone
              ? 'bg-amber-400'
              : 'bg-emerald-500'
          }`}
        />
      </div>
    </div>
  );
}
