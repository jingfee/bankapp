import type { CategoryIcon } from './category-icons';
import type { CategoryColour } from './category-palette';
import type { CategoryKind } from './categories';

export interface DefaultSubcategory {
  name: string;
  icon: CategoryIcon;
}

export interface DefaultCategory {
  name: string;
  kind: CategoryKind;
  colour: CategoryColour;
  icon: CategoryIcon;
  /** True for the single income category and the single transfer category. */
  fixed: boolean;
  subcategories: DefaultSubcategory[];
}

const other: DefaultSubcategory = { name: 'Övrigt', icon: 'circle-ellipsis' };

/**
 * The categories, in sort order. The owner cannot edit them; migration 0010 seeds the same list,
 * and a change here needs a migration and a look at the guessing lists, which refer to
 * subcategories by name (see `guessing/default-subcategory.ts` in the backend).
 */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  {
    name: 'Boende & Hushåll',
    kind: 'expense',
    colour: 'orange',
    icon: 'house',
    fixed: false,
    subcategories: [
      { name: 'Bolån ränta & amortering', icon: 'key-round' },
      { name: 'Hyra & avgift', icon: 'receipt' },
      { name: 'El & värme', icon: 'zap' },
      { name: 'Vatten & avlopp', icon: 'droplets' },
      { name: 'Bredband, TV & mobil', icon: 'wifi' },
      { name: 'Hemförsäkring', icon: 'shield-check' },
      { name: 'Hushållsartiklar', icon: 'spray-can' },
      { name: 'Inredning & möbler', icon: 'sofa' },
      { name: 'Renovering & underhåll', icon: 'hammer' },
      { name: 'Trädgård', icon: 'flower-2' },
      other,
    ],
  },
  {
    name: 'Mat & Dryck',
    kind: 'expense',
    colour: 'green',
    icon: 'utensils',
    fixed: false,
    subcategories: [
      { name: 'Livsmedel', icon: 'shopping-basket' },
      { name: 'Restaurang', icon: 'utensils-crossed' },
      { name: 'Café & fika', icon: 'coffee' },
      { name: 'Snabbmat & hämtmat', icon: 'sandwich' },
      { name: 'Alkohol', icon: 'wine' },
      other,
    ],
  },
  {
    name: 'Transport',
    kind: 'expense',
    colour: 'blue',
    icon: 'bus',
    fixed: false,
    subcategories: [
      { name: 'Kollektivtrafik', icon: 'train-front' },
      { name: 'Bilpool & hyrbil', icon: 'car' },
      { name: 'Taxi', icon: 'car-taxi-front' },
      other,
    ],
  },
  {
    name: 'Shopping',
    kind: 'expense',
    colour: 'pink',
    icon: 'shopping-bag',
    fixed: false,
    subcategories: [
      { name: 'Kläder & skor', icon: 'shirt' },
      { name: 'Elektronik', icon: 'smartphone' },
      { name: 'Sport & friluft', icon: 'bike' },
      { name: 'Böcker & tidningar', icon: 'book-open' },
      other,
    ],
  },
  {
    name: 'Nöje & Fritid',
    kind: 'expense',
    colour: 'purple',
    icon: 'ticket',
    fixed: false,
    subcategories: [
      { name: 'Streaming & prenumerationer', icon: 'tv' },
      { name: 'Träning & gym', icon: 'dumbbell' },
      { name: 'Kultur & evenemang', icon: 'drama' },
      { name: 'Hobby', icon: 'palette' },
      { name: 'Spel', icon: 'gamepad-2' },
      { name: 'Kurser & utbildningar', icon: 'graduation-cap' },
      other,
    ],
  },
  {
    name: 'Hälsa & Skönhet',
    kind: 'expense',
    colour: 'rose',
    icon: 'heart-pulse',
    fixed: false,
    subcategories: [
      { name: 'Vård', icon: 'stethoscope' },
      { name: 'Tandvård', icon: 'smile' },
      { name: 'Apotek', icon: 'pill' },
      { name: 'Frisör & skönhet', icon: 'scissors' },
      other,
    ],
  },
  {
    name: 'Husdjur',
    kind: 'expense',
    colour: 'amber',
    icon: 'paw-print',
    fixed: false,
    subcategories: [
      { name: 'Djurmat', icon: 'bone' },
      { name: 'Veterinär', icon: 'syringe' },
      { name: 'Djurförsäkring', icon: 'shield-check' },
      other,
    ],
  },
  {
    name: 'Resor',
    kind: 'expense',
    colour: 'teal',
    icon: 'plane',
    fixed: false,
    subcategories: [
      { name: 'Flyg & tåg', icon: 'plane-takeoff' },
      { name: 'Hotell & boende', icon: 'bed-double' },
      { name: 'Aktiviteter', icon: 'tent' },
      other,
    ],
  },
  {
    name: 'Ekonomi & Försäkring',
    kind: 'expense',
    colour: 'slate',
    icon: 'landmark',
    fixed: false,
    subcategories: [
      { name: 'Bankavgifter', icon: 'building-2' },
      { name: 'Kortränta & avgifter', icon: 'credit-card' },
      { name: 'Övriga försäkringar', icon: 'shield' },
      { name: 'Fackavgift & a-kassa', icon: 'users' },
      other,
    ],
  },
  {
    name: 'Gåvor & Välgörenhet',
    kind: 'expense',
    colour: 'red',
    icon: 'gift',
    fixed: false,
    subcategories: [
      { name: 'Presenter', icon: 'gift' },
      { name: 'Välgörenhet', icon: 'hand-heart' },
      other,
    ],
  },
  {
    name: 'Övrigt',
    kind: 'expense',
    colour: 'gray',
    icon: 'circle-ellipsis',
    fixed: false,
    subcategories: [{ name: 'Kontantuttag', icon: 'banknote' }, other],
  },
  {
    name: 'Inkomst',
    kind: 'income',
    colour: 'emerald',
    icon: 'wallet',
    fixed: true,
    subcategories: [
      { name: 'Lön', icon: 'briefcase' },
      { name: 'Bidrag', icon: 'hand-coins' },
      { name: 'Skatteåterbäring', icon: 'receipt-text' },
      { name: 'Ränta & utdelning', icon: 'trending-up' },
      { name: 'Försäljning', icon: 'tag' },
      { name: 'Gåvor', icon: 'gift' },
      other,
    ],
  },
  {
    name: 'Överföring',
    kind: 'transfer',
    colour: 'indigo',
    icon: 'arrow-left-right',
    fixed: true,
    subcategories: [
      { name: 'Mellan egna konton', icon: 'arrow-left-right' },
      { name: 'Kortbetalning', icon: 'credit-card' },
      { name: 'Sparande & investeringar', icon: 'piggy-bank' },
      other,
    ],
  },
];
