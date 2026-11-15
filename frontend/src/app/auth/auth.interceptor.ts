import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { LOGIN_PATH } from './auth.guard';
import { AuthService } from './auth.service';

/** A 401 from the API means the session is gone: go to the login page and come back afterwards. */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const router = inject(Router);
  const auth = inject(AuthService);
  return next(request).pipe(
    catchError((error: unknown) => {
      const isAuthCall = request.url.startsWith('/api/auth/');
      if (error instanceof HttpErrorResponse && error.status === 401 && !isAuthCall) {
        auth.markSignedOut();
        const here = router.url;
        if (!here.startsWith(LOGIN_PATH)) {
          void router.navigate([LOGIN_PATH], {
            queryParams: here === '/' ? {} : { tillbaka: here },
          });
        }
      }
      return throwError(() => error);
    }),
  );
};
