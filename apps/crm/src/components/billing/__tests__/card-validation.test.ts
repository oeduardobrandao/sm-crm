import { describe, expect, it } from 'vitest';
import {
  documentValid,
  luhnValid,
  maskCardNumber,
  maskCep,
  maskDocument,
  maskExpiry,
  maskPhone,
  onlyDigits,
  parseExpiry,
  splitPhone,
} from '../card-validation';

describe('onlyDigits', () => {
  it('strips everything but digits', () => {
    expect(onlyDigits('4000 0000-0000.0010')).toBe('4000000000000010');
  });
});

describe('luhnValid', () => {
  it('accepts known-valid test card numbers', () => {
    expect(luhnValid('4000000000000010')).toBe(true);
    expect(luhnValid('5555555555554444')).toBe(true);
  });

  it('accepts them with formatting characters too', () => {
    expect(luhnValid('4000 0000 0000 0010')).toBe(true);
  });

  it('rejects an off-by-one digit', () => {
    expect(luhnValid('4000000000000011')).toBe(false);
  });

  it('rejects too-short input', () => {
    expect(luhnValid('400000')).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(luhnValid('abcd efgh ijkl mnop')).toBe(false);
  });
});

describe('parseExpiry', () => {
  const now = new Date(2026, 5, 15); // June 15, 2026

  it('accepts a valid future date', () => {
    expect(parseExpiry('12/26', now)).toEqual({ month: 12, year: 2026 });
  });

  it('accepts the current month', () => {
    expect(parseExpiry('06/26', now)).toEqual({ month: 6, year: 2026 });
  });

  it('rejects a past month in the current year', () => {
    expect(parseExpiry('05/26', now)).toBeNull();
  });

  it('rejects a past year', () => {
    expect(parseExpiry('12/25', now)).toBeNull();
  });

  it('rejects an out-of-range month (13)', () => {
    expect(parseExpiry('13/30', now)).toBeNull();
  });

  it('rejects an out-of-range month (0)', () => {
    expect(parseExpiry('0/25', now)).toBeNull();
  });

  it('rejects malformed input without a slash', () => {
    expect(parseExpiry('1225', now)).toBeNull();
  });
});

describe('documentValid', () => {
  it('accepts valid CPFs, formatted or raw', () => {
    expect(documentValid('111.444.777-35')).toBe(true);
    expect(documentValid('52998224725')).toBe(true);
    expect(documentValid('529.982.247-25')).toBe(true);
  });

  it('accepts a valid CNPJ', () => {
    expect(documentValid('11.222.333/0001-81')).toBe(true);
    expect(documentValid('11222333000181')).toBe(true);
  });

  it('rejects a repeated-digit CPF', () => {
    expect(documentValid('111.111.111-11')).toBe(false);
  });

  it('rejects a CPF with a wrong check digit', () => {
    expect(documentValid('111.444.777-36')).toBe(false);
  });

  it('rejects a 12-digit input (neither CPF nor CNPJ length)', () => {
    expect(documentValid('123456789012')).toBe(false);
  });
});

describe('maskCardNumber', () => {
  it('groups digits in fours', () => {
    expect(maskCardNumber('4000000000000010')).toBe('4000 0000 0000 0010');
  });

  it('truncates beyond 19 digits', () => {
    expect(maskCardNumber('40000000000000101234567890')).toBe(
      maskCardNumber('4000000000000010123'),
    );
  });
});

describe('maskExpiry', () => {
  it('inserts the slash after two digits', () => {
    expect(maskExpiry('1226')).toBe('12/26');
  });

  it('leaves short input unslashed', () => {
    expect(maskExpiry('1')).toBe('1');
    expect(maskExpiry('12')).toBe('12');
  });

  it('truncates beyond 4 digits', () => {
    expect(maskExpiry('122699')).toBe('12/26');
  });
});

describe('maskDocument', () => {
  it('shapes a CPF as it is typed', () => {
    expect(maskDocument('1')).toBe('1');
    expect(maskDocument('111444777')).toBe('111.444.777');
    expect(maskDocument('11144477735')).toBe('111.444.777-35');
  });

  it('shapes a CNPJ once past 11 digits', () => {
    expect(maskDocument('11222333000181')).toBe('11.222.333/0001-81');
  });

  it('truncates beyond 14 digits', () => {
    expect(maskDocument('112223330001819999')).toBe('11.222.333/0001-81');
  });
});

describe('maskCep', () => {
  it('inserts the dash after five digits', () => {
    expect(maskCep('01310100')).toBe('01310-100');
  });

  it('leaves short input undashed', () => {
    expect(maskCep('0131')).toBe('0131');
  });

  it('truncates beyond 8 digits', () => {
    expect(maskCep('013101009999')).toBe('01310-100');
  });
});

describe('maskPhone', () => {
  it('shapes progressively as digits are typed', () => {
    expect(maskPhone('1')).toBe('1');
    expect(maskPhone('11')).toBe('11');
    expect(maskPhone('119999')).toBe('(11) 9999');
    expect(maskPhone('1199999999')).toBe('(11) 9999-9999');
    expect(maskPhone('11999999999')).toBe('(11) 99999-9999');
  });

  it('truncates beyond 11 digits', () => {
    expect(maskPhone('119999999999999')).toBe('(11) 99999-9999');
  });
});

describe('splitPhone', () => {
  it('splits a 10-digit (landline) number', () => {
    expect(splitPhone('1133334444')).toEqual({ ddd: '11', number: '33334444' });
  });

  it('splits an 11-digit (mobile) number', () => {
    expect(splitPhone('(11) 99999-8888')).toEqual({ ddd: '11', number: '999998888' });
  });

  it('rejects a 9-digit number', () => {
    expect(splitPhone('123456789')).toBeNull();
  });
});
