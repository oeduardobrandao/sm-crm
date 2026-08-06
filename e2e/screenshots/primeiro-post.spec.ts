import { test } from '@playwright/test';
import { installSafetyNet, assertNoViolations } from './safety';
import { shoot } from './capture';

// Capture spec for the help-center article "Como agendar seu primeiro post".
// Runs against the PRODUCTION DK TESTE workspace (conta_id
// e68bdbc3-baf0-4807-b905-0807ac4e0253), logged in as its owner.
//
// Seção 7 (agende a publicação -- shots 29-32) foi OMITIDA DE PROPÓSITO: exige uma
// conta do Instagram apta a publicar, e os quatro tokens do DK TESTE expiraram em
// 2026-06-12 (ver MEMORY.md / project_tiktok... não, ver o registro de tokens do
// workspace). Este arquivo cobre apenas as seções 1-6 e 8 (26 capturas).

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

// Campanha Antes/Depois (Studio Bem-Estar) -- fluxo parado em "Revisão Interna",
// com os posts fixture 1960/1961/1962 já semeados. Usado para as seções 5 e 6.
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

  const violations = await installSafetyNet(page);

  // ── Seção 1: cadastre o cliente ────────────────────────────────────────────
  // Capturas 2 a 4 são o FORMULÁRIO PREENCHIDO, nunca submetido. Nenhum cliente é
  // criado por esta spec: DialogContent aqui não recebe `confirmClose`
  // (ClientesPage.tsx:579), então Escape fecha direto, sem prompt de descarte --
  // verificado lendo components/ui/dialog.tsx (isDirty = confirmClose === true).
  await page.goto('/clientes');
  await page.getByRole('button', { name: /novo cliente/i }).waitFor();
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
  await page.goto('/equipe');
  await page
    .getByRole('button', { name: /adicionar membro/i })
    .first()
    .waitFor();
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
  // "Conectar Instagram" -- esse texto existe apenas no aria-label de um ícone
  // de atalho na nav lateral (ClienteDetalheNav), um elemento diferente.
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

  await page.locator('.drawer-close-btn').first().click();

  // ── Seção 6: aprove o post ─────────────────────────────────────────────────
  // O quadro Kanban agrupa fluxos por template em ABAS quando há mais de um
  // template ativo (KanbanView.tsx TABS_THRESHOLD) -- "Campanha Antes/Depois"
  // vive sob a aba "Produção de Conteúdo", não na aba padrão. Verificado ao
  // vivo: a aba padrão só mostra 1 card de um template diferente.
  await page.goto('/entregas');
  await page.locator('.board-card').first().waitFor();
  await page.getByRole('tab', { name: /produ[cç][aã]o de conte[uú]do/i }).click();
  await page.waitForTimeout(500);

  // O card tem um botão "Concluir etapa e avançar" (título, sem texto visível --
  // WorkflowCard.tsx:707-709) que dispara o MESMO handler que o drag-and-drop
  // (handleForwardCard). Usá-lo evita simular a física de drag do dnd-kit.
  // PRÉ-CLIQUE: para um card em "Revisão Interna" (não uma etapa do tipo
  // aprovacao_cliente), confirmar "Avançar" no diálogo abaixo chama
  // advanceEtapa() diretamente -- uma escrita de verdade. Por isso paramos no
  // diálogo de confirmação e NUNCA clicamos em "Avançar" para este card.
  const campanhaCard = page.locator('.board-card', { hasText: 'Campanha Antes/Depois' });
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
  // Rafael Nunes), um fluxo já parado em "Aprovação Cliente" e SEM
  // nenhum post (verificado ao vivo) -- o que faz `allCleared` ser false e o
  // fluxo cair no ramo do diálogo em vez de avançar direto. Verificado também
  // que a sequência inteira (botão de avançar + confirmar "Avançar" no diálogo
  // interino) não dispara nenhuma escrita: `setApprovalChoiceCard` é só estado
  // local (KanbanView.tsx:414-425) até que um dos três botões do diálogo seja
  // clicado -- o que esta spec nunca faz.
  const aprovacaoCard = page.locator('.board-card', { hasText: 'Post Semana 3' });
  await aprovacaoCard.getByRole('button', { name: 'Concluir etapa e avançar' }).click();
  const forwardDialog2 = page.getByRole('alertdialog').filter({ hasText: 'Avançar etapa?' });
  await forwardDialog2.waitFor();
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
