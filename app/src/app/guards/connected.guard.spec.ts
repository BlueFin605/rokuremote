import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { connectedGuard } from './connected.guard';
import { RokuService } from '../services/roku.service';

const mk = (id: string, ip: string, name: string) =>
  ({ id, name, ip, ecpEnabled: true, deviceInfo: null, tv: { type: 'none', ip: null } });

describe('connectedGuard', () => {
  let http: HttpTestingController;
  let router: Router;
  let roku: RokuService;

  const run = () => TestBed.runInInjectionContext(() => connectedGuard({} as any, {} as any));
  const infoReqs = (ip: string) => http.match(r => r.url.includes('query/device-info') && r.url.includes(ip));

  function setup(seed: boolean) {
    localStorage.clear();
    if (seed) {
      localStorage.setItem('rokus', JSON.stringify([mk('a1', '10.0.0.1', 'Lounge'), mk('b2', '10.0.0.2', 'Bedroom')]));
      localStorage.setItem('active-roku-id', 'a1');
    }
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    roku = TestBed.inject(RokuService);
  }

  afterEach(() => localStorage.clear());

  it('returns a UrlTree for /setup when no Roku is saved', () => {
    setup(false);
    const result = run();
    expect(result instanceof UrlTree).toBeTrue();
    expect(router.serializeUrl(result as UrlTree)).toBe('/setup');
    http.verify();
  });

  it('returns true immediately and fires one device-info request', () => {
    setup(true);
    expect(run()).toBeTrue();
    const reqs = infoReqs('10.0.0.1');
    expect(reqs.length).toBe(1);
    reqs[0].flush('<device-info><friendly-device-name>X</friendly-device-name><model-name>M</model-name></device-info>');
  });

  it('does not re-verify the same Roku on a second run', () => {
    setup(true);
    run();
    infoReqs('10.0.0.1').forEach(r => r.flush('<device-info></device-info>'));
    expect(run()).toBeTrue();
    expect(infoReqs('10.0.0.1').length).toBe(0);
  });

  it('navigates to setup with unreachable state when the check fails', () => {
    setup(true);
    const nav = spyOn(router, 'navigate').and.resolveTo(true);
    run();
    infoReqs('10.0.0.1')[0].flush('', { status: 500, statusText: 'x' });
    expect(nav).toHaveBeenCalledTimes(1);
    const [cmds, extras] = nav.calls.mostRecent().args as any;
    expect(cmds).toEqual(['/setup']);
    expect(extras.state.unreachable).toEqual(jasmine.objectContaining({ id: 'a1', name: 'Lounge', ip: '10.0.0.1' }));
    expect(extras.state.unreachable.message).toBeDefined();
  });

  it('does not navigate when the check fails after the user switched Rokus', () => {
    setup(true);
    const nav = spyOn(router, 'navigate').and.resolveTo(true);
    run();
    roku.selectRoku('b2');
    infoReqs('10.0.0.1')[0].flush('', { status: 500, statusText: 'x' });
    expect(nav).not.toHaveBeenCalled();
  });

  it('a late successful check does not flip the active Roku back', () => {
    setup(true);
    run();
    roku.selectRoku('b2');
    infoReqs('10.0.0.1')[0].flush('<device-info><friendly-device-name>X</friendly-device-name></device-info>');
    expect(roku.activeRoku!.id).toBe('b2');
    expect(roku.rokus.length).toBe(2);
  });

  it('verifies the newly selected Roku after switching', () => {
    setup(true);
    run();
    infoReqs('10.0.0.1').forEach(r => r.flush('<device-info></device-info>'));
    roku.selectRoku('b2');
    expect(run()).toBeTrue();
    expect(infoReqs('10.0.0.2').length).toBe(1);
  });
});
