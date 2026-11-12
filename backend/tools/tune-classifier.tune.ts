/**
 * Measures how good the classifier (layer 4 of guessing) is on the owner's own confirmed
 * categories, to pick `CONFIDENCE_THRESHOLD`, `MIN_TRAINING_EXAMPLES` and `SMOOTHING` in
 * `src/categories/guessing/text-classifier.ts`.
 *
 *   TUNE_DB=/path/to/bankapp.db pnpm --filter @bankapp/backend tune:classifier
 *
 * Read-only on the database. Prints only counts and percentages, never descriptions or amounts,
 * because the database holds real financial data (ADR 0003). Do not paste the database here.
 *
 * Method: 10-fold cross-validation. The confirmed transactions are split into 10 folds; each fold
 * is scored by a classifier trained on the other 9. Only transactions that layers 1-3 would NOT
 * have answered are scored (no other confirmed transaction with the same normalised description,
 * no keyword, no usable merchant category code), since those are the only ones the classifier
 * ever sees. Training uses every confirmed transaction.
 */
import Database from 'better-sqlite3';
import { describe, it } from 'vitest';
import { fromCode, fromKeywords } from '../src/categories/guessing/category-guesser';
import { normaliseDescription } from '../src/categories/guessing/normalise-description';
import {
  type ClassifierOptions,
  type ClassifierInput,
  TextClassifier,
} from '../src/categories/guessing/text-classifier';

interface Confirmed extends ClassifierInput {
  id: number;
  subcategoryId: number;
  /** Layers 1-3 would give no guess, so the classifier would be asked. */
  reachesClassifier: boolean;
}

const FOLDS = 10;
const SMOOTHINGS = [0.1, 0.25, 0.5, 1];
const THRESHOLDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.98];
const TRAINING_SIZES = [5, 10, 20, 30, 50, 100, 200, 400];

const pct = (part: number, whole: number) =>
  whole === 0 ? '   n/a' : `${((100 * part) / whole).toFixed(1).padStart(5)}%`;

function load(path: string): Confirmed[] {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  const rows = db
    .prepare(
      `SELECT id, description, account_id AS accountId, amount, subcategory_id AS subcategoryId, raw
       FROM transactions
       WHERE category_confirmed = 1 AND subcategory_id IS NOT NULL
       ORDER BY COALESCE(category_confirmed_at, 0), id`,
    )
    .all() as (Omit<Confirmed, 'reachesClassifier'> & { raw: string })[];
  db.close();

  const perDescription = new Map<string, number>();
  for (const row of rows) {
    const key = normaliseDescription(row.description);
    perDescription.set(key, (perDescription.get(key) ?? 0) + 1);
  }
  return rows.map(({ raw, ...row }) => ({
    ...row,
    reachesClassifier:
      perDescription.get(normaliseDescription(row.description)) === 1 &&
      fromKeywords(row.description) === undefined &&
      fromCode(raw) === undefined,
  }));
}

function train(rows: Confirmed[], options: ClassifierOptions): TextClassifier<number> {
  const classifier = new TextClassifier<number>(options);
  for (const row of rows) classifier.train(row, row.subcategoryId);
  return classifier;
}

/** Scores every row that reaches the classifier with a model trained on the other folds. */
function crossValidate(rows: Confirmed[], smoothing: number) {
  const scored: { confidence: number; correct: boolean }[] = [];
  let silent = 0;
  for (let fold = 0; fold < FOLDS; fold++) {
    const model = train(
      rows.filter((_, index) => index % FOLDS !== fold),
      { smoothing },
    );
    const held = rows.filter((row, index) => index % FOLDS === fold && row.reachesClassifier);
    for (const row of held) {
      const best = model.score(row);
      if (best)
        scored.push({ confidence: best.confidence, correct: best.label === row.subcategoryId });
      else silent += 1;
    }
  }
  return { scored, silent };
}

describe('tuning the classifier', () => {
  const path = process.env['TUNE_DB'];

  it.skipIf(!path)('prints precision and coverage for the settings', () => {
    const rows = load(path!);
    const eligible = rows.filter((row) => row.reachesClassifier);
    const out: string[] = [''];
    out.push(`Confirmed transactions with a subcategory: ${rows.length}`);
    out.push(`  distinct subcategories: ${new Set(rows.map((r) => r.subcategoryId)).size}`);
    out.push(
      `  reaching the classifier (no history, keyword or merchant code): ${eligible.length}`,
    );
    if (eligible.length < 50) {
      out.push('Too few to say much: confirm more transactions and run this again.');
    }

    out.push('', '== 1. Threshold and smoothing (10-fold cross-validation) ==');
    out.push(
      'precision = right guesses / guesses made; coverage = guesses made / reaching classifier',
    );
    for (const smoothing of SMOOTHINGS) {
      const { scored, silent } = crossValidate(rows, smoothing);
      out.push('', `smoothing ${smoothing}  (no known word at all for ${silent} transactions)`);
      out.push('  threshold  guesses  precision  coverage');
      for (const threshold of THRESHOLDS) {
        const guesses = scored.filter((s) => s.confidence >= threshold);
        const right = guesses.filter((s) => s.correct).length;
        out.push(
          `  ${threshold.toFixed(2).padStart(9)}  ${String(guesses.length).padStart(7)}  ` +
            `${pct(right, guesses.length).padStart(9)}  ${pct(guesses.length, eligible.length).padStart(8)}`,
        );
      }
    }

    const smoothing = Number(process.env['TUNE_SMOOTHING'] ?? 0.5);
    const threshold = Number(process.env['TUNE_THRESHOLD'] ?? 0.8);
    out.push('', `== 2. Training size, at smoothing ${smoothing} and threshold ${threshold} ==`);
    out.push('Trained on the first N confirmations (oldest first), scored on every later one.');
    out.push('  trained on  scored  guesses  precision  coverage');
    for (const size of TRAINING_SIZES.filter((n) => n < rows.length)) {
      const model = train(rows.slice(0, size), { smoothing, minExamples: 0, threshold });
      const later = rows.slice(size).filter((row) => row.reachesClassifier);
      const guesses = later.filter((row) => model.predict(row) !== undefined);
      const right = guesses.filter((row) => model.predict(row) === row.subcategoryId).length;
      out.push(
        `  ${String(size).padStart(10)}  ${String(later.length).padStart(6)}  ` +
          `${String(guesses.length).padStart(7)}  ${pct(right, guesses.length).padStart(9)}  ` +
          `${pct(guesses.length, later.length).padStart(8)}`,
      );
    }
    out.push('');
    process.stdout.write(out.join('\n') + '\n');
  });
});
