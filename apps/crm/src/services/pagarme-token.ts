// Card tokenization: browser -> Pagar.me directly. The ONLY consumer of raw card data in the
// app; nothing here may log, persist, or forward the card fields anywhere else. The token is
// single-use and expires in 60s: callers tokenize on submit and re-tokenize on every retry.

const TOKEN_URL = 'https://api.pagar.me/core/v5/tokens';

export interface CardInput {
  number: string;
  holderName: string;
  expMonth: number;
  expYear: number;
  cvv: string;
}

export class TokenizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenizationError';
  }
}

export async function tokenizeCard(card: CardInput): Promise<string> {
  const publicKey = import.meta.env.VITE_PAGARME_PUBLIC_KEY;
  if (!publicKey) throw new TokenizationError('Pagamento indisponível no momento.');
  let res: Response;
  try {
    res = await fetch(`${TOKEN_URL}?appId=${encodeURIComponent(publicKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        type: 'card',
        card: {
          number: card.number.replace(/\D/g, ''),
          holder_name: card.holderName.trim(),
          exp_month: card.expMonth,
          exp_year: card.expYear,
          cvv: card.cvv,
        },
      }),
    });
  } catch {
    throw new TokenizationError('Não foi possível validar o cartão. Verifique sua conexão.');
  }
  if (!res.ok) {
    throw new TokenizationError('Cartão recusado. Confira os dados ou tente outro cartão.');
  }
  const data = (await res.json().catch(() => null)) as { id?: string } | null;
  if (!data?.id)
    throw new TokenizationError('Cartão recusado. Confira os dados ou tente outro cartão.');
  return data.id;
}
