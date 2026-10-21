# Links úteis do cliente

Data: 2026-09-19

## Objetivo

Na aba "Visão geral" do cliente (`/clientes/:id`), uma seção "Links úteis" onde o
usuário salva links como a pasta do Google Drive, o Notion ou o Figma do cliente, com
título, URL e uma descrição opcional.

## Posição

`VisaoGeralTab` passa a renderizar, nesta ordem: card de informações, **Links úteis**,
Datas importantes, Endereços.

## Dados

Tabela `public.cliente_links`, no padrão de `cliente_enderecos`:

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | `bigint` identity PK | |
| `cliente_id` | `bigint` NOT NULL | FK `clientes(id)` ON DELETE CASCADE |
| `conta_id` | `uuid` NOT NULL | FK `workspaces(id)` ON DELETE CASCADE |
| `titulo` | `text` NOT NULL | 1 a 120 caracteres |
| `url` | `text` NOT NULL | http(s) apenas, até 2048 caracteres |
| `descricao` | `text` | opcional, até 300 caracteres |
| `created_at`, `updated_at` | `timestamptz` | default `now()` |

Índices em `cliente_id` e `conta_id`. RLS ligado, com políticas para authenticated:

- SELECT e DELETE: `conta_id` em `workspace_members` do usuário e em `get_my_conta_id()`.
- INSERT e UPDATE (WITH CHECK): o mesmo predicado, mais
  `EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = cliente_links.cliente_id AND c.conta_id = cliente_links.conta_id)`.
  Isso impede apontar para cliente de outro workspace (correção
  `20260728000004`), então já nasce com o conjunto final.
- Grants explícitos por role (sem depender de `PUBLIC`).
- CHECK no banco espelhando os limites de tamanho e o esquema http(s) da URL.

Migration nova em `supabase/migrations/` com versão acima da cauda de `main`
(`20260925000015`), sem colisão de prefixo.

## Store (`apps/crm/src/store/clients.ts`)

`ClienteLink` e `getClienteLinks`, `addClienteLink`, `updateClienteLink`,
`removeClienteLink`, no mesmo formato das funções de endereços. Ordenação
`created_at desc`. Exportadas por `store/index.ts`.

## UI

`pages/cliente-detalhe/components/ClienteLinksSection.tsx`, com query própria
`['clienteLinks', clienteId]`.

- Lista: título, descrição (se houver) e domínio. O item inteiro é um link com
  `href={sanitizeUrl(url)}`, `target="_blank"` e `rel="noopener noreferrer"`.
- "Adicionar link" abre um Dialog (título, URL, descrição), com `react-hook-form` + `zod`.
- Editar e excluir por item. Excluir passa por AlertDialog.
- Estado vazio com texto curto e o botão de adicionar.
- URL sem protocolo ganha `https://` antes da validação; só http/https é aceito.
  Helper puro `normalizeLinkUrl` em arquivo próprio para ser testado isolado.
- Erros via `toast.error` (sonner). Sem travessão nos textos.
- Textos no namespace i18n `clients`, em pt-BR, e nas demais línguas que o namespace já cobre.
- Sem gate de permissão próprio: herda `clientes:ver` da rota, como Endereços.
- Editor em Dialog com `confirmClose`, então já está coberto pelo aviso de trabalho não salvo.

## Testes

- Vitest do componente: lista, vazio, adicionar, editar, excluir, URL inválida, `https://` automático.
- Vitest de `normalizeLinkUrl`.
- Suíte psql em `supabase/tests/entitlements/` para o isolamento entre workspaces
  (SELECT, INSERT com `cliente_id` de outro workspace, UPDATE re-apontando `cliente_id`, DELETE).
- Verificação no navegador (desktop e mobile) antes de concluir.

## Fora do escopo

Ordenação manual, categorias/ícones por serviço, exposição no Hub, validação de que o
link está acessível.
