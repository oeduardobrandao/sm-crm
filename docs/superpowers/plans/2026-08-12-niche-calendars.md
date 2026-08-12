# Calendários de nicho — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status: já implementado nesta sessão** (não via dispatch task-a-task — o escopo era pequeno o
> suficiente na parte de arquitetura e pesado o suficiente na parte de curadoria de conteúdo que
> a implementação direta + verificação contínua foi mais eficiente que fragmentar em subagents).
> Este documento registra a decomposição como construída, para referência futura — cada task abaixo
> já está `[x]`.

**Goal:** Generalizar a aba "Datas Médicas" de `/calendario` num seletor de 5 calendários de
nicho (Médico, Jurídico, Varejo, Beleza & Estética, Gastronomia), sem vínculo com cliente.

**Architecture:** Dados de cada nicho viram um arquivo próprio em `nicheCalendars/`, todos
seguindo o mesmo shape (`NicheCalendarDef`). Um registro central (`registry.ts`) lista os 5 e
expõe helpers de persistência (localStorage, best-effort). O componente `MedicoCalendar` vira
`NicheCalendar`, parametrizado por `niche: NicheCalendarDef` em vez de ler um array fixo.

**Tech Stack:** React 19 + TypeScript, shadcn `Select`, Vitest + Testing Library.

## Global Constraints

- Sem tabela no banco, sem admin UI — dados hardcoded no frontend, mesmo padrão do médico.
- Sem vínculo com cliente/`especialidade` — troca 100% manual.
- Datas móveis (Black Friday, Páscoa, Carnaval, "2º domingo", etc.) usam rótulo relativo, nunca
  data absoluta de um ano específico.
- Toda tag niche-specific usada em `event.tags` precisa de entrada em `filterLabels`, e vice-versa
  (nenhuma tag órfã, nenhum chip morto) — `week`/`month` são exceção universal (sem chip).
- localStorage de preferência é best-effort: try/catch, valor lido só aceito se bater com um `key`
  presente no registro, fallback `'medico'` caso contrário.

---

### Task 1: Tipos compartilhados e extração do dataset médico

**Files:**

- Create: `apps/crm/src/pages/calendario/nicheCalendars/types.ts`
- Create: `apps/crm/src/pages/calendario/nicheCalendars/medico.ts`
- Modify: `apps/crm/src/pages/calendario/CalendarioPage.tsx` (remove `medicalData`/`dotColorMap`,
  linhas 45–821 do arquivo original)

**Interfaces:**

- Produces: `NicheEventType`, `NicheEvent`, `NicheMonth`, `NicheCalendarDef`, `dotColorMap`
  (`types.ts`); `medicoDef: NicheCalendarDef` (`medico.ts`)

- [x] **Step 1:** Criar `types.ts` com `NicheEventType`, `NicheEvent`, `NicheMonth`,
      `NicheCalendarDef` e `dotColorMap` (mesmas 5 cores de hoje: br/world/prof/week/month).
- [x] **Step 2:** Cortar o array `medicalData` (linhas 45–812 do `CalendarioPage.tsx` original) e
      colar como `data:` de `medicoDef` em `medico.ts`, sem alterar nenhum evento. `filterLabels`
      de médico = `{ cancer: 'Câncer', cardio: 'Cardiologia', 'saude-mental': 'Saúde Mental',
      infeccao: 'Infecção' }` (as 4 categorias que já existiam como chips fixos).
- [x] **Step 3:** Remover o bloco antigo de `CalendarioPage.tsx`.
- [x] **Step 4:** `npx tsc -p apps/crm/tsconfig.json --noEmit` — 0 erros.

### Task 2: Registro central + persistência de preferência

**Files:**

- Create: `apps/crm/src/pages/calendario/nicheCalendars/registry.ts`
- Test: `apps/crm/src/pages/calendario/nicheCalendars/__tests__/registry.test.ts`

**Interfaces:**

- Consumes: `NicheCalendarDef` (Task 1), `medicoDef`/`juridicoDef`/`varejoDef`/
  `belezaEsteticaDef`/`gastronomiaDef` (Task 1 e Task 4)
- Produces: `NICHE_CALENDARS: NicheCalendarDef[]`, `NICHE_STORAGE_KEY`, `DEFAULT_NICHE_KEY`,
  `readStoredNicheKey(validKeys, fallback): string`, `writeStoredNicheKey(key): void`

- [x] **Step 1:** Escrever `registry.test.ts` cobrindo: as 5 chaves exatas em ordem; sem chave
      duplicada; 12 meses únicos 01–12 por nicho; todo `type` válido e `tags` não-vazio; invariante
      de filtro nos dois sentidos (tag órfã / chip morto); e os 6 casos de
      `readStoredNicheKey`/`writeStoredNicheKey` (fallback, valor válido, valor inválido, storage
      lançando exceção em getItem/setItem — via `vi.spyOn(Storage.prototype, ...)`).
