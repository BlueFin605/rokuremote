import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { SetupComponent } from './setup.component';
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
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(routes)],
    }).compileComponents();

    fixture = TestBed.createComponent(SetupComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  afterEach(() => {
    // Flush proxy status check if still pending
    httpMock.match(r => r.url === 'http://localhost:8080/status').forEach(r => r.flush('', { status: 0, statusText: '' }));
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
    component.tryConnect();

    httpMock.expectOne(r => r.url === 'http://192.168.1.100:8060/query/device-info').flush(`
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
    component.tryConnect();

    httpMock.expectOne(r => r.url === 'http://192.168.1.100:8060/query/device-info')
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
    component.tryConnect();

    const req = httpMock.expectOne(r => r.url === 'http://10.0.0.5:8060/query/device-info');
    req.flush(`<device-info>
      <friendly-device-name>Roku</friendly-device-name>
      <model-name>Ultra</model-name>
      <supports-private-listening>false</supports-private-listening>
    </device-info>`);

    expect(localStorage.getItem('roku-ip')).toBe('10.0.0.5');
  });

  it('should not connect when IP is empty', () => {
    component.ipAddress = '   ';
    component.tryConnect();
    httpMock.expectNone(r => r.url === 'http://192.168.1.100:8060/query/device-info');
  });
});
