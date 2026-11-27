-- Turso (libSQL) — اسکیمای همگام‌سازی اختیاری تاریخچه سیگنال‌ها
-- اجرا: turso db shell bainri-apshn-koi-2 < deploy/turso/schema.sql

CREATE TABLE IF NOT EXISTS signal_records (
  id               TEXT PRIMARY KEY,          -- مثل: BTCUSDT-1795775700000
  issued_at        INTEGER NOT NULL,          -- ms epoch زمان صدور
  candle_open_time INTEGER NOT NULL,          -- ms epoch باز شدن کندل هدف
  candle_close_time INTEGER NOT NULL,         -- ms epoch بسته شدن کندل هدف
  asset_id         TEXT NOT NULL,
  asset_label      TEXT NOT NULL,
  direction        TEXT NOT NULL CHECK (direction IN ('CALL', 'PUT')),
  confidence       INTEGER NOT NULL,
  entry_price      REAL NOT NULL,             -- ورود (قفل‌شده به open کندل هدف)
  entry_quote      REAL,                      -- قیمت لحظهٔ صدور برای ممیزی
  close_price      REAL,                      -- تسویه (close کندل دقیق هدف)
  status           TEXT NOT NULL CHECK (status IN ('PENDING', 'WIN', 'LOSS', 'TIE')),
  settle_source    TEXT,                      -- منبع دادهٔ تسویه
  settle_quality   TEXT CHECK (settle_quality IN ('exact', 'approximate')),
  decimals         INTEGER NOT NULL DEFAULT 2,
  reasons          TEXT,                      -- JSON آرایه دلایل موتور
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_signal_records_asset_time
  ON signal_records (asset_id, candle_open_time DESC);

CREATE INDEX IF NOT EXISTS idx_signal_records_status
  ON signal_records (status);
