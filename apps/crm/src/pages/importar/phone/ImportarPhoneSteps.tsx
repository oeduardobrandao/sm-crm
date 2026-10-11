import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Download,
  FileUp,
  Info,
  RefreshCw,
  Undo2,
} from 'lucide-react';
import {
  POST_STATUS_TARGETS,
  type CollectionMapping,
  type Destination,
  type ImportBundle,
  type MappingProposal,
  type PostStatusTarget,
  type SourceKind,
} from '@mesaas/import-parsers';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { FormRow } from '@/components/mobile/FormRow';
import { PickerCell } from '@/components/mobile/PickerSheet';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { Spinner } from '@/components/ui/spinner';
import type { CommitRowResult, PreviewResult, UndoResult } from '@/services/dataImport';
import { norm, type ExistingCliente } from '../buildCommitRows';
import { MAX_FILES, MAX_ROWS, totalRows } from '../parseFiles';
import { SOURCE_GUIDES, type SourceGuide } from '../sourceGuides';
import { KB_SLUG } from '../components/SourceGuideCard';
import type { UploadError } from '../components/StepUpload';
import {
  DESTINATION_LABELS,
  STATUS_LABELS,
  statusKeys,
  type ClientesStatus,
} from '../components/StepMapeamento';
import { downloadFailures, plural, reasonLabel } from '../components/StepCommit';
import './importarPhone.css';

/*
 * The import wizard's phone face (PLAN F2c / F5.5, mockup FImportar). Same state, same
 * callbacks and the same rules as the desktop steps; ImportarPage owns both and renders
 * the step's Voltar / Continuar / Importar in a BottomActionBar instead of each step's
 * own footer. Copy is the desktop copy with its dashes turned into periods and colons.
 */

