import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { StartSyncResponse } from '@bankapp/shared';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /** The owner's "Uppdatera": starts a manual sync and answers at once; progress shows on the overview. */
  @Post()
  @HttpCode(202)
  start(@Req() request: Request): StartSyncResponse {
    const ipAddress = request.ip;
    const userAgent = request.get('user-agent');
    // Banks may reject a header with nothing in it, so a request without details sends none.
    const psu = ipAddress && userAgent ? { ipAddress, userAgent } : undefined;
    const { started } = this.sync.start('manual', psu ? { psu } : {});
    return { started };
  }
}
