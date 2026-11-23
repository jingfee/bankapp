import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';

/** Only paths inside the app, so a crafted link cannot send the owner elsewhere after login. */
function safeReturnUrl(value: string | null): string {
  return value !== null && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

@Component({
  selector: 'app-logga-in-page',
  template: `
    <main class="grid min-h-dvh place-items-center px-4 py-10">
      <form
        class="card flex w-full max-w-sm flex-col gap-5 p-5 sm:p-6"
        [class.shake]="shaking()"
        novalidate
        (submit)="$event.preventDefault(); submit()"
      >
        <header class="flex flex-col items-center gap-3 text-center">
          <span
            class="grid size-12 place-content-center rounded-2xl bg-accent font-display text-xl font-bold text-on-accent"
            aria-hidden="true"
            >B</span
          >
          <h1 class="text-2xl font-bold tracking-tight">Bankapp</h1>
        </header>

        <label class="flex flex-col gap-1.5 text-sm font-medium">
          Användarnamn
          <span class="field">
            <svg
              class="field-icon size-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <input
              class="field-control"
              name="username"
              type="text"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              [value]="username()"
              (input)="username.set($any($event.target).value)"
            />
          </span>
        </label>

        <label class="flex flex-col gap-1.5 text-sm font-medium">
          Lösenord
          <span class="field">
            <svg
              class="field-icon size-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            <input
              class="field-control"
              name="password"
              [type]="showPassword() ? 'text' : 'password'"
              autocomplete="current-password"
              [value]="password()"
              (input)="password.set($any($event.target).value)"
            />
            <button
              type="button"
              class="field-icon cursor-pointer text-sm hover:text-ink"
              [attr.aria-label]="showPassword() ? 'Dölj lösenordet' : 'Visa lösenordet'"
              [attr.aria-pressed]="showPassword()"
              (click)="showPassword.set(!showPassword())"
            >
              {{ showPassword() ? 'Dölj' : 'Visa' }}
            </button>
          </span>
        </label>

        @if (error(); as message) {
          <p role="alert" class="text-sm text-danger">{{ message }}</p>
        }

        <button type="submit" class="btn btn-primary w-full" [disabled]="busy()">
          @if (busy()) {
            <span class="spinner" aria-hidden="true"></span>
          }
          Logga in
        </button>
      </form>
    </main>
  `,
})
export class LoggaInPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly returnUrl = safeReturnUrl(
    inject(ActivatedRoute).snapshot.queryParamMap.get('tillbaka'),
  );

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly showPassword = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly shaking = signal(false);

  protected submit(): void {
    if (this.busy()) return;
    if (this.password() === '') {
      this.error.set('Ange ditt lösenord.');
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    this.auth.login({ username: this.username().trim(), password: this.password() }).subscribe({
      next: () => void this.router.navigateByUrl(this.returnUrl),
      error: (failure: unknown) => {
        this.busy.set(false);
        this.password.set('');
        const status = failure instanceof HttpErrorResponse ? failure.status : 0;
        if (status === 401) {
          this.error.set('Fel användarnamn eller lösenord.');
          this.shake();
        } else if (status === 429) {
          this.error.set('För många försök. Vänta en stund och försök igen.');
        } else {
          this.error.set('Det gick inte att logga in just nu. Försök igen.');
        }
      },
    });
  }

  private shake(): void {
    this.shaking.set(true);
    setTimeout(() => this.shaking.set(false), 500);
  }
}
