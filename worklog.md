# worklog — دقت‌افزایی عملی تسویهٔ تاریخچه (v1.1.0)

**تاریخ:** 2026-11-27 · **مهارت غالب:** build-studio · **زبان پاسخ:** فارسی RTL
**مخزن مبدأ:** `etemadkhob/bainer1405-` (commit `f5d359a`) · **شاخهٔ خروجی:** `fix/history-settlement-accuracy`

## INTAKE
درخواست کاربر: «ورود / تسویه در بخش تاریخچه چرا اشتباه است — طرف درست گفته ولی اعداد درست نیست — در روند صعودی و نزولی دقت کن» + «دقت را در عمل باز هم بهتر کنیم».

## PLAN → EXECUTE (Task ID: 1..6)
1. **واکشی مخزن** — GitHub API با PAT؛ کلون کامل (زبان TypeScript، React+Vite، سرور Express).
2. **مکان‌یابی** — بخش تاریخچه: `SignalHistoryTable.tsx`؛ منطق تسویه: `App.tsx` (settlePendingSignals / handleManualSettleSignal / recordSignalEntry / syncTargetCandleEntries)؛ داده: `marketData.ts` / `realtimeStream.ts` / `server.ts`.
3. **تشخیص ریشه (۵ عیب)** —
   - D1: fallback «نزدیک‌ترین» با `candles.find(|Δ|≤5min)` → تسویه با کندل اشتباه (اولین مورد آرایه، نه نزدیک‌ترین).
   - D2: تسویه با کندل در حال تشکیل / قیمت لحظه‌ای تیکر در تسویهٔ دستی میانهٔ کندل.
   - D3: داوری WIN/LOSS روی float خام در حالی که جدول اعداد رُند‌شده نشان می‌داد (تناقض عدد/وضعیت)؛ مساوی همیشه LOSS.
   - D4: تسویه با منبع synthetic (دادهٔ رندوم ساختگی!) یا CryptoCompare با مبنا متفاوت از کارگزاری.
   - D5: بازنویسی بی‌سروصدای عدد ورود در تسویه (بدون ثبت quote لحظهٔ صدور).
4. **اصلاح** — ماژول خالص جدید `src/engine/settlement.ts` (قواعد طلایی تسویه) + بازنویسی `App.tsx` + `SignalHistoryTable.tsx` (وضعیت TIE، برچسب ≈، tooltip ممیزی) + `marketData.ts` (fetch دقیق برای EURUSD) + تایپ‌ها (`TIE`, `entryQuote`, `settleSource`, `settleQuality`).
5. **تست شواهد** — `scripts/test_settlement.ts`: ۸ سناریو، مقایسهٔ عینی قدیم/جدید + بررسی زندهٔ بایننس.
6. **بسته‌بندی** — zip با manifest.json + checksums.txt (sha256) + README دوزبانه + اسکلت استقرار (wrangler/worker/Turso schema/CI).

## SELF-HEAL LOG (حداکثر ۳)
| # | نوع | شرح | راه‌حل | نتیجه |
|---|---|---|---|---|
| 1 | Dependency | ERESOLVE: vite@8.4 ↔ esbuild@0.25 | ارتقای esbuild به ^0.28.2 | سبز |
| 2 | Runtime | top-level await در تست با tsx/CJS | تبدیل به تابع async + finally | سبز |
| 3 | Logic | تست: تسویهٔ EURUSD از بایننس باید تقریبی باشد | اصلاح `settleQualityForSource` | سبز |

## شواهد اجرا (بدون شواهد، «انجام‌شده» گفته نمی‌شود)
- `npx tsx scripts/test_settlement.ts` → **23 PASS / 0 FAIL**
- `npx tsc --noEmit` → بدون خطا
- `npm run build` → dist ساخته شد (337KB js، بدون هشدار خطا)
- بررسی زندهٔ بایننس: تطابق کامل کندل 2026-11-27T10:35Z (open=61,631.24 / close=61,643.95)

## noQA — فرض‌های ثبت‌شده
- توکن `cfut_...` = Cloudflare API token (استقرار خودکار فقط بعد از تأیید در verify endpoint).
- شاخهٔ مستقل push شد؛ merge به main با PR (غیرمخرب).

## امنیت
- هیچ توکنی در کد/کامیت/zip نیست؛ همه فقط به‌صورت secret (GitHub Secrets / wrangler secret) استفاده می‌شوند.
- توصیهٔ پس از پایان کار: چرخش (rotate) توکن‌هایی که در چت ارسال شده‌اند.
