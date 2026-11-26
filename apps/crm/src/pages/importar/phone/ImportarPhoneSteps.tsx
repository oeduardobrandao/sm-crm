import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '@mesaas/i18n';
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
import { downloadFailures, reasonLabel } from '../components/StepCommit';
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
  const { t } = useTranslation('importWizard');
  const Icon = guide.icon;
  const heading = (
    <>
      <Icon aria-hidden="true" />
      {t('guide.heading', { label: guide.label })}
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
        {t('guide.fullGuide')}
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
  const { t } = useTranslation('importWizard');
  const guide = source ? SOURCE_GUIDES.find((s) => s.id === source) : undefined;
  return (
    <>
      <section className="phone-imp-card phone-imp-mcp">
        <h2 className="phone-imp-mcp__title">
          <Bot aria-hidden="true" />
          {t('origem.mcpTitle')}
        </h2>
        <p>{t('origem.mcpBody')}</p>
      </section>
      <GroupedList aria-label={t('origem.agentGroup')}>
        <Cell label={t('origem.connectAgent')} to="/configuracao/mcp" />
        <Cell label={t('origem.howItWorks')} to="/ajuda/como-conectar-o-claude-mcp" />
      </GroupedList>

      <div role="radiogroup" aria-labelledby="phone-imp-origem-title">
        <GroupedList header={<span id="phone-imp-origem-title">{t('origem.chooseNoColon')}</span>}>
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
  const { t } = useTranslation('importWizard');
  const intlLocale = useIntlLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const rows = bundle ? totalRows(bundle) : 0;
  const collections = bundle?.collections.length ?? 0;
  return (
    <>
      <GuideCard guide={guide} collapsible />

      <GroupedList
        header={t('upload.filesLabel')}
        footer={t('upload.limitsPhone', {
          files: MAX_FILES,
          rows: MAX_ROWS.toLocaleString(intlLocale),
        })}
      >
        <Cell
          label={bundle ? t('upload.pickOtherFiles') : t('upload.pickFiles')}
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
        aria-label={t('upload.filesLabel')}
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
          <Spinner size="sm" /> {t('upload.reading')}
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
            header={`${t('count.collection', { count: collections })} · ${t('count.row', { count: rows })}`}
          >
            {bundle.collections.map((c) => (
              <Cell key={c.id} label={c.name} value={t('count.row', { count: c.rows.length })} />
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
// Built per render: DESTINATION_LABELS resolves in the current UI language on each read.
const destinationOptions = () =>
  (Object.keys(DESTINATION_LABELS) as Destination[]).map((d) => ({
    value: d,
    label: DESTINATION_LABELS[d],
  }));
// Built per render: STATUS_LABELS resolves in the current UI language on each read.
const statusOptions = () => POST_STATUS_TARGETS.map((s) => ({ value: s, label: STATUS_LABELS[s] }));

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
  const { t } = useTranslation('importWizard');
  const update = (collectionId: string, patch: Partial<CollectionMapping>) => {
    onChange({
      collections: proposal.collections.map((m) =>
        m.collectionId === collectionId ? { ...m, ...patch } : m,
      ),
    });
  };

  return (
    <>
      <p className="phone-imp-lead">{t('mapping.leadPhone')}</p>

      {clientesStatus === 'pending' && (
        <p className="phone-imp-status" role="status">
          <Spinner size="sm" /> {t('mapping.loadingClientsPhone')}
        </p>
      )}

      {clientesStatus === 'error' && (
        <>
          <Notice tone="danger" role="alert">
            <p>{t('mapping.clientsError')}</p>
          </Notice>
          <GroupedList aria-label={t('mapping.clientsList')}>
            <Cell label={t('mapping.retry')} icon={<RefreshCw />} onClick={onRetryClientes} />
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
                {t('count.row', { count: collection.rows.length })} ·{' '}
                {t('count.column', { count: collection.columns.length })}
              </span>
            </div>
            <GroupedList aria-label={t('mapping.mappingOf', { name: collection.name })}>
              <PickerCell<Destination>
                label={t('mapping.importAs')}
                sheetTitle={t('mapping.importAsTitle', { name: collection.name })}
                options={destinationOptions()}
                value={mapping.destination}
                onChange={(v) => {
                  if (v) update(collection.id, { destination: v });
                }}
              />
              {needsClient && (
                <PickerCell<string>
                  label={t('mapping.client')}
                  sheetTitle={t('mapping.clientOf', { name: collection.name })}
                  options={[
                    { value: FIXED, label: t('mapping.oneClientForAll') },
                    ...collection.columns.map((c) => ({
                      value: c,
                      label: t('mapping.column', { name: c }),
                    })),
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
                  label={t('mapping.nameShort')}
                  helper={fixedMatch ? t('mapping.willUseExisting') : t('mapping.willCreate')}
                  input={{
                    'aria-label': t('mapping.clientNameOf', { name: collection.name }),
                    value: assignment.clienteNome,
                    placeholder: t('mapping.clientName'),
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
              <GroupedList header={t('mapping.statusMap')} headerAs="h3">
                {keys.map((key) => (
                  <PickerCell<PostStatusTarget>
                    key={key}
                    label={key}
                    sheetTitle={t('mapping.statusSheet', { key })}
                    options={statusOptions()}
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

const COUNT_KEYS = ['clientes', 'posts', 'entregas', 'ideias'] as const;

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
  const { t } = useTranslation('importWizard');
  return (
    <>
      {busy && (
        <p className="phone-imp-status" role="status">
          <Spinner size="sm" /> {t('preview.checking')}
        </p>
      )}

      {error && (
        <Notice tone="danger" role="alert">
          <p>{error}</p>
        </Notice>
      )}

      {preview && (
        <>
          <GroupedList header={t('preview.title')}>
            {COUNT_KEYS.map((key) => (
              <Cell
                key={key}
                label={t(`destination.${key}`)}
                value={String(preview.counts[key] ?? 0)}
              />
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
                {t('preview.ignoredRowsPhone', {
                  counted: t('count.rowIgnored', { count: ignoredRows }),
                })}
              </p>
            </Notice>
          )}

          <p className="phone-imp-foot">{t('preview.mergeNote')}</p>
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
  const { t } = useTranslation('importWizard');
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
        <GroupedList aria-label={t('commit.importGroup')} footer={t('commit.resumeNote')}>
          <Cell label={t('commit.retryAgain')} icon={<RefreshCw />} onClick={onRetry} />
        </GroupedList>
      </>
    );
  }

  if (!results) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <section className="phone-imp-card phone-imp-progress">
        <p className="phone-imp-status">
          <Spinner size="sm" />{' '}
          {t('commit.importing', { done: progress.done, total: progress.total })}
        </p>
        <div
          className="phone-imp-progress__track"
          role="progressbar"
          aria-label={t('commit.progressAria')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="phone-imp-progress__fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="phone-imp-foot">{t('commit.dontClose')}</p>
      </section>
    );
  }

  return (
    <>
      <h2 className="phone-imp-done">
        <CheckCircle2 aria-hidden="true" />
        {t('commit.done')}
      </h2>

      <GroupedList aria-label={t('commit.resultAria')}>
        <Cell label={t('commit.created')} value={String(summary.created)} />
        <Cell label={t('commit.skipped')} value={String(summary.skipped)} />
        <Cell label={t('commit.failed')} value={String(summary.failed.length)} />
      </GroupedList>

      {summary.failed.length > 0 && (
        <>
          <GroupedList header={t('commit.failedHeader')}>
            {summary.byReason.map(([label, count]) => (
              <Cell
                key={label}
                label={label}
                subtitle={`${t('count.rowNotImported', { count })}.`}
              />
            ))}
          </GroupedList>
          {/* Retrying reuses the current job (idempotent per source row); restarting the
              wizard would open a new job and insert every row that already landed again. */}
          <GroupedList aria-label={t('commit.failuresAria')} footer={t('commit.retryNotePhone')}>
            <Cell label={t('commit.retryFailed')} icon={<RefreshCw />} onClick={onRetry} />
            <Cell
              label={t('commit.downloadFailures')}
              icon={<Download />}
              onClick={() => downloadFailures(summary.failed)}
            />
          </GroupedList>
        </>
      )}

      {undoResult ? (
        <section className="phone-imp-card phone-imp-undo" aria-live="polite">
          <p className="phone-imp-undo__title">
            {t('count.recordRemoved', { count: undoResult.deleted })}.
          </p>
          {undoResult.skippedPublished.length > 0 && (
            <p>
              {t('commit.publishedKept', {
                counted: t('count.postKept', { count: undoResult.skippedPublished.length }),
              })}
            </p>
          )}
          {undoResult.skippedWorkflows.length > 0 && (
            <p>
              {t('commit.workflowsKept', {
                counted: t('count.calendarKept', { count: undoResult.skippedWorkflows.length }),
              })}
            </p>
          )}
          {undoResult.skippedTemplates.length > 0 && (
            <p>
              {t('commit.templatesKept', {
                counted: t('count.templateKept', { count: undoResult.skippedTemplates.length }),
              })}
            </p>
          )}
          {undoResult.skippedClientes.length > 0 && (
            <p>
              {t('commit.clientsKept', {
                counted: t('count.clientKept', { count: undoResult.skippedClientes.length }),
              })}
            </p>
          )}
          <p className="phone-imp-foot">{t('commit.mergedNeverDeleted')}</p>
        </section>
      ) : (
        <GroupedList aria-label={t('commit.undoGroup')} footer={t('commit.undoNotePhone')}>
          <Cell
            label={undoing ? t('commit.undoing') : t('commit.undo')}
            icon={undoing ? <Spinner size="sm" /> : <Undo2 />}
            destructive
            disabled={undoing}
            onClick={() => setConfirming(true)}
          />
        </GroupedList>
      )}

      <PhoneConfirmSheet
        open={confirming && !undoResult}
        title={t('commit.undoTitle')}
        actions={[
          {
            label: t('commit.confirmUndo'),
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
