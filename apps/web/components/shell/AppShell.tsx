"use client";
import { useState } from "react";
import { MarketProvider, useMarket } from "./market";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { CreateRoomModal } from "../CreateRoomModal";

function ApiBanner() {
  const { apiDown } = useMarket();
  if (!apiDown) return null;
  return <div className="api-banner">Sunucuya ulaşılamıyor — API çalışıyor mu? (NEXT_PUBLIC_API_URL)</div>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const [create, setCreate] = useState(false);
  return (
    <MarketProvider>
      <div className="app">
        <TopBar onMenu={() => setDrawer((d) => !d)} />
        <ApiBanner />
        <div className="app-body">
          <div className={`side-wrap ${drawer ? "open" : ""}`}>
            <Sidebar onCreate={() => (setCreate(true), setDrawer(false))} onNavigate={() => setDrawer(false)} />
          </div>
          {drawer && <div className="scrim only-mobile" onClick={() => setDrawer(false)} />}
          <main className="main">{children}</main>
        </div>
        {create && <CreateRoomModal onClose={() => setCreate(false)} />}
      </div>
    </MarketProvider>
  );
}
