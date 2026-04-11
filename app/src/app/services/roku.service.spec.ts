import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
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
      providers: [provideHttpClient(), provideHttpClientTesting()],
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
        expect(localStorage.getItem('roku-ip')).toBe('192.168.1.100');
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
      localStorage.setItem('roku-ip', '192.168.1.100');
      service.disconnect();
      expect(service.isConnected()).toBe(false);
      expect(service.getSavedIp()).toBeNull();
      expect(localStorage.getItem('roku-ip')).toBeNull();
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
        'Left',
        'Up', 'Up', 'Up',
        'Select',
        'Up',
        'Select',
        'Down', 'Down',
        'Select',
        'Select',
      ];

      for (const key of expected) {
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
