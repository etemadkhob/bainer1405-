// تست شواهد تایمرها (v1.2.0) — اجرا: npx tsx scripts/test_timers.ts
// همهٔ محاسبات خالص از src/utils/timers.ts تست می‌شوند؛ بدون DOM.
import {
  TIMEFRAMES_MS,
  elapsedPct,
  formatHMS,
  formatMS,
  isSafeRescanWindow,
  remainingForTimeframe,
  secsUntilBreak,
  secsUntilOfficialTrigger,
  secsUntilRescan,
} from '../src/utils/timers';

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected);
  if (ok) {
    pass++;
    console.log(`PASS  ${name} → ${String(actual)}`);
  } else {
    fail++;
    console.error(`FAIL  ${name} → got ${String(actual)}, expected ${String(expected)}`);
  }
}

// ---- مرز بسته‌شدن کندل (مرزهای واقعی = مضرب دقیق تایم‌فریم) ----
const T1M = 60_000, T5M = 300_000, T15M = 900_000, T1H = 3_600_000;
const B1 = Math.floor(1_700_000_000_000 / T1M) * T1M;
const B5 = Math.floor(1_700_000_000_000 / T5M) * T5M;
const B15 = Math.floor(1_700_000_000_000 / T15M) * T15M;
const B1H = Math.floor(1_700_000_000_000 / T1H) * T1H;
check('پیش‌شرط: مرز واقعاً روی مضرب است', (B5 % T5M + T5M) % T5M, 0);

check('1m: روی مرز دقیق → ۶۰ ثانیه', remainingForTimeframe(B1, T1M as never), 60);
check('1m: مرز+۱ثانیه → ۵۹', remainingForTimeframe(B1 + 1_000, T1M as never), 59);
check('5m: مرز+۴۵ثانیه → ۲۵۵', remainingForTimeframe(B5 + 45_000, T5M as never), 255);
check('15m: مرز+۲۹۹ثانیه → ۶۰۱', remainingForTimeframe(B15 + 299_000, T15M as never), 601);
check('1h: مرز+۳۵۹۹ثانیه → ۱', remainingForTimeframe(B1H + 3_599_000, T1H as never), 1);
check('5m: هم‌ترازی با مبنای 5m اپ (FIVE_MINUTES_MS)', remainingForTimeframe(0, T5M as never), 300);

// ---- تریگر رسمی بعدی (لحظهٔ 00:45) ----
check('تریگر: remaining=300 → ۲۵۵', secsUntilOfficialTrigger(300), 255);
check('تریگر: remaining=299 → ۲۵۴', secsUntilOfficialTrigger(299), 254);
check('تریگر: remaining=46 → ۱', secsUntilOfficialTrigger(46), 1);
check('تریگر: remaining=45 → صفر (همین حالا)', secsUntilOfficialTrigger(45), 0);
check('تریگر: remaining=44 → کندل بعدی (۴۴+۲۵۵=۲۹۹)', secsUntilOfficialTrigger(44), 299);
check('تریگر: remaining=1 → ۲۵۶', secsUntilOfficialTrigger(1), 256);
check('تریگر: remaining=0 → ۲۵۵', secsUntilOfficialTrigger(0), 255);

// ---- فرمت‌بندی ----
check('formatMS: 0 → 00:00', formatMS(0), '00:00');
check('formatMS: 65 → 01:05', formatMS(65), '01:05');
check('formatMS: 3599 → 59:59', formatMS(3599), '59:59');
check('formatHMS: 3_661_000ms → 01:01:01', formatHMS(3_661_000), '01:01:01');
check('formatHMS: منفی → 00:00:00', formatHMS(-5), '00:00:00');

// ---- بازاسکن ----
check('بازاسکن: خاموش → null', secsUntilRescan(0, 0, 1_000), null);
check('بازاسکن: ۳ دقیقه، ۶۰ثانیه گذشته → ۱۲۰', secsUntilRescan(180, 0, 60_000), 120);
check('بازاسکن: زمان گذشته → ۰', secsUntilRescan(60, 0, 120_000), 0);
check('پنجرهٔ امن: ۴۹ثانیه پایانی → ممنوع', isSafeRescanWindow(49, false), false);
check('پنجرهٔ امن: ۵۱ثانیه پایانی → مجاز', isSafeRescanWindow(51, false), true);
check('پنجرهٔ امن: حین اسکن → ممنوع', isSafeRescanWindow(200, true), false);

// ---- یادآور استراحت ----
check('یادآور: خاموش → null', secsUntilBreak(0, 0, 1_000), null);
check('یادآور: ۲۵دقیقه، ۱۰دقیقه گذشته → ۹۰۰ثانیه', secsUntilBreak(25, 0, 600_000), 900);
check('یادآور: موعد رسیده → ۰', secsUntilBreak(45, 0, 45 * 60_000), 0);

// ---- درصد پیشرفت ----
check('pct: کندل تازه → ۰٪', elapsedPct(B1, T1M as never), 0);
check('pct: نیمهٔ ۵م → ۵۰٪', Math.round(elapsedPct(B5 + 150_000, T5M as never)), 50);

// ---- سازگاری: آستانهٔ گارد با تریگر رسمی هم‌راستا است ----
// تریگر در ۴۵ثانیهٔ پایانی است؛ گارد از ۵۰ثانیه شروع می‌شود → هیچ بازاسکنی وارد پنجرهٔ تریگر نمی‌شود
check('هم‌راستایی: گارد(50) > تریگر(45) — بازاسکن هرگز در پنجرهٔ تریگر نمی‌افتد', isSafeRescanWindow(46, false), false);

console.log(`\nنتایج: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