function Notice({
  tone,
  children,
  role,
}: {
  tone: 'danger' | 'warning' | 'muted';
  children: ReactNode;
  role?: 'alert' | 'status';
}) {
  const Icon = tone === 'muted' ? Info : AlertTriangle;
  return (
    <div className={`phone-imp-notice phone-imp-notice--${tone}`} role={role}>
      <Icon aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

function GuideCard({ guide, collapsible = false }: { guide: SourceGuide; collapsible?: boolean }) {
  const Icon = guide.icon;
  const heading = (
    <>
      <Icon aria-hidden="true" />
      Como exportar do {guide.label}
    </>
  );
  const body = (
    <>
      <ol className="phone-imp-guide__steps">
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {guide.notes && guide.notes.length > 0 && (
        <ul className="phone-imp-guide__notes">
          {guide.notes.map((note) => (
            <li key={note}>
              <Info aria-hidden="true" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}
      <Link to={`/ajuda/${KB_SLUG}`} className="phone-imp-link">
        Ver o guia completo na Central de Ajuda
      </Link>
    </>
  );
  if (collapsible) {
    return (
      <details className="phone-imp-card phone-imp-guide" open>
        <summary className="phone-imp-guide__title">{heading}</summary>
        {body}
      </details>
    );
  }
  return (
    <section className="phone-imp-card phone-imp-guide">
      <h2 className="phone-imp-guide__title">{heading}</h2>
      {body}
    </section>
  );
}

// ---- Passo 1: Origem --------------------------------------------------------------------

export function PhoneStepOrigem({
  source,
  onSelect,
}: {
  source: SourceKind | null;
  onSelect: (source: SourceKind) => void;
}) {
  const guide = source ? SOURCE_GUIDES.find((s) => s.id === source) : undefined;
  return (
    <>
      <section className="phone-imp-card phone-imp-mcp">
        <h2 className="phone-imp-mcp__title">
          <Bot aria-hidden="true" />O jeito mais completo de migrar: peça para um agente de IA
        </h2>
        <p>
          Conecte o Claude ou o ChatGPT ao seu Mesaas via MCP e peça algo como "migre meus clientes
          e o calendário do Notion para o Mesaas". O agente lê os dados direto na outra ferramenta e
          cria clientes, posts e tarefas por aqui, sem você precisar exportar arquivos.
        </p>
      </section>
      <GroupedList aria-label="Agente de IA">
        <Cell label="Conectar um agente" to="/configuracao/mcp" />
        <Cell label="Como funciona" to="/ajuda/como-conectar-o-claude-mcp" />
      </GroupedList>

      <div role="radiogroup" aria-labelledby="phone-imp-origem-title">
        <GroupedList
          header={
            <span id="phone-imp-origem-title">
              Prefere fazer você mesmo? Escolha de onde vêm os dados
            </span>
          }
        >
          {SOURCE_GUIDES.map((s) => {
            const Icon = s.icon;
            const selected = source === s.id;
            return (
              <Cell
                key={s.id}
                role="radio"
                aria-checked={selected}
                label={s.label}
                subtitle={s.hint}
                icon={<Icon />}
                accessory={
                  selected ? <Check className="phone-check" aria-hidden="true" /> : undefined
                }
                onClick={() => onSelect(s.id)}
              />
            );
          })}
        </GroupedList>
      </div>

      {guide && <GuideCard guide={guide} />}
    </>
  );
}

// ---- Passo 2: Arquivos ------------------------------------------------------------------

export function PhoneStepUpload({
  guide,
  bundle,
  error,
  busy,
  onFiles,
}: {
  guide: SourceGuide;
  bundle: ImportBundle | null;
  error: UploadError | null;
  busy: boolean;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rows = bundle ? totalRows(bundle) : 0;
  const collections = bundle?.collections.length ?? 0;
  return (
    <>
      <GuideCard guide={guide} collapsible />

      <GroupedList
        header="Arquivos de exportação"
        footer={`Até ${MAX_FILES} arquivos, 20 MB cada e ${MAX_ROWS.toLocaleString('pt-BR')} linhas por importação. Os arquivos são lidos no seu navegador: nenhum arquivo é enviado para nossos servidores.`}
      >
        <Cell
          label={bundle ? 'Escolher outros arquivos' : 'Escolher arquivos'}
          icon={<FileUp />}
          disabled={busy}
          // The picker must open inside the tap (iOS).
          onClick={() => inputRef.current?.click()}
        />
      </GroupedList>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={guide.accept}
        aria-label="Arquivos de exportação"
        className="phone-imp-file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Reset so picking the same file again still fires onChange.
          e.target.value = '';
          onFiles(files);
        }}
      />

      {busy && (
        <p className="phone-imp-status" role="status">
          <Spinner size="sm" /> Lendo os arquivos…
        </p>
      )}

      {error && (
        <Notice tone="danger" role="alert">
          <p>{error.message}</p>
          {error.details.length > 0 && (
            <ul className="phone-imp-notice__list">
              {error.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      {bundle && !error && (
        <>
          <GroupedList
            header={`${collections} ${collections === 1 ? 'coleção' : 'coleções'} · ${rows} ${
              rows === 1 ? 'linha' : 'linhas'
            }`}
          >
            {bundle.collections.map((c) => (
              <Cell
                key={c.id}
                label={c.name}
                value={`${c.rows.length} ${c.rows.length === 1 ? 'linha' : 'linhas'}`}
              />
            ))}
          </GroupedList>
          {bundle.warnings.length > 0 && (
            <Notice tone="warning">
              <ul className="phone-imp-notice__list">
                {bundle.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Notice>
          )}
        </>
      )}
    </>
  );
}

// ---- Passo 3: Mapeamento ----------------------------------------------------------------

const FIXED = '__fixo__';
const DESTINATION_OPTIONS = (Object.keys(DESTINATION_LABELS) as Destination[]).map((d) => ({
  value: d,
  label: DESTINATION_LABELS[d],
}));
const STATUS_OPTIONS = POST_STATUS_TARGETS.map((s) => ({ value: s, label: STATUS_LABELS[s] }));

export function PhoneStepMapeamento({
  bundle,
  proposal,
  clientes,
  clientesStatus,
  onRetryClientes,
  error,
  onChange,
}: {
  bundle: ImportBundle;
  proposal: MappingProposal;
  clientes: ExistingCliente[];
  clientesStatus: ClientesStatus;
  onRetryClientes: () => void;
  error: string | null;
  onChange: (proposal: MappingProposal) => void;
}) {
  const update = (collectionId: string, patch: Partial<CollectionMapping>) => {
    onChange({
      collections: proposal.collections.map((m) =>
        m.collectionId === collectionId ? { ...m, ...patch } : m,
      ),
    });
  };

  return (
    <>
      <p className="phone-imp-lead">
        Confira o que encontramos em cada parte do arquivo. Tudo é editável: nada é importado antes
        da sua confirmação.
      </p>

      {clientesStatus === 'pending' && (
        <p className="phone-imp-status" role="status">
          <Spinner size="sm" /> Carregando a lista de clientes existentes. Precisamos dela para
          saber quem já é seu cliente antes de continuar.
        </p>
      )}

      {clientesStatus === 'error' && (
        <>
          <Notice tone="danger" role="alert">
            <p>
              Não foi possível carregar a lista de clientes existentes. Continuar sem ela pode
              duplicar um cliente que já existe.
            </p>
          </Notice>
          <GroupedList aria-label="Lista de clientes">
            <Cell label="Tentar novamente" icon={<RefreshCw />} onClick={onRetryClientes} />
          </GroupedList>
        </>
      )}

      {bundle.collections.map((collection) => {
        const mapping = proposal.collections.find((m) => m.collectionId === collection.id);
        if (!mapping) return null;
        const needsClient = mapping.destination !== 'clientes' && mapping.destination !== 'ignorar';
        const assignment = mapping.clientAssignment;
        const fixedMatch =
          assignment.mode === 'fixed'
            ? clientes.find((c) => norm(c.nome) === norm(assignment.clienteNome))
            : undefined;
        const keys = mapping.destination === 'posts' ? statusKeys(collection, mapping) : [];
        const headingId = `phone-imp-col-${collection.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

        return (
          <section key={collection.id} className="phone-imp-collection" aria-labelledby={headingId}>
            <div className="phone-imp-collection__head">
              <h2 id={headingId}>{collection.name}</h2>
              <span>
                {collection.rows.length} {collection.rows.length === 1 ? 'linha' : 'linhas'} ·{' '}
                {collection.columns.length} {collection.columns.length === 1 ? 'coluna' : 'colunas'}
              </span>
            </div>
            <GroupedList aria-label={`Mapeamento de ${collection.name}`}>
              <PickerCell<Destination>
                label="Importar como"
                sheetTitle={`Importar ${collection.name} como`}
                options={DESTINATION_OPTIONS}
                value={mapping.destination}
                onChange={(v) => {
                  if (v) update(collection.id, { destination: v });
                }}
              />
              {needsClient && (
                <PickerCell<string>
                  label="Cliente"
                  sheetTitle={`Cliente de ${collection.name}`}
                  options={[
                    { value: FIXED, label: 'Um cliente para todas as linhas' },
                    ...collection.columns.map((c) => ({ value: c, label: `Coluna “${c}”` })),
                  ]}
                  value={assignment.mode === 'column' ? assignment.column : FIXED}
                  onChange={(v) => {
                    if (v == null) return;
                    update(collection.id, {
                      clientAssignment:
                        v === FIXED
                          ? { mode: 'fixed', clienteNome: '' }
                          : { mode: 'column', column: v },
                    });
                  }}
                />
              )}
              {needsClient && assignment.mode === 'fixed' && (
                <FormRow
                  label="Nome"
                  helper={
                    fixedMatch
                      ? 'Usaremos o cliente que já existe com esse nome.'
                      : 'Se não existir um cliente com esse nome, ele será criado.'
                  }
                  input={{
                    'aria-label': `Nome do cliente de ${collection.name}`,
                    value: assignment.clienteNome,
                    placeholder: 'Nome do cliente',
                    autoComplete: 'off',
                    onChange: (e) =>
                      update(collection.id, {
                        clientAssignment: { mode: 'fixed', clienteNome: e.target.value },
                      }),
                  }}
                />
              )}
            </GroupedList>

            {keys.length > 0 && (
              <GroupedList header="Equivalência de status" headerAs="h3">
                {keys.map((key) => (
                  <PickerCell<PostStatusTarget>
                    key={key}
                    label={key}
                    sheetTitle={`Status "${key}"`}
                    options={STATUS_OPTIONS}
                    value={mapping.statusMap[key] ?? 'rascunho'}
                    onChange={(v) => {
                      if (v)
                        update(collection.id, { statusMap: { ...mapping.statusMap, [key]: v } });
                    }}
                  />
                ))}
              </GroupedList>
            )}
          </section>
        );
      })}

      {error && (
        <Notice tone="danger" role="alert">
          <p>{error}</p>
        </Notice>
      )}
    </>
  );
}

// ---- Passo 4: Prévia --------------------------------------------------------------------

const COUNT_LABELS: [string, string][] = [
  ['clientes', 'Clientes'],
  ['posts', 'Posts'],
  ['entregas', 'Entregas'],
  ['ideias', 'Ideias'],
];

export function PhoneStepPrevia({
  preview,
  ignoredRows,
  busy,
  error,
}: {
  preview: PreviewResult | null;
  ignoredRows: number;
  busy: boolean;
  error: string | null;
}) {
  return (
    <>
      {busy && (
        <p className="phone-imp-status" role="status">
          <Spinner size="sm" /> Conferindo os dados…
        </p>
      )}

      {error && (
        <Notice tone="danger" role="alert">
          <p>{error}</p>
        </Notice>
      )}

      {preview && (
        <>
          <GroupedList header="Prévia da importação">
            {COUNT_LABELS.map(([key, label]) => (
              <Cell key={key} label={label} value={String(preview.counts[key] ?? 0)} />
            ))}
          </GroupedList>

          {preview.warnings.map((w) => (
            <Notice key={w} tone="warning">
              <p>{w}</p>
            </Notice>
          ))}

          {ignoredRows > 0 && (
            <Notice tone="muted">
              <p>
                {ignoredRows} {ignoredRows === 1 ? 'linha será ignorada' : 'linhas serão ignoradas'}{' '}
                por não ter cliente ou título. Volte e ajuste o mapeamento se não for o esperado.
              </p>
            </Notice>
          )}

          <p className="phone-imp-foot">
            Clientes com o mesmo nome de um cliente que já existe são mesclados: só preenchemos
            campos vazios, nunca sobrescrevemos. Por isso, a mesclagem não é desfeita pelo “Desfazer
            importação”.
          </p>
        </>
      )}
    </>
  );
}

// ---- Passo 5: Importar ------------------------------------------------------------------

export function PhoneStepCommit({
  progress,
  results,
  error,
  undoResult,
  undoing,
  onRetry,
  onUndo,
}: {
  progress: { done: number; total: number };
  results: CommitRowResult[] | null;
  error: string | null;
  undoResult: UndoResult | null;
  undoing: boolean;
  onRetry: () => void;
  onUndo: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const summary = useMemo(() => {
    const rows = results ?? [];
    const failed = rows.filter((r) => r.failed);
    const byReason = new Map<string, number>();
    for (const row of failed) {
      const label = reasonLabel(row.reason);
      byReason.set(label, (byReason.get(label) ?? 0) + 1);
    }
    return {
      created: rows.filter((r) => !r.failed && !r.skipped).length,
      skipped: rows.filter((r) => r.skipped).length,
      failed,
      byReason: [...byReason.entries()],
    };
  }, [results]);

  if (error) {
    return (
      <>
        <Notice tone="danger" role="alert">
          <p>{error}</p>
        </Notice>
        <GroupedList
          aria-label="Importação"
          footer="As linhas que já entraram não serão duplicadas: ao tentar novamente, continuamos de onde paramos."
        >
          <Cell label="Tentar novamente" icon={<RefreshCw />} onClick={onRetry} />
        </GroupedList>
      </>
    );
  }

  if (!results) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <section className="phone-imp-card phone-imp-progress">
        <p className="phone-imp-status">
          <Spinner size="sm" /> Importando… {progress.done} de {progress.total}
        </p>
        <div
          className="phone-imp-progress__track"
          role="progressbar"
          aria-label="Progresso da importação"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="phone-imp-progress__fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="phone-imp-foot">Não feche esta aba até terminar.</p>
      </section>
    );
  }

  return (
    <>
      <h2 className="phone-imp-done">
        <CheckCircle2 aria-hidden="true" />
        Importação concluída
      </h2>

      <GroupedList aria-label="Resultado da importação">
        <Cell label="Importados" value={String(summary.created)} />
        <Cell label="Já existiam" value={String(summary.skipped)} />
        <Cell label="Falharam" value={String(summary.failed.length)} />
      </GroupedList>

      {summary.failed.length > 0 && (
        <>
          <GroupedList header="Linhas que falharam">
            {summary.byReason.map(([label, count]) => (
              <Cell
                key={label}
                label={label}
                subtitle={`${plural(count, 'linha não importada', 'linhas não importadas')}.`}
              />
            ))}
          </GroupedList>
          {/* Retrying reuses the current job (idempotent per source row); restarting the
              wizard would open a new job and insert every row that already landed again. */}
          <GroupedList
            aria-label="Falhas"
            footer="Se a causa já foi resolvida (por exemplo, o limite do plano), você pode tentar de novo sem risco: continuamos a mesma importação, então nada do que já entrou é duplicado. Só as linhas que falharam são gravadas."
          >
            <Cell
              label="Tentar novamente as linhas que falharam"
              icon={<RefreshCw />}
              onClick={onRetry}
            />
            <Cell
              label="Baixar relatório de falhas (CSV)"
              icon={<Download />}
              onClick={() => downloadFailures(summary.failed)}
            />
          </GroupedList>
        </>
      )}

      {undoResult ? (
        <section className="phone-imp-card phone-imp-undo" aria-live="polite">
          <p className="phone-imp-undo__title">
            {plural(undoResult.deleted, 'registro removido', 'registros removidos')}.
          </p>
          {undoResult.skippedPublished.length > 0 && (
            <p>
              {plural(undoResult.skippedPublished.length, 'post mantido', 'posts mantidos')}: já
              foram publicados no Instagram ou no TikTok.
            </p>
          )}
          {undoResult.skippedWorkflows.length > 0 && (
            <p>
              {plural(
                undoResult.skippedWorkflows.length,
                'calendário mantido',
                'calendários mantidos',
              )}
              : ainda têm posts ou links criados depois da importação.
            </p>
          )}
          {undoResult.skippedTemplates.length > 0 && (
            <p>
              {plural(
                undoResult.skippedTemplates.length,
                'modelo de fluxo mantido',
                'modelos de fluxo mantidos',
              )}
              : ainda estão em uso por entregas ou campos personalizados.
            </p>
          )}
          {undoResult.skippedClientes.length > 0 && (
            <p>
              {plural(undoResult.skippedClientes.length, 'cliente mantido', 'clientes mantidos')}:
              já têm dados criados fora desta importação (fluxos, ideias, contas conectadas).
            </p>
          )}
          <p className="phone-imp-foot">
            Clientes mesclados com registros que já existiam nunca são apagados.
          </p>
        </section>
      ) : (
        <GroupedList
          aria-label="Desfazer"
          footer="Você tem 7 dias para desfazer esta importação. Nós mantemos o que passou a depender de outras coisas (posts já publicados, calendários com conteúdo novo e clientes com dados criados depois) e listamos tudo o que ficou."
        >
          <Cell
            label={undoing ? 'Desfazendo…' : 'Desfazer importação'}
            icon={undoing ? <Spinner size="sm" /> : <Undo2 />}
            destructive
            disabled={undoing}
            onClick={() => setConfirming(true)}
          />
        </GroupedList>
      )}

      <PhoneConfirmSheet
        open={confirming && !undoResult}
        title="Desfazer importação?"
        actions={[
          {
            label: 'Confirmar e desfazer',
            destructive: true,
            onSelect: () => {
              setConfirming(false);
              onUndo();
            },
          },
        ]}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
