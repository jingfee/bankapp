import { Body, Controller, Param, Put } from '@nestjs/common';
import type { TransactionCategoryResponse } from '@bankapp/shared';
import { InvalidInput, NoSuchTransaction } from '../domain-errors';
import { isWholeNumber, parseId } from '../transactions/ids';
import { Categorising } from './guessing/categorising';

@Controller('transactions')
export class CategorisingController {
  constructor(private readonly categorising: Categorising) {}

  /** Sets the owner's chosen subcategory as confirmed, or removes it with `subcategoryId: null`. */
  @Put(':id/category')
  setCategory(@Param('id') id: string, @Body() body: unknown): TransactionCategoryResponse {
    const transactionId = parseId(id, new NoSuchTransaction());
    const { subcategoryId } = (body ?? {}) as { subcategoryId?: unknown };
    if (subcategoryId !== null && !isWholeNumber(subcategoryId)) {
      throw new InvalidInput('subcategoryId must be a subcategory id or null');
    }
    return this.categorising.set(transactionId, subcategoryId);
  }
}
