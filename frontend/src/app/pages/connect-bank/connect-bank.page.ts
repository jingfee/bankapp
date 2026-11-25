import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AccountsStore } from '../../stores/accounts.store';
import { BanksStore } from '../../stores/banks.store';
import { Callout } from '../../callout/callout';
import { Empty } from '../../empty/empty';
import { Icon } from '../../icon/icon';
import { Page } from '../../page/page';
import { Skeleton } from '../../skeleton/skeleton';
import { Redirector } from '../../redirector';

@Component({
  selector: 'app-connect-bank-page',
  imports: [RouterLink, Page, Callout, Empty, Icon, Skeleton],
  template: `
    <app-page
      width="narrow"
      title="Anslut bank"
      [fetchedAt]="[banksStore.availableFetchedAt()]"
      subtitle="Välj banken. Du loggar in med BankID hos banken och kommer sedan tillbaka hit."
    >
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

      @let banks = available();
      @if (banksStore.availableFailed()) {
        <app-callout variant="danger"
          >Banklistan kunde inte hämtas. Försök igen senare.</app-callout
        >
      } @else if (!banks) {
        <div aria-busy="true"><app-skeleton [count]="6" /></div>
      } @else if (banks.length === 0) {
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
              <li>
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 disabled:opacity-50"
                  [disabled]="starting()"
                  (click)="connect(bank.name)"
                >
                  @if (bank.logoUrl) {
                    <img [src]="bank.logoUrl" alt="" class="size-9 rounded-[10px] object-contain" />
                  } @else {
                    <span
                      data-monogram
                      class="grid size-9 shrink-0 place-content-center rounded-[10px] bg-surface-3 text-sm font-bold"
                      aria-hidden="true"
                      >{{ bank.name.charAt(0).toLocaleUpperCase('sv-SE') }}</span
                    >
                  }
                  <span data-bank-name class="min-w-0 flex-1 truncate font-medium">{{
                    bank.name
                  }}</span>
                  @if (bank.beta) {
                    <span class="pill pill-guess">Beta</span>
                  }
                  @if (connected().has(bank.name)) {
                    <span data-connected class="pill pill-neutral">Ansluten</span>
                  }
                  <app-icon class="text-muted" name="chevron-right" [size]="18" />
                </button>
              </li>
            }
          </ul>
        }
      }
    </app-page>
  `,
})
export class ConnectBankPage {
  protected readonly banksStore = inject(BanksStore);
  private readonly accountsStore = inject(AccountsStore);
  private readonly redirector = inject(Redirector);
  protected readonly query = signal('');
  protected readonly starting = signal(false);
  protected readonly startError = signal<string | undefined>(undefined);
  protected readonly available = this.banksStore.available;
  /**
   * Banks with an active connection. The accounts are followed from login (`BanksStore.loadOnce`),
   * so until they are there nothing is marked.
   */
  protected readonly connected = computed(
    () => new Set(this.accountsStore.accounts()?.banks.map((group) => group.bank)),
  );
  protected readonly filtered = computed(() => {
    const needle = this.query().trim().toLocaleLowerCase('sv-SE');
    return (this.available() ?? []).filter((bank) =>
      bank.name.toLocaleLowerCase('sv-SE').includes(needle),
    );
  });

  constructor() {
    this.banksStore.activateAvailable();
    inject(DestroyRef).onDestroy(() => this.banksStore.deactivateAvailable());
  }

  protected connect(bank: string): void {
    this.starting.set(true);
    this.startError.set(undefined);
    this.banksStore.startConnection(bank).subscribe({
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
