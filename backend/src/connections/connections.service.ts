import { randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, lt, notInArray } from 'drizzle-orm';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config';
import { BANK_COUNTRY } from '../banks/banks.service';
import { CLOCK, type Clock } from '../clock';
import { DATABASE } from '../db/database.module';
import type { AppDatabase } from '../db/database';
import { accounts, authorisations, banks, connections } from '../db/schema';
import { InvalidInput, NoSuchConnection } from '../domain-errors';
import { Savings } from '../savings/savings';
import {
  EnableBankingClient,
  type EnableBankingSession,
} from '../enable-banking/enable-banking-client';
import { connectionStatus } from './connection-status';
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
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly enableBanking: EnableBankingClient,
    private readonly sync: SyncService,
    private readonly savings: Savings,
  ) {}

  /** Starts a BankID login for the bank and returns the URL to send the owner to. */
  async start(bankName: string, renewal = false): Promise<{ url: string }> {
    const bank = this.db.select().from(banks).where(eq(banks.name, bankName)).get();
    if (!bank) throw new HttpException('Unknown bank', HttpStatus.NOT_FOUND);

    if (!renewal && !this.canConnect(bank.name)) {
      throw new HttpException('The bank is already connected', HttpStatus.CONFLICT);
    }

    this.db
      .delete(authorisations)
      .where(
        lt(authorisations.createdAt, new Date(this.clock.now().getTime() - AUTHORISATION_TTL_MS)),
      )
      .run();

    const state = randomBytes(24).toString('base64url');
    const now = this.clock.now();
    let url: string;
    try {
      ({ url } = await this.enableBanking.startAuthorisation({
        bank: bank.name,
        country: BANK_COUNTRY,
        validUntil: new Date(now.getTime() + bank.maximumConsentSeconds * 1000 - CONSENT_MARGIN_MS),
        state,
        redirectUrl: this.config.redirectUrl,
      }));
    } catch (cause) {
      this.logger.warn(`Could not start a connection to ${bank.name}: ${String(cause)}`);
      throw new HttpException('Enable Banking refused to start the login', HttpStatus.BAD_GATEWAY);
    }
    this.db
      .insert(authorisations)
      .values({ state, bankName: bank.name, renewal, createdAt: now })
      .run();
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
    const expired =
      authorisation.createdAt.getTime() < this.clock.now().getTime() - AUTHORISATION_TTL_MS;
    // A state is good for one return only, whatever comes of it.
    this.db.delete(authorisations).where(eq(authorisations.state, state)).run();
    if (expired) return { outcome: 'unknown-state' };

    const bank = authorisation.bankName;
    if (error || !code) return { outcome: 'failed', bank };
    const renewal = authorisation.renewal;
    if (!renewal && !this.canConnect(bank)) return { outcome: 'already-connected', bank };
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
        const existing = tx.select().from(connections).where(eq(connections.bankName, bank)).get();
        if (existing) return this.renew(tx, existing.id, session);
        const connection = tx
          .insert(connections)
          .values({ bankName: bank, sessionId: session.sessionId, validUntil: session.validUntil })
          .returning({ id: connections.id })
          .get();
        if (session.accounts.length > 0) {
          const connectedOn = this.clock.today();
          tx.insert(accounts)
            .values(
              session.accounts.map((account) => ({
                ...account,
                connectionId: connection.id,
                connectedOn,
              })),
            )
            .run();
        }
        return connection.id;
      });
    } catch (cause) {
      // A concurrent login for the same bank may have won while we waited for Enable Banking.
      if (!renewal && !this.canConnect(bank)) return { outcome: 'already-connected', bank };
      this.logger.warn(`Could not store the connection to ${bank}: ${String(cause)}`);
      return { outcome: 'failed', bank };
    }
    // The owner does not wait for the first fetch; the overview shows it as in progress.
    void this.sync.start('initial', { connectionId });
    return { outcome: 'connected', bank };
  }

  /**
   * Renews the connection in place. Accounts are matched by `identification_hash`, so their
   * history carries on under the new `uid`; those the bank no longer returns are closed.
   */
  private renew(
    tx: Pick<AppDatabase, 'select' | 'insert' | 'update'>,
    connectionId: number,
    session: EnableBankingSession,
  ): number {
    tx.update(connections)
      // A removed bank that is connected again comes back (Removed bank).
      .set({ sessionId: session.sessionId, validUntil: session.validUntil, removedAt: null })
      .where(eq(connections.id, connectionId))
      .run();
    const known = new Set(
      tx
        .select({ hash: accounts.identificationHash })
        .from(accounts)
        .where(eq(accounts.connectionId, connectionId))
        .all()
        .map((row) => row.hash),
    );
    for (const account of session.accounts) {
      if (known.has(account.identificationHash)) {
        tx.update(accounts)
          .set({
            uid: account.uid,
            name: account.name,
            type: account.type,
            currency: account.currency,
            raw: account.raw,
            closed: false,
          })
          .where(
            and(
              eq(accounts.connectionId, connectionId),
              eq(accounts.identificationHash, account.identificationHash),
            ),
          )
          .run();
      } else {
        tx.insert(accounts)
          .values({ ...account, connectionId, connectedOn: this.clock.today() })
          .run();
      }
    }
    const returned = session.accounts.map((account) => account.identificationHash);
    tx.update(accounts)
      .set({ closed: true })
      .where(
        returned.length === 0
          ? eq(accounts.connectionId, connectionId)
          : and(
              eq(accounts.connectionId, connectionId),
              notInArray(accounts.identificationHash, returned),
            ),
      )
      .run();
    return connectionId;
  }

  /**
   * Removes a bank the owner no longer uses (_Ta bort bank_). It is no longer synced and its
   * accounts become closed accounts, keeping their history and any hidden state. The session is
   * revoked at Enable Banking, but a failure there does not stop the removal: it is logged and
   * the permission expires on its own. Of its savings accounts, those in `continueManually` carry
   * on as manual savings accounts; the others close and count as 0 from today.
   */
  async remove(bankName: string, continueManually: number[] = []): Promise<void> {
    const connection = this.db
      .select()
      .from(connections)
      .where(and(eq(connections.bankName, bankName), isNull(connections.removedAt)))
      .get();
    if (!connection) throw new NoSuchConnection();
    if (continueManually.length > 0) {
      const savingsIds = this.db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.connectionId, connection.id),
            eq(accounts.savings, true),
            inArray(accounts.id, continueManually),
          ),
        )
        .all();
      if (savingsIds.length !== new Set(continueManually).size) {
        throw new InvalidInput('continueManually must be savings accounts of the bank');
      }
    }
    try {
      await this.enableBanking.deleteSession(connection.sessionId);
    } catch (cause) {
      this.logger.error(`Could not revoke the connection to ${bankName}: ${String(cause)}`);
    }
    this.db.transaction((tx) => {
      tx.update(connections)
        .set({ removedAt: this.clock.now() })
        .where(eq(connections.id, connection.id))
        .run();
      tx.update(accounts)
        .set({ closed: true })
        .where(eq(accounts.connectionId, connection.id))
        .run();
      for (const accountId of new Set(continueManually)) this.savings.continueManually(accountId);
    });
  }

  /**
   * A bank can be connected if it has no connection yet, it was removed, or its connection is due
   * for renewal.
   * An owner-requested renewal of an active connection skips this check at its call sites.
   */
  private canConnect(bankName: string): boolean {
    const existing = this.db
      .select({ validUntil: connections.validUntil, removedAt: connections.removedAt })
      .from(connections)
      .where(eq(connections.bankName, bankName))
      .get();
    return (
      !existing ||
      existing.removedAt !== null ||
      connectionStatus(existing.validUntil, this.clock.now()) !== 'active'
    );
  }
}
