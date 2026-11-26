import { DEFAULT_PARTNER_NAME } from '../config/config';

/**
 * The partner's name in the genitive, for "<name> andel": _Robins_, _Lars_ (no extra s after
 * s, x or z), and _Partnerns_ while no name is set.
 */
export function partnerPossessive(partner: string): string {
  if (partner === DEFAULT_PARTNER_NAME) return 'Partnerns';
  return /[sxz]$/i.test(partner) ? partner : `${partner}s`;
}
