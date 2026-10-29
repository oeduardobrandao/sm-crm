import { describe, expect, it } from 'vitest';
import { errorMessage } from '../ui';

const GENERIC = 'Não deu certo agora. Tente de novo em instantes.';
const text = (t: string) => ({ isError: true, content: [{ type: 'text', text: t }] });

describe('errorMessage', () => {
  it("swaps the SDK's English input-validation error for the generic sentence", () => {
    expect(
      errorMessage(
        text(
          'MCP error -32602: Input validation error: Invalid arguments for tool create_post: [{"code":"too_big"}]',
        ),
      ),
    ).toBe(GENERIC);
    expect(errorMessage(text('Input validation error: Invalid arguments for tool x'))).toBe(
      GENERIC,
    );
    expect(errorMessage(text('MCP error -32602: Tool send_post_to_client not found'))).toBe(
      GENERIC,
    );
  });

  it('keeps a server pt-BR sentence and swaps the English fallbacks', () => {
    expect(
      errorMessage(text(JSON.stringify({ error: 'Cliente não encontrado neste workspace.' }))),
    ).toBe('Cliente não encontrado neste workspace.');
    expect(errorMessage(text(JSON.stringify({ error: 'Internal error.' })))).toBe(GENERIC);
    expect(errorMessage(undefined)).toBe(GENERIC);
  });
});
