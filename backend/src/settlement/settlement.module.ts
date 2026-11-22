import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';

@Module({
  imports: [ReportsModule],
  controllers: [SettlementController],
  providers: [SettlementService],
})
export class SettlementModule {}
