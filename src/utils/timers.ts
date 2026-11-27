// ماژول خالص ریاضیِ تایمرها — بدون DOM و بدون React تا مستقل تست‌پذیر باشد
// قواعد: همهٔ مرزهای تایم‌فریم بر مبنای UTC epoch (مضرب دقیق) هم‌تراز هستند.

export const TIMEFRAMES_MS = [60_000, 300_000, 900_000, 3_600_000] as const;
export type TimeframeMs = (typeof TIMEFRAMES_MS)[number];

export const TIMEFRAME_LABELS: Record<TimeframeMs, string> = {
  60_000: 'کندل ۱ دقیقه',
  300_000: 'کندل ۵ دقیقه (پایه)',
  900_000: 'کندل ۱۵ دقیقه',
  3_600_000: 'کندل ۱ ساعته',
};

export const TIMEFRAME_SHORT: Record<TimeframeMs, string> = {
  60_000: '1m',
  300_000: '5m',
  900_000: '15m',
  3_600_000: '1h',
};

/** ثانیهٔ باقی‌مانده تا بسته‌شدن کندل جاری در تایم‌فریم داده‌شده (همیشه ≥ ۰) */
export function remainingForTimeframe(nowMs: number, tfMs: TimeframeMs): number {
  const safeNow = Number.isFinite(nowMs) ? Math.max(0, nowMs) : 0;
  const remMs = tfMs - (safeNow % tfMs);
  // روی مرز دقیق (now % tf === 0) کندل همین حالا باز شده → کل تایم‌فریم باقی است
  const remSec = Math.floor(remMs / 1000);
  return remSec >= tfMs / 1000 ? tfMs / 1000 : Math.max(0, remSec);
}

/** درصد سپری‌شدهٔ کندل جاری (۰ تا ۱۰۰) برای نوار پیشرفت */
export function elapsedPct(nowMs: number, tfMs: TimeframeMs): number {
  const remSec = remainingForTimeframe(nowMs, tfMs);
  return Math.min(100, Math.max(0, ((tfMs / 1000 - remSec) / (tfMs / 1000)) * 100));
}

/**
 * ثانیه تا تریگر رسمی بعدی (لحظهٔ 00:05 پایانی کندل ۵ دقیقه — v2.0).
 * تریگر در هر کندل دقیقاً یک‌بار در ثانیهٔ ۵م پایانی رخ می‌دهد تا کاربر
 * دقیقاً روی باز شدن کندل جدید وارد معامله شود؛ اگر عبور کرده باشیم،
 * تریگر بعدی متعلق به کندل بعدی است.
 */
export function secsUntilOfficialTrigger(remainingSecIn5m: number): number {
  const rem = Math.max(0, Math.min(300, Math.floor(remainingSecIn5m)));
  // rem=5 یعنی تریگر همین حالا شلیک می‌شود → شمارش صفر
  return rem >= 5 ? rem - 5 : rem + 295;
}

/** mm:ss با دو رقم تثبیت‌شده (برای شمارش‌های زیر ۱ ساعت) */
export function formatMS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** hh:mm:ss برای مدت سشن */
export function formatHMS(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export interface TimerOption {
  value: number;
  label: string;
}

export const RESCAN_OPTIONS: TimerOption[] = [
  { value: 0, label: 'خاموش' },
  { value: 60, label: 'هر ۱ دقیقه' },
  { value: 180, label: 'هر ۳ دقیقه' },
  { value: 300, label: 'هر ۵ دقیقه' },
  { value: 900, label: 'هر ۱۵ دقیقه' },
];

export const BREAK_OPTIONS: TimerOption[] = [
  { value: 0, label: 'خاموش' },
  { value: 25, label: 'هر ۲۵ دقیقه' },
  { value: 45, label: 'هر ۴۵ دقیقه' },
  { value: 60, label: 'هر ۶۰ دقیقه' },
];

/** ثانیه تا بازاسکن بعدی؛ null یعنی خاموش */
export function secsUntilRescan(
  intervalSec: number,
  lastRescanAtMs: number,
  nowMs: number
): number | null {
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) return null;
  const last = Number.isFinite(lastRescanAtMs) ? lastRescanAtMs : nowMs;
  const elapsed = Math.max(0, (nowMs - last) / 1000);
  return Math.max(0, intervalSec - elapsed);
}

/** ثانیه تا یادآور بعدی؛ null یعنی خاموش */
export function secsUntilBreak(
  intervalMin: number,
  lastBreakAtMs: number,
  nowMs: number
): number | null {
  if (!Number.isFinite(intervalMin) || intervalMin <= 0) return null;
  const last = Number.isFinite(lastBreakAtMs) ? lastBreakAtMs : nowMs;
  const elapsed = Math.max(0, (nowMs - last) / 1000);
  return Math.max(0, intervalMin * 60 - elapsed);
}

/** آیا بازاسکن در پنجرهٔ امن مجاز است؟ (۵۰ ثانیهٔ پایانی کندل + حین اسکن → ممنوع) */
export function isSafeRescanWindow(remainingSecIn5m: number, isScanning: boolean): boolean {
  if (isScanning) return false;
  return Math.max(0, remainingSecIn5m) > 50;
}
