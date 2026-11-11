import { normaliseDescription } from '../src/categories/guessing/normalise-description';

// The descriptions are made up, shaped like those the banks send (ADR 0003); no real names.
describe('normaliseDescription', () => {
  const same = (...descriptions: string[]) =>
    expect(new Set(descriptions.map(normaliseDescription)).size).toBe(1);
  const apart = (...descriptions: string[]) =>
    expect(new Set(descriptions.map(normaliseDescription)).size).toBe(descriptions.length);

  it('lowercases and collapses whitespace', () => {
    expect(normaliseDescription('  ICA  Nära   Vega ')).toBe('ica nära vega');
  });

  it('drops store and terminal numbers', () => {
    expect(normaliseDescription('Espresso House 123')).toBe('espresso house');
    same('Espresso House 123', 'Espresso House 4567', 'ESPRESSO HOUSE 88');
    same('Pressbyran 5512345', 'Pressbyran 5519876');
  });

  it('drops the date and terminal prefix some card purchases carry', () => {
    expect(normaliseDescription('9/8_22689_Circle_K')).toBe('circle k');
    same('9/8_22689_Circle_K', '12/10_22689_Circle_K');
  });

  it('drops dates', () => {
    same('Autogiro Försäkringsbolaget 2026-11-08', 'Autogiro Försäkringsbolaget 2026-12-08');
    same('Hyra 08.11', 'Hyra 08.12');
  });

  it('drops reference, order and invoice numbers', () => {
    same('JOTTACLOUD 12345678', 'JOTTACLOUD 87654321');
    same('Bankgiro Elbolaget 4400123456', 'Bankgiro Elbolaget 4400765432');
    same('Bolt.eu/o/2511081234', 'Bolt.eu/o/2512019876');
    same('HYRE* Bokning:1234567', 'HYRE* Bokning:7654321');
    same('AMAZON.SE* 1A23B45C6', 'AMAZON.SE* 9Z87Y65X4');
    same('Lufthansa.com 22012345', 'Lufthansa.com 22098765');
    same('Elfirma AB (123-4567)', 'Elfirma AB');
  });

  it('drops masked card numbers', () => {
    same('Hemköp ************1234', 'Hemköp XXXX XXXX XXXX 1234', 'Hemköp');
    same('Netflix kort *1234', 'Netflix kort *9876');
  });

  it('keeps digits that are part of a merchant name', () => {
    expect(normaliseDescription('OKQ8 Haninge')).toBe('okq8 haninge');
    expect(normaliseDescription('PAN-19')).toBe('pan-19');
    expect(normaliseDescription('LIDL350SOLNACENTRUM')).toBe('lidl350solnacentrum');
    expect(normaliseDescription('GOOD2GOO')).toBe('good2goo');
    expect(normaliseDescription('7-Eleven Odenplan')).toBe('7-eleven odenplan');
  });

  it('keeps Swish payments to and from different people apart', () => {
    apart(
      'Swish till Anna Andersson',
      'Swish till Bertil Berg',
      'Swish från Anna Andersson',
      'Swish till 0701234567',
      'Swish till 0707654321',
    );
    same('Swish till Anna Andersson', 'SWISH TILL  ANNA ANDERSSON');
  });

  it('keeps transfers to different accounts apart', () => {
    apart('Överföring 8327 1234567', 'Överföring 8327 7654321', 'Överf. 8327 1234567');
  });

  it('keeps the description as it was when nothing but numbers would be left', () => {
    expect(normaliseDescription('12345')).toBe('12345');
    expect(normaliseDescription('')).toBe('');
  });
});
