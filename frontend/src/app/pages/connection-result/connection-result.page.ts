import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Callout } from '../../callout/callout';
import { Page } from '../../page/page';

/** Where the backend sends the owner after BankID: `?status=ok|redan|fel&bank=<name>`. */
@Component({
  selector: 'app-connection-result-page',
  imports: [RouterLink, Page, Callout],
  template: `
    <app-page width="narrow" [title]="heading">
      @if (status === 'ok') {
        <p>{{ bank }} är nu ansluten.</p>
        <a routerLink="/banker" class="font-medium text-accent">Till Banker →</a>
      } @else if (status === 'redan') {
        <p>{{ bank }} är redan ansluten. Ingen ny koppling skapades.</p>
        <a routerLink="/banker" class="font-medium text-accent">Till Banker →</a>
      } @else {
        <app-callout variant="danger"
          >BankID-inloggningen avbröts eller misslyckades. Ingen koppling skapades.</app-callout
        >
        <a routerLink="/anslut-bank" class="font-medium text-accent">Försök igen →</a>
      }
    </app-page>
  `,
})
export class ConnectionResultPage {
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;
  protected readonly status = this.query.get('status');
  protected readonly heading =
    this.status === 'ok'
      ? 'Banken är ansluten'
      : this.status === 'redan'
        ? 'Banken är redan ansluten'
        : 'Anslutningen misslyckades';
  protected readonly bank = this.query.get('bank') ?? 'Banken';
}
