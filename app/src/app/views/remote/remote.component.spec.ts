import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RemoteComponent } from './remote.component';
import { routes } from '../../app.routes';

describe('RemoteComponent', () => {
  let component: RemoteComponent;
  let fixture: ComponentFixture<RemoteComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    // Other specs leave 'rokus' / 'active-roku-id' behind (random spec order); a stale
    // active Roku would win over the legacy key and change the request URLs.
    localStorage.clear();
    localStorage.setItem('roku-ip', '192.168.1.100');
    await TestBed.configureTestingModule({
      imports: [RemoteComponent],
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting(), provideRouter(routes)],
    }).compileComponents();

    fixture = TestBed.createComponent(RemoteComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
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
      r.url === 'http://roku-proxy/api/roku/keypress/Home?ip=192.168.1.100' && r.method === 'POST'
    );
    req.flush('');
    tick(100);
  }));

  it('should send text as individual Lit_ keypresses', fakeAsync(() => {
    component.textInput = 'ab';
    component.sendText();

    expect(component.textInput).toBe('');
    tick();

    const req1 = httpMock.expectOne(r => r.url === 'http://roku-proxy/api/roku/keypress/Lit_a?ip=192.168.1.100');
    req1.flush('');
    tick(100);

    const req2 = httpMock.expectOne(r => r.url === 'http://roku-proxy/api/roku/keypress/Lit_b?ip=192.168.1.100');
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

  describe('disconnect confirmation', () => {
    const btnByText = (t: string) => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find(b => b.textContent?.trim() === t) as HTMLButtonElement | undefined;

    it('single tap asks for confirmation and does not remove', () => {
      const spy = spyOn(component['roku'], 'removeRoku');
      btnByText('Disconnect')!.click();
      fixture.detectChanges();
      expect(spy).not.toHaveBeenCalled();
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid=disconnect-confirm]')!.textContent).toContain('Remove');
      expect(btnByText('Yes')).toBeTruthy();
      expect(btnByText('No')).toBeTruthy();
    });

    it('Yes removes the active Roku', () => {
      const spy = spyOn(component['roku'], 'removeRoku');
      const nav = spyOn(component['router'], 'navigate');
      btnByText('Disconnect')!.click();
      fixture.detectChanges();
      btnByText('Yes')!.click();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(nav).toHaveBeenCalledWith(['/setup']);
    });

    const fakeRoku = (id: string, name: string) => ({ id, name, ip: '1.1.1.1', tv: { type: 'none', ip: null } }) as any;

    it('Yes removes the Roku that was targeted when the strip opened, even if the active one changed', () => {
      let current = fakeRoku('a', 'Lounge');
      spyOnProperty(component['roku'], 'activeRoku', 'get').and.callFake(() => current);
      const spy = spyOn(component['roku'], 'removeRoku');
      spyOn(component['router'], 'navigate');
      btnByText('Disconnect')!.click();
      fixture.detectChanges();
      component.confirmDisconnectYes();
      expect(spy).toHaveBeenCalledOnceWith('a');
      current = fakeRoku('b', 'Bedroom');
    });

    it('closes the strip when the active Roku changes', () => {
      let current = fakeRoku('a', 'Lounge');
      spyOnProperty(component['roku'], 'activeRoku', 'get').and.callFake(() => current);
      btnByText('Disconnect')!.click();
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid=disconnect-confirm]')).toBeTruthy();
      current = fakeRoku('b', 'Bedroom');
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid=disconnect-confirm]')).toBeNull();
    });

    it('strip is an accessible group and focuses No when opened', fakeAsync(() => {
      spyOnProperty(component['roku'], 'activeRoku', 'get').and.returnValue(fakeRoku('a', 'Lounge'));
      btnByText('Disconnect')!.click();
      fixture.detectChanges();
      const strip = (fixture.nativeElement as HTMLElement).querySelector('[data-testid=disconnect-confirm]')!;
      expect(strip.getAttribute('role')).toBe('group');
      expect(strip.getAttribute('aria-label')).toBe('Confirm removing Lounge');
      tick();
      expect(document.activeElement).toBe(btnByText('No')!);
    }));

    it('No cancels', () => {
      const spy = spyOn(component['roku'], 'removeRoku');
      btnByText('Disconnect')!.click();
      fixture.detectChanges();
      btnByText('No')!.click();
      fixture.detectChanges();
      expect(spy).not.toHaveBeenCalled();
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid=disconnect-confirm]')).toBeNull();
      expect(btnByText('Disconnect')).toBeTruthy();
    });
  });

  it('should have a private listening button', () => {
    const el: HTMLElement = fixture.nativeElement;
    const btn = Array.from(el.querySelectorAll('button'))
      .find(b => b.textContent?.trim() === 'Private Listening');
    expect(btn).toBeTruthy();
  });

  it('should have a reboot roku button', () => {
    const el: HTMLElement = fixture.nativeElement;
    const btn = Array.from(el.querySelectorAll('button'))
      .find(b => b.textContent?.trim() === 'Reboot Roku');
    expect(btn).toBeTruthy();
  });
});
