import { randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { eq, lt } from 'drizzle-orm';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config';
import { BANK_COUNTRY } from '../banks/banks.service';
import { CLOCK, type Clock } from '../clock';
import { DATABASE } from '../db/database.module';
import type { AppDatabase } from '../db/database';
import { accounts, authorisations, banks, connections } from '../db/schema';
import {
  EnableBankingClient,
  type EnableBankingSession,
} from '../enable-banking/enable-banking-client';
import { SyncService } from '../sync/sync.service';

/** A login must be completed within this long of being started. */
export const AUTHORISATION_TTL_MS = 15 * 60 * 1000;
/** Requested consent stops this short of the bank's maximum, so latency cannot push it over. */
const CONSENT_MARGIN_MS = 60 * 1000;

@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly now: Clock,
    private readonly enableBanking: EnableBankingClient,
    private readonly sync: SyncService,
  ) {}

  /** Starts a BankID login for the bank and returns the URL to send the owner to. */
  async start(bankName: string): Promise<{ url: string }> {
    const bank = this.db.select().from(banks).where(eq(banks.name, bankName)).get();
    if (!bank) throw new HttpException('Unknown bank', HttpStatus.NOT_FOUND);

    if (this.hasConnection(bank.name)) {
      throw new HttpException('The bank is already connected', HttpStatus.CONFLICT);
    }

    this.db
      .delete(authorisations)
      .where(lt(authorisations.createdAt, new Date(this.now().getTime() - AUTHORISATION_TTL_MS)))
      .run();

    const state = randomBytes(24).toString('base64url');
    const now = this.now();
    let url: string;
    try {
      ({ url } = await this.enableBanking.startAuthorisation({
        bank: bank.name,
        country: BANK_COUNTRY,
        validUntil: new Date(now.getTime() + bank.maximumConsentSeconds * 1000 - CONSENT_MARGIN_MS),
        state,
        redirectUrl: this.config.redirectUrl,
        ...(bank.personnummer !== 'none' && this.config.personnummer
          ? { personnummer: this.config.personnummer }
          : {}),
      }));
    } catch (cause) {
      this.logger.warn(`Could not start a connection to ${bank.name}: ${String(cause)}`);
      throw new HttpException('Enable Banking refused to start the login', HttpStatus.BAD_GATEWAY);
    }
    this.db.insert(authorisations).values({ state, bankName: bank.name, createdAt: now }).run();
    return { url };
  }

  /**
   * Completes a BankID login. `unknown-state` means the request did not come from a login we
   * started (or it was already used); `failed` means the owner cancelled or the bank refused.
   */
  async complete(input: {
    state: string | undefined;
    code: string | undefined;
    error: string | undefined;
  }): Promise<
    | { outcome: 'unknown-state' }
    | { outcome: 'connected' | 'already-connected' | 'failed'; bank: string }
  > {
    const { state, code, error } = input;
    const authorisation = state
      ? this.db.select().from(authorisations).where(eq(authorisations.state, state)).get()
      : undefined;
    if (!state || !authorisation) return { outcome: 'unknown-state' };
    const expired = authorisation.createdAt.getTime() < this.now().getTime() - AUTHORISATION_TTL_MS;
    // A state is good for one return only, whatever comes of it.
    this.db.delete(authorisations).where(eq(authorisations.state, state)).run();
    if (expired) return { outcome: 'unknown-state' };

    const bank = authorisation.bankName;
    if (error || !code) return { outcome: 'failed', bank };
    if (this.hasConnection(bank)) return { outcome: 'already-connected', bank };
    let session: EnableBankingSession;
    try {
      session = await this.enableBanking.createSession(code);
    } catch (cause) {
      this.logger.warn(`Could not complete the connection to ${bank}: ${String(cause)}`);
      return { outcome: 'failed', bank };
    }
    let connectionId: number;
    try {
      connectionId = this.db.transaction((tx) => {
        const connection = tx
          .insert(connections)
          .values({ bankName: bank, sessionId: session.sessionId, validUntil: session.validUntil })
          .returning({ id: connections.id })
          .get();
        if (session.accounts.length > 0) {
          tx.insert(accounts)
            .values(
              session.accounts.map((account) => ({ ...account, connectionId: connection.id })),
            )
            .run();
        }
        return connection.id;
      });
    } catch (cause) {
      // A concurrent login for the same bank may have won while we waited for Enable Banking.
      if (this.hasConnection(bank)) return { outcome: 'already-connected', bank };
      this.logger.warn(`Could not store the connection to ${bank}: ${String(cause)}`);
      return { outcome: 'failed', bank };
    }
    // The owner does not wait for the first fetch; the overview shows it as in progress.
    void this.sync.start('initial', { connectionId });
    return { outcome: 'connected', bank };
  }

  private hasConnection(bankName: string): boolean {
    return (
      this.db.select().from(connections).where(eq(connections.bankName, bankName)).get() !==
      undefined
    );
  }
}
