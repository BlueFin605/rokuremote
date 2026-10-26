import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RokuService } from './roku.service';
import { TvService } from './tv.service';
import type { TvType } from './saved-roku';

export interface RokuDraft { id: string | null; name: string; ip: string; tvType: TvType; tvIp: string; }
export interface SaveResult { id: string; tvStatus: 'none' | 'ok' | 'pairing-required'; }
export class SaveError extends Error {
  constructor(public stage: 'roku' | 'tv', message: string, public kind?: 'limited-mode', public rokuId?: string) { super(message); }
}

@Injectable({ providedIn: 'root' })
export class RokuConfigService {
  constructor(private roku: RokuService, private tv: TvService) {}

  async save(draft: RokuDraft): Promise<SaveResult> {
    const ip = draft.ip.trim();
    if (!ip) throw new SaveError('roku', 'Enter the Roku IP');

    if (this.roku.rokus.some(r => r.ip === ip && r.id !== draft.id)) {
      throw new SaveError('roku', 'Another Roku already uses that IP');
    }

    const tvIp = draft.tvIp.trim();
    if (draft.tvType !== 'none' && !tvIp) throw new SaveError('tv', 'Enter the TV IP');

    const existing = draft.id ? this.roku.rokus.find(r => r.id === draft.id) : undefined;
    let id = existing?.id ?? '';
    if (!existing || existing.ip !== ip) {
      try {
        await firstValueFrom(this.roku.connect(ip, { replaceId: draft.id ?? undefined }));
      } catch (e: any) {
        throw new SaveError('roku', e?.message ?? 'Could not connect to Roku', e?.type === 'limited-mode' ? 'limited-mode' : undefined);
      }
      const saved = this.roku.rokus.find(r => r.ip === ip);
      if (!saved) throw new SaveError('roku', 'Could not connect to Roku');
      id = saved.id;
    }

    const current = this.roku.rokus.find(r => r.id === id);
    const name = draft.name.trim();
    if (name && name !== current?.name) this.roku.renameRoku(id, name);

    if (draft.tvType === 'none') {
      this.roku.setTv(id, 'none', null);
      return { id, tvStatus: 'none' };
    }
    let result: { ok: boolean; pairingRequired?: boolean };
    try {
      result = await firstValueFrom(this.tv.test(draft.tvType, tvIp));
    } catch {
      throw new SaveError('tv', 'Could not reach the TV', undefined, id);
    }
    if (result.ok || result.pairingRequired) {
      this.roku.setTv(id, draft.tvType, tvIp);
      return { id, tvStatus: result.ok ? 'ok' : 'pairing-required' };
    }
    throw new SaveError('tv', 'Could not reach the TV', undefined, id);
  }
}
