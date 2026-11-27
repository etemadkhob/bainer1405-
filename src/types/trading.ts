export type AssetId =
  | 'BTCUSDT'
  | 'ETHUSDT'
  | 'SOLUSDT'
  | 'BNBUSDT'
  | 'XRPUSDT'
  | 'ADAUSDT'
  | 'DOGEUSDT'
  | 'AVAXUSDT'
  | 'TRXUSDT'
  | 'TONUSDT'
  | 'DOTUSDT'
  | 'LINKUSDT'
  | 'SUIUSDT'
  | 'LTCUSDT'
  | 'BCHUSDT'
  | 'NEARUSDT'
  | 'UNIUSDT'
  | 'APTUSDT'
  | 'PAXGUSDT'
  | 'EURUSD';

export interface AssetConfig {
  id: AssetId;
  label: string;
  shortLabel: string;
  binanceSymbol: string;
  ccFsym: string;
  ccTsym: string;
  tvSymbol: string;
  decimals: number;
  basePrice: number;
  volatility: number;
}

export interface Candle {
  time: number; // Unix timestamp in ms (open time of 5m candle)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type MarketDataSource =
  | 'binance_ws'
  | 'binance_vision'
  | 'binance'
  | 'yahoo_fx'
  | 'cryptocompare'
  | 'synthetic';

export interface MarketFeedResult {
  candles: Candle[];
  source: MarketDataSource;
  fetchedAt: number;
}

export interface TickerSnapshot {
  price: number;
  change24hPct: number;
  tickDirection: 'up' | 'down' | 'flat';
  updatedAt: number;
}

export type SignalDirection = 'CALL' | 'PUT' | 'WAIT';

export type LayerSentiment = 'bullish' | 'bearish' | 'neutral' | 'warning';

export interface QuantLayerResult {
  id: string;
  index: number;
  name: string;
  metricLabel: string;
  metricValue: string;
  sentiment: LayerSentiment;
  summary: string;
  pointsCall: number;
  pointsPut: number;
}

export interface QuantPrediction {
  assetId: AssetId;
  direction: SignalDirection;
  confidence: number; // Strictly 50..86
  entryPrice: number;
  latestCandle: Candle;
  callScore: number;
  putScore: number;
  reasons: string[];
  layers: QuantLayerResult[];
  sessionName: string;
  isOptimalSession: boolean;
  volatilityBlocked: boolean;
  source: MarketDataSource;
  evaluatedAt: number;
  isOfficialTrigger: boolean;
}

export type SignalStatus = 'PENDING' | 'WIN' | 'LOSS';

export interface SignalRecord {
  id: string;
  issuedAt: number;
  candleOpenTime: number; // The target 5m candle open time being predicted
  candleCloseTime: number; // When the target 5m candle closes and settles
  assetId: AssetId;
  assetLabel: string;
  direction: 'CALL' | 'PUT';
  confidence: number;
  entryPrice: number;
  closePrice?: number;
  status: SignalStatus;
  reasons: string[];
  decimals: number;
}
