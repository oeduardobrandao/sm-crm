import { useQuery } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { fetchBriefing } from '../api';

export function BriefingPage() {
  const { token } = useHub();
  const { data, isLoading } = useQuery({
    queryKey: ['hub-briefing', token],
    queryFn: () => fetchBriefing(token),
  });

  if (isLoading) return <div className="flex justify-center py-20"><div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" /></div>;

  const b = data?.briefing;
  if (!b) return <div className="max-w-2xl mx-auto py-8 text-muted-foreground">Sem informações de briefing.</div>;

  const fields: Array<{ label: string; value: string | null }> = [
    { label: 'Nome', value: b.nome },
    { label: 'Email', value: b.email },
    { label: 'Telefone', value: b.telefone },
    { label: 'Segmento', value: b.segmento },
    { label: 'Notas', value: b.notas },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-6">Briefing</h2>
      <div className="border rounded-xl bg-white divide-y">
        {fields.filter(f => f.value).map(f => (
          <div key={f.label} className="flex gap-4 px-4 py-3">
            <span className="text-sm text-muted-foreground w-28 shrink-0">{f.label}</span>
            <span className="text-sm font-medium whitespace-pre-wrap">{f.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
