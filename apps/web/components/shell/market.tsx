"use client";
import { createContext, useContext } from "react";
import type { PriceTick, RoomInfo } from "@syb/shared";
import { usePrices, useRooms, useSparklines } from "@/lib/api";

interface Market {
  prices: Record<string, PriceTick>;
  sparks: Record<string, number[]>;
  rooms: RoomInfo[];
  apiDown: boolean;
}
const Ctx = createContext<Market>({ prices: {}, sparks: {}, rooms: [], apiDown: false });

export function MarketProvider({ children }: { children: React.ReactNode }) {
  const prices = usePrices();
  const sparks = useSparklines();
  const { rooms, error } = useRooms();
  return <Ctx.Provider value={{ prices, sparks, rooms, apiDown: error }}>{children}</Ctx.Provider>;
}
export const useMarket = () => useContext(Ctx);
