import { randomUUID } from "node:crypto";
import { INSTRUMENTS, officialRoomName, type RoomInfo, type RoomMode } from "@syb/shared";

interface UserRoom extends Omit<RoomInfo, "participants"> {
  hostIdentity: string;
  hostKey: string;
}

/**
 * In-memory store. Same shape as supabase/schema.sql so it can be swapped
 * for a Supabase-backed implementation later.
 */
class MemoryStore {
  private userRooms = new Map<string, UserRoom>();
  reports: { room: string; target: string; reporter: string; reason: string; at: number }[] = [];

  officialRooms(): Omit<RoomInfo, "participants">[] {
    return INSTRUMENTS.map((i) => ({
      name: officialRoomName(i.id),
      title: `${i.name} Odası`,
      instrumentId: i.id,
      mode: "open" as RoomMode,
      official: true,
      createdAt: 0,
    }));
  }

  listRooms(): Omit<RoomInfo, "participants">[] {
    const user = [...this.userRooms.values()].map(({ hostKey: _k, hostIdentity: _h, ...r }) => r);
    return [...this.officialRooms(), ...user];
  }

  getRoom(name: string) {
    return this.listRooms().find((r) => r.name === name);
  }

  roomsForInstrument(instrumentId: string) {
    return this.listRooms().filter((r) => r.instrumentId === instrumentId).map((r) => r.name);
  }

  createRoom(input: { title: string; instrumentId: string; mode: RoomMode; hostIdentity: string; hostName: string; theme?: string }) {
    const name = `u-${randomUUID().slice(0, 8)}`;
    const hostKey = randomUUID();
    this.userRooms.set(name, {
      name,
      title: input.title,
      instrumentId: input.instrumentId,
      mode: input.mode,
      official: false,
      createdBy: input.hostName,
      createdAt: Date.now(),
      hostIdentity: input.hostIdentity,
      hostKey,
      theme: input.theme,
    });
    return { name, hostKey };
  }

  isHost(room: string, identity: string, hostKey?: string) {
    const r = this.userRooms.get(room);
    return Boolean(r && r.hostIdentity === identity && hostKey && r.hostKey === hostKey);
  }

  /** Remove user rooms that have been empty for a while (called by janitor). */
  dropRoom(name: string) {
    this.userRooms.delete(name);
  }
  userRoomNames() {
    return [...this.userRooms.values()].map((r) => ({ name: r.name, createdAt: r.createdAt }));
  }
}

export const store = new MemoryStore();
