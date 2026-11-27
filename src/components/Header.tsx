import { Activity, Clock, Cloud, CloudOff, TrendingUp, Volume2, VolumeX, Wifi } from 'lucide-react';

/**
 * Header — تک‌خطی (v2.1.2)
 *
 * قانون چیدمان: هرگز نمی‌شکند (flex-nowrap)؛ آیتم‌ها به‌ترتیب اهمیت و
 * در عرض کم «پنهان» می‌شوند نه «رفتن به خط بعد»:
 *   همیشه: برند · زنده/تأخیر · دکمهٔ صدا
 *   ≥ md:  ابر (+ برد سروری) · سشن
 *   ≥ lg:  نرخ برد محلی
 * جزئیات هر آیتم در tooltip (title) است — نه متن روی صفحه.
 * بدون تکرار: برد سروری فقط داخل چیپ ابر، نام کامل سشن فقط tooltip.
 */

interface HeaderProps {
  sessionName: string;
  isOptimalSession: boolean;
  winRate: number | null;
  settledCount: number;
  soundEnabled: boolean;
  wsConnected: boolean;
  streamLatencyMs: number | null;
  cloudAvailable: boolean;
  serverWinRate: number | null;
  serverSettled: number;
  onToggleSound: () => void;
}

const CHIP = 'flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs';

export function Header({
  sessionName,
  isOptimalSession,
  winRate,
  settledCount,
  soundEnabled,
  wsConnected,
  streamLatencyMs,
  cloudAvailable,
  serverWinRate,
  serverSettled,
  onToggleSound,
}: HeaderProps) {
  const latencyColor =
    streamLatencyMs === null ? 'text-slate-500' : streamLatencyMs <= 100 ? 'text-emerald-400' : 'text-amber-400';
  // برد مؤثر — اولویت با سروری؛ هرگز دو عدد هم‌زمان نمایش داده نمی‌شود
  const effWr = serverWinRate ?? winRate;
  const effCnt = serverSettled > 0 ? serverSettled : settledCount;
  const effSrc = serverWinRate !== null ? 'نرخ برد سروری (Turso)' : 'نرخ برد محلی';
  const wrColor =
    effWr === null
      ? 'text-slate-400'
      : effWr >= 60
      ? 'text-emerald-400'
      : effWr >= 50
      ? 'text-amber-400'
      : 'text-rose-400';

  return (
    <header className="border-b border-[#1E293B] bg-[#090D16]/90 backdrop-blur-md">
      {/* h-14 + flex-nowrap = تضمین یک خط */}
      <div className="mx-auto flex h-14 max-w-[1440px] flex-nowrap items-center gap-3 px-4 sm:px-6">
        {/* برند — همیشه کامل ولی کوتاه */}
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <Activity className="h-4 w-4" />
          </div>
          <h1 className="whitespace-nowrap text-base font-bold tracking-tight text-slate-100">اوراکل کوانت</h1>
          <span className="hidden whitespace-nowrap rounded-md border border-[#1E293B] bg-[#111827]/80 px-2 py-0.5 text-[11px] font-medium text-slate-400 md:inline">
            پیش‌بینی ۵ دقیقه‌ای
          </span>
        </div>

        <div className="hidden h-5 w-px shrink-0 bg-[#1E293B] lg:block" aria-hidden="true" />

        {/* تله‌متری — یک گروه، بدون شکستن */}
        <div className="flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-x-3 gap-y-0 overflow-hidden sm:gap-x-4">
          {/* زنده + تأخیر — ادغام دو چیپ قبلی */}
          <div
            title={`استریم زندهٔ بایننس — تأخیر هدف زیر ۱۰۰ms (میانگین متحرک)${wsConnected ? '' : ' — در حال همگام‌سازی'}`}
            className={CHIP}
          >
            <Wifi className={`h-3.5 w-3.5 shrink-0 ${wsConnected ? 'text-emerald-400' : 'text-amber-400'}`} />
            <span className={wsConnected ? 'font-medium text-emerald-400' : 'font-medium text-amber-400'}>
              {wsConnected ? 'زنده' : 'همگام‌سازی'}
            </span>
            <span dir="ltr" className={`font-mono font-medium tabular-nums ${latencyColor}`}>
              {streamLatencyMs === null ? '—' : `${streamLatencyMs}ms`}
            </span>
          </div>

          {/* ابر — فقط وضعیت همگام‌سازی؛ جزئیات در tooltip (≥ md) */}
          <div
            title={
              cloudAvailable
                ? `تاریخچهٔ سروری Turso فعال${serverSettled > 0 ? ` — ${serverSettled} معاملهٔ تسویه‌شده${serverWinRate !== null ? ` · نرخ برد ${serverWinRate.toFixed(1)}٪` : ''}` : ''}`
                : 'ذخیرهٔ محلی (دیتابیس سروری در دسترس نیست)'
            }
            className={`${CHIP} hidden md:flex`}
          >
            {cloudAvailable ? (
              <Cloud className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            ) : (
              <CloudOff className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            )}
            <span className={cloudAvailable ? 'font-medium text-emerald-400' : 'text-slate-500'}>
              {cloudAvailable ? 'ابر' : 'محلی'}
            </span>
          </div>

          {/* سشن — بدون کلمهٔ اضافهٔ «سشن:» و بدون تکرار نام (≥ md) */}
          <div
            title={`سشن معاملاتی: ${sessionName}${isOptimalSession ? '' : ' — جریمهٔ نقدینگی بازار آسیا'}`}
            className={`${CHIP} hidden md:flex`}
          >
            <Clock className={`h-3.5 w-3.5 shrink-0 ${isOptimalSession ? 'text-emerald-400' : 'text-amber-400'}`} />
            <span className={`font-medium ${isOptimalSession ? 'text-emerald-400' : 'text-amber-400'}`}>
              {isOptimalSession ? 'لندن/نیویورک' : 'آسیا'}
            </span>
          </div>

          {/* نرخ برد — فقط یک‌جا (≥ lg) */}
          <div
            title={`${effSrc}${effCnt > 0 ? ` — ${effCnt} معاملهٔ تسویه‌شده` : ' — هنوز معامله‌ای تسویه نشده'}`}
            className={`${CHIP} hidden lg:flex`}
          >
            <TrendingUp
              className={`h-3.5 w-3.5 shrink-0 ${
                effWr === null ? 'text-slate-500' : effWr >= 60 ? 'text-emerald-400' : effWr >= 50 ? 'text-amber-400' : 'text-rose-400'
              }`}
            />
            <span dir="ltr" className={`font-mono font-semibold tabular-nums ${wrColor}`}>
              {effWr === null ? '—' : `${effWr.toFixed(1)}%`}
            </span>
            {effCnt > 0 && <span className="text-slate-500 tabular-nums">({effCnt})</span>}
          </div>

          {/* صدا — فقط آیکنی با tooltip */}
          <button
            type="button"
            onClick={onToggleSound}
            title={soundEnabled ? 'صدای هشدار فعال است — برای قطع کلیک کنید' : 'بی‌صدا — برای فعال‌سازی کلیک کنید'}
            aria-label={soundEnabled ? 'قطع صدای هشدار' : 'فعال‌سازی صدای هشدار'}
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
              soundEnabled
                ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'
                : 'border-[#1E293B] bg-[#111827]/80 text-slate-400 hover:border-slate-700 hover:text-slate-200'
            }`}
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </header>
  );
}
