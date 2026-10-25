import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { RokuService } from '../services/roku.service';

export interface UnreachableState {
  unreachable: { id: string; name: string; ip: string; message?: string };
}

export const connectedGuard: CanActivateFn = () => {
  const roku = inject(RokuService);
  const router = inject(Router);
  const active = roku.activeRoku;
  if (!active) return router.createUrlTree(['/setup']);

  if (roku.startupVerifiedId !== active.id) {
    roku.startupVerifiedId = active.id;
    roku.connect(active.ip).subscribe({
      error: (err) => {
        const state: UnreachableState = {
          unreachable: { id: active.id, name: active.name, ip: active.ip, message: err?.message },
        };
        router.navigate(['/setup'], { state });
      },
    });
  }
  return true;
};
