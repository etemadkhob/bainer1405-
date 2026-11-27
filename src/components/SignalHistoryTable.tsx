import { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  Minus,
  Trash2,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { ASSET_MAP } from '../constants/assets';
import { SignalRecord } from '../types/trading';

interface SignalHistoryTableProps {
  signals: SignalRecord[];
  nowMs: number;
  onClearHistory: () => void;
  onManualSettle: (signalId: string) => void;
}

function formatShortTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString('fa-IR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function SignalHistoryTable({
  signals,
  nowMs,
  onClearHistory,
  onManualSettle,
}: SignalHistoryTableProps) {
  const [collapsed, setCollapsed] = useState<boolean>(false);

  const winCount = signals.filter((s) => s.status === 'WIN').length;
  const lossCount = signals.filter((s) => s.status === 'LOSS').length;
  const pendingCount = signals.filter((s) => s.status === 'PENDING').length;
  const tieCount = signals.filter((s) => s.status === 'TIE').length;

  return (
    <section
      aria-label="تاریخچه سیگنال‌های زنده"
      className="rounded-xl border border-[#1E293B] bg-[#111827]/80 backdrop-blur-md"
    >
      {/* Minimal Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-slate-100">تاریخچه سیگنال‌های زنده</h2>

          {signals.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-slate-400 tabular-nums">
              <span className="text-emerald-400">{winCount} برنده</span>
              <span aria-hidden="true">·</span>
              <span className="text-rose-400">{lossCount} بازنده</span>
              {tieCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-400">{tieCount} برابر</span>
                </>
              )}
              {pendingCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-amber-400">{pendingCount} در جریان</span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {signals.length > 0 && !collapsed && (
            <button
              type="button"
              onClick={onClearHistory}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#1E293B] bg-[#090D16] px-2.5 text-xs text-slate-400 transition-colors hover:border-rose-500/40 hover:text-rose-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>پاک‌سازی</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-expanded={!collapsed}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#1E293B] bg-[#090D16] px-2.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-700 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <span>{collapsed ? 'نمایش' : 'بستن'}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-150 ${
                collapsed ? '' : 'rotate-180 text-emerald-400'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Clean Compact Table */}
      {!collapsed && (
        <div className="border-t border-[#1E293B]">
          {signals.length === 0 ? (
            <div className="px-6 py-7 text-center text-xs text-slate-500">
              هنوز سیگنالی ثبت نشده است؛ سیگنال‌های تاییدشده پس از پایان کندل ۵ دقیقه‌ای به‌صورت
              خودکار تسویه می‌شوند.
            </div>
          ) : (
            <div className="max-h-72 overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-[620px] border-collapse text-right text-xs">
                <thead className="sticky top-0 z-10 bg-[#0D1320]">
                  <tr className="border-b border-[#1E293B] text-slate-400">
                    <th className="px-4 py-2.5 font-medium">زمان</th>
                    <th className="px-4 py-2.5 font-medium">دارایی</th>
                    <th className="px-4 py-2.5 font-medium">جهت</th>
                    <th className="px-4 py-2.5 font-medium">اطمینان</th>
                    <th className="px-4 py-2.5 font-medium">ورود / تسویه</th>
                    <th className="px-4 py-2.5 font-medium">وضعیت</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E293B]/60">
                  {signals.map((sig) => {
                    const isCall = sig.direction === 'CALL';
                    const assetInfo = ASSET_MAP[sig.assetId];
                    const secsLeft = Math.max(0, Math.ceil((sig.candleCloseTime - nowMs) / 1000));
                    const minsLeft = Math.floor(secsLeft / 60);
                    const remSecs = secsLeft % 60;
                    const etaStr = `${String(minsLeft).padStart(2, '0')}:${String(remSecs).padStart(
                      2,
                      '0'
                    )}`;

                    const fmtPrice = (value: number) =>
                      value.toLocaleString('en-US', {
                        minimumFractionDigits: sig.decimals,
                        maximumFractionDigits: sig.decimals,
                      });
                    const entryStr = fmtPrice(sig.entryPrice);
                    const closeStr =
                      sig.closePrice !== undefined ? fmtPrice(sig.closePrice) : null;

                    // ممیزی شفاف: قیمت لحظهٔ صدور، منبع و کیفیت تسویه در tooltip
                    const auditBits: string[] = [];
                    if (sig.entryQuote !== undefined && sig.entryQuote !== sig.entryPrice) {
                      auditBits.push(`قیمت لحظهٔ صدور: ${fmtPrice(sig.entryQuote)}`);
                    }
                    if (sig.settleSource) {
                      auditBits.push(`منبع تسویه: ${sig.settleSource}`);
                    }
                    if (sig.settleQuality === 'approximate') {
                      auditBits.push('تسویه تقریبی — کندل دقیق هدف در دسترس نبود');
                    }
                    const auditTitle =
                      auditBits.length > 0
                        ? `${sig.direction === 'CALL' ? 'CALL' : 'PUT'} | ${auditBits.join(' | ')}`
                        : undefined;

                    return (
                      <tr key={sig.id} className="transition-colors hover:bg-slate-800/25">
                        <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                          {formatShortTime(sig.issuedAt)}
                        </td>

                        <td className="px-4 py-2.5 font-medium text-slate-100">
                          {assetInfo?.shortLabel ?? sig.assetLabel}
                        </td>

                        <td className="px-4 py-2.5 font-semibold">
                          <span
                            className={`inline-flex items-center gap-1 ${
                              isCall ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {isCall ? (
                              <TrendingUp className="h-3.5 w-3.5" />
                            ) : (
                              <TrendingDown className="h-3.5 w-3.5" />
                            )}
                            <span>{isCall ? 'صعودی' : 'نزولی'}</span>
                          </span>
                        </td>

                        <td dir="ltr" className="px-4 py-2.5 text-right font-mono text-slate-300 tabular-nums">
                          {sig.confidence}%
                        </td>

                        <td
                          dir="ltr"
                          title={auditTitle}
                          className="px-4 py-2.5 text-right font-mono text-slate-200 tabular-nums"
                        >
                          {closeStr ? `${entryStr} → ${closeStr}` : entryStr}
                          {sig.settleQuality === 'approximate' && (
                            <span title="تسویه تقریبی" className="mr-1 text-amber-400">
                              ≈
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-2.5">
                          {sig.status === 'PENDING' && (
                            <div className="inline-flex items-center gap-2.5">
                              <span className="inline-flex items-center gap-1 font-medium text-amber-400">
                                <Clock className="h-3.5 w-3.5 shrink-0" />
                                {secsLeft > 0 ? (
                                  <span dir="ltr" className="font-mono tabular-nums">
                                    {etaStr}
                                  </span>
                                ) : (
                                  <span className="animate-pulse">در حال تسویه...</span>
                                )}
                              </span>

                              <button
                                type="button"
                                onClick={() => onManualSettle(sig.id)}
                                className="text-[11px] text-slate-400 underline-offset-4 transition-colors hover:text-amber-300 hover:underline"
                              >
                                تسویه
                              </button>
                            </div>
                          )}

                          {sig.status === 'WIN' && (
                            <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>برنده</span>
                            </span>
                          )}

                          {sig.status === 'LOSS' && (
                            <span className="inline-flex items-center gap-1 font-semibold text-rose-400">
                              <XCircle className="h-3.5 w-3.5" />
                              <span>بازنده</span>
                            </span>
                          )}

                          {sig.status === 'TIE' && (
                            <span className="inline-flex items-center gap-1 font-semibold text-slate-300">
                              <Minus className="h-3.5 w-3.5" />
                              <span>برابر</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
