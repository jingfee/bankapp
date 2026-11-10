import { Controller, Get } from '@nestjs/common';
import type { BanksResponse } from '@bankapp/shared';
import { BanksService } from './banks.service';

@Controller('banks')
export class BanksController {
  constructor(private readonly banks: BanksService) {}

  @Get()
  list(): BanksResponse {
    return { banks: this.banks.list() };
  }
}
