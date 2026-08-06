import { test, expect } from '@playwright/test';
import { installSafetyNet, assertNoViolations } from './safety';
import { shoot } from './capture';

// Capture spec for the help-center article "Como agendar seu primeiro post".
// Runs against the PRODUCTION DK TESTE workspace (conta_id
// e68bdbc3-baf0-4807-b905-0807ac4e0253), logged in as its owner.
//
// Seção 7 (agende a publicação, shots 29-32) foi OMITIDA DE PROPÓSITO: exige uma
// conta do Instagram apta a publicar, e as quatro contas do DK TESTE estão com
// authorization_status 'active' mas token_expires_at em 2026-06-12, o que faz a UI
// derivar `expired` e renderizar o botão Agendar desabilitado
// (WorkflowDrawer.tsx:266-274). Este arquivo cobre as seções 1-6 e 8: 26 capturas.
//
// PRÉ-REQUISITO, sem ele esta spec falha:
//
//   node --env-file=.env.kb-upload.local scripts/seed-kb-capture-fixtures.mjs --up --sem-secao-7
//
// As seções 5 e 6 fotografam posts que NÃO existem no DK TESTE por padrão. O
// workspace tem 2 posts no total e nenhum aprovado, então sem o seed a gaveta
// renderiza o estado vazio e os locators por título estouram em timeout. Rode o
// --down quando terminar: linhas de fixture não devem sobreviver ao seu propósito.
//
// Os ids dos posts mudam a cada seed, então nada aqui os referencia. A spec acha
// os posts pelo título, que é estável porque é definido no próprio script.

const SLUG = 'como-agendar-seu-primeiro-post';

// Studio Bem-Estar -- cliente com Instagram conectado (ainda que com o token
// expirado, o que é o próprio estado real hoje). Verificado ao vivo em 2026-08-06
// contra prod: /clientes/42 renderiza o cabeçalho "Studio Bem-Estar" e a seção
// #ig-container com o card `.instagram-overview__profile` preenchido.
const CLIENT_WITH_IG = 42;
// App Review - META TEST USER -- cliente sem nenhuma conta de Instagram conectada.
// Verificado ao vivo: #ig-container renderiza o card vazio com o botão
// #btn-ig-connect ("Conectar com o Instagram"), não o texto "Conectar Instagram"
// que o brief presumia -- a brief's regex /conectar instagram/i não bateria com o
// texto real do botão.
const CLIENT_WITHOUT_IG = 59;

// Campanha Antes/Depois (Studio Bem-Estar) -- fluxo parado em "Revisão Interna".
// Recebe os posts de fixture do seed e é usado nas seções 5 e 6.
// Verificado ao vivo: a gaveta abre via /entregas?drawer=48 independente da aba de
// template selecionada no board (a gaveta lê o id diretamente, sem depender do
// board estar filtrado nela).
const WORKFLOW_ID = 48;

test.describe.configure({ mode: 'serial' });

