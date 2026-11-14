import { Module } from '@nestjs/common';
import {
  AccountsController,
  HouseholdRatioController,
  SubcategorySharesController,
  TransactionsController,
} from './accounts.controller';
import { AccountsService } from './accounts.service';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [SyncModule],
  controllers: [
    AccountsController,
    HouseholdRatioController,
    SubcategorySharesController,
    TransactionsController,
  ],
  providers: [AccountsService],
})
export class AccountsModule {}
