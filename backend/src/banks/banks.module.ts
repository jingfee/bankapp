import { Module } from '@nestjs/common';
import { BankRefreshScheduler } from './bank-refresh.scheduler';
import { BanksController } from './banks.controller';
import { BanksService } from './banks.service';

@Module({
  controllers: [BanksController],
  providers: [BanksService, BankRefreshScheduler],
})
export class BanksModule {}
