import { Activity, Clock, Volume2, VolumeX, Wifi } from 'lucide-react';

interface HeaderProps {
  sessionName: string;
  isOptimalSession: boolean;
  winRate: number | null;
  settledCount: number;
  soundEnabled: boolean;
  wsConnected: boolean;
  onToggleSound: () => void;
}

export function Header({
  sessionName,
  isOptimalSession,
  winRate,
  settledCount,
  soundEnabled,
  wsConnected,
  onToggleSound,
}: HeaderProps) {
  return (
    <header className="border-b border-[#1E293B] bg-[#090D16]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        {/* Brand Zone */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <Activity className="h-5 w-5" />
          </div>
          <h1 className="whitespace-nowrap text-base font-bold tracking-tight text-slate-100 sm:text-lg">
            اوراکل کوانت | پیش‌بینی ۵ دقیقه‌ای
          </h1>
        </div>

        {/* Telemetry & Controls */}
        <div className="flex flex-wrap items-center gap-4 sm:gap-5">
          {/* Live Stream Status */}
          <div className="flex items-center gap-1.5 text-xs">
            <Wifi
              className={`h-3.5 w-3.5 shrink-0 ${
                wsConnected ? 'text-emerald-400' : 'text-amber-400'
              }`}
            />
            <span className={wsConnected ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
              {wsConnected ? 'داده زنده آنلاین' : 'همگام‌سازی سرور'}
            </span>
          </div>

          <div className="hidden h-4 w-px bg-[#1E293B] sm:block" aria-hidden="true" />

          {/* Live Session Status */}
          <div className="flex items-center gap-2 text-xs sm:text-sm">
            <Clock
              className={`h-4 w-4 shrink-0 ${
                isOptimalSession ? 'text-emerald-400' : 'text-amber-400'
              }`}
            />
            <span className="text-slate-400">سشن:</span>
            <span
              className={`whitespace-nowrap font-medium ${
                isOptimalSession ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {isOptimalSession ? 'لندن / نیویورک' : 'آسیا (جریمه نقدینگی)'}
            </span>
            <span className="hidden text-slate-600 xl:inline" aria-hidden="true">
              ·
            </span>
            <span className="hidden text-xs text-slate-400 xl:inline">{sessionName}</span>
          </div>

          <div className="hidden h-4 w-px bg-[#1E293B] sm:block" aria-hidden="true" />

          {/* Live Win-Rate */}
          <div className="flex items-center gap-2 text-xs sm:text-sm">
            <span className="text-slate-400">نرخ برد:</span>
            <span
              dir="ltr"
              className={`font-mono font-semibold tabular-nums ${
                winRate === null
                  ? 'text-slate-300'
                  : winRate >= 60
                  ? 'text-emerald-400'
                  : winRate >= 50
                  ? 'text-amber-400'
                  : 'text-rose-400'
              }`}
            >
              {winRate === null ? '—' : `${winRate.toFixed(1)}%`}
            </span>
            {settledCount > 0 && (
              <span className="text-xs text-slate-500 tabular-nums">({settledCount} معامله)</span>
            )}
          </div>

          {/* Sound Toggle Action */}
          <button
            type="button"
            onClick={onToggleSound}
            aria-label={soundEnabled ? 'قطع صدای هشدار' : 'فعال‌سازی صدای هشدار'}
            className={`inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg border px-3.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
              soundEnabled
                ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'
                : 'border-[#1E293B] bg-[#111827]/80 text-slate-400 hover:border-slate-700 hover:text-slate-200'
            }`}
          >
            {soundEnabled ? (
              <Volume2 className="h-4 w-4 shrink-0" />
            ) : (
              <VolumeX className="h-4 w-4 shrink-0" />
            )}
            <span>{soundEnabled ? 'صدای هشدار فعال' : 'بی‌صدا'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
