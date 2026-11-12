import type { Routes } from '@angular/router';
import { ConnectBankPage } from './pages/connect-bank/connect-bank.page';
import { ConnectionResultPage } from './pages/connection-result/connection-result.page';
import { BankerPage } from './pages/banker/banker.page';
import { ReviewPage } from './pages/review/review.page';
import { TransactionDetailsPage } from './pages/transaction-details/transaction-details.page';
import { OverviewPage } from './pages/overview/overview.page';
import { TransactionsPage } from './pages/transactions/transactions.page';

export const routes: Routes = [
  { path: '', component: OverviewPage, title: 'Bankapp' },
  { path: 'transaktioner', component: TransactionsPage, title: 'Transaktioner – Bankapp' },
  { path: 'banker', component: BankerPage, title: 'Banker – Bankapp' },
  { path: 'granska', component: ReviewPage, title: 'Att granska – Bankapp' },
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
  { path: '**', redirectTo: '' },
];
