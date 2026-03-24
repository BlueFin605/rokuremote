import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { LauncherComponent } from './launcher.component';
import { routes } from '../../app.routes';

const appsXml = `<?xml version="1.0" encoding="UTF-8" ?>
<apps>
  <app id="12" type="appl" version="14.0.0">Netflix</app>
  <app id="13" type="appl" version="9.0.0">Amazon Prime Video</app>
  <app id="15" type="appl" version="5.0.0">YouTube</app>
</apps>`;

describe('LauncherComponent', () => {
  let component: LauncherComponent;
  let fixture: ComponentFixture<LauncherComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('roku-ip', '192.168.1.100');

    await TestBed.configureTestingModule({
      imports: [LauncherComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(routes)],
    }).compileComponents();

    fixture = TestBed.createComponent(LauncherComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  function flushApps() {
    httpMock.expectOne(r => r.url === 'http://roku-proxy.local/api/roku/query/apps?ip=192.168.1.100').flush(appsXml);
    // Active app query fires after apps load
    httpMock.expectOne(r => r.url === 'http://roku-proxy.local/api/roku/query/active-app?ip=192.168.1.100')
      .flush('<active-app><app id="">Roku</app></active-app>');
    fixture.detectChanges();
  }

  it('should create', () => {
    expect(component).toBeTruthy();
    flushApps();
  });

  it('should load and display apps sorted alphabetically', () => {
    flushApps();

    expect(component.filteredApps.length).toBe(3);
    expect(component.filteredApps[0].name).toBe('Amazon Prime Video');
    expect(component.filteredApps[1].name).toBe('Netflix');
    expect(component.filteredApps[2].name).toBe('YouTube');
  });

  it('should render app tiles in the grid', () => {
    flushApps();

    const el: HTMLElement = fixture.nativeElement;
    const tiles = el.querySelectorAll('.tile');
    expect(tiles.length).toBe(3);
  });

  it('should render app icons as images', () => {
    flushApps();

    const el: HTMLElement = fixture.nativeElement;
    const images = el.querySelectorAll('.tile img');
    expect(images.length).toBe(3);
  });

  it('should filter apps by search query', () => {
    flushApps();

    component.searchQuery = 'net';
    component.filterApps();
    fixture.detectChanges();

    expect(component.filteredApps.length).toBe(1);
    expect(component.filteredApps[0].name).toBe('Netflix');
  });

  it('should show no results message for unmatched search', () => {
    flushApps();

    component.searchQuery = 'zzzzz';
    component.filterApps();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('No apps match');
  });

  it('should launch app on tile click', () => {
    flushApps();

    component.launch(component.filteredApps[1]); // Netflix

    const req = httpMock.expectOne(r =>
      r.url === 'http://roku-proxy.local/api/roku/launch/12?ip=192.168.1.100' && r.method === 'POST'
    );
    req.flush('');
  });

  it('should not launch app when in edit mode', () => {
    flushApps();

    component.editing = true;
    component.launch(component.filteredApps[0]);

    httpMock.expectNone(r => r.url.includes('/roku/launch/'));
  });

  it('should show placeholder when icon fails to load', () => {
    flushApps();

    const app = component.filteredApps[0];
    component.onIconError(app);
    fixture.detectChanges();

    expect(app.iconUrl).toBe('');
    const el: HTMLElement = fixture.nativeElement;
    const placeholders = el.querySelectorAll('.placeholder');
    expect(placeholders.length).toBeGreaterThan(0);
  });

  it('should persist custom order in localStorage', () => {
    flushApps();

    // Simulate a reorder: move YouTube to first position
    const apps = [...component.filteredApps];
    const youtube = apps.splice(2, 1)[0];
    apps.unshift(youtube);
    component.filteredApps = apps;
    // Sync back to main apps list (as drop() would do)
    component.apps = [...apps];
    component.toggleEdit(); // enter edit
    component.toggleEdit(); // exit edit — triggers save

    const saved = JSON.parse(localStorage.getItem('roku-app-order') || '[]');
    expect(saved[0]).toBe('15'); // YouTube
    expect(saved[1]).toBe('13'); // Amazon
    expect(saved[2]).toBe('12'); // Netflix
  });

  it('should restore custom order from localStorage', () => {
    // Set custom order before loading
    localStorage.setItem('roku-app-order', JSON.stringify(['15', '12', '13']));
    flushApps();

    // Recreate component to apply saved order
    fixture = TestBed.createComponent(LauncherComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    httpMock.expectOne(r => r.url === 'http://roku-proxy.local/api/roku/query/apps?ip=192.168.1.100').flush(appsXml);
    httpMock.expectOne(r => r.url === 'http://roku-proxy.local/api/roku/query/active-app?ip=192.168.1.100')
      .flush('<active-app><app id="">Roku</app></active-app>');
    fixture.detectChanges();

    expect(component.filteredApps[0].name).toBe('YouTube');
    expect(component.filteredApps[1].name).toBe('Netflix');
    expect(component.filteredApps[2].name).toBe('Amazon Prime Video');
  });

  it('should reset order to alphabetical', () => {
    flushApps();

    localStorage.setItem('roku-app-order', JSON.stringify(['15', '12', '13']));
    component.resetOrder();
    fixture.detectChanges();

    expect(component.filteredApps[0].name).toBe('Amazon Prime Video');
    expect(localStorage.getItem('roku-app-order')).toBeNull();
  });

  it('should show limited mode error with instructions', () => {
    httpMock.expectOne(r => r.url === 'http://roku-proxy.local/api/roku/query/apps?ip=192.168.1.100')
      .flush('ECP command not allowed in Limited mode.', { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Limited');
  });
});
