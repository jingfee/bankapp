import { Module } from '@nestjs/common';
import { AccountsController, TransactionsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [SyncModule],
  controllers: [AccountsController, TransactionsController],
  providers: [AccountsService],
})
export class AccountsModule {}
