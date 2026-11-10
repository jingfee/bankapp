import type { Routes } from '@angular/router';
import { ConnectBankPage } from './pages/connect-bank/connect-bank.page';
import { HomePage } from './pages/home/home.page';

export const routes: Routes = [
  { path: '', component: HomePage, title: 'Bankapp' },
  { path: 'anslut-bank', component: ConnectBankPage, title: 'Anslut bank – Bankapp' },
  { path: '**', redirectTo: '' },
];
