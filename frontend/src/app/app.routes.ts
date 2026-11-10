import type { Routes } from '@angular/router';
import { ConnectBankPage } from './pages/connect-bank/connect-bank.page';
import { ConnectionResultPage } from './pages/connection-result/connection-result.page';
import { HomePage } from './pages/home/home.page';

export const routes: Routes = [
  { path: '', component: HomePage, title: 'Bankapp' },
  { path: 'anslut-bank', component: ConnectBankPage, title: 'Anslut bank – Bankapp' },
  {
    path: 'anslut-bank/resultat',
    component: ConnectionResultPage,
    title: 'Anslutning – Bankapp',
  },
  { path: '**', redirectTo: '' },
];
