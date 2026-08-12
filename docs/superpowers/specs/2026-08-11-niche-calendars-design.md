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
  Beleza & Estética, Gastronomia. Alvo original era mesma densidade do médico
  (~150+ datas/ano); densidade real ficou abaixo disso — Jurídico 77, Varejo 62,
  Beleza & Estética 45, Gastronomia 94 — e esse número final é o aceito, não uma
  lacuna a fechar. Médico chega a ~163 por ter uma camada de campanhas oficiais
  de conscientização (OMS/Ministério da Saúde) sem equivalente nos outros
  setores; o resto do que existe em listas públicas de "datas comemorativas"
  para jurídico/varejo/beleza/gastronomia é ruído de agregador SEO sem fonte
  verificável ou com datas conflitantes entre sites. A regra de rastreabilidade
  abaixo (confirmar via pesquisa ou descartar) tem prioridade sobre bater o
  número — cada nicho novo teve suas datas checadas e o que não foi possível
  confirmar como real ficou de fora, mesmo custando densidade.
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
[CalendarioPage.tsx:1312-1335](../../apps/crm/src/pages/calendario/CalendarioPage.tsx#L1312-L1335)),
todos com pelo menos um evento correspondente hoje (checado por contagem —
`cardio` tem 9). Isso não generaliza pra outros nichos porque a lista é
hardcoded pro vocabulário médico. Novo modelo:

- O filtro sempre casa contra `event.tags`, nunca contra `event.type`
  ([CalendarioPage.tsx:1338](../../apps/crm/src/pages/calendario/CalendarioPage.tsx#L1338)) —
  são campos independentes hoje (`type` só escolhe a cor do dot/legenda;
  `tags` é quem alimenta busca e chips) e a extração preserva essa separação.
  Um evento pode ser `type: 'prof'` e ainda carregar `tags: ['br', 'prof']`.
- 4 chips universais fixos no componente: `Todos`, `Brasil` (ícone `Flag`,
  tag `br`), `Mundial` (ícone `Globe`, tag `world`), `Profissional` (tag
  `prof`) — presentes em todo nicho, casando contra essas 3 tags fixas.
- Chips adicionais vêm de `filterLabels` do nicho ativo, na ordem em que
  aparecem no objeto (ex: médico continua com Câncer/Cardiologia/Saúde
  Mental/Infecção; jurídico teria algo como Trabalhista/Cível/Criminal/
  Tributário/Consumidor; varejo Black Friday/Sazonal/Consumidor; etc. — a lista
  exata fica a critério de quem cura cada dataset).
- **Invariante obrigatório**: toda tag em `event.tags` que não seja `br`,
  `world` ou `prof` PRECISA ter uma entrada em `filterLabels` do mesmo nicho —
  senão vira uma tag órfã (existe no dado, sem chip pra alcançá-la, achável só
  via busca por texto). E o inverso: toda chave de `filterLabels` precisa
  aparecer em pelo menos um evento — senão é um chip morto que nunca filtra
  nada. `type: 'week'`/`'month'` não tem chip dedicado hoje (só afeta a cor do
  dot/legenda) — os novos nichos seguem essa mesma convenção, a menos que o
  autor do dataset também dê a esses eventos uma tag com `filterLabels`
  correspondente.
- Trocar de nicho reseta `activeFilter` pra `'all'` e limpa `searchTerm`.

### Componente: `MedicoCalendar` → `NicheCalendar`

Generaliza o componente atual (linhas
[1308-1462](../../apps/crm/src/pages/calendario/CalendarioPage.tsx#L1308-L1462))
pra receber o `NicheCalendarDef` ativo em vez de ler `medicalData` fixo. Um
`Select` (shadcn, já existe em `components/ui/select.tsx`) acima da barra de
filtros troca entre os 5 nichos, usando `label` de cada `NicheCalendarDef`.
`CalendarioPage` guarda `activeNiche` em state, inicializado a partir do
localStorage (chave `mesaas:calendario:ultimoNicho`).

O valor lido do localStorage é **não confiável** (pode estar corrompido, vazio,
ou referenciar um `key` de um nicho removido numa versão futura) — mesmo
padrão já usado em `readRecentColors`/`pushRecentColor`
([ColorPicker.tsx:25-46](../../apps/crm/src/components/shared/ColorPicker.tsx#L25-L46)):
leitura e escrita em `try/catch` (best-effort — quota/modo privado nunca
quebram a página), e o valor lido só é aceito se bater com um `key` presente
em `NICHE_CALENDARS`; qualquer outra coisa cai no fallback `'medico'`.

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

As datas de cada nicho novo (Jurídico, Varejo, Beleza & Estética, Gastronomia)
são redigidas como parte da implementação, seguindo o padrão do médico: datas
nacionais e mundiais do setor, profissões correlatas, semanas/meses temáticos —
mirando ~150+ por nicho, mas sem inflar a lista além do que dá pra confirmar
(ver "Resultado real" nas Decisões de produto). Datas menos óbvias (nomenclatura
oficial, se é "dia" nacional vs. internacional, etc.) são checadas via pesquisa
web em vez de só memória, por serem específicas do calendário brasileiro.

**Datas móveis** (Black Friday, período de Carnaval/Páscoa, "semana do
consumidor", etc.) não entram como data fixa de um ano específico — `date` é
renderizado como texto livre
([CalendarioPage.tsx:1447](../../apps/crm/src/pages/calendario/CalendarioPage.tsx#L1447)),
então um valor tipo `'28/11'` fica silenciosamente errado no ano seguinte. O
próprio `medicalData` já resolve isso com rótulos relativos —
`'Último dom.'`, `'2ª qui.'`, `'Penúlt. sáb.'`, ou só o nome do mês
(`'Abril'`) quando o evento é o mês inteiro. Os 4 datasets novos seguem a
mesma convenção pra qualquer data que se mova ano a ano: nunca uma data
absoluta de um ano específico.

**Rastreabilidade**: datas óbvias/amplamente conhecidas (Black Friday, Dia do
Advogado, Dia das Mães) não precisam de fonte. Datas menos óbvias — nome
oficial exato, se é dia nacional vs. mundial, existência mesmo do dia —
carregam a fonte usada como comentário inline no dado, pra revisão pontual não
depender de confiar cegamente em ~600 afirmações.

**Entrega em fases**: o refactor de arquitetura (extrair `medicalData` sem
mudar conteúdo, generalizar componente, `Select`, testes de integridade) é
uma mudança comportamentalmente neutra e pequena — revisável isoladamente. Os
4 datasets novos (conteúdo factual, não lógica) são cada um um incremento
separado por cima dessa base, não uma squash junto do refactor — evita um
diff único gigante misturando "mudei como o código funciona" com "afirmo que
essas 600 datas existem e estão certas".

## Testes

- **Integridade de dados**: um teste que valida, contra `NICHE_CALENDARS`:
  - as 5 chaves exatas, na ordem definida (médico, jurídico, varejo,
    beleza-estetica, gastronomia) — pega um nicho esquecido no registry ou uma
    chave renomeada sem atualizar o resto;
  - pra cada nicho, exatamente 12 meses com `num` únicos `'01'`–`'12'` (pega
    mês duplicado ou faltando, não só "tem 12 entradas" — 13 meses com um
    duplicado passaria nisso);
  - todo `event.type` é um `NicheEventType` válido e todo `event.tags` é
    não-vazio;
  - o invariante de filtro dos dois lados: toda tag fora de `br`/`world`/`prof`
    usada em algum evento do nicho tem entrada em `filterLabels`, e toda
    chave de `filterLabels` é usada por pelo menos um evento (nenhuma tag
    órfã, nenhum chip morto).

  Roda contra os 5 datasets automaticamente — pega erros de curadoria (~750
  entradas ao todo) sem precisar revisar cada linha manualmente.

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
