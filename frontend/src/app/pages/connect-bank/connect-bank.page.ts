import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type { Bank } from '@bankapp/shared';
import { catchError, map, of } from 'rxjs';
import { BanksService } from '../../banks.service';
import { ConnectionsService } from '../../connections.service';
import { Callout } from '../../callout/callout';
import { Empty } from '../../empty/empty';
import { Icon } from '../../icon/icon';
import { Page } from '../../page/page';
import { Skeleton } from '../../skeleton/skeleton';
import { Redirector } from '../../redirector';

type Loaded = { banks: Bank[] } | { failed: true };

@Component({
  selector: 'app-connect-bank-page',
  imports: [RouterLink, Page, Callout, Empty, Icon, Skeleton],
  template: `
    <app-page width="narrow" title="Anslut bank" subtitle="Välj den bank du vill ansluta.">
      <a page-back routerLink="/banker" class="text-sm text-muted hover:underline">← Banker</a>

      <label class="field">
        <app-icon class="field-icon" name="search" [size]="20" />
        <input
          type="search"
          data-search
          class="field-control"
          placeholder="Sök bank"
          aria-label="Sök bank"
          autocomplete="off"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
        />
        @if (query() !== '') {
          <button
            type="button"
            data-clear-search
            aria-label="Rensa sökning"
            class="field-icon"
            (click)="query.set('')"
          >
            <app-icon name="x" />
          </button>
        }
      </label>

      @if (startError(); as message) {
        <app-callout variant="danger">{{ message }}</app-callout>
      }

      @let result = loaded();
      @if (!result) {
        <div aria-busy="true"><app-skeleton [count]="6" /></div>
      } @else if ('failed' in result) {
        <app-callout variant="danger"
          >Banklistan kunde inte hämtas. Försök igen senare.</app-callout
        >
      } @else if (result.banks.length === 0) {
        <app-empty
          icon="landmark"
          text="Inga banker hittades ännu. Banklistan uppdateras varje natt."
        />
      } @else {
        @let visible = filtered();
        @if (visible.length === 0) {
          <app-empty icon="search" [text]="'Ingen bank matchar &quot;' + query() + '&quot;.'" />
        } @else {
          <ul class="card divide-y divide-line">
            @for (bank of visible; track bank.name) {
              <li class="flex items-center gap-3 px-4 py-3">
                @if (bank.logoUrl) {
                  <img [src]="bank.logoUrl" alt="" class="size-8 rounded object-contain" />
                } @else {
                  <span class="size-8 rounded bg-surface-3" aria-hidden="true"></span>
                }
                <button
                  type="button"
                  class="flex-1 cursor-pointer text-left font-medium hover:underline disabled:opacity-50"
                  [disabled]="starting()"
                  (click)="connect(bank.name)"
                >
                  {{ bank.name }}
                </button>
                @if (bank.beta) {
                  <span
                    class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-100"
                    >Beta</span
                  >
                }
              </li>
            }
          </ul>
        }
      }
    </app-page>
  `,
})
export class ConnectBankPage {
  private readonly connections = inject(ConnectionsService);
  private readonly redirector = inject(Redirector);
  protected readonly query = signal('');
  protected readonly starting = signal(false);
  protected readonly startError = signal<string | undefined>(undefined);
  protected readonly loaded = toSignal<Loaded>(
    inject(BanksService)
      .list()
      .pipe(
        map((banks): Loaded => ({ banks })),
        catchError(() => of<Loaded>({ failed: true })),
      ),
    { initialValue: undefined },
  );
  protected readonly filtered = computed(() => {
    const result = this.loaded();
    if (!result || 'failed' in result) return [];
    const needle = this.query().trim().toLocaleLowerCase('sv-SE');
    return result.banks.filter((bank) => bank.name.toLocaleLowerCase('sv-SE').includes(needle));
  });

  protected connect(bank: string): void {
    this.starting.set(true);
    this.startError.set(undefined);
    this.connections.start(bank).subscribe({
      next: (url) => this.redirector.goTo(url),
      error: (error: unknown) => {
        this.starting.set(false);
        this.startError.set(
          error instanceof HttpErrorResponse && error.status === 409
            ? `${bank} är redan ansluten.`
            : 'Anslutningen kunde inte startas. Försök igen senare.',
        );
      },
    });
  }
}
