import { Module } from '@nestjs/common';
import { ManualSavings } from './manual-savings';
import { ManualSavingsController } from './manual-savings.controller';

@Module({
  controllers: [ManualSavingsController],
  providers: [ManualSavings],
  exports: [ManualSavings],
})
export class ManualSavingsModule {}
