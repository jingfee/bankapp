import { Module } from '@nestjs/common';
import { ManualSavingsModule } from '../manual-savings/manual-savings.module';
import { Savings } from './savings';
import { SavingsController } from './savings.controller';

@Module({
  imports: [ManualSavingsModule],
  controllers: [SavingsController],
  providers: [Savings],
  exports: [Savings],
})
export class SavingsModule {}
