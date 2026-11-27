# Quant Oracle — bainer1405 (نسخهٔ دقت‌افزودهٔ ۱.۱.۰)

اپلیکیشن سیگنال کوانت معاملات کوتاه‌مدت (کندل ۵ دقیقه‌ای) برای بازارهای کریپتو و EURUSD،
با موتور چندلایه تحلیل تکنیکال، استریم زندهٔ بایننس و تسویهٔ دقیق سیگنال‌ها.

> **فارسی — خلاصهٔ اصلاح دقت (این نسخه):** خطای اعداد «ورود / تسویه» در بخش تاریخچه و داوری
> روند صعودی/نزولی ریشه‌یابی و رفع شد. پنج عیب اصلی:
> ۱. تسویه با کندلِ تا ۵ دقیقه دورتر از کندل هدف (fallback «نزدیک‌ترین» معیوب)؛
> ۲. تسویه با کندلِ در حال تشکیل یا «قیمت لحظه‌ای» به‌جای close کندل هدف؛
> ۳. داوری صعودی/نزولی روی اعداد رُند‌نشده که با اعداد نمایش‌داده‌شده تناقض داشت؛
> ۴. تسویه با دادهٔ ساختگی (synthetic) یا منابع با مبنا متفاوت؛
> ۵. بازنویسی بی‌سروصدای عدد ورود.
> اکنون: تسویه فقط با کندل دقیق هدفِ بسته‌شده؛ داوری روی همان اعداد نمایش‌داده‌شده؛
> مساوی = «برابر (TIE)»؛ دادهٔ ساختگی هرگز تسویه نمی‌کند؛ تسویهٔ تقریبی نادر و همیشه با برچسب «≈».
> شواهد اجرا: ۲۳ تست PASS (سناریوهای قبل/بعد + بررسی زندهٔ بایننس) — `scripts/test_settlement.ts`.

---

## English — Accuracy fix summary (v1.1.0)

The wrong «ورود / تسویه» (entry / settlement) numbers in the history table and the
upward/downward trend verdict were root-caused and fixed. Five main defects:

| # | Defect (before) | Fix (after) |
|---|---|---|
| 1 | Settlement could use a candle up to ±5 min away from the target candle (`candles.find` first-match fallback) | Settlement only with the exact target candle; closest-candle fallback only after 10 min, always labeled «تسویه تقریبی» (≈) |
| 2 | Settlement with the still-forming candle or the live ticker price (manual settle mid-candle) | Hard guard: never settle before `candleCloseTime`; manual settle requires a proven-closed exact candle |
| 3 | WIN/LOSS judged on unrounded floats while the table shows rounded numbers (contradiction); ties always recorded as LOSS | Verdict computed on display-quantized prices (`decimals`); ties become a new «برابر (TIE)» status, excluded from win-rate |
| 4 | Settlement from synthetic random-walk data or mismatched sources (CryptoCompare aggregate) | Synthetic data never settles (stays PENDING); settle quality per source: binance = exact, EURUSD via binance = approximate, labeled in UI |
| 5 | Entry price silently rewritten at settlement | Final entry locked to target-candle open (broker-consistent) + original issuance quote kept for audit (`entryQuote`, shown in tooltip) |

**Evidence:** 23 PASS / 0 FAIL — before/after numeric scenarios + live Binance candle match
(`scripts/test_settlement.ts`). Typecheck and production build pass.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # dist/ (production SPA)
```

## Deploy — GitHub + Cloudflare + Turso

See `deploy/README-FA.md` (Persian) for the full guide:

- **GitHub Actions** (`.github/workflows/deploy.yml`): typecheck → build → `wrangler deploy` (needs `CLOUDFLARE_API_TOKEN` secret).
- **Cloudflare Workers**: `wrangler.jsonc` serves the SPA from `dist/` and routes `/api/*` to `deploy/worker.ts` — no secrets required.
- **Turso (optional)**: `deploy/turso/schema.sql` + server-only secrets (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` via `wrangler secret put`). Never commit tokens.

## Accuracy rules (settlement engine — `src/engine/settlement.ts`)

1. Settle only against the exact target candle, proven closed (newer candle exists or close time + 3.5 s passed).
2. Judge the trend on the same numbers displayed in the table (quantized to asset `decimals`).
3. Equal entry/close ⇒ TIE (refund-like), never a fabricated LOSS.
4. Synthetic data never produces settlement numbers.
5. Approximate settlement: only after 10 minutes, closest-in-time candle, always labeled «≈».
