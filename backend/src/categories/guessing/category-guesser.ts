import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { CLOCK, type Clock } from '../../clock';
import type { AppDatabase } from '../../db/database';
import { DATABASE } from '../../db/database.module';
import { categories, startupTasks, subcategories, transactions } from '../../db/schema';
import type { DefaultSubcategory } from './default-subcategory';
import { subcategoryForCode } from './merchant-category-codes';
import { MERCHANT_KEYWORDS } from './merchant-keywords';
import { normaliseDescription } from './normalise-description';
import { type ClassifierInput, TextClassifier } from './text-classifier';

/** Marks that the transactions stored before guessing existed have had their one guess. */
const GUESS_EXISTING = 'guess-existing-categories';

/** SQLite limits the number of variables in one statement. */
const BATCH_SIZE = 500;

type Database = Pick<AppDatabase, 'select' | 'update'>;

/** Case, accents and word separators do not matter to keywords (`HEMKOP`, `COOP_MASTERCARD`). */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ');

/** Longest first, so `coop mastercard` wins over `coop`. Digits may follow (`LIDL350…`). */
const KEYWORDS = [...MERCHANT_KEYWORDS]
  .sort(([a], [b]) => b.length - a.length)
  .map(([keyword, subcategory]) => ({
    pattern: new RegExp(
      `(?<![\\p{L}\\p{N}])${fold(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\p{L})`,
      'u',
    ),
    subcategory,
  }));

/**
 * Assigns guessed categories, locally and without any network call (ADR 0004). Three layers are
 * tried in order: the subcategory most recently confirmed for the same normalised description;
 * the built-in Swedish merchant keywords; the card's merchant category code from the raw bank
 * response; last a naive Bayes classifier trained only on the owner's confirmed categories
 * (`text-classifier.ts`). When none gives a match the transaction stays uncategorised. A transaction that
 * already has a category, or whose category the owner decided (also to have none), is never
 * touched.
 */
@Injectable()
export class CategoryGuesser implements OnApplicationBootstrap {
  private readonly logger = new Logger(CategoryGuesser.name);

  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(CLOCK) private readonly now: Clock,
  ) {}

  /** Guesses once for the transactions stored before guessing existed. */
  onApplicationBootstrap(): void {
    this.db.transaction((tx) => {
      if (tx.select().from(startupTasks).where(eq(startupTasks.name, GUESS_EXISTING)).get()) {
        return;
      }
      const ids = tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(isNull(transactions.subcategoryId), eq(transactions.categoryConfirmed, false)))
        .all()
        .map((row) => row.id);
      const guessed = this.guess(tx, ids);
      tx.insert(startupTasks).values({ name: GUESS_EXISTING, completedAt: this.now() }).run();
      this.logger.log(`Guessed categories for ${guessed} of ${ids.length} stored transactions`);
    });
  }

  /**
   * Guesses a category for each of these transactions that has none. Returns how many got one.
   * Runs on the given database handle, so a sync can guess inside its own transaction.
   */
  guess(db: Database, ids: readonly number[]): number {
    if (ids.length === 0) return 0;
    const subcategoryIds = this.subcategoryIds(db);
    const history = this.history(db);
    // Trained from the confirmed categories as they are now, and only if a transaction needs it.
    let classifier: TextClassifier<number> | undefined;
    const classify = (row: ClassifierInput) => (classifier ??= this.classifier(db)).predict(row);
    let guessed = 0;
    for (let start = 0; start < ids.length; start += BATCH_SIZE) {
      const rows = db
        .select({
          id: transactions.id,
          description: transactions.description,
          accountId: transactions.accountId,
          amount: transactions.amount,
          raw: transactions.raw,
        })
        .from(transactions)
        .where(
          and(
            inArray(transactions.id, ids.slice(start, start + BATCH_SIZE)),
            isNull(transactions.subcategoryId),
            eq(transactions.categoryConfirmed, false),
          ),
        )
        .all();
      for (const row of rows) {
        const subcategoryId =
          history.get(normaliseDescription(row.description)) ??
          lookUp(subcategoryIds, fromKeywords(row.description)) ??
          lookUp(subcategoryIds, fromCode(row.raw)) ??
          classify(row);
        if (subcategoryId === undefined) continue;
        db.update(transactions)
          .set({ subcategoryId, categoryConfirmed: false })
          .where(eq(transactions.id, row.id))
          .run();
        guessed += 1;
      }
    }
    return guessed;
  }

  /** The most recently confirmed subcategory for each normalised description. */
  private history(db: Database): Map<string, number> {
    const rows = db
      .select({ description: transactions.description, subcategoryId: transactions.subcategoryId })
      .from(transactions)
      .where(eq(transactions.categoryConfirmed, true))
      .orderBy(
        sql`${transactions.categoryConfirmedAt} IS NULL`,
        desc(transactions.categoryConfirmedAt),
        desc(transactions.id),
      )
      .all();
    const history = new Map<string, number>();
    for (const { description, subcategoryId } of rows) {
      const key = normaliseDescription(description);
      if (subcategoryId !== null && !history.has(key)) history.set(key, subcategoryId);
    }
    return history;
  }

  /** A classifier trained on every confirmed category, so it follows each new confirmation. */
  private classifier(db: Database): TextClassifier<number> {
    const classifier = new TextClassifier<number>();
    const rows = db
      .select({
        description: transactions.description,
        accountId: transactions.accountId,
        amount: transactions.amount,
        subcategoryId: transactions.subcategoryId,
      })
      .from(transactions)
      .where(and(eq(transactions.categoryConfirmed, true), isNotNull(transactions.subcategoryId)))
      .all();
    for (const { subcategoryId, ...input } of rows) classifier.train(input, subcategoryId!);
    return classifier;
  }

  /** Subcategory ids by category and subcategory name, as the owner currently has them. */
  private subcategoryIds(db: Database): Map<string, number> {
    const rows = db
      .select({ id: subcategories.id, name: subcategories.name, category: categories.name })
      .from(subcategories)
      .innerJoin(categories, eq(subcategories.categoryId, categories.id))
      .all();
    return new Map(rows.map((row) => [key([row.category, row.name]), row.id]));
  }
}

const key = ([category, subcategory]: DefaultSubcategory) => `${category}\u0000${subcategory}`;

function lookUp(ids: Map<string, number>, target: DefaultSubcategory | undefined) {
  return target === undefined ? undefined : ids.get(key(target));
}

function fromKeywords(description: string): DefaultSubcategory | undefined {
  const folded = fold(description);
  return KEYWORDS.find(({ pattern }) => pattern.test(folded))?.subcategory ?? undefined;
}

/** Swish, autogiro and transfers carry no code, and a raw response may not even be JSON. */
function fromCode(rawJson: string): DefaultSubcategory | undefined {
  try {
    const raw: unknown = JSON.parse(rawJson);
    const code =
      typeof raw === 'object' && raw !== null
        ? (raw as Record<string, unknown>)['merchant_category_code']
        : undefined;
    return typeof code === 'string' ? subcategoryForCode(code.trim()) : undefined;
  } catch {
    return undefined;
  }
}
