import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { RokuService } from './roku.service';

const PROXY = 'http://roku-proxy';

function rokuUrl(path: string, ip: string): string {
  return `${PROXY}/api/roku/${path}?ip=${ip}`;
}

describe('RokuService', () => {
  let service: RokuService;
  let httpMock: HttpTestingController;

  const connectXml = `<device-info>
    <friendly-device-name>Roku</friendly-device-name>
    <model-name>Test</model-name>
    <supports-private-listening>false</supports-private-listening>
  </device-info>`;

  function connectService(ip = '192.168.1.100') {
    service.connect(ip).subscribe();
    httpMock.expectOne(r => r.url === rokuUrl('query/device-info', ip)).flush(connectXml);
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting()],
    });
    service = TestBed.inject(RokuService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('connect', () => {
    const deviceInfoXml = `<?xml version="1.0" encoding="UTF-8" ?>
      <device-info>
        <friendly-device-name>Living Room Roku</friendly-device-name>
        <model-name>Roku Express</model-name>
        <supports-private-listening>true</supports-private-listening>
      </device-info>`;

    it('should parse device info from XML', (done) => {
      service.connect('192.168.1.100').subscribe(info => {
        expect(info.name).toBe('Living Room Roku');
        expect(info.model).toBe('Roku Express');
        expect(info.supportsPrivateListening).toBe(true);
        done();
      });

      const req = httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '192.168.1.100'));
      expect(req.request.method).toBe('GET');
      req.flush(deviceInfoXml);
    });

    it('should save IP to localStorage on success', (done) => {
      service.connect('192.168.1.100').subscribe(() => {
        expect(service.getSavedIp()).toBe('192.168.1.100');
        expect(service.isConnected()).toBe(true);
        done();
      });

      httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '192.168.1.100')).flush(deviceInfoXml);
    });

    it('should fall back to default-device-name when friendly name is missing', (done) => {
      const xml = `<device-info>
        <default-device-name>Roku Stick</default-device-name>
        <model-name>3800X</model-name>
        <supports-private-listening>false</supports-private-listening>
      </device-info>`;

      service.connect('10.0.0.1').subscribe(info => {
        expect(info.name).toBe('Roku Stick');
        expect(info.supportsPrivateListening).toBe(false);
        done();
      });

      httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.1')).flush(xml);
    });

    it('should return limited-mode error for 403 with Limited mode message', (done) => {
      service.connect('192.168.1.100').subscribe({
        error: (err) => {
          expect(err.type).toBe('limited-mode');
          done();
        },
      });

      httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '192.168.1.100'))
        .flush('ECP command not allowed in Limited mode.', { status: 403, statusText: 'Forbidden' });
    });
  });

  describe('disconnect', () => {
    it('should clear saved IP and mark as disconnected', () => {
      connectService();
      service.disconnect();
      expect(service.isConnected()).toBe(false);
      expect(service.getSavedIp()).toBeNull();
      expect(service.rokus.length).toBe(0);
    });
  });

  function createService(): RokuService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(withXhr()), provideHttpClientTesting()] });
    httpMock = TestBed.inject(HttpTestingController);
    return TestBed.inject(RokuService);
  }

  describe('saved Roku list', () => {
    it('migrates legacy single-Roku keys into one active entry and removes them', () => {
      localStorage.setItem('roku-ip', '192.168.1.50');
      localStorage.setItem('roku-device-info', JSON.stringify({ name: 'Lounge', model: 'Ultra', supportsPrivateListening: true, ecpEnabled: true }));
      localStorage.setItem('roku-ecp-enabled', 'true');
      localStorage.setItem('tv-type', 'panasonic');
      localStorage.setItem('tv-ip', '192.168.1.90');
      const s = createService();
      expect(s.rokus.length).toBe(1);
      expect(s.activeRoku).toEqual(jasmine.objectContaining({ name: 'Lounge', ip: '192.168.1.50', ecpEnabled: true, tv: { type: 'panasonic', ip: '192.168.1.90' } }));
      expect(s.getSavedIp()).toBe('192.168.1.50');
      for (const k of ['roku-ip', 'roku-device-info', 'roku-ecp-enabled', 'tv-type', 'tv-ip']) expect(localStorage.getItem(k)).toBeNull();
    });
    it('treats a non-array stored list as empty and drops malformed entries', () => {
      localStorage.setItem('rokus', '{}');
      expect(createService().rokus.length).toBe(0);
      localStorage.setItem('rokus', JSON.stringify([null, 5, { id: 'x' }, { id: 'a', ip: '1.2.3.4', name: 'A' }]));
      const s2 = createService();
      expect(s2.rokus.map(r => r.id)).toEqual(['a']);
    });
    it('starts empty with nothing saved', () => {
      const s = createService();
      expect(s.rokus.length).toBe(0);
      expect(s.activeRoku).toBeNull();
      expect(s.isConnected()).toBeFalse();
    });
    it('connect adds a new Roku, makes it active, and reuses the entry for a known ip', () => {
      const s = createService();
      s.connect('10.0.0.1').subscribe();
      httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.1')).flush(connectXml);
      s.connect('10.0.0.2').subscribe();
      httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.2')).flush(connectXml);
      expect(s.rokus.map(r => r.ip)).toEqual(['10.0.0.1', '10.0.0.2']);
      expect(s.activeRoku!.ip).toBe('10.0.0.2');
      s.connect('10.0.0.1').subscribe();
      httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.1')).flush(connectXml);
      expect(s.rokus.length).toBe(2);
      expect(s.activeRoku!.ip).toBe('10.0.0.1');
    });
    it('verifyOnly updates the checked entry without changing the active Roku', () => {
      const s = createService();
      s.connect('10.0.0.1').subscribe(); httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.1')).flush(connectXml);
      s.connect('10.0.0.2').subscribe(); httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.2')).flush(connectXml);
      const a = s.rokus[0];
      s.renameRoku(a.id, 'Custom');
      s.selectRoku(s.rokus[1].id);
      const activeId = s.activeRoku!.id;
      s.connect('10.0.0.1', { replaceId: a.id, verifyOnly: true }).subscribe();
      httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.1')).flush(connectXml);
      expect(s.activeRoku!.id).toBe(activeId);
      expect(s.rokus.length).toBe(2);
      const updated = s.rokus.find(r => r.id === a.id)!;
      expect(updated.name).toBe('Custom');
      expect(updated.deviceInfo).not.toBeNull();
    });
    it('verifyOnly for a removed entry does not re-add it', () => {
      const s = createService();
      s.connect('10.0.0.1').subscribe(); httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.1')).flush(connectXml);
      s.connect('10.0.0.2').subscribe(); httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.2')).flush(connectXml);
      const a = s.rokus[0];
      s.connect('10.0.0.1', { replaceId: a.id, verifyOnly: true }).subscribe();
      s.removeRoku(a.id);
      httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.1')).flush(connectXml);
      expect(s.rokus.map(r => r.ip)).toEqual(['10.0.0.2']);
      expect(s.activeRoku!.ip).toBe('10.0.0.2');
    });
    it('connect with replaceId updates that entry ip keeping id, name and tv', () => {
      const s = createService();
      s.connect('10.0.0.1').subscribe(); httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.1')).flush(connectXml);
      s.renameRoku(s.activeRoku!.id, 'Custom');
      s.setActiveTv('panasonic', '10.0.0.9');
      const before = s.activeRoku!;
      s.connect('10.0.0.5', { replaceId: before.id }).subscribe();
      httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.5')).flush(connectXml);
      expect(s.rokus.length).toBe(1);
      expect(s.activeRoku).toEqual(jasmine.objectContaining({ id: before.id, name: 'Custom', ip: '10.0.0.5', tv: { type: 'panasonic', ip: '10.0.0.9' } }));
    });
    it('connect with replaceId to an ip that already exists switches to that entry without adding', () => {
      const s = createService();
      s.connect('10.0.0.1').subscribe(); httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.1')).flush(connectXml);
      s.connect('10.0.0.2').subscribe(); httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.2')).flush(connectXml);
      const [a, b] = s.rokus;
      s.connect('10.0.0.1', { replaceId: b.id }).subscribe();
      httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.1')).flush(connectXml);
      expect(s.rokus.length).toBe(2);
      expect(s.rokus.find(r => r.id === b.id)!.ip).toBe('10.0.0.2');
      expect(s.activeRoku!.id).toBe(a.id);
    });
    it('selectRoku switches the active Roku, persists it, and emits activeChanged$', () => {
      const s = createService();
      let emitted = 0; s.activeChanged$.subscribe(() => emitted++);
      s.connect('10.0.0.1').subscribe(); httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.1')).flush(connectXml);
      s.connect('10.0.0.2').subscribe(); httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.2')).flush(connectXml);
      const first = s.rokus[0];
      emitted = 0;
      s.selectRoku(first.id);
      expect(s.activeRoku!.id).toBe(first.id);
      expect(emitted).toBe(1);
      expect(createService().activeRoku!.id).toBe(first.id); // persisted
    });
    it('removeRoku of the active Roku falls back to the first remaining; disconnect removes only the active one', () => {
      const s = createService();
      s.connect('10.0.0.1').subscribe(); httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.1')).flush(connectXml);
      s.connect('10.0.0.2').subscribe(); httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.2')).flush(connectXml);
      s.disconnect();
      expect(s.rokus.map(r => r.ip)).toEqual(['10.0.0.1']);
      expect(s.activeRoku!.ip).toBe('10.0.0.1');
      s.disconnect();
      expect(s.activeRoku).toBeNull();
    });
    it('renameRoku and setActiveTv update the active entry and persist', () => {
      const s = createService();
      s.connect('10.0.0.1').subscribe(); httpMock.expectOne(r => r.url === rokuUrl('query/device-info', '10.0.0.1')).flush(connectXml);
      s.renameRoku(s.activeRoku!.id, '  Bedroom ');
      s.setActiveTv('panasonic', '10.0.0.9');
      const again = createService();
      expect(again.activeRoku!.name).toBe('Bedroom');
      expect(again.activeRoku!.tv).toEqual({ type: 'panasonic', ip: '10.0.0.9' });
      again.setActiveTv('none', null);
      expect(again.activeRoku!.tv).toEqual({ type: 'none', ip: null });
    });
  });

  describe('keypress', () => {
    it('should send POST to correct keypress URL', fakeAsync(() => {
      connectService();

      service.keypress('Home');
      tick();

      const req = httpMock.expectOne(r =>
        r.url === rokuUrl('keypress/Home', '192.168.1.100') && r.method === 'POST'
      );
      req.flush('');
      tick(100);
    }));

    it('should send wake sequence as PowerOn then Home', fakeAsync(() => {
      connectService();

      service.wake();
      tick();

      const req1 = httpMock.expectOne(r =>
        r.url === rokuUrl('keypress/PowerOn', '192.168.1.100') && r.method === 'POST'
      );
      req1.flush('');
      tick(100);

      const req2 = httpMock.expectOne(r =>
        r.url === rokuUrl('keypress/Home', '192.168.1.100') && r.method === 'POST'
      );
      req2.flush('');
      tick(100);
    }));

    it('should send reboot sequence', fakeAsync(() => {
      connectService();

      service.reboot();
      tick();

      const expected = [
        'Home',
        'long-delay',
        'Home',
        'Home',
        'short-delay',
        'Up',
        'Right',
        'Up',
        'Right',
        'Up',
        'Up',
        'Right',
        'Select',
      ];

      for (const key of expected) {
        if (key === 'long-delay' || key === 'short-delay') {
          // pseudo keypress: delays the queue, no HTTP request
          tick(1200);
          continue;
        }
        const req = httpMock.expectOne(r =>
          r.url === rokuUrl(`keypress/${key}`, '192.168.1.100') && r.method === 'POST'
        );
        req.flush('');
        tick(1200);
      }
    }));

    it('should apply configured short-delay pseudo keypress without sending delay HTTP', fakeAsync(() => {
      connectService();

      service.setRebootDelays({ shortMs: 500 });
      service.keypress('short-delay');
      service.keypress('Home');

      tick(520);
      httpMock.expectNone(r => r.url === rokuUrl('keypress/Home', '192.168.1.100'));
      httpMock.expectNone(r => r.url === rokuUrl('keypress/short-delay', '192.168.1.100'));

      tick(80);
      const req = httpMock.expectOne(r =>
        r.url === rokuUrl('keypress/Home', '192.168.1.100') && r.method === 'POST'
      );
      req.flush('');
      tick(100);

      expect(localStorage.getItem('roku-short-delay-ms')).toBe('500');
    }));
  });

  describe('sendText', () => {
    it('should send each character as a Lit_ keypress', fakeAsync(() => {
      connectService();

      service.sendText('Hi');
      tick();

      const req1 = httpMock.expectOne(r => r.url === rokuUrl('keypress/Lit_H', '192.168.1.100'));
      req1.flush('');
      tick(100);

      const req2 = httpMock.expectOne(r => r.url === rokuUrl('keypress/Lit_i', '192.168.1.100'));
      req2.flush('');
      tick(100);
    }));
  });

  describe('getApps', () => {
    const appsXml = `<?xml version="1.0" encoding="UTF-8" ?>
      <apps>
        <app id="12" type="appl" version="14.0.0">Netflix</app>
        <app id="13" type="appl" version="9.0.0">Amazon Prime Video</app>
        <app id="15" type="appl" version="5.0.0">YouTube</app>
      </apps>`;

    it('should parse apps from XML and sort alphabetically', (done) => {
      connectService();

      service.getApps().subscribe(apps => {
        expect(apps.length).toBe(3);
        expect(apps[0].name).toBe('Amazon Prime Video');
        expect(apps[1].name).toBe('Netflix');
        expect(apps[2].name).toBe('YouTube');
        expect(apps[1].id).toBe('12');
        expect(apps[1].version).toBe('14.0.0');
        done();
      });

      httpMock.expectOne(r => r.url === rokuUrl('query/apps', '192.168.1.100')).flush(appsXml);
    });

    it('should include icon URLs for each app', (done) => {
      connectService();

      service.getApps().subscribe(apps => {
        expect(apps[1].iconUrl).toContain('/roku/query/icon/12');
        done();
      });

      httpMock.expectOne(r => r.url === rokuUrl('query/apps', '192.168.1.100')).flush(appsXml);
    });
  });

  describe('launchApp', () => {
    it('should POST to launch endpoint', (done) => {
      connectService();

      service.launchApp('12').subscribe(() => done());

      const req = httpMock.expectOne(r =>
        r.url === rokuUrl('launch/12', '192.168.1.100') && r.method === 'POST'
      );
      req.flush('');
    });
  });

  describe('getActiveApp', () => {
    it('should return the active app ID', (done) => {
      connectService();

      service.getActiveApp().subscribe(id => {
        expect(id).toBe('12');
        done();
      });

      httpMock.expectOne(r => r.url === rokuUrl('query/active-app', '192.168.1.100'))
        .flush('<active-app><app id="12">Netflix</app></active-app>');
    });

    it('should return empty string when no app is active', (done) => {
      connectService();

      service.getActiveApp().subscribe(id => {
        expect(id).toBe('');
        done();
      });

      httpMock.expectOne(r => r.url === rokuUrl('query/active-app', '192.168.1.100'))
        .flush('<active-app><app id="">Roku</app></active-app>');
    });
  });
});
