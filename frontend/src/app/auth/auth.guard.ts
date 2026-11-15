import { inject } from '@angular/core';
import { type CanActivateChildFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from './auth.service';

export const LOGIN_PATH = '/logga-in';

/** Sends a signed-out visitor to the login page, remembering where they were going. */
export const authGuard: CanActivateChildFn = (_route, state) => {
  const router = inject(Router);
  return inject(AuthService)
    .check()
    .pipe(
      map(
        (signedIn) =>
          signedIn ||
          router.createUrlTree([LOGIN_PATH], {
            queryParams: state.url === '/' ? {} : { tillbaka: state.url },
          }),
      ),
    );
};
