import { Module } from '@nestjs/common';
import { Mortgage } from './mortgage';
import { MortgageController } from './mortgage.controller';
import { MortgageReport } from './report';

@Module({
  controllers: [MortgageController],
  providers: [Mortgage, MortgageReport],
  exports: [Mortgage],
})
export class MortgageModule {}
