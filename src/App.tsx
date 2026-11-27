import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Radar, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { AssetTabs } from './components/AssetTabs';
import { CountdownTimer } from './components/CountdownTimer';
import { Header } from './components/Header';
import { SignalCard } from './components/SignalCard';
import { SignalHistoryTable } from './components/SignalHistoryTable';
import { TimerPanel } from './components/TimerPanel';
import { TradingViewChart } from './components/TradingViewChart';
import { ASSET_MAP, ASSETS, FIVE_MINUTES_MS } from './constants/assets';
import { getSessionStatus, runQuantEngine, selectBestOpportunity } from './engine/quantEngine';
import {
  APPROX_SETTLE_DELAY_MS,
  judgeSignal,
  pickApproximateCandle,
  pickExactClosedCandle,
  settleQualityForSource,
} from './engine/settlement';
import {
  fetchExactCandleByOpenTime,
  fetchLiveTickers,
  fetchMarketCandles,
} from './services/marketData';
import { subscribeBinanceKlineStream } from './services/realtimeStream';
import {
  AssetId,
  Candle,
  MarketDataSource,
  QuantPrediction,
  SignalRecord,
  TickerSnapshot,
} from './types/trading';
import { playReminderChime, playSignalChime, unlockAudioContext } from './utils/audio';

const STORAGE_SIGNALS_KEY = 'quant_oracle_signals_v1';
const STORAGE_SOUND_KEY = 'quant_oracle_sound_v1';
const STORAGE_RESCAN_KEY = 'quant_oracle_rescan_v1';
const STORAGE_BREAK_KEY = 'quant_oracle_break_v1';

const RESCAN_ALLOWED = new Set([0, 60, 180, 300, 900]);
const BREAK_ALLOWED = new Set([0, 25, 45, 60]);

function loadStoredTimerOption(key: string, allowed: Set<number>, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    return allowed.has(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function loadStoredSignals(): SignalRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_SIGNALS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is Partial<SignalRecord> => Boolean(item && typeof item === 'object'))
      .map((item) => {
        const assetId: AssetId =
          item.assetId && item.assetId in ASSET_MAP ? item.assetId : 'BTCUSDT';
        const asset = ASSET_MAP[assetId];
        const issuedAt =
          typeof item.issuedAt === 'number' && Number.isFinite(item.issuedAt)
            ? item.issuedAt
            : Date.now() - FIVE_MINUTES_MS;
        const fallbackOpen = Math.floor(issuedAt / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
        const candleOpenTime =
          typeof item.candleOpenTime === 'number' && Number.isFinite(item.candleOpenTime)
            ? item.candleOpenTime
            : fallbackOpen;
        const candleCloseTime =
          typeof item.candleCloseTime === 'number' && Number.isFinite(item.candleCloseTime)
            ? item.candleCloseTime
            : candleOpenTime + FIVE_MINUTES_MS;

        return {
          id: typeof item.id === 'string' ? item.id : `${assetId}-${issuedAt}`,
          issuedAt,
          candleOpenTime,
          candleCloseTime,
          assetId,
          assetLabel: typeof item.assetLabel === 'string' ? item.assetLabel : asset.label,
          direction: item.direction === 'PUT' ? 'PUT' : 'CALL',
          confidence:
            typeof item.confidence === 'number' && Number.isFinite(item.confidence)
              ? item.confidence
              : 68,
          entryPrice:
            typeof item.entryPrice === 'number' && Number.isFinite(item.entryPrice)
              ? item.entryPrice
              : asset.basePrice,
          closePrice:
            typeof item.closePrice === 'number' && Number.isFinite(item.closePrice)
              ? item.closePrice
              : undefined,
          status:
            item.status === 'WIN' ||
            item.status === 'LOSS' ||
            item.status === 'TIE' ||
            item.status === 'PENDING'
              ? item.status
              : 'PENDING',
          reasons: Array.isArray(item.reasons) ? item.reasons : [],
          decimals:
            typeof item.decimals === 'number' && Number.isFinite(item.decimals)
              ? item.decimals
              : asset.decimals,
          entryQuote:
            typeof item.entryQuote === 'number' && Number.isFinite(item.entryQuote)
              ? item.entryQuote
              : undefined,
          settleSource:
            typeof item.settleSource === 'string'
              ? (item.settleSource as MarketDataSource)
              : undefined,
          settleQuality:
            item.settleQuality === 'approximate' || item.settleQuality === 'exact'
              ? item.settleQuality
              : undefined,
        };
      });
  } catch {
    return [];
  }
}

function loadStoredSound(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_SOUND_KEY);
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

