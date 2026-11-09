export type InstrumentKind = "crypto" | "index";

export interface Instrument {
  /** Our short id, used in room names: inst-BTC */
  id: string;
  name: string;
  kind: InstrumentKind;
  emoji: string;
  /** Brand color for the badge */
  color: string;
  /** TradingView symbol for the chart widget */
  tvSymbol: string;
  /** Binance stream symbol (crypto) */
  binance?: string;
  /** Yahoo Finance symbol (indices, polled) */
  yahoo?: string;
  /** % move within ALARM_WINDOW_SEC that fires the room alarm */
  alarmPct: number;
  /** Mock mode start price */
  mockPrice: number;
}

/** Add a coin/index = add one line here. */
export const INSTRUMENTS: Instrument[] = [
  { id: "BTC", color: "#F7931A", name: "Bitcoin", kind: "crypto", emoji: "🟠", tvSymbol: "BINANCE:BTCUSDT", binance: "btcusdt", alarmPct: 1, mockPrice: 98000 },
  { id: "ETH", color: "#627EEA", name: "Ethereum", kind: "crypto", emoji: "💎", tvSymbol: "BINANCE:ETHUSDT", binance: "ethusdt", alarmPct: 1, mockPrice: 3600 },
  { id: "SOL", color: "#9945FF", name: "Solana", kind: "crypto", emoji: "🟣", tvSymbol: "BINANCE:SOLUSDT", binance: "solusdt", alarmPct: 1.5, mockPrice: 210 },
  { id: "XRP", color: "#23292F", name: "XRP", kind: "crypto", emoji: "💧", tvSymbol: "BINANCE:XRPUSDT", binance: "xrpusdt", alarmPct: 1.5, mockPrice: 2.4 },
  { id: "DOGE", color: "#C2A633", name: "Dogecoin", kind: "crypto", emoji: "🐕", tvSymbol: "BINANCE:DOGEUSDT", binance: "dogeusdt", alarmPct: 2, mockPrice: 0.38 },
  { id: "NDX", color: "#0091DA", name: "Nasdaq 100", kind: "index", emoji: "🇺🇸", tvSymbol: "NASDAQ:NDX", yahoo: "^NDX", alarmPct: 0.5, mockPrice: 21000 },
  { id: "SPX", color: "#3D5AFE", name: "S&P 500", kind: "index", emoji: "🗽", tvSymbol: "SP:SPX", yahoo: "^GSPC", alarmPct: 0.5, mockPrice: 6000 },
  { id: "BIST", color: "#E30A17", name: "BIST 100", kind: "index", emoji: "🇹🇷", tvSymbol: "BIST:XU100", yahoo: "XU100.IS", alarmPct: 0.7, mockPrice: 10500 },
  { id: "DXY", color: "#2E7D32", name: "Dolar Endeksi", kind: "index", emoji: "💵", tvSymbol: "TVC:DXY", yahoo: "DX-Y.NYB", alarmPct: 0.3, mockPrice: 106 },
  { id: "GOLD", color: "#D4AF37", name: "Altın", kind: "index", emoji: "🥇", tvSymbol: "TVC:GOLD", yahoo: "GC=F", alarmPct: 0.5, mockPrice: 2700 },
];

export const instrumentById = (id: string) => INSTRUMENTS.find((i) => i.id === id);
