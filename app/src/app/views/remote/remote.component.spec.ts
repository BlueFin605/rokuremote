import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RemoteComponent } from './remote.component';
import { routes } from '../../app.routes';

describe('RemoteComponent', () => {
  let component: RemoteComponent;
  let fixture: ComponentFixture<RemoteComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    localStorage.setItem('roku-ip', '192.168.1.100');
    await TestBed.configureTestingModule({
      imports: [RemoteComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(routes)],
    }).compileComponents();

    fixture = TestBed.createComponent(RemoteComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have all essential remote buttons', () => {
    const el: HTMLElement = fixture.nativeElement;
    const text = el.textContent || '';

    expect(text).toContain('Back');
    expect(text).toContain('Home');
    expect(text).toContain('Apps');
    expect(text).toContain('Power');
    expect(text).toContain('OK');
    expect(text).toContain('Vol');
    expect(text).toContain('Mute');
  });

  it('should have a text input field', () => {
    const el: HTMLElement = fixture.nativeElement;
    const input = el.querySelector('input[type="text"]');
    expect(input).toBeTruthy();
  });

  it('should send keypress on button click', fakeAsync(() => {
    component.press('Home');
    tick();

    const req = httpMock.expectOne(r =>
      r.url === 'http://roku-proxy.local:8080/roku/keypress/Home?ip=192.168.1.100' && r.method === 'POST'
    );
    req.flush('');
    tick(100);
  }));

  it('should send text as individual Lit_ keypresses', fakeAsync(() => {
    component.textInput = 'ab';
    component.sendText();

    expect(component.textInput).toBe('');
    tick();

    const req1 = httpMock.expectOne(r => r.url === 'http://roku-proxy.local:8080/roku/keypress/Lit_a?ip=192.168.1.100');
    req1.flush('');
    tick(100);

    const req2 = httpMock.expectOne(r => r.url === 'http://roku-proxy.local:8080/roku/keypress/Lit_b?ip=192.168.1.100');
    req2.flush('');
    tick(100);
  }));

  it('should not send empty text', () => {
    component.textInput = '   ';
    component.sendText();
    httpMock.expectNone(r => r.url.includes('/roku/keypress/Lit_'));
  });

  it('should have a disconnect button', () => {
    const el: HTMLElement = fixture.nativeElement;
    const btn = Array.from(el.querySelectorAll('button'))
      .find(b => b.textContent?.trim() === 'Disconnect');
    expect(btn).toBeTruthy();
  });

  it('should have a private listening button', () => {
    const el: HTMLElement = fixture.nativeElement;
    const btn = Array.from(el.querySelectorAll('button'))
      .find(b => b.textContent?.trim() === 'Private Listening');
    expect(btn).toBeTruthy();
  });
});
