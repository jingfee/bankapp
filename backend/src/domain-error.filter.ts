import {
  BadRequestException,
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  ConflictException,
  type HttpException,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from './domain-errors';

/** Maps a domain error to the HTTP error that has the same status and body as Nest's own. */
@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter<DomainError> {
  catch(error: DomainError, host: ArgumentsHost): void {
    const exception: HttpException = {
      'bad-request': () => new BadRequestException(error.message),
      'not-found': () => new NotFoundException(error.message),
      conflict: () => new ConflictException(error.message),
    }[error.kind]();
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(exception.getStatus())
      .json(exception.getResponse());
  }
}
