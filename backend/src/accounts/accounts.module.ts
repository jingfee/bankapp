import { Module } from '@nestjs/common';
import {
  AccountsController,
  HouseholdRatioController,
  TransactionsController,
} from './accounts.controller';
import { AccountsService } from './accounts.service';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [SyncModule],
  controllers: [AccountsController, HouseholdRatioController, TransactionsController],
  providers: [AccountsService],
})
export class AccountsModule {}
