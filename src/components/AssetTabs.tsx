import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, Sparkles } from 'lucide-react';
import { ASSET_MAP, ASSETS } from '../constants/assets';
import { AssetId } from '../types/trading';

interface AssetTabsProps {
  selectedAssetId: AssetId;
  recommendedAssetId?: AssetId;
  onSelectAsset: (id: AssetId) => void;
}

export function AssetTabs({
  selectedAssetId,
  recommendedAssetId,
  onSelectAsset,
}: AssetTabsProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const activeAsset = ASSET_MAP[selectedAssetId];

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }

    const focusTimer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 30);

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const filteredAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? ASSETS.filter(
          (a) =>
            a.shortLabel.toLowerCase().includes(q) ||
            a.label.toLowerCase().includes(q) ||
            a.id.toLowerCase().includes(q)
        )
      : ASSETS;

    if (!recommendedAssetId || q) return list;
    return [...list].sort((a, b) => {
      if (a.id === recommendedAssetId) return -1;
      if (b.id === recommendedAssetId) return 1;
      return 0;
    });
  }, [query, recommendedAssetId]);

  return (
    <div ref={containerRef} className="relative z-30 w-full sm:w-72">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="انتخاب دارایی معاملاتی"
        className={`flex h-11 w-full items-center justify-between gap-3 rounded-xl border px-3.5 text-right transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
          open
            ? 'border-emerald-500/50 bg-[#111827] text-slate-50'
            : 'border-[#1E293B] bg-[#111827]/80 text-slate-100 hover:border-slate-700'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="truncate text-sm font-semibold text-slate-100">
            {activeAsset.shortLabel}
          </span>
          <span dir="ltr" className="font-mono text-xs text-slate-400">
            {activeAsset.label}
          </span>
        </div>

        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-150 ${
            open ? 'rotate-180 text-emerald-400' : ''
          }`}
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-full overflow-hidden rounded-xl border border-[#1E293B] bg-[#0F172A]/95 shadow-2xl backdrop-blur-xl">
          <div className="border-b border-[#1E293B] p-1.5">
            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-slate-500" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="جستجوی ارز..."
                className="h-8 w-full rounded-lg bg-[#090D16] pr-8 pl-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
              />
            </div>
          </div>

          <ul
            role="listbox"
            aria-label="فهرست دارایی‌ها"
            className="max-h-72 overflow-y-auto p-1"
          >
            {filteredAssets.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-slate-500">
                ارزی با این نام یافت نشد
              </li>
            ) : (
              filteredAssets.map((asset) => {
                const isSelected = asset.id === selectedAssetId;
                const isRecommended = asset.id === recommendedAssetId;

                return (
                  <li key={asset.id} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectAsset(asset.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-right transition-colors ${
                        isSelected
                          ? 'bg-emerald-500/12 text-emerald-300'
                          : 'text-slate-200 hover:bg-slate-800/70'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">{asset.shortLabel}</span>
                        <span
                          dir="ltr"
                          className={`font-mono text-xs ${
                            isSelected ? 'text-emerald-400/80' : 'text-slate-400'
                          }`}
                        >
                          {asset.label}
                        </span>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {isRecommended && (
                          <span
                            title="پیشنهاد هوشمند موتور کوانت"
                            className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400"
                          >
                            <Sparkles className="h-3 w-3" />
                            <span>برتر</span>
                          </span>
                        )}
                        {isSelected && <Check className="h-4 w-4 text-emerald-400" />}
                      </div>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
