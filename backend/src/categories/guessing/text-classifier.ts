import { normaliseDescription } from './normalise-description';

/** What the classifier learns from and judges: one transaction, as the owner's bank described it. */
export interface ClassifierInput {
  description: string;
  accountId: number;
  amount: number;
}

/** Feature prefixes: only words say what a transaction is; account and sign just refine it. */
const WORD = 'word:';
const ACCOUNT = 'account:';
const SIGN = 'sign:';

/**
 * Below this many confirmed transactions the classifier is not trusted to say anything: with a
 * handful of examples every word looks decisive. In the dev database's first round of tuning the
 * only guesses made with 10 or 20 confirmations were both wrong, so it waits for 50, and staying
 * silent only leaves a transaction uncategorised.
 */
export const MIN_TRAINING_EXAMPLES = 50;

/**
 * A guess needs at least this posterior probability for its subcategory, otherwise the
 * transaction stays uncategorised (ADR 0004).
 *
 * Naive Bayes is overconfident (it counts correlated words as independent evidence), so its
 * probabilities run high and a low threshold would guess almost everything. 0.8 is a starting
 * point, and the data so far could not move it. `tools/tune-classifier.tune.ts` tuned it on the dev
 * database's confirmed categories (ADR 0003): 98 confirmed, of which 67 reached the classifier
 * (the rest are answered by history, keywords or merchant codes), spread over 37 subcategories,
 * about two each. At 0.8 it made 0 to 2 guesses, too few to measure precision; at 0.5 to 0.6 it
 * guessed 4 to 10 times and was right 0 to 50% of the time, so do not lower it. Re-run the tool
 * once some 300 transactions reach the classifier and replace this note with what it finds.
 */
export const CONFIDENCE_THRESHOLD = 0.8;

/**
 * Smoothing for words a subcategory has not been confirmed with. Add-one smoothing is too blunt for
 * so little data: a word confirmed five times for one subcategory would reach only about 0.75.
 * At 0.5 such a word passes the threshold, while one confirmed a single time does not. The dev
 * database was too sparse to prefer another value (0.1 looked better on two guesses, which is noise).
 */
const SMOOTHING = 0.5;

export interface ClassifierOptions {
  smoothing?: number;
  minExamples?: number;
  threshold?: number;
}

/**
 * A multinomial naive Bayes classifier over the words of the normalised description, the account
 * and the sign of the amount. It runs entirely in memory and is cheap enough to retrain from the
 * confirmed categories each time it is needed, so it never drifts from the owner's choices.
 *
 * Words it has never seen carry no information and are ignored. Account and sign alone can never
 * produce a guess: with no known word the owner's most common subcategory would win every time.
 */
export class TextClassifier<Label extends string | number> {
  /** The defaults are what the app runs with; tuning (`tools/tune-classifier.tune.ts`) overrides them. */
  constructor(private readonly options: ClassifierOptions = {}) {}

  private readonly examples = new Map<Label, number>();
  private readonly featureCounts = new Map<Label, Map<string, number>>();
  private readonly featureTotals = new Map<Label, number>();
  private readonly vocabulary = new Set<string>();
  private total = 0;

  train(input: ClassifierInput, label: Label): void {
    const counts = this.featureCounts.get(label) ?? new Map<string, number>();
    this.featureCounts.set(label, counts);
    for (const feature of features(input)) {
      counts.set(feature, (counts.get(feature) ?? 0) + 1);
      this.featureTotals.set(label, (this.featureTotals.get(label) ?? 0) + 1);
      this.vocabulary.add(feature);
    }
    this.examples.set(label, (this.examples.get(label) ?? 0) + 1);
    this.total += 1;
  }

  /** The most likely label, when there is enough training data and the confidence is high enough. */
  predict(input: ClassifierInput): Label | undefined {
    if (this.total < (this.options.minExamples ?? MIN_TRAINING_EXAMPLES)) return undefined;
    const best = this.score(input);
    return best && best.confidence >= (this.options.threshold ?? CONFIDENCE_THRESHOLD)
      ? best.label
      : undefined;
  }

  /**
   * The most likely label and its posterior probability, before any threshold or minimum of
   * training data is applied. Undefined when the description has no word seen in training.
   */
  score(input: ClassifierInput): { label: Label; confidence: number } | undefined {
    const smoothing = this.options.smoothing ?? SMOOTHING;
    const known = features(input).filter((feature) => this.vocabulary.has(feature));
    if (this.total === 0 || !known.some((feature) => feature.startsWith(WORD))) return undefined;

    const scores = [...this.examples].map(([label, count]) => {
      const counts = this.featureCounts.get(label)!;
      const denominator = this.featureTotals.get(label)! + smoothing * this.vocabulary.size;
      let score = Math.log(count / this.total);
      for (const feature of known) {
        score += Math.log(((counts.get(feature) ?? 0) + smoothing) / denominator);
      }
      return { label, score };
    });
    const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
    const sum = scores.reduce((acc, { score }) => acc + Math.exp(score - best.score), 0);
    return { label: best.label, confidence: 1 / sum };
  }
}

function features({ description, accountId, amount }: ClassifierInput): string[] {
  const words = normaliseDescription(description)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1);
  return [
    ...[...new Set(words)].map((word) => `${WORD}${word}`),
    `${ACCOUNT}${accountId}`,
    `${SIGN}${amount < 0 ? 'out' : 'in'}`,
  ];
}
