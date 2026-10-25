import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { SetupComponent } from './setup.component';
import { RokuService } from '../../services/roku.service';
import { routes } from '../../app.routes';

describe('SetupComponent', () => {
  let component: SetupComponent;
  let fixture: ComponentFixture<SetupComponent>;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [SetupComponent],
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting(), provideRouter(routes)],
    }).compileComponents();

    fixture = TestBed.createComponent(SetupComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  afterEach(() => {
    // Flush proxy status check if still pending
    httpMock.match(r => r.url === 'http://roku-proxy/api/status').forEach(r => r.flush('', { status: 0, statusText: '' }));
    httpMock.match(r => r.url.includes('version.json')).forEach(r => r.flush('{}'));
    httpMock.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should show IP input and connect button', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('input#ip')).toBeTruthy();
    expect(el.querySelector('button')).toBeTruthy();
  });

  it('should show hint about finding Roku IP', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Settings');
    expect(el.textContent).toContain('Network');
    expect(el.textContent).toContain('About');
  });

  it('should display device info on successful connect', () => {
    component.ipAddress = '192.168.1.100';
    component.saveRoku();

    httpMock.expectOne(r => r.url === 'http://roku-proxy/api/roku/query/device-info?ip=192.168.1.100').flush(`
      <device-info>
        <friendly-device-name>Living Room Roku</friendly-device-name>
        <model-name>Express</model-name>
        <supports-private-listening>true</supports-private-listening>
      </device-info>
    `);

    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Living Room Roku');
    expect(el.textContent).toContain('Express');
  });

  it('should show limited mode instructions on 403', () => {
    component.ipAddress = '192.168.1.100';
    component.saveRoku();

    httpMock.expectOne(r => r.url === 'http://roku-proxy/api/roku/query/device-info?ip=192.168.1.100')
      .flush('ECP command not allowed in Limited mode.', { status: 403, statusText: 'Forbidden' });

    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Control by Mobile Apps');
    expect(el.textContent).toContain('Network Access');
    expect(el.textContent).toContain('Enabled');
  });

  it('should auto-connect if IP is saved in localStorage', () => {
    // Set IP and manually trigger the connect flow
    component.ipAddress = '10.0.0.5';
    component.saveRoku();

    const req = httpMock.expectOne(r => r.url === 'http://roku-proxy/api/roku/query/device-info?ip=10.0.0.5');
    req.flush(`<device-info>
      <friendly-device-name>Roku</friendly-device-name>
      <model-name>Ultra</model-name>
      <supports-private-listening>false</supports-private-listening>
    </device-info>`);

    expect(TestBed.inject(RokuService).getSavedIp()).toBe('10.0.0.5');
  });

  it('should not connect when IP is empty', () => {
    component.ipAddress = '   ';
    component.saveRoku();
    httpMock.expectNone(r => r.url === 'http://roku-proxy/api/roku/query/device-info?ip=192.168.1.100');
  });
});

describe('SetupComponent Roku list', () => {
  let component: SetupComponent;
  let fixture: ComponentFixture<SetupComponent>;
  let httpMock: HttpTestingController;
  let router: Router;
  let roku: RokuService;

  const seed = (bEcp = true) => {
    localStorage.clear();
    localStorage.setItem('roku-ip', '10.0.0.1');
    localStorage.setItem('rokus', JSON.stringify([
      { id: 'a', name: 'Lounge', ip: '10.0.0.1', ecpEnabled: true, deviceInfo: { name: 'Lounge', model: 'Ultra', supportsPrivateListening: true, ecpEnabled: true }, tv: { type: 'panasonic', ip: '10.0.0.50' } },
      { id: 'b', name: 'Bedroom', ip: '10.0.0.2', ecpEnabled: bEcp, deviceInfo: null, tv: { type: 'none', ip: null } },
    ]));
    localStorage.setItem('active-roku-id', 'a');
  };

  const setup = async (bEcp = true) => {
    seed(bEcp);
    await TestBed.configureTestingModule({
      imports: [SetupComponent],
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting(), provideRouter(routes)],
    }).compileComponents();
    roku = TestBed.inject(RokuService);
    router = TestBed.inject(Router);
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SetupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  afterEach(() => {
    httpMock.match(r => r.url.includes('/api/status')).forEach(r => r.flush('', { status: 0, statusText: '' }));
    httpMock.match(r => r.url.includes('version.json')).forEach(r => r.flush('{}'));
    localStorage.clear();
  });

  it('renders one .roku-item per saved Roku and marks the active one', async () => {
    await setup();
    const items = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.roku-item'));
    expect(items.length).toBe(2);
    expect(items[0].classList.contains('active')).toBeTrue();
    expect(items[1].classList.contains('active')).toBeFalse();
  });

  it('useRoku selects the Roku and navigates to /apps', async () => {
    await setup();
    const nav = spyOn(router, 'navigate');
    component.useRoku('b');
    expect(roku.activeRoku!.id).toBe('b');
    expect(nav).toHaveBeenCalledWith(['/apps']);
  });

  it('useRoku navigates to /remote when the Roku has ECP disabled', async () => {
    await setup(false);
    const nav = spyOn(router, 'navigate');
    component.useRoku('b');
    expect(nav).toHaveBeenCalledWith(['/remote']);
  });

  it('deleteRoku removes the Roku', async () => {
    await setup();
    component.deleteRoku('b');
    expect(roku.rokus.map(r => r.id)).toEqual(['a']);
  });

  it('startRename + commitRename renames the Roku', async () => {
    await setup();
    component.startRename(roku.rokus[1]);
    expect(component.editingId).toBe('b');
    component.editName = 'Den';
    component.commitRename();
    expect(roku.rokus[1].name).toBe('Den');
    expect(component.editingId).toBeNull();
  });

  it('startAdd clears the form', async () => {
    await setup();
    expect(component.ipAddress).toBe('10.0.0.1');
    component.startAdd();
    expect(component.ipAddress).toBe('');
    expect(component.deviceInfo).toBeNull();
  });

  it('reloads TV config when the active Roku changes', async () => {
    await setup();
    expect(component.tvType).toBe('panasonic');
    expect(component.tvIpAddress).toBe('10.0.0.50');
    roku.selectRoku('b');
    expect(component.tvType).toBe('none');
    expect(component.tvIpAddress).toBe('');
    expect(component.ipAddress).toBe('10.0.0.2');
    roku.selectRoku('a');
    expect(component.tvType).toBe('panasonic');
    expect(component.tvIpAddress).toBe('10.0.0.50');
  });
});
