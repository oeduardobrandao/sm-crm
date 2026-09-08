import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { isAllowedRichTextLinkUrl } from '@mesaas/link-policy';
import { PaginaRichTextEditor } from '../PaginaRichTextEditor';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from 'sonner';

afterEach(() => vi.clearAllMocks());

describe('PaginaRichTextEditor', () => {
  it('emite o documento a cada edição', async () => {
    const onChange = vi.fn();
    render(<PaginaRichTextEditor doc={{ type: 'doc', content: [] }} onChange={onChange} />);
    await userEvent.type(screen.getByRole('textbox'), 'Olá');
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0];
    expect(JSON.stringify(last)).toContain('Olá');
  });

  it('não dispara onChange no mount', () => {
    const onChange = vi.fn();
    render(<PaginaRichTextEditor doc={{ type: 'doc', content: [] }} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renderiza a barra fixa com os 10 controles do plano, cada um com nome acessível', () => {
    render(<PaginaRichTextEditor doc={{ type: 'doc', content: [] }} onChange={vi.fn()} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Formatação do texto' });
    const labels = [
      'Negrito',
      'Itálico',
      'Sublinhado',
      'Título 2',
      'Título 3',
      'Lista com marcadores',
      'Lista numerada',
      'Citação',
      'Link',
      'Destacar',
    ];
    for (const label of labels) {
      expect(screen.getByRole('button', { name: label, hidden: false })).toBeInTheDocument();
    }
    // Nenhum rótulo se repete dentro da barra fixa -- cada controle tem nome único.
    const toolbarButtons = toolbar.querySelectorAll('button[aria-label]');
    const toolbarLabels = Array.from(toolbarButtons).map((b) => b.getAttribute('aria-label'));
    expect(new Set(toolbarLabels).size).toBe(toolbarLabels.length);
  });

  it('não expõe nenhum controle de imagem -- fora de escopo deste editor', () => {
    render(<PaginaRichTextEditor doc={{ type: 'doc', content: [] }} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /imagem/i })).not.toBeInTheDocument();
  });

  it('negrito na barra fixa alterna o marcador e reflete no JSON emitido', async () => {
    const onChange = vi.fn();
    render(
      <PaginaRichTextEditor
        doc={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'abc' }] }],
        }}
        onChange={onChange}
      />,
    );
    const textbox = screen.getByRole('textbox');
    await userEvent.click(textbox);
    // seleciona todo o texto do parágrafo antes de aplicar a marca
    await userEvent.keyboard('{Control>}a{/Control}');
    await userEvent.click(screen.getByRole('button', { name: 'Negrito' }));

    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0] as {
      content: { content: { marks?: { type: string }[] }[] }[];
    };
    const marks = last.content[0]?.content[0]?.marks ?? [];
    expect(marks.some((m) => m.type === 'bold')).toBe(true);
  });

  it('abre o popover de link com a barra fixa e aplica o href', async () => {
    render(
      <PaginaRichTextEditor
        doc={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'abc' }] }],
        }}
        onChange={vi.fn()}
      />,
    );
    const textbox = screen.getByRole('textbox');
    await userEvent.click(textbox);
    await userEvent.keyboard('{Control>}a{/Control}');
    const toolbar = screen.getByRole('toolbar', { name: 'Formatação do texto' });
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Link' }).find((b) => toolbar.contains(b))!,
    );
    const input = screen.getByLabelText('Endereço do link');
    await userEvent.type(input, 'https://mesaas.com.br');
    await userEvent.keyboard('{Enter}');
    expect(textbox.querySelector('a[href="https://mesaas.com.br"]')).not.toBeNull();
  });
});

// Compartilhado entre os blocos de política de link abaixo: abre o popover de link
// pela barra fixa, digita `href` e confirma com Enter -- exatamente o fluxo real do
// usuário, não a política isolada.
async function applyLinkViaToolbar(href: string) {
  render(
    <PaginaRichTextEditor
      doc={{
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'abc' }] }],
      }}
      onChange={vi.fn()}
    />,
  );
  const textbox = screen.getByRole('textbox');
  await userEvent.click(textbox);
  await userEvent.keyboard('{Control>}a{/Control}');
  const toolbar = screen.getByRole('toolbar', { name: 'Formatação do texto' });
  await userEvent.click(
    screen.getAllByRole('button', { name: 'Link' }).find((b) => toolbar.contains(b))!,
  );
  const input = screen.getByLabelText('Endereço do link');
  await userEvent.type(input, href);
  await userEvent.keyboard('{Enter}');
  return textbox;
}

describe('política de link do editor (Finding 1, fix round 2)', () => {
  // A mesma política que o Hub aplica na leitura (isAllowedRichTextLinkUrl,
  // @mesaas/link-policy) agora também roda aqui na escrita -- sem isso este editor
  // podia persistir um link que o Hub recusa a renderizar, um beco sem saída
  // silencioso. TipTap's `setLink` command já checa `isAllowedUri` e vira NO-OP
  // (marca não aplicada) quando ela recusa -- diferente do lado de leitura, que
  // aplica a marca e só esvazia o `href` ao renderizar.
  it.each([['mailto:contato@exemplo.com'], ['tel:+5511999999999']])(
    'aplica o link %s (autolink de e-mail digitado não pode virar link morto no Hub)',
    async (href) => {
      const textbox = await applyLinkViaToolbar(href);
      expect(textbox.querySelector(`a[href="${href}"]`)).not.toBeNull();
    },
  );

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['ftp://example.com/segredo'],
    ['https://user:senha@example.com'],
    ['/pagina-interna'],
    ['#ancora'],
  ])('recusa o link %s -- nenhuma marca é aplicada', async (href) => {
    const textbox = await applyLinkViaToolbar(href);
    expect(textbox.querySelector('a')).toBeNull();
  });
});

