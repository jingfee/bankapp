/** A recurring day of a loan part: the next date (rolled forward to today or later) and its interval. */
export interface RecurringDay {
  /** `YYYY-MM-DD`; never in the past. */
  next: string;
  intervalMonths: number;
}

/** A dated value for a loan part, in force from `from` until the next change. */
export interface RateChange {
  id: number;
  /** `YYYY-MM-DD`. */
  from: string;
  /** Per cent, e.g. 3.85. */
  rate: number;
}

export interface AmortisationChange {
  id: number;
  /** `YYYY-MM-DD`. */
  from: string;
  /** Kr per month. */
  amount: number;
}

export interface LoanPart {
  id: number;
  name: string;
  startedOn: string;
  /** The day the part ended (`YYYY-MM-DD`), or null while it is open. It counts as 0 from then. */
  endedOn: string | null;
  /** The debt in its latest mortgage entry; null before the first one. */
  debt: number | null;
  /** The interest rate in force today (%), 0 once ended; null when none is in force yet. */
  rate: number | null;
  /** The amortisation in force today (kr per month), 0 once ended; null when none is in force yet. */
  amortisation: number | null;
  /** Newest first. */
  rateChanges: RateChange[];
  /** Newest first. */
  amortisationChanges: AmortisationChange[];
  rateAdjustment: RecurringDay;
  /** Whether to ask the owner for a new rate: the latest rate adjustment day has come and no rate change is dated on or after it. False once ended. */
  needsNewRate: boolean;
  termsChange: RecurringDay;
}

export interface MortgageEntryDebt {
  partId: number;
  debt: number;
}

/** The owner stating each loan part's remaining debt on a day. */
export interface MortgageEntry {
  id: number;
  /** `YYYY-MM-DD`. */
  date: string;
  debts: MortgageEntryDebt[];
}

export interface MortgageResponse {
  /** Open parts first, then ended ones. Empty until the mortgage is set up. */
  parts: LoanPart[];
  /** Newest first. */
  entries: MortgageEntry[];
}

export interface RecurringDayRequest {
  /** The next date; the series runs from it. */
  next: string;
  intervalMonths: number;
}

export interface AddLoanPartRequest {
  name: string;
  /** Defaults to today; never in the future. */
  startedOn?: string;
  /** Remaining debt on the start day, in kr. */
  debt: number;
  /** Per cent. In force from the start day. */
  rate: number;
  /** Kr per month. In force from the start day. */
  amortisation: number;
  rateAdjustment: RecurringDayRequest;
  termsChange: RecurringDayRequest;
}

/** Fields left out are unchanged. */
export interface UpdateLoanPartRequest {
  name?: string;
  rateAdjustment?: RecurringDayRequest;
  termsChange?: RecurringDayRequest;
}

export interface EndLoanPartRequest {
  /** Defaults to today. */
  date?: string;
}

export interface InterestRateChangeRequest {
  /** Defaults to today. */
  from?: string;
  rate: number;
}

export interface AmortisationChangeRequest {
  /** Defaults to today. */
  from?: string;
  amount: number;
}

export interface MortgageEntryRequest {
  /** Defaults to today; never in the future. */
  date?: string;
  /** The debt of every part open on the day. */
  debts: MortgageEntryDebt[];
}

/** A loan part's remaining debt, in kr. */
export interface LoanPartDebt {
  partId: number;
  debt: number;
}

/** One calendar month of the mortgage's figures. */
export interface MortgageMonth {
  /** `YYYY-MM`. */
  month: string;
  /** Each part open in the month, with its remaining debt at the start of it. */
  debts: LoanPartDebt[];
  /** Estimated interest for the month, in kr; no interest tax deduction. */
  interest: number;
  /** Amortisation in force for the month, in kr. */
  amortisation: number;
  /** `interest` plus `amortisation`. */
  total: number;
  /** What was paid in Bolån ränta & amortering in the month (booked and pending, whole amounts), as a positive amount. */
  paid: number;
}

export interface MortgageFiguresResponse {
  /** Each part's remaining debt now, worked out from its latest entry and the booked payments since. */
  debts: LoanPartDebt[];
  /** The remaining debt across open parts now, in kr. */
  totalDebt: number;
  /** The debt-weighted average of the open parts' rates in force today (%); parts with no rate are left out; null with no such debt. */
  averageRate: number | null;
  /** From the first mortgage entry's month to the current one, oldest first. Empty before any entry. */
  months: MortgageMonth[];
  /** `YYYY-MM` of each ended month since the first entry with no booked payment, oldest first. */
  monthsWithoutPayment: string[];
  /** The id of Bolån ränta & amortering, whose transactions are the payments; null if it is missing. */
  paymentsSubcategoryId: number | null;
}
