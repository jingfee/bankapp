import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@bankapp/shared';
import { Public } from '../auth/public.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): HealthResponse {
    return { status: 'ok' };
  }
}
