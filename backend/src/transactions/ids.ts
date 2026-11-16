import type { DomainError } from '../domain-errors';

/** The numeric id in a route parameter; throws `notFound` for anything that cannot be an id. */
export function parseId(value: string, notFound: DomainError): number {
  if (!/^\d{1,15}$/.test(value)) throw notFound;
  return Number(value);
}

/** Whether `value` is a whole number, as a transaction or subcategory id in a body must be. */
export function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}
