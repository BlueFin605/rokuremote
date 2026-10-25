import type { RokuDeviceInfo } from './roku.service';

export type TvType = 'panasonic' | 'none';

export interface SavedRoku {
  id: string;
  name: string;
  ip: string;
  ecpEnabled: boolean;
  deviceInfo: RokuDeviceInfo | null;
  tv: { type: TvType; ip: string | null };
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
