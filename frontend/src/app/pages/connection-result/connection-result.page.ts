import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Page } from '../../page/page';

/** Where the backend sends the owner after BankID: `?status=ok|redan|fel&bank=<name>`. */
@Component({
  selector: 'app-connection-result-page',
  imports: [RouterLink, Page],
  template: `
    <app-page width="narrow" [title]="heading">
      @if (status === 'ok') {
        <p>{{ bank }} är nu ansluten.</p>
        <a routerLink="/banker" class="font-medium underline">Till översikten</a>
      } @else if (status === 'redan') {
        <p>{{ bank }} är redan ansluten. Ingen ny koppling skapades.</p>
        <a routerLink="/banker" class="font-medium underline">Till översikten</a>
      } @else {
        <p role="alert">BankID-inloggningen avbröts eller misslyckades. Ingen koppling skapades.</p>
        <a routerLink="/anslut-bank" class="font-medium underline">Försök igen</a>
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
