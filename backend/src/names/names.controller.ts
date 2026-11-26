import { Controller, Get, Inject } from '@nestjs/common';
import type { PartyNames } from '@bankapp/shared';
import type { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/config.module';

/** What the owner and the partner are called, from OWNER_NAME and PARTNER_NAME. */
@Controller('names')
export class NamesController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get()
  get(): PartyNames {
    return { owner: this.config.ownerName, partner: this.config.partnerName };
  }
}
