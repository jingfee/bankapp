import type { Routes } from '@angular/router';
import { ConnectBankPage } from './pages/connect-bank/connect-bank.page';
import { ConnectionResultPage } from './pages/connection-result/connection-result.page';
<<<<<<< Updated upstream
import { HomePage } from './pages/home/home.page';
import { TransactionsPage } from './pages/transactions/transactions.page';

export const routes: Routes = [
  { path: '', component: HomePage, title: 'Bankapp' },
=======
import { BankerPage } from './pages/banker/banker.page';
import { ReviewPage } from './pages/review/review.page';
import { TransactionDetailsPage } from './pages/transaction-details/transaction-details.page';
import { TransactionsPage } from './pages/transactions/transactions.page';

export const routes: Routes = [
  { path: '', component: TransactionsPage, title: 'Bankapp' },
  { path: 'banker', component: BankerPage, title: 'Banker – Bankapp' },
  { path: 'granska', component: ReviewPage, title: 'Att granska – Bankapp' },
>>>>>>> Stashed changes
  { path: 'anslut-bank', component: ConnectBankPage, title: 'Anslut bank – Bankapp' },
  {
    path: 'anslut-bank/resultat',
    component: ConnectionResultPage,
    title: 'Anslutning – Bankapp',
  },
  { path: 'transaktioner', component: TransactionsPage, title: 'Transaktioner – Bankapp' },
  { path: '**', redirectTo: '' },
];
