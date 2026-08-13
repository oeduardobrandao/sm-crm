import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenizeCard, TokenizationError } from '../pagarme-token';

type FetchMock = ReturnType<typeof vi.fn>;
const calls = () => (fetch as unknown as FetchMock).mock.calls;

const card = {
  number: '4000 0000 0000 0010',
  holderName: 'Ana Souza',
  expMonth: 12,
  expYear: 2030,
  cvv: '123',
};

function mockFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    }),
  );
}

describe('tokenizeCard', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_PAGARME_PUBLIC_KEY', 'pk_test_abc123');
  });

  it('posts only to the Pagar.me host with the appId query param', async () => {
    mockFetch({ id: 'token_123' });
    await tokenizeCard(card);
    expect(calls()).toHaveLength(1);
    const url = calls()[0][0] as string;
    expect(url).toBe('https://api.pagar.me/core/v5/tokens?appId=pk_test_abc123');
  });

  it('sends the card number as digits only', async () => {
    mockFetch({ id: 'token_123' });
    await tokenizeCard(card);
    const body = JSON.parse(calls()[0][1].body);
    expect(body.card.number).toBe('4000000000000010');
    expect(body.card.holder_name).toBe('Ana Souza');
    expect(body.card.exp_month).toBe(12);
    expect(body.card.exp_year).toBe(2030);
    expect(body.card.cvv).toBe('123');
    expect(body.type).toBe('card');
  });

  it('resolves with the token id on success', async () => {
    mockFetch({ id: 'token_abc' });
    const token = await tokenizeCard(card);
    expect(token).toBe('token_abc');
  });

  it('throws the fixed PT-BR message on a non-ok response, never leaking the response body', async () => {
    mockFetch({ message: 'card number is invalid: super secret gateway detail' }, false, 422);
    await expect(tokenizeCard(card)).rejects.toThrow(TokenizationError);
    try {
      await tokenizeCard(card);
      throw new Error('expected tokenizeCard to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(TokenizationError);
      expect((err as Error).message).toBe(
        'Cartão recusado. Confira os dados ou tente outro cartão.',
      );
      expect((err as Error).message).not.toContain('super secret gateway detail');
    }
  });

  it('throws the connection message when fetch rejects (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(tokenizeCard(card)).rejects.toThrow(
      'Não foi possível validar o cartão. Verifique sua conexão.',
    );
  });

  it('throws the unavailable message when the public key is missing, without calling fetch', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_PAGARME_PUBLIC_KEY', '');
    vi.stubGlobal('fetch', vi.fn());
    await expect(tokenizeCard(card)).rejects.toThrow('Pagamento indisponível no momento.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws the fixed message when the ok response has no id', async () => {
    mockFetch({});
    await expect(tokenizeCard(card)).rejects.toThrow(
      'Cartão recusado. Confira os dados ou tente outro cartão.',
    );
  });
});
