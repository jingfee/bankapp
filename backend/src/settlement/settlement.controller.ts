import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import type {
  SetBalanceSettingRequest,
  SettlementBalanceResponse,
  SettlementResponse,
} from '@bankapp/shared';
import { isDay } from '../clock';
import { SettlementService } from './settlement.service';

@Controller('settlement')
export class SettlementController {
  constructor(private readonly settlement: SettlementService) {}

  @Get()
  get(): SettlementResponse {
    return this.settlement.get();
  }

  /** Just the balance, for the start page's card. */
  @Get('balance')
  balance(): SettlementBalanceResponse {
    return { balance: this.settlement.balance() };
  }

  /** States the balance as of a day (today by default); earlier settings stay in the history. */
  @Post('balance-settings')
  setBalance(@Body() body: Partial<SetBalanceSettingRequest> | undefined): SettlementResponse {
    const { amount, asOf } = body ?? {};
    if (typeof amount !== 'number' || !Number.isFinite(amount) || Math.abs(amount) > 1e9) {
      throw new BadRequestException('amount must be a number');
    }
    if (asOf !== undefined && (typeof asOf !== 'string' || !isDay(asOf))) {
      throw new BadRequestException('asOf must be a day as YYYY-MM-DD');
    }
    if (asOf !== undefined && asOf > this.settlement.today()) {
      throw new BadRequestException('asOf cannot be in the future');
    }
    return this.settlement.setBalance(amount, asOf);
  }
}
