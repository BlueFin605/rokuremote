import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { SetupComponent } from './setup.component';
import { RokuService } from '../../services/roku.service';
import { RokuConfigService } from '../../services/roku-config.service';
import { routes } from '../../app.routes';
import { APP_VERSION } from '../../version';
import { APP_PLUGIN } from '../../services/native-info.service';

const mk = (id: string, name: string, ip: string, ecp = true, tv: any = { type: 'none', ip: null }) =>
  ({ id, name, ip, ecpEnabled: ecp, deviceInfo: null, tv });

describe('SetupComponent', () => {
  let component: SetupComponent;
  let fixture: ComponentFixture<SetupComponent>;
  let httpMock: HttpTestingController;
  let router: Router;
  let roku: RokuService;
  let save: jasmine.Spy;

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (sel: string) => el().querySelector(sel) as HTMLElement | null;

  const setup = async (opts: { rokus?: unknown[]; bEcp?: boolean } = {}) => {
    localStorage.clear();
    const rokus = opts.rokus ?? [
      mk('a', 'Lounge', '10.0.0.1', true, { type: 'panasonic', ip: '10.0.0.50' }),
      mk('b', 'Bedroom', '10.0.0.2', opts.bEcp ?? true),
    ];
    if (rokus.length) {
      localStorage.setItem('rokus', JSON.stringify(rokus));
      localStorage.setItem('active-roku-id', (rokus[0] as any).id);
    }
    save = jasmine.createSpy('save');
    await TestBed.configureTestingModule({
      imports: [SetupComponent],
      providers: [
        provideHttpClient(withXhr()), provideHttpClientTesting(), provideRouter(routes),
        { provide: RokuConfigService, useValue: { save } },
      ],
    }).compileComponents();
    router = TestBed.inject(Router);
    roku = TestBed.inject(RokuService);
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SetupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  afterEach(() => {
    httpMock.match(r => r.url.includes("/api/status")).forEach(r => { try { r.flush('', { status: 0, statusText: '' }); } catch { /* cancelled */ } });
    localStorage.clear();
  });

  it('shows the app version in the footer', async () => {
    await setup();
    expect(q('[data-testid=app-version]')!.textContent?.trim()).toBe('v' + APP_VERSION);
  });

  it('renders one card per saved Roku and marks the active one', async () => {
    await setup();
    expect(q('[data-testid=roku-card-a]')).toBeTruthy();
    expect(q('[data-testid=roku-card-b]')).toBeTruthy();
    expect(q('[data-testid=roku-card-a]')!.classList.contains('active')).toBeTrue();
    expect(q('[data-testid=roku-card-b]')!.classList.contains('active')).toBeFalse();
    expect(q('[data-testid=new-roku-card]')).toBeNull();
  });

  it('no longer renders the standalone IP form or TV settings', async () => {
    await setup();
    expect(q('input#ip')).toBeNull();
    expect(q('.tv-section')).toBeNull();
  });

  it('first run with zero Rokus shows a single new card in edit mode', async () => {
    await setup({ rokus: [] });
    expect(q('[data-testid=new-roku-card]')).toBeTruthy();
    expect(q('[data-testid=card-edit]')).toBeTruthy();
    expect(q('[data-testid=add-roku]')).toBeNull();
  });

  it('Add Roku appends a new edit card; cancelling removes it', async () => {
    await setup();
    q('[data-testid=add-roku]')!.click();
    fixture.detectChanges();
    expect(component.adding).toBeTrue();
    expect(q('[data-testid=new-roku-card] [data-testid=card-edit]')).toBeTruthy();
    q('[data-testid=card-cancel]')!.click();
    fixture.detectChanges();
    expect(component.adding).toBeFalse();
    expect(q('[data-testid=new-roku-card]')).toBeNull();
    expect(q('[data-testid=add-roku]')).toBeTruthy();
  });

  it('only one card is editable at a time', async () => {
    await setup();
    const dis = (id: string) => (q('[data-testid=' + id + ']') as HTMLButtonElement).disabled;
    expect(dis('edit-a')).toBeFalse();
    q('[data-testid=edit-a]')!.click();
    fixture.detectChanges();
    expect(dis('edit-b')).toBeTrue();
    expect(dis('add-roku')).toBeTrue();
    q('[data-testid=card-cancel]')!.click();
    fixture.detectChanges();
    expect(dis('edit-a')).toBeFalse();
    expect(dis('edit-b')).toBeFalse();
    expect(dis('add-roku')).toBeFalse();
    q('[data-testid=add-roku]')!.click();
    fixture.detectChanges();
    expect(dis('edit-a')).toBeTrue();
    expect(dis('edit-b')).toBeTrue();
  });

  it('saving a new card removes it and clears prefill', async () => {
    await setup();
    save.and.resolveTo({ id: 'c', tvStatus: 'none' });
    component.selectDevice({ ip: '10.0.0.9', name: 'Kitchen', model: 'Express' });
    fixture.detectChanges();
    q('[data-testid=card-save]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.adding).toBeFalse();
    expect(component.prefill).toBeNull();
    expect(q('[data-testid=new-roku-card]')).toBeNull();
  });

  it('discovered device opens a new card pre-filled with its ip and name', async () => {
    await setup();
    component.selectDevice({ ip: '10.0.0.9', name: 'Kitchen', model: 'Express' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.adding).toBeTrue();
    expect((q('[data-testid=card-roku-ip]') as HTMLInputElement).value).toBe('10.0.0.9');
    expect((q('[data-testid=card-name]') as HTMLInputElement).value).toBe('Kitchen');
    component.selectDevice({ ip: '10.0.0.10', name: 'Den', model: 'Ultra' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((q('[data-testid=card-roku-ip]') as HTMLInputElement).value).toBe('10.0.0.10');
  });

  it('useRoku selects the Roku and navigates to /apps', async () => {
    await setup();
    const nav = spyOn(router, 'navigate');
    q('[data-testid=use-b]')!.click();
    expect(roku.activeRoku!.id).toBe('b');
    expect(nav).toHaveBeenCalledWith(['/apps']);
  });

  it('useRoku navigates to /remote when the Roku has ECP disabled', async () => {
    await setup({ bEcp: false });
    const nav = spyOn(router, 'navigate');
    component.useRoku('b');
    expect(nav).toHaveBeenCalledWith(['/remote']);
  });

  it('deleting from a card removes the Roku', async () => {
    await setup();
    q('[data-testid=delete-b]')!.click();
    fixture.detectChanges();
    q('[data-testid=delete-yes-b]')!.click();
    fixture.detectChanges();
    expect(roku.rokus.map(r => r.id)).toEqual(['a']);
    expect(q('[data-testid=roku-card-b]')).toBeNull();
  });

  it('deleting the active Roku leaves the other card', async () => {
    await setup();
    component.deleteRoku('a');
    fixture.detectChanges();
    expect(q('[data-testid=roku-card-a]')).toBeNull();
    expect(q('[data-testid=roku-card-b]')).toBeTruthy();
  });

  it('deleting the last Roku shows a new card and hides Close', async () => {
    await setup({ rokus: [mk('a', 'Lounge', '10.0.0.1')] });
    component.deleteRoku('a');
    fixture.detectChanges();
    expect(q('[data-testid=new-roku-card]')).toBeTruthy();
    expect(q('.close-btn')).toBeNull();
  });

  it('shows Close only when a Roku is active', async () => {
    await setup();
    expect(q('.close-btn')).toBeTruthy();
    TestBed.resetTestingModule();
    await setup({ rokus: [] });
    expect(q('.close-btn')).toBeNull();
  });
});

describe('SetupComponent unreachable banner', () => {
  let component: SetupComponent;
  let fixture: ComponentFixture<SetupComponent>;
  let httpMock: HttpTestingController;
  let router: Router;
  let roku: RokuService;

  const setup = async (withState = true, extraRoku = true) => {
    localStorage.clear();
    const list: unknown[] = [mk('a', 'Lounge', '10.0.0.1')];
    if (extraRoku) list.push(mk('b', 'Bedroom', '10.0.0.2'));
    localStorage.setItem('rokus', JSON.stringify(list));
    localStorage.setItem('active-roku-id', 'a');
    await TestBed.configureTestingModule({
      imports: [SetupComponent],
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting(), provideRouter(routes)],
    }).compileComponents();
    router = TestBed.inject(Router);
    roku = TestBed.inject(RokuService);
    httpMock = TestBed.inject(HttpTestingController);
    roku.startupVerifiedId = 'a';
    if (withState) {
      spyOn(router, 'currentNavigation').and.returnValue({
        extras: { state: { unreachable: { id: 'a', name: 'Lounge', ip: '10.0.0.1', message: 'Http failure response for http://x: 502' } } },
      } as any);
    }
    fixture = TestBed.createComponent(SetupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  const el = () => fixture.nativeElement as HTMLElement;

  afterEach(() => {
    httpMock.match(r => r.url.includes("/api/status")).forEach(r => { try { r.flush('', { status: 0, statusText: '' }); } catch { /* cancelled */ } });
    localStorage.clear();
  });

  it('shows the banner with name and ip only, and marks the card', async () => {
    await setup();
    const banner = el().querySelector('[data-testid=unreachable-banner]')!;
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("Couldn't reach Lounge (10.0.0.1)");
    expect(banner.textContent).not.toContain('Http failure');
    expect(el().querySelector('[data-testid=roku-card-a]')!.classList.contains('unreachable')).toBeTrue();
    expect(el().querySelector('[data-testid=roku-card-b]')!.classList.contains('unreachable')).toBeFalse();
  });

  it('clears startupVerifiedId so the next navigation re-checks', async () => {
    await setup();
    expect(roku.startupVerifiedId).toBeNull();
  });

  it('shows no banner without navigation state and leaves startupVerifiedId alone', async () => {
    await setup(false);
    expect(el().querySelector('[data-testid=unreachable-banner]')).toBeNull();
    expect(roku.startupVerifiedId).toBe('a');
  });

  it('retryUnreachable success clears the banner and navigates to /apps', async () => {
    await setup();
    const nav = spyOn(router, 'navigate');
    component.retryUnreachable();
    httpMock.expectOne(r => r.url === 'http://roku-proxy/api/roku/query/device-info?ip=10.0.0.1')
      .flush('<device-info><friendly-device-name>Lounge</friendly-device-name><model-name>Ultra</model-name></device-info>');
    expect(component.unreachable).toBeNull();
    expect(nav).toHaveBeenCalledWith(['/apps']);
  });

  it('retryUnreachable failure keeps the banner and shows the error', async () => {
    await setup();
    const nav = spyOn(router, 'navigate');
    component.retryUnreachable();
    httpMock.expectOne(r => r.url === 'http://roku-proxy/api/roku/query/device-info?ip=10.0.0.1')
      .flush('nope', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(component.unreachable).not.toBeNull();
    expect(component.error).toBeTruthy();
    expect(nav).not.toHaveBeenCalled();
    expect(el().querySelector('[data-testid=unreachable-banner]')).toBeTruthy();
    expect(el().querySelector('[data-testid=setup-error]')).toBeTruthy();
  });

  it('saving the unreachable Roku from its card clears the banner, saving another keeps it', async () => {
    await setup();
    component.onSaved({ id: 'b', tvStatus: 'none' });
    expect(component.unreachable).not.toBeNull();
    component.onSaved({ id: 'a', tvStatus: 'none' });
    expect(component.unreachable).toBeNull();
  });

  it('dismissUnreachable clears the banner', async () => {
    await setup();
    component.dismissUnreachable();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid=unreachable-banner]')).toBeNull();
  });

  it('deleteRoku of the unreachable Roku clears the banner, of another keeps it', async () => {
    await setup();
    component.deleteRoku('b');
    expect(component.unreachable).not.toBeNull();
    component.deleteRoku('a');
    expect(component.unreachable).toBeNull();
  });

  it('useRoku clears the banner', async () => {
    await setup();
    spyOn(router, 'navigate');
    component.useRoku('b');
    expect(component.unreachable).toBeNull();
  });

  it('only offers "Switch to another Roku" when more than one Roku is saved', async () => {
    await setup(true, true);
    expect(el().textContent).toContain('Switch to another Roku');
    TestBed.resetTestingModule();
    await setup(true, false);
    expect(el().querySelector('[data-testid=unreachable-banner]')).toBeTruthy();
    expect(el().textContent).not.toContain('Switch to another Roku');
  });
});

describe('SetupComponent Android app download', () => {
  let fixture: ComponentFixture<SetupComponent>;
  let httpMock: HttpTestingController;
  const apk = 'https://roku.bluefin605.com/android/latest/roku-remote.apk';

  const setup = async (userAgent: string, native = false, getInfo: jasmine.Spy = jasmine.createSpy('getInfo').and.resolveTo({ version: '0' })) => {
    localStorage.clear();
    spyOnProperty(navigator, 'userAgent', 'get').and.returnValue(userAgent);
    spyOn(Capacitor, 'isNativePlatform').and.returnValue(native);
    await TestBed.configureTestingModule({
      imports: [SetupComponent],
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting(), provideRouter(routes), { provide: APP_PLUGIN, useValue: { getInfo } }],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SetupComponent);
    fixture.detectChanges();
  };

  const el = () => fixture.nativeElement as HTMLElement;

  afterEach(() => {
    httpMock.match(r => r.url.includes("/api/status")).forEach(r => { try { r.flush('', { status: 0, statusText: '' }); } catch { /* cancelled */ } });
    localStorage.clear();
  });

  it('shows the native app version in the footer when running natively', async () => {
    await setup('Mozilla/5.0 (Linux; Android 14; Pixel 8)', true, jasmine.createSpy('getInfo').and.resolveTo({ version: '1.0.12' }));
    await new Promise(r => setTimeout(r));
    fixture.detectChanges();
    const t = el().querySelector('[data-testid=app-version]')!.textContent!;
    expect(t).toContain('(app 1.0.12)');
  });

  it('omits the native app version in a browser', async () => {
    const getInfo = jasmine.createSpy('getInfo');
    await setup('Mozilla/5.0 (Windows NT 10.0)', false, getInfo);
    await new Promise(r => setTimeout(r));
    fixture.detectChanges();
    expect(el().querySelector('[data-testid=app-version]')!.textContent).not.toContain('(app');
    expect(getInfo).not.toHaveBeenCalled();
  });

  it('shows the card with the CloudFront apk link on an Android browser, and no footer link', async () => {
    await setup('Mozilla/5.0 (Linux; Android 14; Pixel 8)');
    const a = el().querySelector('[data-testid=android-card] a') as HTMLAnchorElement;
    expect(a).toBeTruthy();
    expect(a.getAttribute('href')).toBe(apk);
    expect(el().querySelector('[data-testid=android-link]')).toBeNull();
  });

  it('shows only the footer link on a desktop browser', async () => {
    await setup('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120');
    expect(el().querySelector('[data-testid=android-card]')).toBeNull();
    const a = el().querySelector('[data-testid=android-link]') as HTMLAnchorElement;
    expect(a).toBeTruthy();
    expect(a.getAttribute('href')).toBe(apk);
  });

  it('shows neither inside the native app even with a desktop user agent', async () => {
    await setup('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', true);
    expect(el().querySelector('[data-testid=android-card]')).toBeNull();
    expect(el().querySelector('[data-testid=android-link]')).toBeNull();
  });

  it('shows neither inside the native app', async () => {
    await setup('Mozilla/5.0 (Linux; Android 14; Pixel 8)', true, jasmine.createSpy('getInfo').and.resolveTo({ version: '1.0.12' }));
    expect(el().querySelector('[data-testid=android-card]')).toBeNull();
    expect(el().querySelector('[data-testid=android-link]')).toBeNull();
  });
});
