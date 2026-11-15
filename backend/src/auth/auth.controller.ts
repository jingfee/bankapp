import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { MeResponse } from '@bankapp/shared';
import { CLOCK, type Clock } from '../clock';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config';
import { LoginThrottle } from './login-throttle';
import { verifyPassword } from './password-hash';
import { Public } from './public.decorator';
import { clearSessionCookie, readSessionId, setSessionCookie } from './session-cookie';
import { SessionService } from './session.service';

const digest = (value: string) => createHash('sha256').update(value).digest();

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly throttle = new LoginThrottle();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly now: Clock,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(204)
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const retryAfter = this.throttle.retryAfterSeconds(this.now());
    if (retryAfter > 0) {
      this.logger.warn(`Login refused: too many failed attempts (from ${request.ip})`);
      response.setHeader('Retry-After', String(retryAfter));
      throw new HttpException('Too many failed attempts', HttpStatus.TOO_MANY_REQUESTS);
    }

    // Counted as a failure until it proves otherwise; see LoginThrottle.recordFailure.
    const attempt = this.throttle.recordFailure(this.now());
    const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
    const given = typeof username === 'string' ? username : '';
    // Both checks always run, and neither short-circuits, so timing reveals nothing about which
    // of the two was wrong.
    const passwordOk = await verifyPassword(
      typeof password === 'string' ? password : '',
      this.config.passwordHash,
    );
    const usernameOk = timingSafeEqual(digest(given), digest(this.config.username));
    if (!passwordOk || !usernameOk) {
      this.logger.warn(`Failed login attempt (from ${request.ip})`);
      throw new UnauthorizedException('Wrong username or password');
    }

    this.throttle.forgive(attempt);
    setSessionCookie(response, this.sessions.create());
  }

  // Public so that a stale cookie can still be cleared; it only ever revokes the caller's own session.
  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): void {
    const id = readSessionId(request);
    if (id !== undefined) this.sessions.revoke(id);
    clearSessionCookie(response);
  }

  @Get('me')
  me(): MeResponse {
    return { username: this.config.username };
  }
}
