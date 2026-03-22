import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { RokuService } from './roku.service';

describe('RokuService', () => {
  let service: RokuService;
  let httpMock: HttpTestingController;

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

      const req = httpMock.expectOne(r => r.url === 'http://192.168.1.100:8060/query/device-info');
      expect(req.request.method).toBe('GET');
      req.flush(deviceInfoXml);
    });

    it('should save IP to localStorage on success', (done) => {
      service.connect('192.168.1.100').subscribe(() => {
        expect(localStorage.getItem('roku-ip')).toBe('192.168.1.100');
        expect(service.isConnected()).toBe(true);
        done();
      });

      httpMock.expectOne(r => r.url === 'http://192.168.1.100:8060/query/device-info').flush(deviceInfoXml);
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

      httpMock.expectOne(r => r.url === 'http://10.0.0.1:8060/query/device-info').flush(xml);
    });

    it('should return limited-mode error for 403 with Limited mode message', (done) => {
      service.connect('192.168.1.100').subscribe({
        error: (err) => {
          expect(err.type).toBe('limited-mode');
          done();
        },
      });

      httpMock.expectOne(r => r.url === 'http://192.168.1.100:8060/query/device-info')
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
      // Connect first to set the IP
      service.connect('192.168.1.100').subscribe();
      httpMock.expectOne(r => r.url === 'http://192.168.1.100:8060/query/device-info').flush(`
        <device-info>
          <friendly-device-name>Roku</friendly-device-name>
          <model-name>Test</model-name>
          <supports-private-listening>false</supports-private-listening>
        </device-info>`);

      service.keypress('Home');
      tick();

      const req = httpMock.expectOne(r =>
        r.url === 'http://192.168.1.100:8060/keypress/Home' && r.method === 'POST'
      );
      req.flush('');
      tick(100);
    }));
  });

  describe('sendText', () => {
    it('should send each character as a Lit_ keypress', fakeAsync(() => {
      service.connect('192.168.1.100').subscribe();
      httpMock.expectOne(r => r.url === 'http://192.168.1.100:8060/query/device-info').flush(`<device-info>
        <friendly-device-name>Roku</friendly-device-name>
        <model-name>Test</model-name>
        <supports-private-listening>false</supports-private-listening>
      </device-info>`);

      service.sendText('Hi');
      tick(); // first command enters concatMap

      const req1 = httpMock.expectOne(r => r.url === 'http://192.168.1.100:8060/keypress/Lit_H');
      req1.flush('');
      tick(100); // delay between commands

      const req2 = httpMock.expectOne(r => r.url === 'http://192.168.1.100:8060/keypress/Lit_i');
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

    const connectXml = `<device-info>
      <friendly-device-name>Roku</friendly-device-name>
      <model-name>Test</model-name>
      <supports-private-listening>false</supports-private-listening>
    </device-info>`;

    function connectService(svc: RokuService, mock: HttpTestingController) {
      svc.connect('192.168.1.100').subscribe();
      mock.expectOne(r => r.url === 'http://192.168.1.100:8060/query/device-info').flush(connectXml);
    }

    it('should parse apps from XML and sort alphabetically', (done) => {
      connectService(service, httpMock);

      service.getApps().subscribe(apps => {
        expect(apps.length).toBe(3);
        expect(apps[0].name).toBe('Amazon Prime Video');
        expect(apps[1].name).toBe('Netflix');
        expect(apps[2].name).toBe('YouTube');
        expect(apps[1].id).toBe('12');
        expect(apps[1].version).toBe('14.0.0');
        done();
      });

      httpMock.expectOne(r => r.url === 'http://192.168.1.100:8060/query/apps').flush(appsXml);
    });

    it('should include icon URLs for each app', (done) => {
      connectService(service, httpMock);

      service.getApps().subscribe(apps => {
        expect(apps[1].iconUrl).toContain('http://192.168.1.100:8060/query/icon/12');
        done();
      });

      httpMock.expectOne(r => r.url === 'http://192.168.1.100:8060/query/apps').flush(appsXml);
    });
  });

  describe('launchApp', () => {
    it('should POST to launch endpoint', (done) => {
      service.connect('192.168.1.100').subscribe();
      httpMock.expectOne(r => r.url === 'http://192.168.1.100:8060/query/device-info').flush(`<device-info>
        <friendly-device-name>Roku</friendly-device-name>
        <model-name>Test</model-name>
        <supports-private-listening>false</supports-private-listening>
      </device-info>`);

      service.launchApp('12').subscribe(() => done());

      const req = httpMock.expectOne(r =>
        r.url === 'http://192.168.1.100:8060/launch/12' && r.method === 'POST'
      );
      req.flush('');
    });
  });

  describe('getActiveApp', () => {
    const connectXml = `<device-info>
      <friendly-device-name>Roku</friendly-device-name>
      <model-name>Test</model-name>
      <supports-private-listening>false</supports-private-listening>
    </device-info>`;

    it('should return the active app ID', (done) => {
      service.connect('192.168.1.100').subscribe();
      httpMock.expectOne(r => r.url === 'http://192.168.1.100:8060/query/device-info').flush(connectXml);

      service.getActiveApp().subscribe(id => {
        expect(id).toBe('12');
        done();
      });

      httpMock.expectOne(r => r.url === 'http://192.168.1.100:8060/query/active-app')
        .flush('<active-app><app id="12">Netflix</app></active-app>');
    });

    it('should return empty string when no app is active', (done) => {
      service.connect('192.168.1.100').subscribe();
      httpMock.expectOne(r => r.url === 'http://192.168.1.100:8060/query/device-info').flush(connectXml);

      service.getActiveApp().subscribe(id => {
        expect(id).toBe('');
        done();
      });

      httpMock.expectOne(r => r.url === 'http://192.168.1.100:8060/query/active-app')
        .flush('<active-app><app id="">Roku</app></active-app>');
    });
  });
});
