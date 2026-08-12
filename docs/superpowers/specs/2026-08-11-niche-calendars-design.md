# Calendários de nicho: expandir "Datas Médicas" para múltiplos verticais

Data: 2026-08-11 · Status: aprovado (brainstorm validado com o usuário)

## Problema

`/calendario` hoje tem uma aba "Datas Médicas" com ~163 datas de saúde/consciência
hardcoded em `medicalData`
([CalendarioPage.tsx:45-813](../../apps/crm/src/pages/calendario/CalendarioPage.tsx#L45-L813)),
pensada para agências que atendem clientes médicos. Agências que atendem outros
nichos (jurídico, varejo, beleza & estética, gastronomia...) não têm equivalente —
a página só serve quem trabalha com saúde. O objetivo é generalizar essa aba num
seletor de calendários por nicho, mantendo a mesma utilidade (achar oportunidades
editoriais por mês/categoria, conforme já documentado no artigo da KB
`usando-o-calendario-para-financas-prazos-e-datas-importantes`).

## Decisões de produto

- **Sem vínculo com cliente.** Ferramenta de referência global — a pessoa escolhe
  manualmente qual calendário de nicho ver. Não usa `Cliente.especialidade`
  (texto livre, sem padronização confiável), não propõe nicho automaticamente.
- **5 nichos no v1**: Médico (já existe, conteúdo inalterado), Jurídico, Varejo,
  Beleza & Estética, Gastronomia. Mesma densidade do médico — ~150+ datas/ano por
  nicho novo (datas nacionais, mundiais, profissões do setor, semanas/meses
  temáticos), não uma lista enxuta só com as datas óbvias.
- **Sem banco de dados.** Continua hardcoded no frontend, mesmo padrão de hoje —
  ninguém pediu edição em runtime nem admin UI; criar tabela+RLS+CRUD pra uma
  lista que muda uma vez por ano seria over-engineering.
- **Título da aba**: "Datas Comemorativas" (renomeando a atual "Datas Médicas").
  O `<h1>` da página continua mostrando o título específico do nicho ativo (hoje
  mostra "Calendário Médico" fixo quando a aba médica está ativa — no v2
  generalizado isso passa a vir do registro do nicho selecionado).
- **Última escolha de nicho é lembrada** via localStorage (preferência de UI
  global, não por cliente) — reabre no último nicho visto; primeira visita
  default = Médico, preservando o comportamento atual.

## Arquitetura

### Dados: um arquivo por nicho, registro central

Extrair `medicalData` e criar os 4 novos datasets em
`apps/crm/src/pages/calendario/nicheCalendars/`:

```
nicheCalendars/
  types.ts          # NicheEvent, NicheMonth, NicheCalendarDef, NicheEventType
  medico.ts         # medicalData movido, sem mudar conteúdo — exporta medicoDef
  juridico.ts
  varejo.ts
  belezaEstetica.ts
  gastronomia.ts
  registry.ts        # NICHE_CALENDARS: NicheCalendarDef[] — ordem: médico, jurídico, varejo, beleza & estética, gastronomia
```

Cada arquivo de nicho exporta um único `NicheCalendarDef`:

```ts
interface NicheCalendarDef {
  key: string; // 'medico' | 'juridico' | 'varejo' | 'beleza-estetica' | 'gastronomia'
  label: string; // rótulo curto no seletor, ex: 'Beleza & Estética'
  title: string; // <h1>, ex: 'Calendário de Beleza & Estética'
  subtitle: string; // ex: 'Brasil & Mundial — Datas de Beleza & Bem-estar'
  data: NicheMonth[]; // mesmo shape de hoje: { month, num, badge?, events: NicheEvent[] }
  filterLabels: Record<string, string>; // tags específicas do nicho → rótulo do chip (ex: { cancer: 'Câncer', cardio: 'Cardiologia' })
}
```

`NicheEvent` e `NicheMonth` mantêm o shape atual de `medicalData` (`date` como
string livre — já lida com dia único, intervalo, "Último dom.", mês inteiro;
`type: 'br'|'world'|'prof'|'week'|'month'`; `tags: string[]`). `dotColorMap`
(hoje linha 815) é compartilhado entre todos os nichos — as 5 cores representam
categorias universais (Brasil/Mundial/Profissional/Semana/Mês), não precisa
variar por nicho. Fica em `types.ts` ou `registry.ts`.

Adicionar um 6º nicho no futuro = 1 arquivo de dado + 1 linha no `registry.ts`,
zero mudança em `CalendarioPage.tsx` ou no componente de render.

### Filtros: universais + específicos do nicho

Os chips de filtro hoje são uma lista fixa pensada só pro médico (`all`, `br`,
`world`, `prof`, `cancer`, `cardio`, `saude-mental`, `infeccao` —
[CalendarioPage.tsx:1312-1335](../../apps/crm/src/pages/calendario/CalendarioPage.tsx#L1312-L1335)).
Isso não generaliza (`cardio` não tem nenhum evento com essa tag hoje — bug
preexistente que a extração já corrige por construção). Novo modelo:

- 4 chips universais fixos no componente: `Todos`, `Brasil` (ícone `Flag`),
  `Mundial` (ícone `Globe`), `Profissional` — presentes em todo nicho.
- Chips adicionais vêm de `filterLabels` do nicho ativo, na ordem em que
  aparecem no objeto (ex: médico continua com Câncer/Cardiologia/Saúde
  Mental/Infecção; jurídico teria algo como Trabalhista/Cível/Criminal/
  Tributário/Consumidor; varejo Black Friday/Sazonal/Consumidor; etc. — a lista
  exata fica a critério de quem cura cada dataset).
- Trocar de nicho reseta `activeFilter` pra `'all'` e limpa `searchTerm`.

### Componente: `MedicoCalendar` → `NicheCalendar`

Generaliza o componente atual (linhas
[1308-1462](../../apps/crm/src/pages/calendario/CalendarioPage.tsx#L1308-L1462))
pra receber o `NicheCalendarDef` ativo em vez de ler `medicalData` fixo. Um
`Select` (shadcn, já existe em `components/ui/select.tsx`) acima da barra de
filtros troca entre os 5 nichos, usando `label` de cada `NicheCalendarDef`.
`CalendarioPage` guarda `activeNiche` em state, inicializado a partir do
localStorage (chave `mesaas:calendario:ultimoNicho`, fallback `'medico'`),
persiste a cada troca.

Estrutura de tabs no topo não muda de forma (dois tabs — `calendar-tabs`), só o
rótulo do segundo: `Calendário` | `Datas Comemorativas`. O `<h1>` e subtítulo
(hoje hardcoded pra "Calendário Médico" /
"Brasil & Mundial — Datas de Saúde & Conscientização" — linhas 1537-1541) passam
a vir de `title`/`subtitle` do `NicheCalendarDef` ativo quando a aba de datas
comemorativas está selecionada.

### CSS: renomear `.med-*` → `.niche-*`

As classes em `style.css` (`.med-controls`, `.med-count`, `.med-legend*`,
`.med-grid`, `.med-month-*`, `.med-event-*` — linhas ~4033-4173) são só nomes,
sem semântica médica real. Como agora servem 5 nichos, renomear pra `.niche-*`
evita confusão futura ("por que o calendário jurídico usa uma classe `med-`?").
Rename mecânico, sem mudança visual — find/replace no CSS e no componente.

### Curadoria de conteúdo

As ~150+ datas de cada nicho novo (Jurídico, Varejo, Beleza & Estética,
Gastronomia) são redigidas como parte da implementação, seguindo o padrão do
médico: datas nacionais e mundiais do setor, profissões correlatas, semanas/
meses temáticos. Datas menos óbvias (nomenclatura oficial, se é "dia" nacional
vs. internacional, etc.) são checadas via pesquisa web em vez de só memória,
por serem específicas do calendário brasileiro.

## Testes

- **Integridade de dados**: um teste que itera `NICHE_CALENDARS` e valida, pra
  cada nicho, que existem os 12 meses, todo `event.type` é um
  `NicheEventType` válido (well-typed já ajuda, mas o teste pega erro de
  digitação em arrays literais), e todo `event.tags` é não-vazio. Roda contra
  os 5 datasets automaticamente — pega erros de curadoria (~750 entradas ao
  todo) sem precisar revisar cada linha manualmente.
- **Componente**: teste leve de `NicheCalendar`/`CalendarioPage` cobrindo troca
  de nicho no `Select` (conteúdo do nicho anterior some, do novo aparece,
  filtro/busca resetam) e persistência em localStorage entre remounts.

## Fora de escopo

- Vínculo com cliente ou sugestão automática por `especialidade`.
- Tabela no banco, RLS, admin UI de edição.
- Mudanças na aba Financeiro além do rename do tab vizinho.
- Nichos além dos 5 listados (Educação, Imobiliário, Pet, etc. ficam pra uma
  iteração futura, mesma arquitetura de registro suporta adicionar sem
  refactor).
