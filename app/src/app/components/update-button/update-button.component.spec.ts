import { TestBed, ComponentFixture } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { UpdateButtonComponent } from './update-button.component';
import { UpdateService, UpdateState, LatestBundle } from '../../services/update.service';
import { ANDROID_APK_URL } from '../../services/android-links';

class FakeUpdate {
  latest: LatestBundle | null = null;
  state: UpdateState = 'none';
  changes$ = new BehaviorSubject<UpdateState>('none');
  progress$ = new BehaviorSubject<number | null>(null);
  error$ = new BehaviorSubject<string | null>(null);
  apply = jasmine.createSpy('apply').and.resolveTo();
  check = jasmine.createSpy('check').and.resolveTo();
  setState(s: UpdateState) {
    this.state = s;
    this.latest = s === 'none' ? null : { version: '1.0.42', url: 'u', minNativeVersion: '1.0.1' };
    this.changes$.next(s);
  }
}

describe('UpdateButtonComponent', () => {
  let fake: FakeUpdate;
  let fixture: ComponentFixture<UpdateButtonComponent>;
  const q = (id: string) => fixture.nativeElement.querySelector(`[data-testid=${id}]`) as HTMLElement | null;

  beforeEach(() => {
    fake = new FakeUpdate();
    TestBed.configureTestingModule({
      imports: [UpdateButtonComponent],
      providers: [{ provide: UpdateService, useValue: fake }],
    });
    fixture = TestBed.createComponent(UpdateButtonComponent);
    fixture.detectChanges();
  });

  it('renders nothing for none', () => {
    expect(q('update-button')).toBeNull();
    expect(q('update-apk')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent!.trim()).toBe('');
  });

  it('shows the update button and calls apply on click', () => {
    fake.setState('available');
    fixture.detectChanges();
    const b = q('update-button') as HTMLButtonElement;
    expect(b.textContent).toContain('Update to v1.0.42');
    b.click();
    expect(fake.apply).toHaveBeenCalled();
  });

  it('shows progress and disables while updating', () => {
    fake.setState('available');
    fake.progress$.next(37);
    fixture.detectChanges();
    const b = q('update-button') as HTMLButtonElement;
    expect(b.textContent).toContain('Updating 37%');
    expect(b.disabled).toBeTrue();
  });

  it('shows the error text', () => {
    fake.setState('available');
    fake.error$.next('Update failed, try again');
    fixture.detectChanges();
    expect(q('update-error')!.textContent).toContain('Update failed, try again');
  });

  it('shows the APK link for native-required', () => {
    fake.setState('native-required');
    fixture.detectChanges();
    const a = q('update-apk') as HTMLAnchorElement;
    expect(a.textContent).toContain('Download new APK');
    expect(a.getAttribute('href')).toBe(ANDROID_APK_URL);
    expect(q('update-button')).toBeNull();
  });

  it('compact uses the banner strip', () => {
    fixture.componentRef.setInput('compact', true);
    fake.setState('available');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.banner')).not.toBeNull();
  });

  it('full-size has no banner class', () => {
    fake.setState('available');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.banner')).toBeNull();
  });
});
