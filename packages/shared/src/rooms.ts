export type RoomMode = "open" | "stage";

export interface RoomInfo {
  /** LiveKit room name */
  name: string;
  title: string;
  instrumentId: string;
  mode: RoomMode;
  official: boolean;
  createdBy?: string;
  createdAt: number;
  participants: number;
  /** cosmetic room theme (shop item) */
  theme?: string;
}

export const officialRoomName = (instrumentId: string) => `inst-${instrumentId}`;

/** Stored in LiveKit room/participant metadata */
export interface ParticipantMeta {
  host?: boolean;
  /** linked Solana wallet (enables tipping) */
  wallet?: string;
  /** cosmetic: gold nickname */
  gold?: boolean;
}
