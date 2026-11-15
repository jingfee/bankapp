import type { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';
import { LoggaInPage } from './pages/logga-in/logga-in.page';
import { ConnectBankPage } from './pages/connect-bank/connect-bank.page';
import { ConnectionResultPage } from './pages/connection-result/connection-result.page';
import { AndelarPage } from './pages/andelar/andelar.page';
import { AvrakningPage } from './pages/avrakning/avrakning.page';
import { BankerPage } from './pages/banker/banker.page';
import { ReviewPage } from './pages/review/review.page';
import { TransactionDetailsPage } from './pages/transaction-details/transaction-details.page';
import { ManualTransactionPage } from './pages/manual-transaction/manual-transaction.page';
import { OverviewPage } from './pages/overview/overview.page';
import { TransactionsPage } from './pages/transactions/transactions.page';

export const routes: Routes = [
  { path: 'logga-in', component: LoggaInPage, title: 'Logga in – Bankapp' },
  {
    path: '',
    canActivateChild: [authGuard],
    children: [
      { path: '', component: OverviewPage, title: 'Bankapp' },
      { path: 'transaktioner', component: TransactionsPage, title: 'Transaktioner – Bankapp' },
      {
        path: 'transaktioner/ny',
        component: ManualTransactionPage,
        title: 'Ny transaktion – Bankapp',
      },
      {
        path: 'transaktioner/:id/redigera',
        component: ManualTransactionPage,
        title: 'Redigera transaktion – Bankapp',
      },
      { path: 'banker', component: BankerPage, title: 'Banker – Bankapp' },
      { path: 'andelar', component: AndelarPage, title: 'Andelar – Bankapp' },
      { path: 'avrakning', component: AvrakningPage, title: 'Avräkning – Bankapp' },
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
    ],
  },
  { path: '**', redirectTo: '' },
];
