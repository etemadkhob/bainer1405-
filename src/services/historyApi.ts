/**
 * همگام‌سازی تاریخچهٔ سیگنال‌ها با دیتابیس سرور (Turso از طریق Worker).
 * خواندن: hydrate اولیه · نوشتن: upsert debounce شده.
 * شکستِ نرم: در نبودِ Worker/دیتابیس، اپ فقط با localStorage کار می‌کند.
 */

import type { SignalRecord } from '../types/trading';

const PUSH_DEBOUNCE_MS = 2500;
const MAX_RECORDS = 100;

let pushTimer: number | null = null;
let pendingRecords: Map<string, SignalRecord> = new Map();

export interface ServerSyncStatus {
  available: boolean;
  lastError?: string;
}

let lastStatus: ServerSyncStatus = { available: false };

export function serverSyncStatus(): ServerSyncStatus {
  return lastStatus;
}

function toWire(r: SignalRecord) {
  return {
    id: r.id,
    issued_at: r.issuedAt,
    candle_open_time: r.candleOpenTime,
    candle_close_time: r.candleCloseTime,
    asset_id: r.assetId,
    asset_label: r.assetLabel,
    direction: r.direction,
    confidence: Math.round(r.confidence),
    entry_price: r.entryPrice,
    entry_quote: r.entryQuote ?? null,
    close_price: r.closePrice ?? null,
    status: r.status,
    settle_source: r.settleSource ?? null,
    settle_quality: r.settleQuality ?? null,
    decimals: r.decimals,
    reasons: JSON.stringify(r.reasons ?? []),
  };
}

function fromWire(row: Record<string, unknown>): SignalRecord | null {
  try {
    const reasonsRaw = typeof row.reasons === 'string' ? row.reasons : '[]';
    const parsedReasons = JSON.parse(reasonsRaw);
    return {
      id: String(row.id),
      issuedAt: Number(row.issued_at),
      candleOpenTime: Number(row.candle_open_time),
      candleCloseTime: Number(row.candle_close_time),
      assetId: String(row.asset_id) as SignalRecord['assetId'],
      assetLabel: String(row.asset_label),
      direction: row.direction === 'PUT' ? 'PUT' : 'CALL',
      confidence: Number(row.confidence),
      entryPrice: Number(row.entry_price),
      entryQuote: row.entry_quote !== null && row.entry_quote !== undefined ? Number(row.entry_quote) : undefined,
      closePrice: row.close_price !== null && row.close_price !== undefined ? Number(row.close_price) : undefined,
      status: (['PENDING', 'WIN', 'LOSS', 'TIE'].includes(String(row.status))
        ? String(row.status)
        : 'PENDING') as SignalRecord['status'],
      settleSource: (row.settle_source as SignalRecord['settleSource']) ?? undefined,
      settleQuality: row.settle_quality === 'approximate' || row.settle_quality === 'exact'
        ? (row.settle_quality as SignalRecord['settleQuality'])
        : undefined,
      decimals: Number(row.decimals ?? 2),
      reasons: Array.isArray(parsedReasons) ? parsedReasons.map(String) : [],
    };
  } catch {
    return null;
  }
}

export async function fetchServerSignals(limit = MAX_RECORDS): Promise<SignalRecord[]> {
  try {
    const res = await fetch(`/api/signals?limit=${limit}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as { records?: Array<Record<string, unknown>> };
    const records = (payload.records ?? [])
      .map(fromWire)
      .filter((r): r is SignalRecord => r !== null);
    lastStatus = { available: true };
    return records;
  } catch (e) {
    lastStatus = { available: false, lastError: (e as Error).message };
    return [];
  }
}

export interface ServerStats {
  available: boolean;
  settled: number;
  wins: number;
  losses: number;
  winRate: number | null;
}

export async function fetchServerStats(): Promise<ServerStats> {
  try {
    const res = await fetch('/api/stats', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as {
      settled?: number;
      wins?: number;
      losses?: number;
    };
    const settled = payload.settled ?? 0;
    const wins = payload.wins ?? 0;
    const losses = payload.losses ?? 0;
    lastStatus = { available: true };
    return {
      available: true,
      settled,
      wins,
      losses,
      winRate: settled > 0 ? (wins / settled) * 100 : null,
    };
  } catch (e) {
    lastStatus = { available: false, lastError: (e as Error).message };
    return { available: false, settled: 0, wins: 0, losses: 0, winRate: null };
  }
}

/** upsert debounce شده — چند صدا در یک تیک، یک درخواست واحد */
export function queuePushSignals(records: SignalRecord[]): void {
  for (const r of records) {
    pendingRecords.set(r.id, r);
  }
  if (pushTimer !== null) return;
  pushTimer = window.setTimeout(async () => {
    pushTimer = null;
    const batch = Array.from(pendingRecords.values()).slice(0, MAX_RECORDS);
    pendingRecords = new Map();
    if (batch.length === 0) return;
    try {
      const res = await fetch('/api/signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: batch.map(toWire) }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      lastStatus = { available: true };
    } catch (e) {
      lastStatus = { available: false, lastError: (e as Error).message };
      // رکوردها را برای تلاش بعدی نگه دار (حداکثر سقف)
      for (const r of batch) {
        if (pendingRecords.size < MAX_RECORDS) pendingRecords.set(r.id, r);
      }
    }
  }, PUSH_DEBOUNCE_MS);
}

/** ادغام سرور + محلی بر اساس id؛ رکورد تسویه‌شده همیشه بر رکورد PENDING می‌چربد */
export function mergeRecords(local: SignalRecord[], server: SignalRecord[]): SignalRecord[] {
  const byId = new Map<string, SignalRecord>();
  for (const r of local) byId.set(r.id, r);
  for (const r of server) {
    const existing = byId.get(r.id);
    if (!existing) {
      byId.set(r.id, r);
      continue;
    }
    const serverSettled = r.status !== 'PENDING';
    const localSettled = existing.status !== 'PENDING';
    if (serverSettled && !localSettled) byId.set(r.id, r);
    else if (serverSettled && localSettled && r.settleQuality === 'exact' && existing.settleQuality !== 'exact') {
      byId.set(r.id, r);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => b.issuedAt - a.issuedAt)
    .slice(0, MAX_RECORDS);
}

// ---------------------------------------------------------------------------
// تقویم اقتصادی — پنجرهٔ بلوک ±۱۵ دقیقه اخبار مهم (از طریق Worker)
// ---------------------------------------------------------------------------
export interface CalendarEvent {
  title: string;
  currency: string;
  impact: string;
  time: number;
}

export async function fetchNewsEvents(): Promise<CalendarEvent[] | undefined> {
  try {
    const res = await fetch('/api/news', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as { available?: boolean; events?: CalendarEvent[] };
    if (!payload.available || !Array.isArray(payload.events)) return undefined;
    return payload.events;
  } catch {
    return undefined;
  }
}
