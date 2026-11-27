/**
 * newsfeed.ts — نرمال‌ساز خالص فید تقویم اقتصادی ForexFactory.
 *
 * ماژول خالص (بدون API ورکرها) تا هم در Worker و هم در تست tsx استفاده شود.
 * منابع به ترتیب اولویت:
 *   ۱) آینهٔ GitHub — raw.githubusercontent.com از edge کلادفلر قابل واکشی است
 *      و مانند nfs.faireconomy.media محدودیت 429/530 به دیتاسنتر ندارد.
 *   ۲) nfs.faireconomy.media (منبع اصلی)
 *   ۳) cdn-nfs.faireconomy.media (میرور CDN)
 */

export const NEWS_SOURCES = [
  'https://raw.githubusercontent.com/dkmarlin/ff-mirror/main/ff_calendar_thisweek.json',
  'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  'https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json',
] as const;

export interface WireEvent {
  title: string;
  currency: string;
  impact: string;
  time: number; // ms epoch
}

interface FfRow {
  title?: string;
  country?: string;
  currency?: string;
  date?: string;
  impact?: string;
}

/** سقف رویدادها برای جلوگیری از باد کردن حافظهٔ edge */
export const NEWS_MAX_EVENTS = 500;

/**
 * تبدیل سطرهای خام فید FF به WireEvent معتبر — بدون کلون تکراری.
 * سطرهای بی‌تاریخ یا بی‌عنوان کاملاً نامعتبر دور ریخته می‌شوند.
 */
export function normalizeFfEvents(rows: unknown[]): WireEvent[] {
  if (!Array.isArray(rows)) return [];
  const out: WireEvent[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const row = (raw ?? {}) as FfRow;
    const t = row.date ? Date.parse(row.date) : NaN;
    if (!Number.isFinite(t)) continue;
    const title = String(row.title ?? '').trim();
    if (!title) continue;
    const key = `${title}|${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: title.slice(0, 160),
      currency: String(row.currency ?? row.country ?? '').trim().slice(0, 8),
      impact: String(row.impact ?? '').trim().slice(0, 16),
      time: t,
    });
    if (out.length >= NEWS_MAX_EVENTS) break;
  }
  return out;
}

/** فیلتر رویدادهای پرنقاط (High) — چیزی که گیت خبر استفاده می‌کند */
export function highImpactEvents(events: WireEvent[]): WireEvent[] {
  return events.filter((e) => e.impact.toLowerCase() === 'high');
}
