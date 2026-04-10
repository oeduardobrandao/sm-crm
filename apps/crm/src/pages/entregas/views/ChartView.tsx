import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import type { BoardCard } from '../hooks/useEntregasData';

ChartJS.register(ArcElement, Tooltip, Legend);

interface ChartViewProps {
  cards: BoardCard[];
}

export function ChartView({ cards }: ChartViewProps) {
  const atrasado = cards.filter(c => c.deadline.estourado).length;
  const urgente = cards.filter(c => c.deadline.urgente && !c.deadline.estourado).length;
  const emDia = cards.filter(c => !c.deadline.estourado && !c.deadline.urgente).length;

  if (cards.length === 0) {
    return (
      <div className="card animate-up" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        <p>Nenhuma entrega encontrada. Ajuste os filtros.</p>
      </div>
    );
  }

  const data = {
    labels: ['Em dia', 'Urgente', 'Atrasado'],
    datasets: [{
      data: [emDia, urgente, atrasado],
      backgroundColor: ['#3ecf8e', '#eab308', '#ef4444'],
      borderWidth: 0,
    }],
  };

  const options = {
    responsive: true,
    plugins: {
      legend: { position: 'bottom' as const },
    },
  };

  return (
    <div className="animate-up" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2rem' }}>
      <div style={{ maxWidth: 320, width: '100%' }}>
        <Doughnut data={data} options={options} />
      </div>
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        {[
          { label: 'Em dia', count: emDia, color: '#3ecf8e' },
          { label: 'Urgente', count: urgente, color: '#eab308' },
          { label: 'Atrasado', count: atrasado, color: '#ef4444' },
        ].map(stat => (
          <div key={stat.label} className="card" style={{ textAlign: 'center', minWidth: 120, padding: '1.5rem 2rem' }}>
            <div style={{ fontSize: '2.5rem', fontWeight: 700, color: stat.color }}>{stat.count}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
