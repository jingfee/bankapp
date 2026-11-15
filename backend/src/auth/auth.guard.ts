import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC } from './public.decorator';
import { readSessionId } from './session-cookie';
import { SessionService } from './session.service';

/** Requires a valid session on every route that is not marked {@link Public}. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const id = readSessionId(context.switchToHttp().getRequest<Request>());
    if (id === undefined || !this.sessions.isValid(id)) throw new UnauthorizedException();
    return true;
  }
}
