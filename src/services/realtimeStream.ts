import { ASSETS } from '../constants/assets';
import { AssetId, Candle } from '../types/trading';

export interface KlineTickPayload {
  assetId: AssetId;
  candle: Candle;
  isClosed: boolean;
}

const STREAM_SYMBOL_TO_ASSET: Record<string, AssetId> = ASSETS.reduce(
  (acc, item) => {
    acc[item.binanceSymbol] = item.id;
    return acc;
  },
  {} as Record<string, AssetId>
);

const COMBINED_STREAMS = ASSETS.map(
  (item) => `${item.binanceSymbol.toLowerCase()}@kline_5m`
).join('/');

const WS_ENDPOINTS = [
  `wss://data-stream.binance.vision/stream?streams=${COMBINED_STREAMS}`,
  `wss://stream.binance.com:9443/stream?streams=${COMBINED_STREAMS}`,
];

export function subscribeBinanceKlineStream(
  onTick: (tick: KlineTickPayload) => void,
  onStatusChange: (connected: boolean) => void
): () => void {
  let ws: WebSocket | null = null;
  let closedByClient = false;
  let reconnectTimer: number | null = null;
  let endpointIdx = 0;

  const connect = () => {
    if (closedByClient) return;
    const url = WS_ENDPOINTS[endpointIdx % WS_ENDPOINTS.length];

    try {
      ws = new WebSocket(url);
    } catch {
      onStatusChange(false);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      onStatusChange(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          data?: {
            e?: string;
            s?: string;
            k?: {
              t: number;
              o: string;
              h: string;
              l: string;
              c: string;
              v: string;
              x: boolean;
            };
          };
        };

        const k = msg?.data?.k;
        const sym = msg?.data?.s;
        if (!k || !sym) return;

        const assetId = STREAM_SYMBOL_TO_ASSET[sym];
        if (!assetId) return;

        onTick({
          assetId,
          candle: {
            time: Number(k.t),
            open: Number(k.o),
            high: Number(k.h),
            low: Number(k.l),
            close: Number(k.c),
            volume: Number(k.v),
          },
          isClosed: Boolean(k.x),
        });
      } catch {
        // Ignore malformed frames
      }
    };

    ws.onerror = () => {
      onStatusChange(false);
    };

    ws.onclose = () => {
      onStatusChange(false);
      if (!closedByClient) {
        endpointIdx += 1;
        scheduleReconnect();
      }
    };
  };

  const scheduleReconnect = () => {
    if (closedByClient || reconnectTimer !== null) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 2500);
  };

  connect();

  return () => {
    closedByClient = true;
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
    }
    if (ws && ws.readyState <= WebSocket.OPEN) {
      ws.close();
    }
  };
}
