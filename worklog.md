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
- `npx tsx scripts/test_settlement.ts` → **23 PASS / 0 FAIL** (اجرای نهایی پس از افزودن bybit)
- `npx tsc --noEmit` → بدون خطا · `npm run build` → dist سبز
- بررسی زندهٔ بایننس در تست: تطابق کامل کندل 2026-11-27T10:35Z (open=61,631.24 / close=61,643.95)

## ممیزی دادهٔ واقعی کاربر (جدول signals در Turso — ۵ رکورد موجود)
تطبیق هر رکورد با کندل حقیقی بایننس (`scripts/audit_turso_signals.py`، بدون تغییر داده):
- **ADAUSDT** — کاملاً درست (ورود=open، تسویه=close، WIN صحیح)
- **LTCUSDT** — ورود 44.51 ≠ حقیقت 44.52 و تسویه 44.47 ≠ حقیقت 44.46 (عدد غلط؛ حکم LOSS تصادفاً درست)
- **APTUSDT** — ورود 0.3919 ≠ 0.3917 و تسویه 0.3915 ≠ 0.3917؛ حقیقت open==close یعنی **برابر (TIE)** ولی اپ «بازنده» نوشته — دقیقاً همان گزارش کاربر
- **AVAXUSDT** — ورود 6.80 ≠ حقیقت open 6.79 (ورود قفل به کندل نشده بود)
- **UNIUSDT** — ورود 4.896 ≠ حقیقت 4.897
- **نتیجه: ۴ از ۵ رکورد عدد ورودِ اشتباه + ۱ رکورد عدد تسویهٔ اشتباه با حکم غلط** — ریشه: همان D1/D3/D5

## استقرار واقعی (الزام گیت‌هاب + کلودفلر + Turso)
- **Turso**: توکن تأیید شد؛ اسکیمای `signal_records` اعمال شد (جدول موجود: signals، schema_meta)
- **Cloudflare Workers**: `https://bainer1405-quant-oracle.hamid-khobee1.workers.dev`
  - `/` → 200 (اسپای فارسی RTL) · `/api/health` → ok v1.1.0 · `/api/tickers` → 18 تیکر
  - `/api/klines/BTCUSDT` → **bybit، ۲۲۰ کندل**؛ diag شفاف: binance 403 (بلاک edge) → okx 429 → bybit سبز
- **GitHub**: fork `hamidkhobee1-crypto/bainer1405-` شاخهٔ `fix/history-settlement-accuracy` + **PR #1** به مخزن اصلی
  - توکن به مخزن اصلی دسترسی نوشتن نداشت (403) → مسیر fork+PR (غیرمخرب)
- **یافتهٔ جانبی مهم**: CryptoCompare بدون API key غیرفعال شده (401) → fallback کلاینتِ قدیمی خراب بود؛ زنجیرهٔ جدید کلاینت/سرور: بایننس → OKX → Bybit → CC → (فقط برای موتور) synthetic

## SELF-HEAL LOG (حداکثر ۳) — به‌روزرسانی نهایی
| # | نوع | شرح | راه‌حل | نتیجه |
|---|---|---|---|---|
| 1 | Dependency | ERESOLVE: vite@8.4 ↔ esbuild@0.25 | ارتقای esbuild به ^0.28.2 | سبز |
| 2 | Runtime | top-level await در تست با tsx/CJS | تبدیل به تابع async + finally | سبز |
| 3 | Logic | تسویهٔ EURUSD از بایننس باید تقریبی باشد | اصلاح `settleQualityForSource` | سبز |
| + | Environment | push به مخزن اصلی 403 | fork + PR #1 | سبز |
| + | Environment | بایننس/OKX از edge کلودفلر بلاک (403/429) | fallback Bybit در Worker و کلاینت | سبز |

## noQA — فرض‌های ثبت‌شده
- توکن `cfut_...` = Cloudflare API token (استقرار خودکار فقط بعد از تأیید در verify endpoint).
- شاخهٔ مستقل push شد؛ merge به main با PR (غیرمخرب).

## امنیت
- هیچ توکنی در کد/کامیت/zip نیست؛ همه فقط به‌صورت secret (GitHub Secrets / wrangler secret) استفاده می‌شوند.
- توصیهٔ پس از پایان کار: چرخش (rotate) توکن‌هایی که در چت ارسال شده‌اند.

---

# worklog — تایمرهای مختلف (v1.2.0)

**تاریخ:** 2026-11-27 · **مهارت غالب:** build-studio · **درخواست:** «تایمر های مختلف اضافه کن»

