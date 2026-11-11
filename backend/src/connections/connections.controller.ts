import { BadRequestException, Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { StartConnectionResponse } from '@bankapp/shared';
import { ConnectionsService } from './connections.service';

@Controller('connections')
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Post()
  start(@Body() body: unknown): Promise<StartConnectionResponse> {
    const { bank, renew } = (body ?? {}) as { bank?: unknown; renew?: unknown };
    if (typeof bank !== 'string' || bank === '') throw new BadRequestException('bank is required');
    return this.connections.start(bank, renew === true);
  }

  /** Where Enable Banking sends the owner back after BankID. */
  @Get('callback')
  async callback(
    @Query('state') state: string | undefined,
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
    const result = await this.connections.complete({
      state: text(state),
      code: text(code),
      error: text(error),
    });
    if (result.outcome === 'unknown-state') {
      res.status(400).type('html').send(UNKNOWN_STATE_PAGE);
    } else if (result.outcome === 'failed') {
      res.redirect(`${RESULT_PAGE}?status=fel`);
    } else {
      const status = result.outcome === 'connected' ? 'ok' : 'redan';
      res.redirect(`${RESULT_PAGE}?status=${status}&bank=${encodeURIComponent(result.bank)}`);
    }
  }
}

const RESULT_PAGE = '/anslut-bank/resultat';

const UNKNOWN_STATE_PAGE = `<!doctype html>
<html lang="sv">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Anslutningen kunde inte slutföras – Bankapp</title>
  </head>
  <body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem">
    <h1>Anslutningen kunde inte slutföras</h1>
    <p>Länken är ogiltig eller har redan använts. Ingen koppling har skapats.</p>
    <p><a href="/anslut-bank">Försök ansluta banken igen</a></p>
  </body>
</html>
`;
