/** How a domain error is reported over HTTP; `DomainErrorFilter` is the only place that maps it. */
export type DomainErrorKind = 'bad-request' | 'not-found' | 'conflict';

/** A rule of the domain that a request broke. Modules throw these; controllers never branch on them. */
export abstract class DomainError extends Error {
  abstract readonly kind: DomainErrorKind;
}

/** Input that is malformed or breaks a validation rule. */
export class InvalidInput extends DomainError {
  readonly kind = 'bad-request';
}

/** A bank addressed by the route that is not connected, or already removed. */
export class NoSuchConnection extends DomainError {
  readonly kind = 'not-found';
  constructor() {
    super('There is no such connected bank');
  }
}

/** Deleting for good is only for a bank that has already been removed. */
export class BankNotRemoved extends DomainError {
  readonly kind = 'conflict';
  constructor() {
    super('Only a removed bank can be deleted for good');
  }
}

export class NoSuchAccount extends DomainError {
  readonly kind = 'not-found';
  constructor() {
    super('There is no such account');
  }
}

export class NoSuchTransaction extends DomainError {
  readonly kind = 'not-found';
  constructor() {
    super('There is no such transaction');
  }
}

/** A subcategory addressed by the route. */
export class NoSuchSubcategory extends DomainError {
  readonly kind = 'not-found';
  constructor() {
    super('There is no such subcategory');
  }
}

/** A subcategory named in a request body. */
export class UnknownSubcategory extends DomainError {
  readonly kind = 'bad-request';
  constructor() {
    super('There is no such subcategory');
  }
}

/** A purchase named in a request body. */
export class NoSuchPurchase extends DomainError {
  readonly kind = 'bad-request';
  constructor() {
    super('There is no such purchase');
  }
}

export class NoHouseholdRatio extends DomainError {
  readonly kind = 'conflict';
  constructor() {
    super('Set a household ratio before choosing Hushåll');
  }
}

export class NotLinkable extends DomainError {
  readonly kind = 'bad-request';
  constructor() {
    super(
      'Only a booked money-in transaction can be offset against a booked purchase in the same currency',
    );
  }
}

export class NotReplaceable extends DomainError {
  readonly kind = 'bad-request';
  constructor() {
    super('Only a bank transaction can replace a manual transaction paid by the owner');
  }
}

export class NotAManualAndBankPair extends DomainError {
  readonly kind = 'bad-request';
  constructor() {
    super('Expected a manual transaction and a bank transaction');
  }
}

export class AlreadyReplaced extends DomainError {
  readonly kind = 'conflict';
  constructor() {
    super('One of them is already replaced or replacing');
  }
}

export class NotManual extends DomainError {
  readonly kind = 'conflict';
  constructor(action: 'edited' | 'deleted') {
    super(`Only a manual transaction can be ${action}`);
  }
}

/** A kvittad refund takes its purchase's category and share. */
export class FollowsPurchase extends DomainError {
  readonly kind = 'conflict';
  constructor() {
    super('A kvittad refund follows its purchase; change the purchase');
  }
}

export class NoSuchManualSavingsAccount extends DomainError {
  readonly kind = 'not-found';
  constructor() {
    super('There is no such manual savings account');
  }
}

export class NoSuchBalanceEntry extends DomainError {
  readonly kind = 'not-found';
  constructor() {
    super('There is no such balance entry');
  }
}

/** A closed manual savings account asks for no more entries; reopen it first. */
export class AccountClosed extends DomainError {
  readonly kind = 'conflict';
  constructor() {
    super('The account is closed; reopen it to add entries');
  }
}

/** Moving an entry onto a day that already has one would silently replace that one. */
export class EntryDateTaken extends DomainError {
  readonly kind = 'conflict';
  constructor() {
    super('The account already has an entry for that day');
  }
}

export class NoSuchLoanPart extends DomainError {
  readonly kind = 'not-found';
  constructor() {
    super('There is no such loan part');
  }
}

export class NoSuchMortgageEntry extends DomainError {
  readonly kind = 'not-found';
  constructor() {
    super('There is no such mortgage entry');
  }
}

/** An ended part takes no more changes. */
export class LoanPartEnded extends DomainError {
  readonly kind = 'conflict';
  constructor() {
    super('The loan part has ended');
  }
}

/** Moving a mortgage entry onto a day that already has one would silently replace that one. */
export class MortgageEntryDateTaken extends DomainError {
  readonly kind = 'conflict';
  constructor() {
    super('The mortgage already has an entry for that day');
  }
}
