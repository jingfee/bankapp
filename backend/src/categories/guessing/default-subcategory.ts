/**
 * A subcategory of the built-in list, named by its category and its own name. Guessing looks it up
 * by name, so a migration that renames or removes a subcategory must update these too; one that
 * no longer exists is simply not guessed.
 */
export type DefaultSubcategory = readonly [category: string, subcategory: string];

export const LIVSMEDEL: DefaultSubcategory = ['Mat & Dryck', 'Livsmedel'];
export const RESTAURANG: DefaultSubcategory = ['Mat & Dryck', 'Restaurang'];
export const CAFE: DefaultSubcategory = ['Mat & Dryck', 'Café & fika'];
export const SNABBMAT: DefaultSubcategory = ['Mat & Dryck', 'Snabbmat & hämtmat'];
export const ALKOHOL: DefaultSubcategory = ['Mat & Dryck', 'Alkohol'];
export const KOLLEKTIVTRAFIK: DefaultSubcategory = ['Transport', 'Kollektivtrafik'];
export const BILPOOL: DefaultSubcategory = ['Transport', 'Bilpool & hyrbil'];
export const TAXI: DefaultSubcategory = ['Transport', 'Taxi'];
export const KLADER: DefaultSubcategory = ['Shopping', 'Kläder & skor'];
export const ELEKTRONIK: DefaultSubcategory = ['Shopping', 'Elektronik'];
export const SPORT: DefaultSubcategory = ['Shopping', 'Sport & friluft'];
export const BOCKER: DefaultSubcategory = ['Shopping', 'Böcker & tidningar'];
export const STREAMING: DefaultSubcategory = ['Nöje & Fritid', 'Streaming & prenumerationer'];
export const KULTUR: DefaultSubcategory = ['Nöje & Fritid', 'Kultur & evenemang'];
export const SPEL: DefaultSubcategory = ['Nöje & Fritid', 'Spel'];
export const KURSER: DefaultSubcategory = ['Nöje & Fritid', 'Kurser & utbildningar'];
export const VARD: DefaultSubcategory = ['Hälsa & Skönhet', 'Vård'];
export const TANDVARD: DefaultSubcategory = ['Hälsa & Skönhet', 'Tandvård'];
export const APOTEK: DefaultSubcategory = ['Hälsa & Skönhet', 'Apotek'];
export const FRISOR: DefaultSubcategory = ['Hälsa & Skönhet', 'Frisör & skönhet'];
export const VETERINAR: DefaultSubcategory = ['Husdjur', 'Veterinär'];
export const FLYG_OCH_TAG: DefaultSubcategory = ['Resor', 'Flyg & tåg'];
export const HOTELL: DefaultSubcategory = ['Resor', 'Hotell & boende'];
export const BREDBAND: DefaultSubcategory = ['Boende & Hushåll', 'Bredband, TV & mobil'];
export const INREDNING: DefaultSubcategory = ['Boende & Hushåll', 'Inredning & möbler'];
export const RENOVERING: DefaultSubcategory = ['Boende & Hushåll', 'Renovering & underhåll'];
export const TRADGARD: DefaultSubcategory = ['Boende & Hushåll', 'Trädgård'];
export const OVRIGA_FORSAKRINGAR: DefaultSubcategory = [
  'Ekonomi & Försäkring',
  'Övriga försäkringar',
];
export const VALGORENHET: DefaultSubcategory = ['Gåvor & Välgörenhet', 'Välgörenhet'];
export const KONTANTUTTAG: DefaultSubcategory = ['Övrigt', 'Kontantuttag'];
export const KORTBETALNING: DefaultSubcategory = ['Överföring', 'Kortbetalning'];
