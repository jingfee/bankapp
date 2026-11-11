import type { Routes } from '@angular/router';
import { ConnectBankPage } from './pages/connect-bank/connect-bank.page';
import { ConnectionResultPage } from './pages/connection-result/connection-result.page';
import { BankerPage } from './pages/banker/banker.page';
import { TransactionDetailsPage } from './pages/transaction-details/transaction-details.page';
import { TransactionsPage } from './pages/transactions/transactions.page';

export const routes: Routes = [
  { path: '', component: TransactionsPage, title: 'Bankapp' },
  { path: 'banker', component: BankerPage, title: 'Banker – Bankapp' },
  { path: 'anslut-bank', component: ConnectBankPage, title: 'Anslut bank – Bankapp' },
  {
    path: 'anslut-bank/resultat',
    component: ConnectionResultPage,
    title: 'Anslutning – Bankapp',
  },
  {
    path: 'transaktioner/:id',
    component: TransactionDetailsPage,
    title: 'Transaktion – Bankapp',
  },
  { path: 'transaktioner', redirectTo: '', pathMatch: 'full' },
  { path: '**', redirectTo: '' },
];
