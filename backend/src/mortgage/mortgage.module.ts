import { Module } from '@nestjs/common';
import { Mortgage } from './mortgage';
import { MortgageController } from './mortgage.controller';

@Module({
  controllers: [MortgageController],
  providers: [Mortgage],
  exports: [Mortgage],
})
export class MortgageModule {}
