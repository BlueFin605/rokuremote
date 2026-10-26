import { of, throwError } from 'rxjs';
import { RokuConfigService, SaveError, RokuDraft } from './roku-config.service';
import type { SavedRoku, TvType } from './saved-roku';

function saved(id: string, name: string, ip: string): SavedRoku {
  return { id, name, ip, ecpEnabled: true, deviceInfo: null, tv: { type: 'none', ip: null } };
}

describe('RokuConfigService.save', () => {
  let list: SavedRoku[];
  let roku: any;
  let tv: any;
  let svc: RokuConfigService;

  beforeEach(() => {
    list = [saved('a', 'Lounge', '10.0.0.1')];
    roku = {
      get rokus() { return list; },
      connect: jasmine.createSpy('connect').and.callFake((ip: string, opts: { replaceId?: string }) => {
        const ex = list.find(r => r.ip === ip) ?? list.find(r => r.id === opts.replaceId);
        if (ex) list = list.map(r => (r === ex ? { ...r, ip } : r));
        else list = [...list, saved('new', 'Roku', ip)];
        return of({});
      }),
      renameRoku: jasmine.createSpy('renameRoku'),
      setTv: jasmine.createSpy('setTv'),
    };
    tv = { test: jasmine.createSpy('test').and.returnValue(of({ ok: true })) };
    svc = new RokuConfigService(roku, tv);
  });

  const draft = (o: Partial<RokuDraft> = {}): RokuDraft =>
    ({ id: 'a', name: 'Lounge', ip: '10.0.0.1', tvType: 'none' as TvType, tvIp: '', ...o });

  it('rejects an empty ip', async () => {
    const err = await svc.save(draft({ ip: '  ' })).catch(e => e);
    expect(err instanceof SaveError).toBeTrue();
    expect(err.stage).toBe('roku');
    expect(err.message).toBe('Enter the Roku IP');
    expect(roku.connect).not.toHaveBeenCalled();
  });

  it('rejects an ip used by another Roku (edit and new card) without changing anything', async () => {
    list = [...list, saved('b', 'Den', '10.0.0.2')];
    for (const d of [draft({ ip: '10.0.0.2', name: 'Renamed', tvType: 'panasonic', tvIp: '10.0.0.90' }), draft({ id: null, ip: ' 10.0.0.2 ' })]) {
      const err = await svc.save(d).catch(e => e);
      expect(err instanceof SaveError).toBeTrue();
      expect(err.stage).toBe('roku');
      expect(err.message).toBe('Another Roku already uses that IP');
    }
    expect(roku.connect).not.toHaveBeenCalled();
    expect(roku.renameRoku).not.toHaveBeenCalled();
    expect(roku.setTv).not.toHaveBeenCalled();
    expect(tv.test).not.toHaveBeenCalled();
  });

  it('errors when connect succeeds but no Roku has that ip', async () => {
    roku.connect.and.returnValue(of({}));
    const err = await svc.save(draft({ id: null, ip: '10.0.0.7' })).catch(e => e);
    expect(err.stage).toBe('roku');
    expect(err.message).toBe('Could not connect to Roku');
  });

  it('keeps kind limited-mode from the connect error', async () => {
    roku.connect.and.returnValue(throwError(() => ({ type: 'limited-mode', message: 'Limited' })));
    const err = await svc.save(draft({ ip: '10.0.0.9' })).catch(e => e);
    expect(err.kind).toBe('limited-mode');
    roku.connect.and.returnValue(throwError(() => ({ type: 'unknown', message: 'x' })));
    const err2 = await svc.save(draft({ ip: '10.0.0.9' })).catch(e => e);
    expect(err2.kind).toBeUndefined();
  });

  it('uses a fallback message when the connect error has no message', async () => {
    roku.connect.and.returnValue(throwError(() => ({})));
    const err = await svc.save(draft({ ip: '10.0.0.9' })).catch(e => e);
    expect(err.stage).toBe('roku');
    expect(err.message).toBe('Could not connect to Roku');
  });

  it('new roku: connects, resolves id, and uses it', async () => {
    const r = await svc.save(draft({ id: null, name: '', ip: '10.0.0.5' }));
    expect(roku.connect).toHaveBeenCalledWith('10.0.0.5', { replaceId: undefined });
    expect(r).toEqual({ id: 'new', tvStatus: 'none' });
    expect(roku.setTv).toHaveBeenCalledWith('new', 'none', null);
    expect(roku.renameRoku).not.toHaveBeenCalled();
  });

  it('edited ip connects with replaceId', async () => {
    const r = await svc.save(draft({ ip: '10.0.0.9' }));
    expect(roku.connect).toHaveBeenCalledWith('10.0.0.9', { replaceId: 'a' });
    expect(r.id).toBe('a');
  });

  it('unchanged ip skips connect', async () => {
    await svc.save(draft());
    expect(roku.connect).not.toHaveBeenCalled();
  });

  it('renames only when the trimmed name changed', async () => {
    await svc.save(draft({ name: ' Lounge ' }));
    expect(roku.renameRoku).not.toHaveBeenCalled();
    await svc.save(draft({ name: ' Bedroom ' }));
    expect(roku.renameRoku).toHaveBeenCalledWith('a', 'Bedroom');
    await svc.save(draft({ name: '   ' }));
    expect(roku.renameRoku).toHaveBeenCalledTimes(1);
  });

  it('connect failure aborts before rename and TV', async () => {
    roku.connect.and.returnValue(throwError(() => ({ type: 'timeout', message: 'Roku not found' })));
    const err = await svc.save(draft({ ip: '10.0.0.9', name: 'X', tvType: 'panasonic', tvIp: '10.0.0.90' })).catch(e => e);
    expect(err instanceof SaveError).toBeTrue();
    expect(err.stage).toBe('roku');
    expect(err.message).toBe('Roku not found');
    expect(roku.renameRoku).not.toHaveBeenCalled();
    expect(tv.test).not.toHaveBeenCalled();
    expect(roku.setTv).not.toHaveBeenCalled();
  });

  it('TV ok saves the TV', async () => {
    const r = await svc.save(draft({ tvType: 'panasonic', tvIp: '10.0.0.90' }));
    expect(tv.test).toHaveBeenCalledWith('panasonic', '10.0.0.90');
    expect(roku.setTv).toHaveBeenCalledWith('a', 'panasonic', '10.0.0.90');
    expect(r.tvStatus).toBe('ok');
  });

  it('pairing required still saves the TV', async () => {
    tv.test.and.returnValue(of({ ok: false, pairingRequired: true }));
    const r = await svc.save(draft({ tvType: 'panasonic', tvIp: '10.0.0.90' }));
    expect(roku.setTv).toHaveBeenCalledWith('a', 'panasonic', '10.0.0.90');
    expect(r.tvStatus).toBe('pairing-required');
  });

  it('TV failure keeps Roku changes but not the TV', async () => {
    tv.test.and.returnValue(of({ ok: false }));
    const err = await svc.save(draft({ name: 'New', tvType: 'panasonic', tvIp: '10.0.0.90' })).catch(e => e);
    expect(err.stage).toBe('tv');
    expect(err.message).toBe('Could not reach the TV');
    expect(roku.renameRoku).toHaveBeenCalledWith('a', 'New');
    expect(roku.setTv).not.toHaveBeenCalled();
    tv.test.and.returnValue(throwError(() => new Error('x')));
    const err2 = await svc.save(draft({ tvType: 'panasonic', tvIp: '10.0.0.90' })).catch(e => e);
    expect(err2.stage).toBe('tv');
  });

  it('empty TV ip errors for a TV type', async () => {
    const err = await svc.save(draft({ tvType: 'panasonic', tvIp: ' ' })).catch(e => e);
    expect(err.stage).toBe('tv');
    expect(err.message).toBe('Enter the TV IP');
    expect(tv.test).not.toHaveBeenCalled();
  });

  it('none clears the TV', async () => {
    list[0].tv = { type: 'panasonic', ip: '10.0.0.90' };
    const r = await svc.save(draft());
    expect(roku.setTv).toHaveBeenCalledWith('a', 'none', null);
    expect(r.tvStatus).toBe('none');
    expect(tv.test).not.toHaveBeenCalled();
  });
});
