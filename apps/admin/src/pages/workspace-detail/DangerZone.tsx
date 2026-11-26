// "Zona de perigo" at the bottom of the workspace detail: the only entry to the permanent
// delete, kept away from the header's everyday actions. The dialog itself lives in the page.
import { Trash2 } from 'lucide-react';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { Button } from '../../components/ui/button';

const COPY =
  'Exclui o workspace, todos os dados dele e o login de quem não participa de outro workspace. Não dá para desfazer.';

export function DangerZonePanel({ onDelete }: { onDelete: () => void }) {
  return (
    <GlassPanel title="Zona de perigo" titleId="wd-danger-zone" className="border-destructive/40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 max-w-[60ch] text-sm text-muted-foreground">{COPY}</p>
        <Button variant="destructive" onClick={onDelete}>
          <Trash2 aria-hidden="true" />
          Excluir workspace
        </Button>
      </div>
    </GlassPanel>
  );
}

export function DangerZonePhone({ onDelete }: { onDelete: () => void }) {
  return (
    <section className="phone-group" aria-labelledby="wdp-danger-zone">
      <h2 id="wdp-danger-zone" className="phone-group__header mx-4 mb-1.5" style={{ marginTop: 0 }}>
        Zona de perigo
      </h2>
      <div className="flex flex-col gap-3 rounded-[16px] border border-destructive/40 bg-card px-3.5 py-3">
        <p className="m-0 text-[15px] text-muted-foreground">{COPY}</p>
        <Button variant="destructive" onClick={onDelete} className="w-full">
          <Trash2 aria-hidden="true" />
          Excluir workspace
        </Button>
      </div>
    </section>
  );
}
