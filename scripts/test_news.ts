/**
 * test_news.ts — شاهد اجرای v2.0.1: خط لولهٔ تقویم اقتصادی
 *
 *  ۱) واکشی زندهٔ منبع آینهٔ GitHub (همان URL اول داخل Worker)
 *  ۲) نرمال‌ساز normalizeFfEvents (همان تابع داخل Worker)
 *  ۳) گیت newsBlockFor با پنجرهٔ ±۱۵ دقیقه (همان گیت درون موتور)
 *
 * اجرا: npx tsx scripts/test_news.ts
 */

import { NEWS_SOURCES, normalizeFfEvents, highImpactEvents } from '../deploy/newsfeed';
import { newsBlockFor, type NewsEvent } from '../src/engine/filters';

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`PASS  ${label}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}${extra ? `\n      ${extra}` : ''}`);
  }
}

async function main() {
  console.log('=== v2.0.1 — خط لولهٔ تقویم اقتصادی ===\n');

  // --- ۱) واکشی زندهٔ منبع اول (آینهٔ GitHub) ---
  const mirrorUrl = NEWS_SOURCES[0];
  check('منبع اول = آینهٔ raw.githubusercontent', mirrorUrl.startsWith('https://raw.githubusercontent.com/dkmarlin/ff-mirror/'), mirrorUrl);

  const res = await fetch(mirrorUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  check(`واکشی زندهٔ آینه → HTTP 200 (got ${res.status})`, res.status === 200);
  const rows = (await res.json()) as unknown[];
  check('پاسخ یک آرایهٔ رویداد است', Array.isArray(rows) && rows.length > 0, `len=${(rows as unknown[]).length}`);

  // --- ۲) نرمال‌ساز ---
  const events = normalizeFfEvents(rows);
  check('نرمال‌ساز: خروجی نام خالی نیست', events.length > 0);
  check('نرمال‌ساز: همهٔ زمان‌ها epoch معتبر', events.every((e) => Number.isFinite(e.time) && e.time > 1_500_000_000_000));
  check('نرمال‌ساز: همهٔ عنوان‌ها غیرخالی', events.every((e) => e.title.length > 0));
  check('نرمال‌ساز: کلون صفر (title+time یکتا)', new Set(events.map((e) => `${e.title}|${e.time}`)).size === events.length);
  check('نرمال‌ساز: سقف ۵۰۰ رویداد', events.length <= 500, `len=${events.length}`);

  const high = highImpactEvents(events);
  check(`رویدادهای High استخراج شدند (n=${high.length})`, high.length >= 0 && high.every((e) => e.impact.toLowerCase() === 'high'));

  const sorted = [...events].sort((a, b) => a.time - b.time);
  const fmt = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  console.log(`      بازهٔ هفته: ${fmt(sorted[0].time)} → ${fmt(sorted[sorted.length - 1].time)} (UTC)`);
  console.log(`      High: ${high.map((e) => `${e.currency} ${e.title} @ ${fmt(e.time)}`).join(' · ') || '—'}`);

  // --- ۳) گیت ±۱۵ دقیقه با تابع واقعی موتور ---
  const now = Date.now();
  const mk = (time: number, impact: string): NewsEvent[] => [
    { title: 'تست خبر', currency: 'USD', impact, time },
  ];
  check('گیت: High در +۱۰ دقیقه → بلاک', newsBlockFor(mk(now + 10 * 60_000, 'High'), now).blocked === true);
  check('گیت: High در −۱۴ دقیقه → بلاک', newsBlockFor(mk(now - 14 * 60_000, 'High'), now).blocked === true);
  check('گیت: High در +۱۶ دقیقه → آزاد', newsBlockFor(mk(now + 16 * 60_000, 'High'), now).blocked === false);
  check('گیت: Low در +۵ دقیقه → آزاد', newsBlockFor(mk(now + 5 * 60_000, 'Low'), now).blocked === false);
  check('گیت: مرز دقیقاً +۱۵ دقیقه → بلاک (≤)', newsBlockFor(mk(now + 15 * 60_000, 'High'), now).blocked === true);
  check('گیت: آرایهٔ خالی → آزاد', newsBlockFor([], now).blocked === false);
  check('گیت: undefined (فید در دسترس نیست) → آزاد (fail-open)', newsBlockFor(undefined, now).blocked === false);

  // رویدادهای High واقعی هفته روی گیت: هیچ بلوکی برای «الان» نباید جعلی باشد
  const realHit = newsBlockFor(high, now);
  console.log(`      گیت روی High واقعی همین حالا: ${realHit.blocked ? `بلاک (${realHit.event?.title})` : 'آزاد — رویداد پرنقاطی در ±۱۵ دقیقه نیست'}`);
  check('گیت روی دادهٔ واقعی: خروجی سازگار (blocked یا آزاد)', typeof realHit.blocked === 'boolean');

  console.log(`\n==========================================================`);
  console.log(`نتیجه: ${pass} PASS / ${fail} FAIL`);
  console.log(`==========================================================`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('CRASH:', e);
  process.exit(1);
});