## INTAKE → PLAN
اپ فقط یک تایمر مرئی داشت (کندل ۵ دقیقه) + ETA تسویه در جدول. خواسته: چند تایمر متفاوت و واقعاً کاربردی.
قید دقت: هیچ تایمر جدیدی نباید با پنجرهٔ تریگر رسمی (۴۵ ثانیهٔ پایانی) و موتور تسویهٔ v1.1.0 تداخل کند.

## EXECUTE (فایل‌ها)
- `src/utils/timers.ts` (جدید) — ریاضی خالص تایمرها: مرز UTC تایم‌فریم‌ها، شمارش تا تریگر، فرمت‌بندی، گارد پنجرهٔ امن
- `src/components/TimerPanel.tsx` (جدید) — پنل ۵ تایمر: 1m/5m/15m/1h + تریگر بعدی + بازاسکن دوره‌ای + سشن + یادآور استراحت
- `src/App.tsx` — state/refs جدید + یک اینتروال ۱ثانیه‌ای + گارد `remaining > 50` + ذخیرهٔ گزینه‌ها در localStorage
- `src/utils/audio.ts` — `playReminderChime` (C6→G5، triangle، گین کمتر — متمایز از چایم سیگنال)
- `deploy/worker.ts` — health → `version: 1.2.0`
- `scripts/test_timers.ts` (جدید) — تست شواهد ۳۱ سناریو

## تایمرهای افزوده‌شده
| # | تایمر | رفتار |
|---|---|---|
| T1 | مولتی‌تایم‌فریم 1m/5m/15m/1h | شمارش تا بسته‌شدن هر کندل، هم‌تراز UTC، نوار پیشرفت، هایلایت 5m |
| T2 | تریگر رسمی بعدی | شمارش تا لحظهٔ 00:45 (rem≥45 → rem−45؛ rem<45 → rem+255) |
| T3 | بازاسکن دوره‌ای | خاموش/۱/۳/۵/۱۵ دقیقه؛ در ۵۰ ثانیهٔ پایانی و حین اسکن به تعویق می‌افتد |
| T4 | مدت سشن | hh:mm:ss از زمان بارگذاری |
| T5 | یادآور استراحت | خاموش/۲۵/۴۵/۶۰ دقیقه؛ زنگ ملایم + چرخهٔ خودکار |

## SELF-HEAL (۱ رویداد)
| # | نوع | شرح | راه‌حل | نتیجه |
|---|---|---|---|---|
| 1 | Logic | off-by-one تریگر: در remaining=45 باید ۰ باشد نه ۳۰۰؛ + فرض مرز در تست‌ها غلط بود | `rem >= 45`؛ مرز تست = مضرب دقیق تایم‌فریم | سبز |

## شواهد اجرا
- `npx tsx scripts/test_timers.ts` → **31 PASS / 0 FAIL**
- `npx tsx scripts/test_settlement.ts` → **23 PASS / 0 FAIL** (رگرسیون دقت v1.1.0 سبز)
- `npx tsc --noEmit` → تمیز · `npm run build` → سبز (`index-Bh6WqrgZ.js`)
- استقرار: Version ID `8c754ccd` · `/api/health` → `{"ok":true,"version":"1.2.0"}` · SPA 200
- GitHub: شاخهٔ `feat/timer-suite` به فورک push شد → **PR #2** به مخزن اصلی باز شد
- بسته: `bainer1405-fix-v1.2.0-2026-11-27.zip` — ۴۲ فایل، testzip OK، sha256 ثبت شد

## noQA
- بازاسکن دوره‌ای فقط تحلیل تازه‌سازی می‌کند (`isOfficialTrigger=false`) و هرگز سیگنال ثبت نمی‌کند — آلوده‌کردن تاریخچه ممکن نیست.
- گزینهٔ پیش‌فرض بازاسکن و یادآور: خاموش؛ رفتار اپ بدون تغییر تا کاربر فعال کند.
- تایم‌فریم‌های 1m/15m/1h صرفاً نمایشی‌اند؛ موتور و تسویه همچنان فقط روی ۵ دقیقه کار می‌کنند.

## جدول صداقت
| ادعا | وضعیت | شاهد |
|---|---|---|
| ۵ تایمر جدید در کد | 🟢 | TimerPanel.tsx + سیم‌کشی App.tsx |
| تست ۳۱ سناریو | 🟢 | خروجی test_timers.ts |
| عدم رگرسیون دقت تسویه | 🟢 | 23 PASS / 0 FAIL |
| استقرار زنده v1.2.0 | 🟢 | health + Version ID |
| PR #2 به مخزن اصلی | 🟢 | api.github.com → state: open |
| بازبینی بصری پنل در مرورگر | 🟢 | اسکرین‌شات زندهٔ صفحهٔ deploy شده — ۴ کاشی + ۲ دراپ‌داون + تریگر 01:23 (rem=128s → 128−45) همگی درست |
