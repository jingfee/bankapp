import {
  ALKOHOL,
  APOTEK,
  KOLLEKTIVTRAFIK,
  KORTBETALNING,
  LARM,
  LIVSMEDEL,
  STADNING,
  STREAMING,
  type DefaultSubcategory,
} from './default-subcategory';

/**
 * Swedish merchants recognised by name, built in and not editable (ADR 0004). A keyword matches
 * a whole word of the description, ignoring case, accents (card data writes Hemköp as `HEMKOP`)
 * and how words are separated; digits may follow it (`LIDL350SOLNACENTRUM`). Longer keywords
 * win, so paying the Coop Mastercard bill is not taken for shopping at Coop. A keyword with no
 * subcategory blocks a shorter one: ICA Banken is a bank, not an ICA store.
 */
export const MERCHANT_KEYWORDS: readonly (readonly [keyword: string, DefaultSubcategory | null])[] =
  [
    ['coop mastercard', KORTBETALNING],
    ['ica banken', null],
    ['ica', LIVSMEDEL],
    ['willys', LIVSMEDEL],
    ['coop', LIVSMEDEL],
    ['lidl', LIVSMEDEL],
    ['hemkop', LIVSMEDEL],
    ['city gross', LIVSMEDEL],
    ['mathem', LIVSMEDEL],
    ['systembolaget', ALKOHOL],
    ['sl', KOLLEKTIVTRAFIK],
    ['vasttrafik', KOLLEKTIVTRAFIK],
    ['skanetrafiken', KOLLEKTIVTRAFIK],
    ['spotify', STREAMING],
    ['netflix', STREAMING],
    ['viaplay', STREAMING],
    ['apotek', APOTEK],
    ['apoteket', APOTEK],
    ['kronans', APOTEK],
    ['verisure', LARM],
    ['sector alarm', LARM],
    ['hemfrid', STADNING],
    ['vardagsfrid', STADNING],
  ];
