import { TestBed, ComponentFixture } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { RokuCardComponent } from './roku-card.component';
import { RokuConfigService, RokuDraft, SaveError, SaveResult } from '../../services/roku-config.service';
import { TvService } from '../../services/tv.service';
import { SavedRoku } from '../../services/saved-roku';

const ROKU: SavedRoku = {
  id: 'r1', name: 'Lounge', ip: '192.168.1.10', ecpEnabled: true, deviceInfo: null,
  tv: { type: 'panasonic', ip: '192.168.1.50' },
};
const NO_TV: SavedRoku = { ...ROKU, id: 'r2', name: 'Bedroom', tv: { type: 'none', ip: null } };

describe('RokuCardComponent', () => {
  let fixture: ComponentFixture<RokuCardComponent>;
  let save: jasmine.Spy;
  let discover: jasmine.Spy;
  const q = (id: string) => fixture.nativeElement.querySelector(`[data-testid=${id}]`) as HTMLElement | null;
  const input = (id: string) => q(id) as HTMLInputElement;
  const type = async (id: string, v: string) => {
    const el = input(id);
    el.value = v;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const click = (id: string) => { q(id)!.click(); fixture.detectChanges(); };
  const flush = async () => { await fixture.whenStable(); fixture.detectChanges(); };

  function create(inputs: Record<string, unknown> = {}) {
    fixture = TestBed.createComponent(RokuCardComponent);
    const defaults = { roku: ROKU, active: false, unreachable: false, proxyAvailable: true, prefill: null };
    for (const [k, v] of Object.entries({ ...defaults, ...inputs })) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
  }

  beforeEach(() => {
    save = jasmine.createSpy('save').and.resolveTo({ id: 'r1', tvStatus: 'ok' } as SaveResult);
    discover = jasmine.createSpy('discover').and.returnValue(of([{ ip: '192.168.1.77', name: 'Viera' }]));
    TestBed.configureTestingModule({
      imports: [RokuCardComponent],
      providers: [
        { provide: RokuConfigService, useValue: { save } },
        { provide: TvService, useValue: { discover } },
      ],
    });
  });

  it('renders view mode with roku and tv rows', () => {
    create();
    const card = q('roku-card-r1')!;
    expect(card.textContent).toContain('Lounge');
    expect(card.textContent).toContain('192.168.1.10');
    expect(card.textContent).toContain('Panasonic Viera 192.168.1.50');
    expect(q('card-edit')).toBeNull();
  });

  it('shows No TV and an Active badge', () => {
    create({ roku: NO_TV, active: true });
    expect(q('roku-card-r2')!.textContent).toContain('No TV');
    expect(q('roku-card-r2')!.textContent).toContain('Active');
  });

  it('use emits the id', () => {
    create();
    const ids: string[] = [];
    fixture.componentInstance.use.subscribe(i => ids.push(i));
    click('use-r1');
    expect(ids).toEqual(['r1']);
  });

  it('edit toggles to edit mode populated from roku', async () => {
    create();
    click('edit-r1');
    await flush();
    expect(q('card-edit')).not.toBeNull();
    expect(input('card-name').value).toBe('Lounge');
    expect(input('card-roku-ip').value).toBe('192.168.1.10');
    expect(input('card-tv-ip').value).toBe('192.168.1.50');
  });

  it('hides TV IP and discover when type is none', () => {
    create({ roku: NO_TV });
    click('edit-r2');
    expect(q('card-tv-ip')).toBeNull();
    expect(q('card-discover-tv')).toBeNull();
  });

  it('hides discover when proxy unavailable', () => {
    create({ proxyAvailable: false });
    click('edit-r1');
    expect(q('card-tv-ip')).not.toBeNull();
    expect(q('card-discover-tv')).toBeNull();
  });

  it('discover lists results and picking fills the TV IP', async () => {
    create();
    click('edit-r1');
    click('card-discover-tv');
    await flush();
    expect(discover).toHaveBeenCalledWith('panasonic');
    click('card-tv-result-0');
    await flush();
    expect(input('card-tv-ip').value).toBe('192.168.1.77');
  });

  it('save success emits saved and returns to view mode', async () => {
    create();
    const out: SaveResult[] = [];
    fixture.componentInstance.saved.subscribe(r => out.push(r));
    click('edit-r1');
    await flush();
    await type('card-name', 'Den');
    click('card-save');
    await flush();
    const draft: RokuDraft = save.calls.mostRecent().args[0];
    expect(draft).toEqual({ id: 'r1', name: 'Den', ip: '192.168.1.10', tvType: 'panasonic', tvIp: '192.168.1.50' });
    expect(out).toEqual([{ id: 'r1', tvStatus: 'ok' }]);
    expect(q('card-edit')).toBeNull();
  });

  it('Enter in an input submits', async () => {
    create();
    click('edit-r1');
    input('card-name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();
    expect(save).toHaveBeenCalled();
  });

  it('disables inputs and shows Saving... while saving', async () => {
    let resolve!: (r: SaveResult) => void;
    save.and.returnValue(new Promise<SaveResult>(res => { resolve = res; }));
    create();
    click('edit-r1');
    click('card-save');
    expect(q('card-save')!.textContent).toContain('Saving...');
    expect((q('card-save') as HTMLButtonElement).disabled).toBeTrue();
    await flush();
    expect(input('card-name').disabled).toBeTrue();
    resolve({ id: 'r1', tvStatus: 'ok' });
    await flush();
    expect(q('card-edit')).toBeNull();
  });

  for (const stage of ['roku', 'tv'] as const) {
    it(`SaveError at ${stage} shows inline error and stays in edit`, async () => {
      save.and.rejectWith(new SaveError(stage, `${stage} failed`));
      create();
      const out: SaveResult[] = [];
      fixture.componentInstance.saved.subscribe(r => out.push(r));
      click('edit-r1');
      click('card-save');
      await flush();
      expect(q('card-edit')).not.toBeNull();
      expect(q('card-error')!.textContent).toContain(`${stage} failed`);
      expect(q('card-error')!.getAttribute('data-stage')).toBe(stage);
      expect(out).toEqual([]);
      expect((q('card-save') as HTMLButtonElement).disabled).toBeFalse();
    });
  }

  it('emits editingChange on edit, cancel and successful save; editLocked disables Edit', async () => {
    create();
    const out: boolean[] = [];
    fixture.componentInstance.editingChange.subscribe(v => out.push(v));
    click('edit-r1');
    click('card-cancel');
    click('edit-r1');
    click('card-save');
    await flush();
    expect(out).toEqual([true, false, true, false]);
    fixture.componentRef.setInput('editLocked', true);
    fixture.detectChanges();
    expect((q('edit-r1') as HTMLButtonElement).disabled).toBeTrue();
  });

  it('adopts the id of a Roku created before a TV-stage failure so a retry is an edit', async () => {
    save.and.rejectWith(new SaveError('tv', 'Could not reach the TV', undefined, 'created-1'));
    create({ roku: null, prefill: { ip: '192.168.1.99', name: 'Kitchen' } });
    click('card-save');
    await flush();
    expect(fixture.componentInstance.draft.id).toBe('created-1');
    save.and.resolveTo({ id: 'created-1', tvStatus: 'ok' } as SaveResult);
    click('card-save');
    await flush();
    expect(save.calls.mostRecent().args[0].id).toBe('created-1');
    expect(q('card-edit')).toBeNull();
  });

  it('limited-mode error shows the enable steps, other errors do not', async () => {
    save.and.rejectWith(new SaveError('roku', 'Limited', 'limited-mode'));
    create();
    click('edit-r1');
    click('card-save');
    await flush();
    expect(q('card-limited-steps')!.textContent).toContain('Control by Mobile Apps');
    save.and.rejectWith(new SaveError('roku', 'nope'));
    click('card-save');
    await flush();
    expect(q('card-error')).not.toBeNull();
    expect(q('card-limited-steps')).toBeNull();
  });

  it('edit mode hints where to find the Roku IP', () => {
    create({ roku: null });
    expect(q('card-edit')!.textContent).toContain('Settings > Network > About');
  });

  it('pairing-required shows a warning', async () => {
    save.and.resolveTo({ id: 'r1', tvStatus: 'pairing-required' });
    create();
    click('edit-r1');
    click('card-save');
    await flush();
    expect(q('card-warning')!.textContent).toContain('Pairing required (support coming in a future update)');
  });

  it('cancel restores the draft and emits cancelled', async () => {
    create();
    let cancelled = 0;
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);
    click('edit-r1');
    await flush();
    await type('card-name', 'Changed');
    click('card-cancel');
    expect(cancelled).toBe(1);
    expect(q('card-edit')).toBeNull();
    click('edit-r1');
    await flush();
    expect(input('card-name').value).toBe('Lounge');
  });

  it('new card starts in edit mode and honours prefill', async () => {
    create({ roku: null, prefill: { ip: '192.168.1.99', name: 'Kitchen' } });
    await flush();
    expect(q('card-edit')).not.toBeNull();
    expect(input('card-roku-ip').value).toBe('192.168.1.99');
    expect(input('card-name').value).toBe('Kitchen');
  });

  it('changing the TV type cancels an in-flight discover', async () => {
    const subj = new Subject<{ ip: string; name: string }[]>();
    discover.and.returnValue(subj);
    create();
    click('edit-r1');
    click('card-discover-tv');
    expect(fixture.componentInstance.discovering).toBeTrue();
    fixture.componentInstance.onTypeChange('none');
    expect(fixture.componentInstance.discovering).toBeFalse();
    subj.next([{ ip: '1.1.1.1', name: 'Late' }]);
    expect(fixture.componentInstance.discovered).toBeNull();
  });

  it('a new prefill replaces the draft of a new card', async () => {
    create({ roku: null, prefill: { ip: '192.168.1.99', name: 'Kitchen' } });
    await flush();
    fixture.componentRef.setInput('prefill', { ip: '192.168.1.5', name: 'Den' });
    fixture.detectChanges();
    await flush();
    expect(input('card-roku-ip').value).toBe('192.168.1.5');
    expect(input('card-name').value).toBe('Den');
  });

  it('new card save sends null id', async () => {
    create({ roku: null, prefill: { ip: '192.168.1.99', name: 'Kitchen' } });
    click('card-save');
    await flush();
    expect(save.calls.mostRecent().args[0].id).toBeNull();
  });

  it('delete confirms inline and emits only on Yes', () => {
    create();
    const ids: string[] = [];
    fixture.componentInstance.delete.subscribe(i => ids.push(i));
    click('delete-r1');
    expect(ids).toEqual([]);
    click('delete-no-r1');
    expect(q('delete-yes-r1')).toBeNull();
    click('delete-r1');
    click('delete-yes-r1');
    expect(ids).toEqual(['r1']);
  });
});
