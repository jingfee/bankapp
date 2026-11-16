import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { InvalidInput } from '../domain-errors';
import { isWholeNumber } from './ids';
import { Replace } from './replace';

@Controller('transactions')
export class ReplaceController {
  constructor(private readonly replaceModule: Replace) {}

  /** The bank transaction replaces the manual transaction it is the purchase of (ADR 0009). */
  @Post('replace')
  @HttpCode(204)
  replace(@Body() body: unknown): void {
    const { manualId, bankId } = parseReplacement(body);
    this.replaceModule.replace(manualId, bankId);
  }

  /** Stores that a manual and a bank transaction are not the same purchase. */
  @Post('not-same')
  @HttpCode(204)
  notSame(@Body() body: unknown): void {
    const { manualId, bankId } = parseReplacement(body);
    this.replaceModule.notSame(manualId, bankId);
  }
}

function parseReplacement(body: unknown): { manualId: number; bankId: number } {
  const { manualId, bankId } = (body ?? {}) as Record<string, unknown>;
  if (!isWholeNumber(manualId) || !isWholeNumber(bankId)) {
    throw new InvalidInput('manualId and bankId must be transaction ids');
  }
  return { manualId, bankId };
}