test('primeiro post walkthrough', async ({ page }) => {
  // This walkthrough covers substantially more ground than the other capture specs
  // (26 shots across 7 pages, a multi-step wizard, and two Kanban forward-etapa
  // flows), so the default 30s Playwright test timeout is too tight.
  test.setTimeout(180_000);

  // A rede de segurança entra antes de QUALQUER navegação. Nada nesta spec pode
  // alcançar a rede sem ser observado.
  const violations = await installSafetyNet(page);

  // NÃO existe aqui uma checagem de pré-requisito em runtime, e isso é uma
  // decisão, não um esquecimento. Uma sonda no início falhou de três formas
  // seguidas, cada uma custando uma execução real contra produção: a gaveta não
  // é role=dialog; um waitFor sem timeout herda o timeout de 180s do teste e
  // reproduz exatamente o erro opaco que a sonda queria substituir; e nem o deep
  // link `?drawer=` nem `.board-card` resolvem na PRIMEIRA navegação da execução,
  // porque os dois dependem de estado que a spec só acumula adiante. Replicar
  // isso no topo significa replicar a navegação inteira da spec, que é o que a
  // spec já faz.
  //
  // O aviso ficou onde tem custo zero e não pode quebrar: o cabeçalho deste
  // arquivo, com o comando exato. Sem o seed a falha aparece na seção 5, num
  // locator por título, e a explicação está a uma rolagem de distância.

  // ── Seção 1: cadastre o cliente ────────────────────────────────────────────
  // Capturas 2 a 4 são o FORMULÁRIO PREENCHIDO, nunca submetido. Nenhum cliente é
  // criado por esta spec: DialogContent aqui não recebe `confirmClose`
  // (ClientesPage.tsx:579), então Escape fecha direto, sem prompt de descarte --
  // verificado lendo components/ui/dialog.tsx (isDirty = confirmClose === true).
  // ClientesPage.tsx:442-447 renders a full-page Spinner while `isLoading` is
  // true, and the "Novo Cliente" button is unconditional page chrome above
  // that -- it is present even while the spinner is showing. Waiting on the
  // button alone can capture the spinner instead of the populated list.
  // `.team-card` (ClientesPage.tsx:452) only renders once `filtered` has been
  // computed from loaded data, and this page has no separate empty-state
  // branch, so its presence means real rows are on screen. Verified live
  // against prod on 2026-08-06 (CRM_BASE_URL=http://localhost:5174, DK TESTE):
  // the grid renders multiple real client cards under this class.
  await page.goto('/clientes');
  await page.getByRole('button', { name: /novo cliente/i }).waitFor();
  await page.locator('.team-card').first().waitFor();
  await shoot(page, SLUG, 1, 'abrir-clientes');

  await page.getByRole('button', { name: /novo cliente/i }).click();
  const nomeInput = page.getByLabel(/nome/i).first();
  await nomeInput.waitFor();
  await shoot(page, SLUG, 2, 'novo-cliente');

  await nomeInput.fill('Clínica Exemplo');
  await page
    .getByLabel(/e-?mail/i)
    .first()
    .fill('contato@clinicaexemplo.com.br');
  await page
    .getByLabel(/telefone/i)
    .first()
    .fill('71999990000');
  await shoot(page, SLUG, 3, 'preencher-dados');

  // Rótulo real (packages/i18n/locales/pt/clients.json): "Valor Mensal (R$)".
  await page
    .getByLabel(/valor mensal/i)
    .first()
    .scrollIntoViewIfNeeded();
  await page
    .getByLabel(/valor mensal/i)
    .first()
    .fill('1500');
  await shoot(page, SLUG, 4, 'plano-e-valores');

  await page.keyboard.press('Escape');

  // ── Seção 2: monte sua equipe ──────────────────────────────────────────────
  // Mesmo padrão: EquipePage.tsx:550 também não passa `confirmClose`, Escape
  // fecha direto.
  // Same recurring failure mode as shot 1: EquipePage.tsx:454-459 renders a
  // full-page Spinner while `isLoading` is true, above which "Adicionar
  // Membro" already sits as unconditional chrome. `.team-card`
  // (EquipePage.tsx:465) is the same shared-class row element used by
  // Clientes and only renders from loaded, non-empty `filtered` data.
  // Verified live against prod on 2026-08-06: the grid renders multiple real
  // team-member cards under this class.
  await page.goto('/equipe');
  await page
    .getByRole('button', { name: /adicionar membro/i })
    .first()
    .waitFor();
  await page.locator('.team-card').first().waitFor();
  await shoot(page, SLUG, 5, 'abrir-equipe');

  await page
    .getByRole('button', { name: /adicionar membro/i })
    .first()
    .click();
  const membroNome = page.getByLabel(/nome/i).first();
  await membroNome.waitFor();
  await shoot(page, SLUG, 6, 'adicionar-membro');

  await membroNome.fill('Ana Souza');
  await page.getByLabel(/cargo/i).first().fill('Social Media');
  await shoot(page, SLUG, 7, 'dados-do-membro');

  // "Tipo" é um Select do Radix (EquipePage.tsx:585), não um <select> nativo --
  // capturamos fechado, sem abrir o popover, então scrollIntoViewIfNeeded basta.
  await page.getByLabel(/tipo/i).first().scrollIntoViewIfNeeded();
  await shoot(page, SLUG, 8, 'tipo-de-vinculo');

  // Convite. Mesmo diálogo, ainda aberto -- CORREÇÃO em relação ao brief, que
  // fechava o diálogo com Escape antes desta captura; a seção "Convidar para o
  // workspace" só existe dentro do modal (InviteSection.tsx), então fechar
  // antes a deixaria de fora do screenshot. PRÉ-CLIQUE: o switch de mesmo
  // aria-label habilita o convite por e-mail (Resend), que a rede de segurança
  // bloqueia de qualquer forma (BLOCKED_FUNCTIONS em safety.ts) -- mas esta
  // spec nunca clica nele. Alvo pelo texto plano do parágrafo
  // (InviteSection.tsx:147), não pelo switch de aria-label idêntico.
  const convite = page.getByText('Convidar para o workspace', { exact: false }).first();
  await convite.scrollIntoViewIfNeeded();
  await shoot(page, SLUG, 9, 'convidar-usuario');

  await page.keyboard.press('Escape');

  // ── Seção 3: conecte o Instagram do cliente ────────────────────────────────
  await page.goto(`/clientes/${CLIENT_WITH_IG}`);
  await page.getByRole('heading', { level: 2 }).first().waitFor();
  await shoot(page, SLUG, 10, 'abrir-cliente');

  // #ig-container é o id estável usado tanto pelo componente
  // (InstagramOverviewCard.ts) quanto pela navegação lateral
  // (clienteDetalheNav.model.ts:68) -- mais confiável que `getByText(/instagram/i)`,
  // que também bate em textos do menu e do rodapé de erro. Espera por
  // `.instagram-overview__profile`, o marcador de que o card real (não o
  // placeholder vazio) já carregou.
  const igContainer = page.locator('#ig-container');
  await igContainer.scrollIntoViewIfNeeded();
  await page.locator('.instagram-overview__profile').waitFor();
  await shoot(page, SLUG, 11, 'secao-instagram');

  // Cliente SEM conta conectada, para mostrar o botão de conectar.
  // PRÉ-CLIQUE E DE ALTO RISCO: a rede de segurança roteia apenas
  // functions/v1 e rest/v1, então NÃO vê uma navegação para facebook.com.
  // Clicar aqui atravessa o OAuth real e altera uma integração de verdade.
  // Capture o botão e siga. Nunca clique.
  // Selector verificado ao vivo: o texto real do botão é "Conectar com o
  // Instagram" (id="btn-ig-connect", InstagramOverviewCard.ts:39), não
  // "Conectar Instagram" -- esse texto exato aparece como texto VISÍVEL de um
  // atalho na nav lateral (ClienteDetalheNav.tsx:145-149, <span
  // className="cliente-detalhe-nav__label">), um elemento diferente. O
  // seletor abaixo mira #btn-ig-connect diretamente e nunca clica em nenhum
  // dos dois.
  await page.goto(`/clientes/${CLIENT_WITHOUT_IG}`);
  const conectar = page.locator('#btn-ig-connect');
  await conectar.waitFor();
  await conectar.scrollIntoViewIfNeeded();
  await shoot(page, SLUG, 12, 'conectar-instagram');

  // 13 a 15 são telas do Facebook, capturadas à mão -- fora do escopo desta spec.

  // ── Seção 4: crie o fluxo de entrega ───────────────────────────────────────
  // ACHADO DO STEP 1: "Novo Fluxo" abre um WIZARD de várias etapas
  // (NewWorkflowWizard.tsx), não o diálogo único com abas que o brief presumia.
  // Etapa 1 = escolher um template; etapa 2 = "O básico" (cliente + nome, aqui é
  // onde entra a captura 18); etapa 3 = "As etapas" (chips de sugestão +
  // responsável/prazo por etapa, capturas 19 e 20 na MESMA tela, roladas).
  await page.goto('/entregas');
  await page.getByRole('button', { name: /novo fluxo/i }).waitFor();
  await shoot(page, SLUG, 16, 'abrir-entregas');

  await page.getByRole('button', { name: /novo fluxo/i }).click();
  const wizardDialog = page.getByRole('dialog');
  await wizardDialog.getByRole('heading', { name: 'Novo Fluxo', exact: true }).waitFor();
  await shoot(page, SLUG, 17, 'novo-fluxo');

  // "Produção de Conteúdo" é um template salvo do workspace, listado sob "Seus
  // templates" abaixo dos 6 presets prontos -- não um dos cards com <h4>.
  // Verificado ao vivo (2026-08-06): escolhê-lo avança para a etapa 2 e prefixa
  // o título do diálogo com "Novo Fluxo · Produção de Conteúdo".
  await wizardDialog.getByText('Produção de Conteúdo', { exact: false }).first().click();
  const wizardCliente = wizardDialog.locator('#wizard-cliente');
  await wizardCliente.waitFor();
  await wizardCliente.click();
  await page
    .getByRole('listbox')
    .getByRole('option', { name: 'Studio Bem-Estar', exact: true })
    .click();
  await shoot(page, SLUG, 18, 'escolher-template');

  // Selecionar o cliente habilita "Continuar →", que avança para a etapa 3.
  await wizardDialog.getByRole('button', { name: /continuar/i }).click();
  await wizardDialog.getByText('As etapas', { exact: true }).waitFor();
  await shoot(page, SLUG, 19, 'etapas-do-fluxo');

  // Mesma tela, rolada até os controles de responsável/prazo por etapa -- para
  // que a captura 20 não saia pixel-idêntica à 19 (mesmo cuidado do
  // entregas.spec.ts para o passo de revisão de etapas).
  await wizardDialog
    .getByRole('combobox', { name: 'Responsável' })
    .first()
    .scrollIntoViewIfNeeded();
  await shoot(page, SLUG, 20, 'responsavel-e-prazo');

  // Fechar sem criar o fluxo. O wizard fica "dirty" assim que um template é
  // escolhido (NewWorkflowWizard.tsx:99), então Escape aqui abre o alerta
  // "Fechar sem salvar?" (confirmClose={isDirty}) em vez de fechar direto --
  // diferente do diálogo de Cliente/Equipe. "Fechar mesmo assim" só descarta o
  // estado local do formulário; nenhum fluxo é criado.
  await page.keyboard.press('Escape');
  const discardButton = page.getByRole('button', { name: 'Fechar mesmo assim' });
  if (await discardButton.isVisible().catch(() => false)) {
    await discardButton.click();
  }
  await wizardDialog.waitFor({ state: 'hidden' }).catch(() => {});

  // ── Seção 5: crie o post dentro do fluxo ───────────────────────────────────
  // Gaveta de um fluxo que já existe, via deep link. Somente leitura.
  await page.goto(`/entregas?drawer=${WORKFLOW_ID}`);
  await page.locator('.drawer-header-title').waitFor();
  await shoot(page, SLUG, 21, 'abrir-gaveta');

  // DESVIO DOCUMENTADO: o botão real "Novo Post" (WorkflowDrawer.tsx:352,
  // handleAddPost) faz um INSERT de verdade em workflow_posts -- não é um
  // formulário com botão de salvar separado, como Cliente/Equipe/Fluxo. Clicar
  // nele violaria "zero writes". Em vez disso, expandimos o post fixture 1960
  // ("Antes e depois: harmonização facial", status rascunho, sem mídia nem
  // legenda) como um substituto honesto: ele já está no estado de "post recém
  // criado, vazio", que é exatamente o que estas capturas querem mostrar.
  const draftRow = page.locator('.drawer-post-item', {
    hasText: 'Antes e depois: harmonização facial',
  });
  await draftRow.locator('.drawer-post-trigger').click();
  const tituloInput = draftRow.locator('input[placeholder="Título do post"]');
  await tituloInput.waitFor();
  await shoot(page, SLUG, 22, 'novo-post');

  await tituloInput.scrollIntoViewIfNeeded();
  await shoot(page, SLUG, 23, 'tipo-e-titulo');

  // PostMediaGallery busca a mídia do post de forma assíncrona e renderiza um
  // skeleton `animate-pulse` enquanto carrega (PostMediaGallery.tsx:390) --
  // esperar pelo dropzone "Adicionar" (mesmo texto usado em post-express.spec.ts)
  // confirma que o carregamento terminou e que este post realmente não tem
  // mídia anexada.
  const addMediaZone = draftRow.getByText('Adicionar', { exact: true });
  await addMediaZone.scrollIntoViewIfNeeded();
  await addMediaZone.waitFor();
  await shoot(page, SLUG, 24, 'enviar-midia');

  const captionField = draftRow.locator('textarea');
  await captionField.scrollIntoViewIfNeeded();
  await shoot(page, SLUG, 25, 'escrever-legenda');

  // `.drawer-close-btn` is ambiguous: WorkflowDrawer.tsx:708 (fullscreen
  // toggle) carries both "drawer-close-btn drawer-fullscreen-btn" and is
  // first in the DOM, while the real close control at :714 carries only
  // "drawer-close-btn". `:not()` excludes the fullscreen button so this
  // targets the actual close control.
  await page.locator('.drawer-close-btn:not(.drawer-fullscreen-btn)').click();

  // ── Seção 6: aprove o post ─────────────────────────────────────────────────
  // O quadro Kanban agrupa fluxos por template em ABAS quando há mais de um
  // template ativo (KanbanView.tsx TABS_THRESHOLD) -- "Campanha Antes/Depois"
  // vive sob a aba "Produção de Conteúdo", não na aba padrão. Verificado ao
  // vivo: a aba padrão só mostra 1 card de um template diferente.
  await page.goto('/entregas');
  await page.locator('.board-card').first().waitFor();
  // Tab switching is a synchronous `setActiveRowKey` over boards already
  // fetched into memory (KanbanView.tsx:531-533) -- no new network request
  // fires, so the real signal to wait for is the target card itself
  // appearing under the newly active tab, not a fixed delay.
  const campanhaCard = page.locator('.board-card', { hasText: 'Campanha Antes/Depois' });
  await page.getByRole('tab', { name: /produ[cç][aã]o de conte[uú]do/i }).click();
  await campanhaCard.waitFor();

  // O card tem um botão "Concluir etapa e avançar" (título, sem texto visível --
  // WorkflowCard.tsx:707-709) que dispara o MESMO handler que o drag-and-drop
  // (handleForwardCard). Usá-lo evita simular a física de drag do dnd-kit.
  // PRÉ-CLIQUE: para um card em "Revisão Interna" (não uma etapa do tipo
  // aprovacao_cliente), confirmar "Avançar" no diálogo abaixo chama
  // advanceEtapa() diretamente -- uma escrita de verdade. Por isso paramos no
  // diálogo de confirmação e NUNCA clicamos em "Avançar" para este card.
  await campanhaCard.getByRole('button', { name: 'Concluir etapa e avançar' }).click();
  const forwardDialog = page.getByRole('alertdialog').filter({ hasText: 'Avançar etapa?' });
  await forwardDialog.waitFor();
  await shoot(page, SLUG, 26, 'avancar-etapa');
  await forwardDialog.getByRole('button', { name: 'Cancelar' }).click();

  // DESVIO DOCUMENTADO: para mostrar o diálogo real "Como deseja prosseguir com
  // a aprovação?" (ClientApprovalChoiceDialog, com o botão "Aprovar
  // internamente") é preciso um fluxo cuja etapa ATUAL já seja do tipo
  // aprovacao_cliente -- "Campanha Antes/Depois" está em "Revisão Interna", uma
  // etapa ANTERIOR a essa, então avançá-la não abre esse diálogo (ver
  // executeForward em KanbanView.tsx:388-405). Usamos "Post Semana 3" (Dr.
  // Rafael Nunes), um fluxo já parado em "Aprovação Cliente" e SEM nenhum
  // post, o que faz `allCleared` ser false e o fluxo cair no ramo do diálogo
  // em vez de avançar direto (a escrita real via advanceEtapa()). Verificado
  // também que a sequência inteira (botão de avançar + confirmar "Avançar" no
  // diálogo interino) não dispara nenhuma escrita: `setApprovalChoiceCard` é
  // só estado local (KanbanView.tsx:414-425) até que um dos três botões do
  // diálogo seja clicado, o que esta spec nunca faz.
  //
  // A ramificação em si depende do estado do workflow em produção, que pode
  // ter mudado desde a última verificação. Em vez de confiar num comentário,
  // as duas asserções abaixo checam no DOM, imediatamente antes do clique em
  // "Avançar", as mesmas duas condições que executeForward usa
  // (card.etapa.tipo === 'aprovacao_cliente' e !allCleared), na mesma fonte
  // de verdade que o componente: `.board-card-approval`
  // (WorkflowCard.tsx:452) só renderiza quando etapa.tipo === 'aprovacao_cliente',
  // e a AUSÊNCIA de `.board-card-posts-badge` (WorkflowCard.tsx:701) prova
  // postsCount === 0, o que força total === 0 e allCleared === false. Se o
  // estado real mudar (drift), o teste falha aqui em vez de gravar em produção.
  const aprovacaoCard = page.locator('.board-card', { hasText: 'Post Semana 3' });
  await aprovacaoCard.getByRole('button', { name: 'Concluir etapa e avançar' }).click();
  const forwardDialog2 = page.getByRole('alertdialog').filter({ hasText: 'Avançar etapa?' });
  await forwardDialog2.waitFor();
  await expect(aprovacaoCard.locator('.board-card-approval')).toBeVisible();
  await expect(aprovacaoCard.locator('.board-card-posts-badge')).toHaveCount(0);
  await forwardDialog2.getByRole('button', { name: 'Avançar' }).click();
  const approvalDialog = page.getByRole('dialog').filter({ hasText: 'Como deseja prosseguir' });
  await approvalDialog.waitFor();
  await shoot(page, SLUG, 27, 'dialogo-de-aprovacao');
  await page.keyboard.press('Escape');
  await approvalDialog.waitFor({ state: 'hidden' });

  // "post-aprovado": em vez de clicar em "Aprovar internamente" (o que gravaria
  // de verdade), mostramos o post fixture 1962 ("Cuidados no pós-procedimento"),
  // já semeado com status aprovado_interno -- o chip real
  // "Aprovado internamente" (PostStatusChip -> STATUS_LABELS.aprovado_interno,
  // postLabels.ts:57) já visível na linha recolhida do post, sem precisar
  // expandir nada.
  await page.goto(`/entregas?drawer=${WORKFLOW_ID}`);
  await page.locator('.drawer-header-title').waitFor();
  const aprovadoRow = page.locator('.drawer-post-item', {
    hasText: 'Cuidados no pós-procedimento',
  });
  await aprovadoRow.getByText('Aprovado internamente').waitFor();
  await aprovadoRow.scrollIntoViewIfNeeded();
  await shoot(page, SLUG, 28, 'post-aprovado');

  // ── Seção 8: e agora? ───────────────────────────────────────────────────────
  await page.goto('/calendario');
  await page.getByRole('heading', { name: 'Calendário', level: 1 }).waitFor();
  await shoot(page, SLUG, 33, 'acompanhar-no-calendario');

  // Falha a execução se qualquer chamada para fora foi tentada. Deve ser a
  // última linha: lançar de dentro de um route handler não reprova o teste.
  assertNoViolations(violations);
});
