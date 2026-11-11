import {
  ALKOHOL,
  APOTEK,
  BILPOOL,
  BOCKER,
  BREDBAND,
  CAFE,
  ELEKTRONIK,
  FLYG_OCH_TAG,
  FRISOR,
  HOTELL,
  INREDNING,
  KLADER,
  KOLLEKTIVTRAFIK,
  KONTANTUTTAG,
  KULTUR,
  KURSER,
  LIVSMEDEL,
  OVRIGA_FORSAKRINGAR,
  RENOVERING,
  RESTAURANG,
  SNABBMAT,
  SPEL,
  SPORT,
  STREAMING,
  TANDVARD,
  TAXI,
  TRADGARD,
  VALGORENHET,
  VARD,
  VETERINAR,
  type DefaultSubcategory,
} from './default-subcategory';

/**
 * Card network merchant category codes (MCC, ISO 18245) that clearly mean one subcategory, built
 * in and not editable (ADR 0004). Catch-all codes are left out on purpose, e.g. 5999 (misc
 * retail), 5499 (misc food stores), 5399 (general merchandise), 4899 (pay TV and streaming
 * alike), 5994 (newsagents, mostly snacks here) and 5541 (fuel).
 */
const CODES: Record<string, DefaultSubcategory> = {
  '5411': LIVSMEDEL, // grocery stores, supermarkets
  '5422': LIVSMEDEL, // meat provisioners
  '5451': LIVSMEDEL, // dairy stores
  '5812': RESTAURANG, // eating places, restaurants
  '5814': SNABBMAT, // fast food
  '5462': CAFE, // bakeries
  '5921': ALKOHOL, // package stores (beer, wine, liquor)
  '4111': KOLLEKTIVTRAFIK, // local commuter transport
  '4131': KOLLEKTIVTRAFIK, // bus lines
  '4121': TAXI, // taxicabs and limousines
  '7512': BILPOOL, // car rental
  '4112': FLYG_OCH_TAG, // passenger railways
  '4511': FLYG_OCH_TAG, // airlines
  '7011': HOTELL, // lodging, hotels
  '5912': APOTEK, // drug stores, pharmacies
  '8011': VARD, // doctors
  '8062': VARD, // hospitals
  '8021': TANDVARD, // dentists
  '7230': FRISOR, // beauty and barber shops
  '0742': VETERINAR, // veterinary services
  '5815': STREAMING, // digital media: books, films, music
  '5816': SPEL, // digital games
  '7832': KULTUR, // cinemas
  '7922': KULTUR, // theatre and ticket agencies
  '8299': KURSER, // schools and educational services
  '8241': KURSER, // correspondence schools
  '5611': KLADER, // men's clothing
  '5621': KLADER, // women's clothing
  '5651': KLADER, // family clothing
  '5661': KLADER, // shoe stores
  '5691': KLADER, // men's and women's clothing
  '5732': ELEKTRONIK, // electronics stores
  '5941': SPORT, // sporting goods
  '5942': BOCKER, // book stores
  '4814': BREDBAND, // telecommunication services
  '5712': INREDNING, // furniture
  '5200': RENOVERING, // home supply warehouses
  '5211': RENOVERING, // building materials
  '5251': RENOVERING, // hardware stores
  '5261': TRADGARD, // nurseries, lawn and garden supply
  '6300': OVRIGA_FORSAKRINGAR, // insurance
  '8398': VALGORENHET, // charitable organisations
  '6011': KONTANTUTTAG, // cash withdrawals (ATM)
  '6010': KONTANTUTTAG, // cash withdrawals (manual)
};

/** The subcategory a merchant category code clearly means, or undefined. */
export function subcategoryForCode(code: string): DefaultSubcategory | undefined {
  if (!/^\d{4}$/.test(code)) return undefined;
  const number = Number(code);
  if (number >= 3000 && number <= 3350) return FLYG_OCH_TAG; // airlines by name
  if (number >= 3501 && number <= 3999) return HOTELL; // hotel chains by name
  return CODES[code];
}