describe('normalização de href do popover de link (Finding, fix round 4)', () => {
  // Round 3 fez a política resolver o candidato sem esquema APENAS para decidir
  // sim/não (isAllowedUri) -- ela nunca reescrevia o que `setLink` de fato persiste.
  // Digitar "mesaas.com.br" no popover e confirmar aplicava a marca (a checagem
  // passava, porque internamente resolvia para https:// só pra validar) mas gravava
  // o href CRU "mesaas.com.br", que o Hub recusa a renderizar (`href=""`). Estes
  // testes dirigem o popover de verdade e leem o `href` do `<a>` resultante --
  // exatamente a classe de regressão que passaria batido numa checagem só da função
  // de política isolada.
  it.each([
    ['mesaas.com.br', 'https://mesaas.com.br'],
    ['www.exemplo.com', 'https://www.exemplo.com'],
    ['exemplo.com/pagina', 'https://exemplo.com/pagina'],
    ['contato@exemplo.com', 'mailto:contato@exemplo.com'],
    ['https://exemplo.com', 'https://exemplo.com'],
  ])(
    'digitar %s no popover grava o href normalizado %s, e esse href sobrevive à política de leitura do Hub',
    async (typed, expectedHref) => {
      const textbox = await applyLinkViaToolbar(typed);
      const anchor = textbox.querySelector('a');
      expect(anchor).not.toBeNull();
      expect(anchor?.getAttribute('href')).toBe(expectedHref);
      expect(isAllowedRichTextLinkUrl(anchor!.getAttribute('href'))).toBe(true);
    },
  );

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['ftp://exemplo.com/segredo'],
    ['https://user:pass@exemplo.com'],
    ['/pagina-interna'],
    ['#ancora'],
  ])('recusa %s pelo popover e avisa o usuário (não fica em silêncio)', async (typed) => {
    const textbox = await applyLinkViaToolbar(typed);
    expect(textbox.querySelector('a')).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      'Não foi possível aplicar o link. Use um endereço válido (http, https, e-mail ou telefone).',
    );
  });
});

describe('autolink ao digitar (Finding 1, fix round 3)', () => {
  // Regressão do fix round 2: TipTap's autolink plugin valida o TEXTO DIGITADO CRU do
  // candidato a link, nunca o href que ele está prestes a atribuir à marca
  // (@tiptap/extension-link's `autolink()` helper filtra em `link.value`, só usa
  // `link.href` ao criar a marca). Passar `isAllowedRichTextLinkUrl` direto como
  // `isAllowedUri` rejeitava todo candidato sem esquema -- "contato@exemplo.com" e
  // "www.exemplo.com" nunca chegavam nem perto da lista de esquemas permitidos --
  // trocando "link morto" por "nenhum link", exatamente o cenário que a política
  // deveria evitar. Estes testes digitam de verdade (não chamam a política isolada)
  // porque foi assim que a regressão escapou da rodada anterior.
  it('digitar um e-mail seguido de espaço vira link mailto: de verdade', async () => {
    render(<PaginaRichTextEditor doc={{ type: 'doc', content: [] }} onChange={vi.fn()} />);
    const textbox = screen.getByRole('textbox');
    await userEvent.click(textbox);
    await userEvent.type(textbox, 'contato@exemplo.com ');
    expect(textbox.querySelector('a[href="mailto:contato@exemplo.com"]')).not.toBeNull();
  });

  it('digitar um domínio nu seguido de espaço vira link http(s) de verdade', async () => {
    render(<PaginaRichTextEditor doc={{ type: 'doc', content: [] }} onChange={vi.fn()} />);
    const textbox = screen.getByRole('textbox');
    await userEvent.click(textbox);
    await userEvent.type(textbox, 'www.exemplo.com ');
    const anchor = textbox.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toBe('http://www.exemplo.com');
  });

  it('digitar uma URL completa com esquema continua virando link (baseline preservado)', async () => {
    render(<PaginaRichTextEditor doc={{ type: 'doc', content: [] }} onChange={vi.fn()} />);
    const textbox = screen.getByRole('textbox');
    await userEvent.click(textbox);
    await userEvent.type(textbox, 'https://exemplo.com ');
    expect(textbox.querySelector('a[href="https://exemplo.com"]')).not.toBeNull();
  });

  it('digitar um caminho relativo seguido de espaço não vira link', async () => {
    render(<PaginaRichTextEditor doc={{ type: 'doc', content: [] }} onChange={vi.fn()} />);
    const textbox = screen.getByRole('textbox');
    await userEvent.click(textbox);
    await userEvent.type(textbox, '/pagina-interna ');
    expect(textbox.querySelector('a')).toBeNull();
  });
});
