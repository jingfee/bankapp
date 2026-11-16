import type { Routes, UrlMatcher } from '@angular/router';
import { authGuard } from './auth/auth.guard';
import { LoggaInPage } from './pages/logga-in/logga-in.page';
import { ConnectBankPage } from './pages/connect-bank/connect-bank.page';
import { ConnectionResultPage } from './pages/connection-result/connection-result.page';
import { AndelarPage } from './pages/andelar/andelar.page';
import { AvrakningPage } from './pages/avrakning/avrakning.page';
import { BankerPage } from './pages/banker/banker.page';
import { ReviewPage } from './pages/review/review.page';
import { TransactionDetailsPage } from './pages/transaction-details/transaction-details.page';
import { OverviewPage } from './pages/overview/overview.page';
import { TransactionsPage } from './pages/transactions/transactions.page';

/**
 * The list, and the list with the add form open over it. One route serves both, so opening or
 * closing the form keeps the list as it is.
 */
export const listMatcher: UrlMatcher = (segments) =>
  segments[0]?.path === 'transaktioner' &&
  (segments.length === 1 || (segments.length === 2 && segments[1]?.path === 'ny'))
    ? { consumed: segments }
    : null;

/** A transaction, and the transaction with the edit form open over it. */
export const detailsMatcher: UrlMatcher = (segments) => {
  const [root, id, action] = segments;
  if (root?.path !== 'transaktioner' || id === undefined) return null;
  if (segments.length === 2 || (segments.length === 3 && action?.path === 'redigera')) {
    return { consumed: segments, posParams: { id } };
  }
  return null;
};

export const routes: Routes = [
  { path: 'logga-in', component: LoggaInPage, title: 'Logga in – Bankapp' },
  {
    path: '',
    canActivateChild: [authGuard],
    children: [
      { path: '', component: OverviewPage, title: 'Bankapp' },
      { matcher: listMatcher, component: TransactionsPage, title: 'Transaktioner – Bankapp' },
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
        matcher: detailsMatcher,
        component: TransactionDetailsPage,
        title: 'Transaktion – Bankapp',
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
