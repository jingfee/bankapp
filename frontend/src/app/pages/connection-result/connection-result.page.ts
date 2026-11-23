import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Icon } from '../../icon/icon';
import { Page } from '../../page/page';
import { BanksStore } from '../../stores/banks.store';

/** Where the backend sends the owner after BankID: `?status=ok|redan|fel&bank=<name>`. */
@Component({
  selector: 'app-connection-result-page',
  imports: [RouterLink, Page, Icon],
  template: `
    <app-page width="narrow">
      <section class="card flex flex-col items-center gap-3 p-6 text-center sm:p-8">
        <span
          data-result-icon
          class="grid size-14 place-content-center rounded-full"
          [class]="failed ? 'bg-danger/15 text-danger' : 'bg-positive/15 text-positive'"
        >
          <app-icon [name]="failed ? 'circle-alert' : 'circle-check'" [size]="28" />
        </span>
        <h1 data-page-title class="page-title">{{ heading }}</h1>
        @if (status === 'ok') {
          <p class="text-muted">{{ bank }} är nu ansluten.</p>
        } @else if (status === 'redan') {
          <p class="text-muted">{{ bank }} är redan ansluten. Ingen ny koppling skapades.</p>
        } @else {
          <p role="alert" class="text-muted">
            BankID-inloggningen avbröts eller misslyckades. Ingen koppling skapades.
          </p>
        }
        <a class="btn btn-primary mt-2" [routerLink]="failed ? '/anslut-bank' : '/banker'">{{
          failed ? 'Försök igen' : 'Till Banker'
        }}</a>
      </section>
    </app-page>
  `,
})
export class ConnectionResultPage {
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;
  protected readonly status = this.query.get('status');
  protected readonly failed = this.status !== 'ok' && this.status !== 'redan';
  protected readonly heading =
    this.status === 'ok'
      ? 'Banken är ansluten'
      : this.status === 'redan'
        ? 'Banken är redan ansluten'
        : 'Anslutningen misslyckades';
  protected readonly bank = this.query.get('bank') ?? 'Banken';

  constructor() {
    inject(BanksStore).connectionResult();
  }
}
