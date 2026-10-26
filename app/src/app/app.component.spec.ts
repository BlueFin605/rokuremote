import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';
import { routes } from './app.routes';
import { NativeInfoService } from './services/native-info.service';
import { UPDATER_PLUGIN, UpdateService } from './services/update.service';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter(routes)],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it(`should have the 'roku-remote' title`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.title).toEqual('roku-remote');
  });

  describe('notifyAppReady', () => {
    async function create(isNative: boolean) {
      const plugin = { notifyAppReady: jasmine.createSpy('notifyAppReady').and.resolveTo() };
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AppComponent],
        providers: [
          provideRouter(routes),
          { provide: UPDATER_PLUGIN, useValue: plugin },
          { provide: NativeInfoService, useValue: { isNative } },
        ],
      }).compileComponents();
      TestBed.createComponent(AppComponent);
      return plugin;
    }
    it('is called once when native', async () => {
      expect((await create(true)).notifyAppReady).toHaveBeenCalledTimes(1);
    });
    it('is not called in a browser', async () => {
      expect((await create(false)).notifyAppReady).not.toHaveBeenCalled();
    });
  });

  it('checks for an update on startup', async () => {
    const update = { check: jasmine.createSpy('check').and.resolveTo() };
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter(routes), { provide: UpdateService, useValue: update }],
    }).compileComponents();
    TestBed.createComponent(AppComponent);
    expect(update.check).toHaveBeenCalledTimes(1);
  });
});