- [x] **Step 2:** Rodar — falha (módulo `registry.ts` não existe).
- [x] **Step 3:** Implementar `registry.ts` (`NICHE_CALENDARS` + os dois helpers, try/catch
      best-effort, mesmo padrão de `ColorPicker.tsx`'s `readRecentColors`/`pushRecentColor`).
- [x] **Step 4:** Rodar — 23/23 passam.
- [x] **Step 5:** Commit.

### Task 3: Generalizar o componente (`MedicoCalendar` → `NicheCalendar`) + Select + rename

**Files:**

- Modify: `apps/crm/src/pages/calendario/CalendarioPage.tsx`
- Modify: `apps/crm/style.css` (linhas 4033–4173: `.med-*` → `.niche-*`)
- Test: `apps/crm/src/pages/calendario/__tests__/CalendarioPage.test.tsx`

**Interfaces:**

- Consumes: `NICHE_CALENDARS`, `DEFAULT_NICHE_KEY`, `readStoredNicheKey`, `writeStoredNicheKey`
  (Task 2), `dotColorMap`, `NicheCalendarDef` (Task 1)

- [x] **Step 1:** Escrever `CalendarioPage.test.tsx` mockando `nicheCalendars/registry` com 2
      fixtures mínimas (não os dados reais — desacopla o teste de componente da curadoria de
      conteúdo). Cobre: troca de nicho no `Select` mostra/esconde o conteúdo certo; título/subtítulo
      seguem o nicho ativo; última escolha sobrevive a um remount (localStorage real, não mockado);
      filtro e busca resetam ao trocar de nicho.
- [x] **Step 2:** Rodar — falha (`Select` inexistente no page, `MedicoCalendar` não aceita prop).
- [x] **Step 3:** Implementar: renomear `MedicoCalendar` → `NicheCalendar({ niche })`, derivar
      `filterOptions` de `niche.filterLabels`, `useEffect` resetando filtro/busca em `niche.key`;
      em `CalendarioPage`, `activeNicheKey` inicializado via `readStoredNicheKey`, `Select` com uma
      `SelectItem` por `NICHE_CALENDARS`, tab renomeado para "Datas Comemorativas", `<h1>`/subtítulo
      vindo de `activeNiche.title`/`.subtitle`.
- [x] **Step 4:** Renomear `.med-*` → `.niche-*` em `style.css` (mecânico, mesmo range de linhas).
- [x] **Step 5:** Rodar — 3/3 passam. `npx tsc` limpo.
- [x] **Step 6:** Commit.

### Task 4: Datasets dos 4 nichos novos

**Files:**

- Create: `apps/crm/src/pages/calendario/nicheCalendars/juridico.ts`
- Create: `apps/crm/src/pages/calendario/nicheCalendars/varejo.ts`
- Create: `apps/crm/src/pages/calendario/nicheCalendars/belezaEstetica.ts`
- Create: `apps/crm/src/pages/calendario/nicheCalendars/gastronomia.ts`
- Modify: `apps/crm/src/pages/calendario/nicheCalendars/registry.ts` (import + append ao array)

**Interfaces:**

- Produces: `juridicoDef`, `varejoDef`, `belezaEsteticaDef`, `gastronomiaDef: NicheCalendarDef`

- [x] Cada dataset pesquisado com WebSearch para datas não-óbvias (comentário `// fonte:` inline),
      convenção de data relativa para tudo que se move ano a ano, `filterLabels` com 4–7 categorias
      próprias do nicho.
- [x] `registry.test.ts` passa para os 5 (sem precisar editar o teste — ele já era genérico).
- [x] `npx tsc`, `npm run lint`, `npm run test`, `npm run format:check` — todos limpos.
- [x] Commit.

**Resultado real vs. meta da spec — divergência assumida:** a spec pedia "mesma densidade do
médico" (~150+/nicho). Nenhum dos 4 chegou lá: Jurídico 77, Varejo 62, Beleza & Estética 45,
Gastronomia 94. Causa: medicina tem uma camada de campanhas de conscientização (OMS/Ministério da
Saúde) sem equivalente nos outros verticais — o resto do volume em listas públicas era
SEO-aggregator sem fonte confiável, e a regra da própria spec ("se não dá pra confirmar, não
inclui") descartou esse enchimento. Prefiri menos itens verificados a mais itens duvidosos;
sinalizado ao usuário para decidir se vale um segundo passe de pesquisa.

### Task 5: Verificação final

- [x] `npx tsc -p apps/crm/tsconfig.json|apps/hub/tsconfig.json|apps/admin/tsconfig.json|tsconfig.scripts.json --noEmit` — limpos.
- [x] `npm run lint` — 0 erros (79 warnings pré-existentes, nenhum nos arquivos tocados).
- [x] `npm run test` — 337 arquivos / 2978 testes passam.
- [x] `npm run test:functions` — 1438 testes Deno passam (não relacionado, checado por completude).
- [x] `npm run format:check` — limpo.
- [x] Verificação visual no browser (staging session, conta de teste): troca de nicho, filtro por
      tag niche-specific, reset de filtro/busca ao trocar, dark mode, Black Friday renderizando
      como "Últ. sex." — todos corretos.
