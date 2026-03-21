import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { RokuService } from '../services/roku.service';

export const connectedGuard: CanActivateFn = () => {
  const roku = inject(RokuService);
  const router = inject(Router);

  if (roku.isConnected()) {
    return true;
  }

  return router.createUrlTree(['/setup']);
};
