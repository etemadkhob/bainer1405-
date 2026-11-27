# استقرار روی گیت‌هاب + کلودفلر + Turso

این ساختار با سه سرویس الزام‌شده کاملاً هماهنگ است:

## ۱) گیت‌هاب (مخزن + CI/CD)
- فایل `.github/workflows/deploy.yml` روی هر push به `main`:
  1. `npm ci`
  2. `npx tsc --noEmit` (کنترل تایپ)
  3. `npm run build` (خروجی `dist/`)
  4. `npx wrangler deploy` با secret به نام `CLOUDFLARE_API_TOKEN`
- Secrets لازم در گیت‌هاب (Settings → Secrets → Actions):
  - `CLOUDFLARE_API_TOKEN` — توکن API کلودفلر با دسترسی Workers/Pages

## ۲) کلودفلر (Workers + Static Assets)
- `wrangler.jsonc` در ریشه: اسپا از `dist/` سرو می‌شود، مسیرهای `/api/*` به `deploy/worker.ts` می‌روند.
- استقرار دستی: `npm run build && npx wrangler deploy`
- هیچ کلید مخفی لازم نیست — فقط APIهای عمومی بایننس استفاده می‌شود.
- تست سلامت: `https://<your-worker>.workers.dev/api/health`

## ۳) Turso (اختیاری — همگام‌سازی سروری تاریخچه)
نسخهٔ فعلی تاریخچه را در localStorage کلاینت نگه می‌دارد؛ برای پایداری بین دستگاه‌ها
می‌توانید همان جدول را در Turso نگه دارید:

```bash
turso db create bainri-apshn-koi-2 --location aws-eu-north-1   # اگر موجود نیست
turso db tokens create bainri-apshn-koi-2                      # توکن RW
```

اسکیمای آماده: `deploy/turso/schema.sql` (جدول `signal_records`).

در Worker (فقط سرور — هرگز در باندل فرانت‌اند):

```bash
wrangler secret put TURSO_DATABASE_URL   # libsql://...turso.io
wrangler secret put TURSO_AUTH_TOKEN     # JWT با محدوده rw
```

قاعدهٔ امنیتی: توکن‌ها فقط در GitHub Secrets / `wrangler secret put` / `.dev.vars`
(داخل `.gitignore`)؛ هرگز در کد کامیت‌شده.