function getRemainingSeconds(nowMs: number): number {
  const candleEnd = (Math.floor(nowMs / FIVE_MINUTES_MS) + 1) * FIVE_MINUTES_MS;
  return Math.max(0, Math.floor((candleEnd - nowMs) / 1000));
}

export default function App() {
  const [selectedAssetId, setSelectedAssetId] = useState<AssetId>('BTCUSDT');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(loadStoredSound);
  const [signals, setSignals] = useState<SignalRecord[]>(loadStoredSignals);
  const [tickers, setTickers] = useState<Partial<Record<AssetId, TickerSnapshot>>>({});
  const [predictions, setPredictions] = useState<Partial<Record<AssetId, QuantPrediction>>>({});
  const [candlesByAsset, setCandlesByAsset] = useState<Partial<Record<AssetId, Candle[]>>>({});
  const [liveCandles, setLiveCandles] = useState<Partial<Record<AssetId, Candle>>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() =>
    getRemainingSeconds(Date.now())
  );
  const [lastAutoTriggerAt, setLastAutoTriggerAt] = useState<number | null>(null);
  const [sessionState, setSessionState] = useState(() => getSessionStatus(new Date()));
  const [autoSelectBest, setAutoSelectBest] = useState<boolean>(true);
  const [scanningAll, setScanningAll] = useState<boolean>(false);

  // ---- تایمرهای عملیاتی (پنل جدید) ----
  const [sessionStartMs] = useState<number>(() => Date.now());
  const [rescanIntervalSec, setRescanIntervalSec] = useState<number>(() =>
    loadStoredTimerOption(STORAGE_RESCAN_KEY, RESCAN_ALLOWED, 0)
  );
  const [lastRescanAt, setLastRescanAt] = useState<number>(() => Date.now());
  const [breakReminderMin, setBreakReminderMin] = useState<number>(() =>
    loadStoredTimerOption(STORAGE_BREAK_KEY, BREAK_ALLOWED, 0)
  );
  const [lastBreakAt, setLastBreakAt] = useState<number>(() => Date.now());

  const candlesCacheRef = useRef<Partial<Record<AssetId, Candle[]>>>({});
  const closedKlinesRef = useRef<Record<string, Candle>>({});
  const syncedEntryIdsRef = useRef<Set<string>>(new Set());
  const sourceCacheRef = useRef<Partial<Record<AssetId, MarketDataSource>>>({});
  const signalsRef = useRef<SignalRecord[]>(signals);
  const tickersRef = useRef<Partial<Record<AssetId, TickerSnapshot>>>(tickers);
  const liveCandlesRef = useRef<Partial<Record<AssetId, Candle>>>(liveCandles);
  const settlingRef = useRef<boolean>(false);
  const triggeredBucketRef = useRef<number | null>(null);
  const lastOpenedBucketRef = useRef<number>(Math.floor(Date.now() / FIVE_MINUTES_MS));
  const selectedAssetRef = useRef<AssetId>(selectedAssetId);
  const soundEnabledRef = useRef<boolean>(soundEnabled);
  const autoSelectRef = useRef<boolean>(autoSelectBest);
  const remainingSecRef = useRef<number>(remainingSeconds);
  const scanningRef = useRef<boolean>(scanningAll);

  useEffect(() => {
    selectedAssetRef.current = selectedAssetId;
  }, [selectedAssetId]);

  useEffect(() => {
    autoSelectRef.current = autoSelectBest;
  }, [autoSelectBest]);

  useEffect(() => {
    scanningRef.current = scanningAll;
  }, [scanningAll]);

  useEffect(() => {
    signalsRef.current = signals;
    try {
      localStorage.setItem(STORAGE_SIGNALS_KEY, JSON.stringify(signals.slice(0, 100)));
    } catch {
      // Ignore storage quota errors
    }
  }, [signals]);

  useEffect(() => {
    tickersRef.current = tickers;
  }, [tickers]);

  useEffect(() => {
    liveCandlesRef.current = liveCandles;
  }, [liveCandles]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    try {
      localStorage.setItem(STORAGE_SOUND_KEY, String(soundEnabled));
    } catch {
      // Ignore storage quota errors
    }
  }, [soundEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_RESCAN_KEY, String(rescanIntervalSec));
    } catch {
      // Ignore storage quota errors
    }
  }, [rescanIntervalSec]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_BREAK_KEY, String(breakReminderMin));
    } catch {
      // Ignore storage quota errors
    }
  }, [breakReminderMin]);

  // تغییر گزینه‌ها چرخهٔ شمارش همان تایمر را از نو آغاز می‌کند
  useEffect(() => {
    setLastRescanAt(Date.now());
  }, [rescanIntervalSec]);

  useEffect(() => {
    setLastBreakAt(Date.now());
  }, [breakReminderMin]);

  const activeAsset = ASSET_MAP[selectedAssetId];

  const recordSignalEntry = useCallback(
    (pred: QuantPrediction, customEntryPrice?: number, isOfficial = false) => {
      if (pred.direction !== 'CALL' && pred.direction !== 'PUT') return;
      const asset = ASSET_MAP[pred.assetId];
      const now = Date.now();
      const currentCandleStart = Math.floor(now / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
      const currentCandleClose = currentCandleStart + FIVE_MINUTES_MS;
      const secsLeftInCurrent = Math.max(0, Math.floor((currentCandleClose - now) / 1000));

      // Official :45 trigger (or manual entry in the last 60s) targets the NEXT 5m candle.
      // Manual entry earlier in the candle targets the current candle's close so it settles with the visible timer.
      const targetNextCandle = isOfficial || secsLeftInCurrent <= 60;
      const targetOpenTime = targetNextCandle ? currentCandleClose : currentCandleStart;
      const targetCloseTime = targetOpenTime + FIVE_MINUTES_MS;

      // Always capture the freshest live market price instead of potentially stale REST entryPrice
      const liveTicker = tickersRef.current[pred.assetId];
      const liveCandle = liveCandlesRef.current[pred.assetId];
      const freshestPrice =
        liveTicker && now - liveTicker.updatedAt < 10_000
          ? liveTicker.price
          : liveCandle?.close ?? pred.entryPrice;
      const entry = customEntryPrice ?? freshestPrice;

      if (soundEnabledRef.current) {
        playSignalChime(pred.direction);
      }

      const newRecord: SignalRecord = {
        id: `${asset.id}-${now}`,
        issuedAt: now,
        candleOpenTime: targetOpenTime,
        candleCloseTime: targetCloseTime,
        assetId: asset.id,
        assetLabel: asset.label,
        direction: pred.direction,
        confidence: pred.confidence,
        entryPrice: entry,
        entryQuote: entry,
        status: 'PENDING',
        reasons: pred.reasons,
        decimals: asset.decimals,
      };

      // Mid-candle manual entries stay locked at the exact click price
      if (!targetNextCandle) {
        syncedEntryIdsRef.current.add(newRecord.id);
      }

      setSignals((prev) => [newRecord, ...prev].slice(0, 100));
    },
    []
  );

  const syncTargetCandleEntries = useCallback((assetId: AssetId, candle: Candle) => {
    const hasPendingToSync = signalsRef.current.some(
      (sig) =>
        sig.status === 'PENDING' &&
        sig.assetId === assetId &&
        sig.candleOpenTime > sig.issuedAt &&
        !syncedEntryIdsRef.current.has(sig.id) &&
        Math.abs(candle.time - sig.candleOpenTime) < 30_000
    );
    if (!hasPendingToSync) return;

    setSignals((prev) =>
      prev.map((sig) => {
        if (
          sig.status !== 'PENDING' ||
          sig.assetId !== assetId ||
          sig.candleOpenTime <= sig.issuedAt ||
          syncedEntryIdsRef.current.has(sig.id) ||
          Math.abs(candle.time - sig.candleOpenTime) >= 30_000
        ) {
          return sig;
        }
        syncedEntryIdsRef.current.add(sig.id);
        return {
          ...sig,
          entryPrice: candle.open,
        };
      })
    );
  }, []);

  const analyzeAsset = useCallback(
    async (
      assetId: AssetId,
      isOfficialTrigger: boolean,
      showSpinner = false,
      autoRecord = true
    ) => {
      const asset = ASSET_MAP[assetId];
      if (showSpinner) {
        setLoading(true);
      }

      try {
        const feed = await fetchMarketCandles(asset);
        candlesCacheRef.current[assetId] = feed.candles;
        sourceCacheRef.current[assetId] = feed.source;
        setCandlesByAsset((prev) => ({ ...prev, [assetId]: feed.candles }));

        // Cache all finalized historical bars (all except the currently forming last bar)
        for (let i = 0; i < feed.candles.length - 1; i++) {
          const c = feed.candles[i];
          closedKlinesRef.current[`${assetId}:${c.time}`] = c;
        }

        const lastCandle = feed.candles[feed.candles.length - 1];
        if (lastCandle) {
          syncTargetCandleEntries(assetId, lastCandle);
        }

        const existingTicker = tickersRef.current[assetId];
        const hasFreshWsTick =
          existingTicker && Date.now() - existingTicker.updatedAt < 4500 && assetId !== 'EURUSD';

        if (!hasFreshWsTick) {
          setLiveCandles((prev) => ({ ...prev, [assetId]: lastCandle }));
          setTickers((prev) => {
            const prevTicker = prev[assetId];
            const prevPrice = prevTicker?.price ?? lastCandle.close;
            return {
              ...prev,
              [assetId]: {
                price: lastCandle.close,
                change24hPct: prevTicker?.change24hPct ?? 0,
                tickDirection:
                  lastCandle.close > prevPrice
                    ? 'up'
                    : lastCandle.close < prevPrice
                    ? 'down'
                    : prevTicker?.tickDirection ?? 'flat',
                updatedAt: Date.now(),
              },
            };
          });
        }

        const liveWsCandle = liveCandlesRef.current[assetId];
        const effectiveCandles =
          liveWsCandle &&
          lastCandle &&
          liveWsCandle.time === lastCandle.time &&
          assetId !== 'EURUSD'
            ? [...feed.candles.slice(0, -1), liveWsCandle]
            : feed.candles;

        const result = runQuantEngine(asset, effectiveCandles, feed.source, isOfficialTrigger);
        setPredictions((prev) => ({ ...prev, [assetId]: result }));

        if (isOfficialTrigger && autoRecord) {
          setLastAutoTriggerAt(Date.now());
          if (result.direction === 'CALL' || result.direction === 'PUT') {
            recordSignalEntry(result, undefined, true);
          }
        }

        return result;
      } finally {
        if (showSpinner) {
          setLoading(false);
        }
      }
    },
    [recordSignalEntry, syncTargetCandleEntries]
  );

  const scanAllAssets = useCallback(
    async (isOfficialTrigger: boolean, forceAutoPick = false) => {
      setLoading(true);
      setScanningAll(true);
      const scannedMap: Partial<Record<AssetId, QuantPrediction>> = {};

      try {
        // Prioritize active asset first so main chart hydrates immediately, then batch remaining assets
        const orderedAssets = [
          ASSET_MAP[selectedAssetRef.current],
          ...ASSETS.filter((a) => a.id !== selectedAssetRef.current),
        ];

        for (let i = 0; i < orderedAssets.length; i += 5) {
          const batch = orderedAssets.slice(i, i + 5);
          const results = await Promise.all(
            batch.map((asset) => analyzeAsset(asset.id, isOfficialTrigger, false, false))
          );
          for (let j = 0; j < batch.length; j++) {
            scannedMap[batch[j].id] = results[j];
          }
        }

        const bestSummary = selectBestOpportunity(scannedMap);
        if (bestSummary && (autoSelectRef.current || forceAutoPick)) {
          setSelectedAssetId(bestSummary.best.assetId);
        }

        if (isOfficialTrigger) {
          setLastAutoTriggerAt(Date.now());
          const targetPred =
            bestSummary && (autoSelectRef.current || forceAutoPick)
              ? bestSummary.best
              : scannedMap[selectedAssetRef.current];
          if (targetPred && (targetPred.direction === 'CALL' || targetPred.direction === 'PUT')) {
            recordSignalEntry(targetPred, undefined, true);
          }
        }
      } finally {
        setLoading(false);
        setScanningAll(false);
      }
    },
    [analyzeAsset, recordSignalEntry]
  );

  const settlePendingSignals = useCallback(async () => {
    if (settlingRef.current) return;
    const now = Date.now();
    // Wait 1.5s past candleCloseTime unless WebSocket already confirmed the bar closed
    const readyToSettle = signalsRef.current.filter((sig) => {
      if (sig.status !== 'PENDING') return false;
      const wsClosed = closedKlinesRef.current[`${sig.assetId}:${sig.candleOpenTime}`];
      return Boolean(wsClosed) || now >= sig.candleCloseTime + 1500;
    });
    if (readyToSettle.length === 0) return;

    settlingRef.current = true;
    try {
      const uniqueAssetIds = Array.from(new Set(readyToSettle.map((s) => s.assetId)));
      const results = await Promise.all(
        uniqueAssetIds.map(async (id) => {
          const asset = ASSET_MAP[id];
          if (!asset)
            return {
              id,
              candles: [] as Candle[],
              source: undefined as MarketDataSource | undefined,
            };
          try {
            const feed = await fetchMarketCandles(asset);
            for (let i = 0; i < feed.candles.length - 1; i++) {
              const c = feed.candles[i];
              closedKlinesRef.current[`${id}:${c.time}`] = c;
            }
            return { id, candles: feed.candles, source: feed.source };
          } catch {
            return {
              id,
              candles: candlesCacheRef.current[id] ?? [],
              source: sourceCacheRef.current[id],
            };
          }
        })
      );

      const candleMap = new Map(results.map((r) => [r.id, r.candles]));
      const sourceMap = new Map(results.map((r) => [r.id, r.source]));

      // Fetch exact historical bar from Binance if a pending signal is outside the 220-bar window
      const exactFallbackMap = new Map<string, { candle: Candle; approximate: boolean }>();
      await Promise.all(
        readyToSettle.map(async (sig) => {
          const wsClosed = closedKlinesRef.current[`${sig.assetId}:${sig.candleOpenTime}`];
          if (wsClosed) return;
          const candles = candleMap.get(sig.assetId) ?? candlesCacheRef.current[sig.assetId] ?? [];
          const found = pickExactClosedCandle(
            candles,
            sig.candleOpenTime,
            sig.candleCloseTime,
            Date.now()
          );
          if (!found) {
            const asset = ASSET_MAP[sig.assetId];
            if (asset) {
              const fetched = await fetchExactCandleByOpenTime(asset, sig.candleOpenTime);
              if (fetched) {
                if (sig.assetId === 'EURUSD') {
                  // EURUSDT بایننس در برابر ورودِ یاهو مبنا دارد → تسویه با برچسب تقریبی
                  exactFallbackMap.set(sig.id, { candle: fetched, approximate: true });
                } else {
                  closedKlinesRef.current[`${sig.assetId}:${sig.candleOpenTime}`] = fetched;
                }
              }
            }
          }
        })
      );

      setSignals((latest) =>
        latest.map((sig) => {
          if (sig.status !== 'PENDING') return sig;

          const currentNow = Date.now();

          // گارد سخت: هرگز قبل از بسته‌شدن واقعی کندل هدف تسویه نکن
          if (currentNow < sig.candleCloseTime) return sig;

          const wsClosed = closedKlinesRef.current[`${sig.assetId}:${sig.candleOpenTime}`];
          const exactFallback = exactFallbackMap.get(sig.id);

          if (!wsClosed && !exactFallback && currentNow < sig.candleCloseTime + 1500) {
            return sig;
          }

          let settledCandle: Candle | undefined;
          let settleSource: MarketDataSource | undefined;
          let settleQuality: 'exact' | 'approximate' = 'exact';

          if (wsClosed) {
            // کندل بسته‌شده که مستقیماً از استریم WebSocket تایید شده است
            settledCandle = wsClosed;
            settleSource = 'binance_vision';
          } else if (exactFallback) {
            settledCandle = exactFallback.candle;
            settleSource = 'binance';
            settleQuality = exactFallback.approximate ? 'approximate' : 'exact';
          } else {
            const candles = candleMap.get(sig.assetId) ?? candlesCacheRef.current[sig.assetId] ?? [];
            const feedSource = sourceMap.get(sig.assetId) ?? sourceCacheRef.current[sig.assetId];

            // دادهٔ ساختگی هرگز نباید عدد تسویه تولید کند — سیگنال PENDING می‌ماند
            if (feedSource === 'synthetic') return sig;

            const exactClosed = pickExactClosedCandle(
              candles,
              sig.candleOpenTime,
              sig.candleCloseTime,
              currentNow
            );
            if (exactClosed) {
              settledCandle = exactClosed;
              settleSource = feedSource;
              settleQuality = settleQualityForSource(sig.assetId, feedSource);
            } else if (currentNow >= sig.candleCloseTime + APPROX_SETTLE_DELAY_MS) {
              // آخرین راه پس از ۱۰ دقیقه: نزدیک‌ترین کندل از نظر زمان، همیشه با برچسب تقریبی
              const approx = pickApproximateCandle(candles, sig.candleOpenTime);
              if (approx) {
                settledCandle = approx;
                settleSource = feedSource;
                settleQuality = 'approximate';
              }
            }
          }

          if (!settledCandle) return sig;

          let resolvedEntryPrice = sig.entryPrice;

          // If this was a next-candle signal, lock entryPrice to the exact candle open price
          if (sig.candleOpenTime > sig.issuedAt && !syncedEntryIdsRef.current.has(sig.id)) {
            resolvedEntryPrice = settledCandle.open;
            syncedEntryIdsRef.current.add(sig.id);
          }

          // داوری روی اعدادِ رُند‌شدهٔ نمایش‌دادنی تا جدول هرگز با وضعیت تناقض نداشته باشد
          const verdict = judgeSignal(
            sig.direction,
            resolvedEntryPrice,
            settledCandle.close,
            sig.decimals
          );

          return {
            ...sig,
            entryPrice: verdict.entryPrice,
            closePrice: verdict.closePrice,
            status: verdict.status,
            settleSource,
            settleQuality,
          };
        })
      );
    } finally {
      settlingRef.current = false;
    }
  }, []);

  // Live Binance Vision WebSocket Stream: updates live prices and forming candle OHLC
  useEffect(() => {
    const unsubscribe = subscribeBinanceKlineStream(
      ({ assetId, candle, isClosed }) => {
        if (assetId === 'EURUSD' && sourceCacheRef.current.EURUSD === 'yahoo_fx') {
          return;
        }

        if (isClosed) {
          closedKlinesRef.current[`${assetId}:${candle.time}`] = candle;
          if (
            signalsRef.current.some(
              (sig) =>
                sig.status === 'PENDING' &&
                sig.assetId === assetId &&
                Math.abs(sig.candleOpenTime - candle.time) < 30_000
            )
          ) {
            settlePendingSignals();
          }
        }

        syncTargetCandleEntries(assetId, candle);
        setLiveCandles((prev) => ({ ...prev, [assetId]: candle }));
        setTickers((prev) => {
          const prevTicker = prev[assetId];
          const prevPrice = prevTicker?.price ?? candle.close;
          const tickDirection =
            candle.close > prevPrice
              ? 'up'
              : candle.close < prevPrice
              ? 'down'
              : prevTicker?.tickDirection ?? 'flat';

          return {
            ...prev,
            [assetId]: {
              price: candle.close,
              change24hPct: prevTicker?.change24hPct ?? 0,
              tickDirection,
              updatedAt: Date.now(),
            },
          };
        });
      },
      (connected) => setWsConnected(connected)
    );

    return unsubscribe;
  }, [settlePendingSignals, syncTargetCandleEntries]);

  // Fast 3-second server ticker sync + continuous 2-second settlement monitor
  useEffect(() => {
    let active = true;

    const syncTickers = async () => {
      const serverTickers = await fetchLiveTickers();
      if (!active || Object.keys(serverTickers).length === 0) return;

      setTickers((prev) => {
        const next = { ...prev };
        for (const [id, info] of Object.entries(serverTickers)) {
          if (!info) continue;
          const assetId = id as AssetId;
          const prevSnap = prev[assetId];
          const prevPrice = prevSnap?.price ?? info.price;
          next[assetId] = {
            price: info.price,
            change24hPct: info.change24hPct,
            tickDirection:
              info.price > prevPrice
                ? 'up'
                : info.price < prevPrice
                ? 'down'
                : prevSnap?.tickDirection ?? 'flat',
            updatedAt: info.updatedAt,
          };
        }
        return next;
      });
    };

    syncTickers();
    settlePendingSignals();

    const tickerTimer = window.setInterval(syncTickers, 3000);
    const settleTimer = window.setInterval(() => {
      settlePendingSignals();
    }, 2000);

    return () => {
      active = false;
      window.clearInterval(tickerTimer);
      window.clearInterval(settleTimer);
    };
  }, [settlePendingSignals]);

  // Initial scan of all 5 assets on mount
  useEffect(() => {
    scanAllAssets(false);
  }, [scanAllAssets]);

  // حلقهٔ تایمرهای عملیاتی: بازاسکن دوره‌ای + یادآور استراحت (دقت ۱ ثانیه)
  useEffect(() => {
    const handleTimers = () => {
      const now = Date.now();

      // بازاسکن دوره‌ای — با گارد پنجرهٔ امن (۵۰ ثانیهٔ پایانی کندل / حین اسکن)
      if (
        rescanIntervalSec > 0 &&
        !scanningRef.current &&
        now - lastRescanAt >= rescanIntervalSec * 1000 &&
        remainingSecRef.current > 50
      ) {
        setLastRescanAt(now);
        scanAllAssets(false);
      }

      // یادآور استراحت — زنگ ملایم و آغاز خودکار چرخهٔ بعدی
      if (breakReminderMin > 0 && now - lastBreakAt >= breakReminderMin * 60_000) {
        setLastBreakAt(now);
        if (soundEnabledRef.current) {
          playReminderChime();
        }
      }
    };

    const timerTimer = window.setInterval(handleTimers, 1000);
    return () => window.clearInterval(timerTimer);
  }, [scanAllAssets, rescanIntervalSec, breakReminderMin, lastRescanAt, lastBreakAt]);

  // Atomic 5-minute clock loop (250ms precision)
  useEffect(() => {
    const tick = () => {
      const current = Date.now();
      setNowMs(current);
      const rem = getRemainingSeconds(current);
      setRemainingSeconds(rem);
      remainingSecRef.current = rem;

      const remMins = Math.floor(rem / 60);
      const secs = rem % 60;
      const currentBucket = Math.floor(current / FIVE_MINUTES_MS);

      if (secs % 30 === 0) {
        setSessionState(getSessionStatus(new Date(current)));
      }

      // Auto-trigger engine strictly at remMins === 0 && secs === 45
      if (remMins === 0 && secs === 45 && triggeredBucketRef.current !== currentBucket) {
        triggeredBucketRef.current = currentBucket;
        scanAllAssets(true);
      }

      // Immediately settle any PENDING signal whose candleCloseTime has arrived
      if (
        signalsRef.current.some(
          (sig) => sig.status === 'PENDING' && current >= sig.candleCloseTime
        )
      ) {
        settlePendingSignals();
      }

      // When a new 5m candle opens: settle expired PENDING signals & refresh locked candle analysis
      if (currentBucket !== lastOpenedBucketRef.current) {
        lastOpenedBucketRef.current = currentBucket;
        window.setTimeout(() => {
          settlePendingSignals();
          scanAllAssets(false);
        }, 1200);
      }
    };

    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [scanAllAssets, settlePendingSignals]);

  const handleManualSettleSignal = useCallback((signalId: string) => {
    const now = Date.now();
    setSignals((prev) =>
      prev.map((sig) => {
        if (sig.id !== signalId || sig.status !== 'PENDING') return sig;

        // دقت: تسویهٔ دستی فقط پس از بسته‌شدن واقعی کندل و فقط با کندل دقیق هدف مجاز است
        if (now < sig.candleCloseTime) return sig;

        const exactClosed =
          closedKlinesRef.current[`${sig.assetId}:${sig.candleOpenTime}`] ??
          pickExactClosedCandle(
            candlesCacheRef.current[sig.assetId] ?? [],
            sig.candleOpenTime,
            sig.candleCloseTime,
            now
          );
        if (!exactClosed) return sig; // به‌جای حدس زدن عدد، در انتظار دادهٔ دقیق می‌مانیم

        let resolvedEntry = sig.entryPrice;
        if (sig.candleOpenTime > sig.issuedAt && !syncedEntryIdsRef.current.has(sig.id)) {
          resolvedEntry = exactClosed.open;
          syncedEntryIdsRef.current.add(sig.id);
        }

        const verdict = judgeSignal(sig.direction, resolvedEntry, exactClosed.close, sig.decimals);
        return {
          ...sig,
          entryPrice: verdict.entryPrice,
          closePrice: verdict.closePrice,
          status: verdict.status,
          settleSource: sourceCacheRef.current[sig.assetId],
          settleQuality: settleQualityForSource(sig.assetId, sourceCacheRef.current[sig.assetId]),
        };
      })
    );
  }, []);

  const { winRate, settledCount } = useMemo(() => {
    const settled = signals.filter((s) => s.status === 'WIN' || s.status === 'LOSS');
    if (settled.length === 0) return { winRate: null, settledCount: 0 };
    const wins = settled.filter((s) => s.status === 'WIN').length;
    return {
      winRate: (wins / settled.length) * 100,
      settledCount: settled.length,
    };
  }, [signals]);

  const handleToggleSound = () => {
    setSoundEnabled((prev) => {
      const next = !prev;
      if (next) unlockAudioContext();
      return next;
    });
  };

  const bestOpportunity = useMemo(() => selectBestOpportunity(predictions), [predictions]);
  const bestAsset = bestOpportunity ? ASSET_MAP[bestOpportunity.best.assetId] : null;
  const activePrediction = predictions[selectedAssetId] ?? null;
  const activeCandles = candlesByAsset[selectedAssetId] ?? [];
  const activeLivePrice = tickers[selectedAssetId]?.price;
  const activeLiveCandle = liveCandles[selectedAssetId];

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100">
      <Header
        sessionName={sessionState.sessionName}
        isOptimalSession={sessionState.isOptimal}
        winRate={winRate}
        settledCount={settledCount}
        soundEnabled={soundEnabled}
        wsConnected={wsConnected}
        onToggleSound={handleToggleSound}
      />

      <main className="mx-auto max-w-[1440px] space-y-4 px-4 py-4 sm:px-6 sm:py-5">
        {/* Clean Asset Dropdown + Smart 20-Market Opportunity Recommender */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <AssetTabs
            selectedAssetId={selectedAssetId}
            recommendedAssetId={bestOpportunity?.best.assetId}
            onSelectAsset={(id) => {
              unlockAudioContext();
              setAutoSelectBest(false);
              setSelectedAssetId(id);
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            {bestOpportunity && bestAsset && (
              <button
                type="button"
                onClick={() => {
                  unlockAudioContext();
                  setAutoSelectBest(true);
                  setSelectedAssetId(bestAsset.id);
                }}
                className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                  bestOpportunity.best.direction === 'CALL'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'
                    : bestOpportunity.best.direction === 'PUT'
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/15'
                    : 'border-[#1E293B] bg-[#111827]/80 text-slate-300 hover:border-slate-700'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {bestOpportunity.best.direction === 'WAIT'
                    ? 'آماده‌ترین گزینه:'
                    : 'پیشنهاد هوشمند:'}
                </span>
                <span className="font-semibold text-slate-100">{bestAsset.shortLabel}</span>
                {bestOpportunity.best.direction === 'CALL' && (
                  <span className="inline-flex items-center gap-0.5 font-semibold text-emerald-400">
                    <TrendingUp className="h-3.5 w-3.5" />
                    صعودی
                  </span>
                )}
                {bestOpportunity.best.direction === 'PUT' && (
                  <span className="inline-flex items-center gap-0.5 font-semibold text-rose-400">
                    <TrendingDown className="h-3.5 w-3.5" />
                    نزولی
                  </span>
                )}
                <span dir="ltr" className="font-mono font-bold tabular-nums">
                  {bestOpportunity.best.confidence}%
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                unlockAudioContext();
                setAutoSelectBest((prev) => {
                  const next = !prev;
                  if (next && bestOpportunity) {
                    setSelectedAssetId(bestOpportunity.best.assetId);
                  }
                  return next;
                });
              }}
              aria-pressed={autoSelectBest}
              className={`inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                autoSelectBest
                  ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-300'
                  : 'border-[#1E293B] bg-[#111827]/80 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>انتخاب خودکار: {autoSelectBest ? 'فعال' : 'دستی'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                unlockAudioContext();
                setAutoSelectBest(true);
                scanAllAssets(false, true);
              }}
              disabled={scanningAll}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#1E293B] bg-[#111827]/80 px-3 text-xs font-medium text-slate-200 transition-colors hover:border-slate-700 hover:bg-slate-800/80 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              <Radar className={`h-3.5 w-3.5 text-emerald-400 ${scanningAll ? 'animate-spin' : ''}`} />
              <span>{scanningAll ? 'در حال اسکن...' : 'اسکن هوشمند'}</span>
            </button>
          </div>
        </div>

        {/* Main Split Workspace: Right 65% Chart (first in RTL), Left 35% Timer + Hero Signal Card */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[65fr_35fr] lg:items-stretch">
          <TradingViewChart
            asset={activeAsset}
            candles={activeCandles}
            liveCandle={activeLiveCandle}
            prediction={activePrediction}
            remainingSeconds={remainingSeconds}
          />

          <div className="flex flex-col gap-4">
            <CountdownTimer
              remainingSeconds={remainingSeconds}
              lastAutoTriggerAt={lastAutoTriggerAt}
            />
            <TimerPanel
              nowMs={nowMs}
              fiveMinRemainingSec={remainingSeconds}
              sessionStartMs={sessionStartMs}
              lastAutoTriggerAt={lastAutoTriggerAt}
              scanningAll={scanningAll}
              rescanIntervalSec={rescanIntervalSec}
              lastRescanAt={lastRescanAt}
              breakReminderMin={breakReminderMin}
              lastBreakAt={lastBreakAt}
              onChangeRescanInterval={setRescanIntervalSec}
              onChangeBreakReminder={setBreakReminderMin}
            />
            <SignalCard
              asset={activeAsset}
              prediction={activePrediction}
              livePrice={activeLivePrice}
              liveCandle={activeLiveCandle}
              loading={loading}
              onManualAnalyze={() => {
                unlockAudioContext();
                analyzeAsset(selectedAssetId, false, true);
              }}
              onRecordSignal={(pred) => {
                unlockAudioContext();
                recordSignalEntry(pred, activeLivePrice, false);
              }}
            />
          </div>
        </div>

        <SignalHistoryTable
          signals={signals}
          nowMs={nowMs}
          onClearHistory={() => setSignals([])}
          onManualSettle={handleManualSettleSignal}
        />
      </main>
    </div>
  );
}
