import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

/** Where the backend sends the owner after BankID: `?status=ok|redan|fel&bank=<name>`. */
@Component({
  selector: 'app-connection-result-page',
  imports: [RouterLink],
  template: `
    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      @if (status === 'ok') {
        <h1 class="text-3xl font-semibold tracking-tight">Banken är ansluten</h1>
        <p>{{ bank }} är nu ansluten.</p>
        <a routerLink="/banker" class="font-medium underline">Till översikten</a>
      } @else if (status === 'redan') {
        <h1 class="text-3xl font-semibold tracking-tight">Banken är redan ansluten</h1>
        <p>{{ bank }} är redan ansluten. Ingen ny koppling skapades.</p>
        <a routerLink="/banker" class="font-medium underline">Till översikten</a>
      } @else {
        <h1 class="text-3xl font-semibold tracking-tight">Anslutningen misslyckades</h1>
        <p role="alert">BankID-inloggningen avbröts eller misslyckades. Ingen koppling skapades.</p>
        <a routerLink="/anslut-bank" class="font-medium underline">Försök igen</a>
      }
    </main>
  `,
})
export class ConnectionResultPage {
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;
  protected readonly status = this.query.get('status');
  protected readonly bank = this.query.get('bank') ?? 'Banken';
}
