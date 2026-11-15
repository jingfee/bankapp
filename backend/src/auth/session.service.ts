import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { eq, lte } from 'drizzle-orm';
import { CLOCK, type Clock } from '../clock';
import type { AppDatabase } from '../db/database';
import { DATABASE } from '../db/database.module';
import { sessions } from '../db/schema';

/**
 * How long a session lasts. Browsers cap a cookie's lifetime at 400 days (Chrome, and the
 * standard's recommendation), so this is the longest a login can really last.
 */
export const SESSION_DAYS = 400;
export const SESSION_MS = SESSION_DAYS * 24 * 3600 * 1000;

const hashId = (id: string) => createHash('sha256').update(id).digest('hex');

@Injectable()
export class SessionService {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(CLOCK) private readonly now: Clock,
  ) {}

  /** Starts a session and returns its id, which only the caller's cookie will ever hold. */
  create(): string {
    const now = this.now();
    this.db.delete(sessions).where(lte(sessions.expiresAt, now)).run();
    const id = randomBytes(32).toString('base64url');
    this.db
      .insert(sessions)
      .values({
        idHash: hashId(id),
        createdAt: now,
        expiresAt: new Date(now.getTime() + SESSION_MS),
      })
      .run();
    return id;
  }

  isValid(id: string): boolean {
    const row = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.idHash, hashId(id)))
      .get();
    return row !== undefined && row.expiresAt.getTime() > this.now().getTime();
  }

  revoke(id: string): void {
    this.db
      .delete(sessions)
      .where(eq(sessions.idHash, hashId(id)))
      .run();
  }
}
