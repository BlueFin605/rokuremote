import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { RokuSwitcherComponent } from './roku-switcher.component';
import { RokuService } from '../../services/roku.service';
import { AudioPlayerService } from '../../services/audio-player.service';
import { ProxyService } from '../../services/proxy.service';
import { of } from 'rxjs';

describe('RokuSwitcherComponent', () => {
  let fixture: ComponentFixture<RokuSwitcherComponent>;
  let el: HTMLElement;
  let roku: RokuService;

  const items = () => Array.from(el.querySelectorAll('.menu li')) as HTMLElement[];

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('roku-ip', '10.0.0.1');
    localStorage.setItem('rokus', JSON.stringify([
      { id: 'a', name: 'Lounge', ip: '10.0.0.1', ecpEnabled: true, deviceInfo: null, tv: { type: 'none', ip: null } },
      { id: 'b', name: 'Bedroom', ip: '10.0.0.2', ecpEnabled: true, deviceInfo: null, tv: { type: 'none', ip: null } },
    ]));
    localStorage.setItem('active-roku-id', 'a');

    await TestBed.configureTestingModule({
      imports: [RokuSwitcherComponent],
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting()],
    }).compileComponents();

    roku = TestBed.inject(RokuService);
    fixture = TestBed.createComponent(RokuSwitcherComponent);
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  it('shows the active Roku name on the toggle', () => {
    expect(el.querySelector('.current')!.textContent).toContain('Lounge');
    expect(items().length).toBe(0);
  });

  it('lists each Roku plus Manage Rokus when opened', () => {
    (el.querySelector('.current') as HTMLElement).click();
    fixture.detectChanges();
    const texts = items().map(i => i.textContent!.trim());
    expect(texts).toEqual(['Lounge', 'Bedroom', 'Manage Rokus']);
  });

  it('selecting another Roku switches and closes the menu', () => {
    (el.querySelector('.current') as HTMLElement).click();
    fixture.detectChanges();
    items().find(i => i.textContent!.includes('Bedroom'))!.click();
    fixture.detectChanges();
    expect(roku.activeRoku!.name).toBe('Bedroom');
    expect(items().length).toBe(0);
    expect(el.querySelector('.current')!.textContent).toContain('Bedroom');
  });

  it('stops audio and proxy listening when switching while playing', () => {
    const audio = TestBed.inject(AudioPlayerService);
    const proxy = TestBed.inject(ProxyService);
    spyOnProperty(audio, 'isPlaying', 'get').and.returnValue(true);
    const stop = spyOn(audio, 'stop').and.resolveTo();
    const stopListening = spyOn(proxy, 'stopListening').and.returnValue(of(undefined));
    (el.querySelector('.current') as HTMLElement).click();
    fixture.detectChanges();
    items().find(i => i.textContent!.includes('Bedroom'))!.click();
    expect(stop).toHaveBeenCalled();
    expect(stopListening).toHaveBeenCalled();
  });

  it('does not stop audio when not playing', () => {
    const audio = TestBed.inject(AudioPlayerService);
    const stop = spyOn(audio, 'stop').and.resolveTo();
    (el.querySelector('.current') as HTMLElement).click();
    fixture.detectChanges();
    items().find(i => i.textContent!.includes('Bedroom'))!.click();
    expect(stop).not.toHaveBeenCalled();
  });

  it('Manage Rokus navigates to /setup', () => {
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    (el.querySelector('.current') as HTMLElement).click();
    fixture.detectChanges();
    el.querySelector<HTMLElement>('.menu li.manage')!.click();
    expect(nav).toHaveBeenCalledWith(['/setup']);
  });
});
