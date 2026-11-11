/**
 * The form of a transaction description that stays the same between purchases at the same place,
 * so a category confirmed for one can be reused for the next (ADR 0004).
 *
 * Based on the descriptions Skandia and Coop Mastercard send (ADR 0003):
 * - Case and runs of whitespace do not matter; `_` separates words like a space
 *   (`9/8_22689_Circle_K`).
 * - Words that are mostly digits vary between purchases and are dropped: store and terminal
 *   numbers (`Espresso House 123`, `Pressbyran 5512345`), dates (`2026-11-08`, `9/8`), invoice,
 *   OCR and order references (`Bankgiro Elbolaget 4400123456`, `AMAZON.SE* 1A23B45C6`) and
 *   giro or phone numbers in brackets (`(123-4567)`).
 * - Digits after `/`, `:` or `#` inside a word are references too (`Bolt.eu/o/2511081234`,
 *   `HYRE* Bokning:1234567`).
 * - Masked card numbers are dropped (`************1234`, `XXXX XXXX XXXX 1234`, `*1234`).
 * - Digits that are part of a name stay (`OKQ8`, `PAN-19`, `LIDL350SOLNACENTRUM`, `7-Eleven`).
 * - Swish payments and transfers between accounts keep everything: there the name, phone
 *   number or account number is who the money went to, so different people stay apart.
 * - Words with no letters or digits left (`-`, `&`) are dropped.
 * If nothing would be left, the lowercased description is used as it is.
 */
export function normaliseDescription(description: string): string {
  const plain = description.toLocaleLowerCase('sv-SE').replace(/\s+/g, ' ').trim();
  if (KEEPS_EVERYTHING.test(plain)) return plain;
  const words = plain
    .replace(/_/g, ' ')
    .replace(/[/:#]\d[\d-]*/g, '')
    .split(' ')
    .filter((word) => !MASKED_CARD.test(word) && !isMostlyDigits(word) && ALPHANUMERIC.test(word));
  return words.join(' ') || plain;
}

/** Swish payments and transfers between accounts, where every part tells payees apart. */
const KEEPS_EVERYTHING = /^(swish|överf)/;
const MASKED_CARD = /^(x{2,}|\*{2,})[\dx*]*$/;
const ALPHANUMERIC = /[\p{L}\p{N}]/u;

function isMostlyDigits(word: string): boolean {
  const characters = word.replace(/[^\p{L}\p{N}]/gu, '');
  const digits = characters.replace(/\D/g, '').length;
  return digits > 0 && digits * 2 > characters.length;
}
