import { getClientes, getMembros, Cliente, Membro, formatBRL, currentUserRole, getWorkflows, getWorkflowEtapas, type Workflow, type WorkflowEtapa } from '../store';
import { showToast, openConfirm } from '../router';

export async function renderCalendario(container: HTMLElement): Promise<void> {
  // Styles
  if (!document.getElementById('calendar-styles')) {
    const style = document.createElement('style');
    style.id = 'calendar-styles';
    style.innerHTML = `
      .calendar-layout { display: grid; grid-template-columns: 1fr 340px; gap: 2rem; align-items: start; }
      @media (max-width: 1024px) { .calendar-layout { grid-template-columns: 1fr; height: auto; } }
      
      .calendar-main { background: var(--card-bg); border-radius: var(--radius); padding: 2rem; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 1.5rem; }
      .calendar-header { display: flex; justify-content: space-between; align-items: center; }
      .calendar-title-group { display: flex; align-items: baseline; gap: 0.5rem; }
      .calendar-title-group h2 { font-family: var(--font-heading); font-size: 1.6rem; font-weight: 700; color: var(--text-main); }
      .calendar-title-group span { font-family: var(--font-mono); font-size: 1.2rem; color: var(--text-muted); font-weight: 400; }
      
      .calendar-nav { display: flex; gap: 0.5rem; }
      .calendar-nav button { width: 36px; height: 36px; border-radius: 4px; border: 1px solid var(--border-color); background: transparent; color: var(--text-main); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: var(--transition); }
      .calendar-nav button:hover { background: var(--surface-hover); }

      .calendar-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); text-align: left; padding: 0 0.5rem; color: var(--text-muted); font-family: var(--font-mono); font-size: 0.75rem; text-transform: uppercase; font-weight: 500; margin-bottom: 0.5rem; }
      
      .calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.75rem; }
      .calendar-day { background: var(--surface-main); border: 1px solid var(--border-color); border-radius: 8px; min-height: 120px; padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem; transition: var(--transition); cursor: pointer; position: relative; overflow: hidden; }
      .calendar-day:hover { border-color: var(--primary-color); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
      .calendar-day.empty { background: transparent; border: none; cursor: default; box-shadow: none; pointer-events: none; }
      .calendar-day.today { border: 1px solid var(--primary-color); background: rgba(234, 179, 8, 0.05); }
      .calendar-day.selected { border: 2px dashed var(--primary-color); }
      .calendar-day.has-events::before { content: ''; position: absolute; top: 0; right: 0; bottom: 0; left: 0; background: radial-gradient(circle at top right, rgba(234,179,8,0.15) 0%, transparent 70%); pointer-events: none; }
      
      .day-number { font-family: var(--font-mono); font-size: 1.1rem; font-weight: 500; color: var(--text-main); }
      
      .day-events { display: flex; flex-direction: column; gap: 0.35rem; margin-top: auto; }
      .event-pill { font-family: var(--font-mono); font-size: 0.65rem; padding: 0.3rem 0.5rem; border-radius: 4px; display: flex; align-items: center; gap: 0.3rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }
      .event-pill.income { background: rgba(62, 207, 142, 0.1); color: var(--success); border-left: 2px solid var(--success); }
      .event-pill.expense { background: rgba(245, 163, 66, 0.1); color: var(--warning); border-left: 2px solid var(--warning); }
      .event-pill.deadline { background: rgba(139, 92, 246, 0.1); color: #8b5cf6; border-left: 2px solid #8b5cf6; }
      .event-pill.deadline.overdue { background: rgba(239, 68, 68, 0.1); color: var(--danger); border-left: 2px solid var(--danger); }
      
      .scheduled-panel { background: var(--card-bg); border-radius: var(--radius); padding: 2rem; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 1.5rem; }

      @media (max-width: 768px) {
        .calendar-weekdays { display: none; }
        .calendar-grid { grid-template-columns: 1fr; gap: 0.5rem; }
        .calendar-day { flex-direction: row; align-items: center; justify-content: space-between; min-height: auto; padding: 1rem; }
        .calendar-day.empty { display: none; }
        .day-events { flex-direction: row; flex-wrap: wrap; margin-top: 0; align-items: center; justify-content: flex-end; }
        .day-number::after { content: " " attr(data-weekday); font-size: 0.8rem; color: var(--text-muted); font-family: var(--font-main); font-weight: 400; margin-left: 0.5rem; text-transform: capitalize; }
        .calendar-main { padding: 1.25rem; }
        .scheduled-panel { padding: 1.25rem; }
      }
      .scheduled-header h3 { font-family: var(--font-heading); font-size: 1.2rem; color: var(--text-main); margin-bottom: 0.2rem; }
      .scheduled-header p { font-family: var(--font-mono); font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); }
      
      .scheduled-list { display: flex; flex-direction: column; gap: 1rem; overflow-y: auto; padding-right: 0.5rem;}
      .scheduled-item { background: var(--surface-main); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.2rem; display: flex; flex-direction: column; gap: 0.8rem; }
      .item-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
      .item-title { font-weight: 600; color: var(--text-main); font-size: 0.95rem; line-height: 1.3; font-family: var(--font-main); }
      .item-subtitle { font-family: var(--font-mono); font-size: 0.7rem; text-transform: uppercase; color: var(--text-muted); margin-top: 0.4rem; }
      .item-badge { padding: 4px 0; border-radius: 2px; width: 40px; height: 4px; }
      .item-badge.income { background: var(--success); }
      .item-badge.expense { background: var(--warning); }
      .item-meta { display: flex; align-items: center; gap: 0.5rem; font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted); padding-top: 0.8rem; border-top: 1px solid var(--border-color); }
      
      /* Medico Layout */
      .med-controls { padding: 0 0 1.5rem 0; display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
      .med-search-input { background: var(--surface-main); border: 1px solid var(--border-color); color: var(--text-main); font-family: var(--font-main); font-size: 0.85rem; padding: 0.4rem 1rem; border-radius: 4px; outline: none; width: 240px; transition: border-color 0.2s; margin-left: auto; }
      .med-search-input:focus { border-color: var(--primary-color); }
      .med-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.5rem; }
      .month-card { background: var(--surface-main); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; transition: border-color 0.2s; }
      .month-card:hover { border-color: var(--primary-color); }
      .month-header { padding: 1.2rem 1.5rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-color); }
      .month-name { font-family: var(--font-heading); font-size: 1.4rem; font-weight: 700; color: var(--text-main); }
      .month-num { font-family: var(--font-mono); font-size: 0.65rem; color: var(--text-muted); letter-spacing: 0.1em; }
      .month-badge { font-family: var(--font-mono); font-size: 0.6rem; letter-spacing: 0.08em; text-transform: uppercase; padding: 0.25rem 0.6rem; border-radius: 2px; background: rgba(234, 179, 8, 0.1); color: var(--primary-color); border: 1px solid rgba(234, 179, 8, 0.2); white-space: nowrap; }
      .month-events { padding: 0.5rem 0; }
      .event-item { display: flex; align-items: flex-start; gap: 0.8rem; padding: 0.6rem 1.5rem; transition: background 0.15s; cursor: default; }
      .event-item:hover { background: var(--surface-hover); }
      .event-date { font-family: var(--font-mono); font-size: 0.68rem; color: var(--text-muted); min-width: 52px; line-height: 1.6; flex-shrink: 0; padding-top: 1px; }
      .event-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; }
      .event-name { font-size: 0.82rem; line-height: 1.5; color: var(--text-main); }
      
      .type-br   { background: var(--primary-color); }
      .type-world { background: var(--teal); }
      .type-prof  { background: var(--warning); }
      .type-week  { background: var(--pink); }
      .type-month { background: var(--danger); }
      
      .no-results { grid-column: 1/-1; text-align: center; padding: 4rem; font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase;}
      .count-bar { padding: 0 0 1.5rem 0; font-family: var(--font-mono); font-size: 0.65rem; color: var(--text-muted); letter-spacing: 0.08em; text-transform: uppercase;}
      .count-bar span { color: var(--primary-color); font-weight: 600; }
      
      .legend { display: flex; gap: 1.2rem; flex-wrap: wrap; align-items: center; margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--border-color); }
      .legend-item { display: flex; align-items: center; gap: 0.45rem; font-family: var(--font-mono); font-size: 0.65rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
      .legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    `;
    document.head.appendChild(style);
  }

  // --- State ---
  let activeTab: 'financeiro' | 'medico' = 'financeiro';
  
  // Financeiro State
  let currentDate = new Date();
  let selectedDate = new Date();
  let clientes: Cliente[] = [];
  let membros: Membro[] = [];
  let transacoes: import('../store').Transacao[] = [];

  // Entregas deadlines
  interface DeadlineEvent {
    workflowTitle: string;
    etapaNome: string;
    clienteNome: string;
    clienteCor: string;
    deadlineDate: Date;
    diasRestantes: number;
    estourado: boolean;
  }
  let deadlineEvents: DeadlineEvent[] = [];

  // Medico State
  let activeFilter = 'all';
  let searchTerm = '';

  const medicalData = [
    {
      month: "Janeiro", num: "01", badge: "Roxo · Hanseníase",
      events: [
        { date: "02/01", name: "Dia do Sanitarista", type: "prof", tags: ["br","prof"] },
        { date: "04/01", name: "Dia do Hemofílico", type: "br", tags: ["br"] },
        { date: "19/01", name: "Dia Mundial do Terapeuta Ocupacional", type: "world", tags: ["world","prof"] },
        { date: "20/01", name: "Dia do Farmacêutico", type: "prof", tags: ["br","prof"] },
        { date: "20/01", name: "Dia Nacional da Parteira Tradicional", type: "br", tags: ["br","prof"] },
        { date: "29/01", name: "Dia Nacional da Visibilidade Trans", type: "br", tags: ["br"] },
        { date: "30/01", name: "Dia Mundial das Doenças Tropicais Negligenciadas", type: "world", tags: ["world","infeccao"] },
        { date: "Último dom.", name: "Dia Nacional de Combate e Prevenção da Hanseníase", type: "br", tags: ["br","infeccao"] },
      ]
    },
    {
      month: "Fevereiro", num: "02", badge: "Laranja · Leucemia",
      events: [
        { date: "01–08/02", name: "Semana Nacional de Prevenção da Gravidez na Adolescência", type: "week", tags: ["br","week"] },
        { date: "04/02", name: "Dia Mundial do Câncer (OMS)", type: "world", tags: ["world","cancer"] },
        { date: "05/02", name: "Dia Nacional da Mamografia", type: "br", tags: ["br","cancer"] },
        { date: "10/02", name: "Dia Internacional da Epilepsia", type: "world", tags: ["world","saude-mental"] },
        { date: "13/02", name: "Dia Internacional do Preservativo", type: "world", tags: ["world","infeccao"] },
        { date: "14/02", name: "Dia Mundial dos Enfermos", type: "world", tags: ["world"] },
        { date: "15/02", name: "Dia Internacional de Luta contra o Câncer Infantil", type: "world", tags: ["world","cancer"] },
        { date: "18/02", name: "Dia Nacional da Criança Traqueostomizada", type: "br", tags: ["br"] },
        { date: "20/02", name: "Dia Nacional de Combate às Drogas e Alcoolismo", type: "br", tags: ["br","saude-mental"] },
        { date: "28/02", name: "Dia Mundial das Doenças Raras", type: "world", tags: ["world"] },
        { date: "28/02", name: "Dia e Semana Nacional sobre Doenças Raras", type: "br", tags: ["br"] },
      ]
    },
    {
      month: "Março", num: "03", badge: "",
      events: [
        { date: "01/03", name: "Dia Mundial de Zero Discriminação", type: "world", tags: ["world"] },
        { date: "03/03", name: "Dia Mundial da Audição (OMS)", type: "world", tags: ["world"] },
        { date: "03/03", name: "Dia Mundial dos Defeitos Congênitos", type: "world", tags: ["world"] },
        { date: "04/03", name: "Dia Mundial da Obesidade", type: "world", tags: ["world"] },
        { date: "04/03", name: "Dia Internacional de Conscientização sobre HPV", type: "world", tags: ["world","cancer","infeccao"] },
        { date: "08/03", name: "Dia Internacional da Mulher", type: "world", tags: ["world"] },
        { date: "10/03", name: "Dia Nacional de Combate ao Sedentarismo", type: "br", tags: ["br"] },
        { date: "10–16/03", name: "Semana Mundial do Glaucoma", type: "week", tags: ["world","week"] },
        { date: "2ª qui.", name: "Dia Mundial do Rim (OMS)", type: "world", tags: ["world"] },
        { date: "15/03", name: "Dia Mundial de Conscientização sobre Covid Longa", type: "world", tags: ["world","infeccao"] },
        { date: "18/03", name: "Dia Mundial do Sono", type: "world", tags: ["world"] },
        { date: "20/03", name: "Dia Mundial da Saúde Bucal", type: "world", tags: ["world"] },
        { date: "21/03", name: "Dia Mundial e Nacional da Síndrome de Down", type: "world", tags: ["world","br"] },
        { date: "22/03", name: "Dia Mundial da Água (OMS)", type: "world", tags: ["world"] },
        { date: "24/03", name: "Dia Mundial de Combate à Tuberculose (OMS)", type: "world", tags: ["world","infeccao"] },
        { date: "24–31/03", name: "Semana Nacional de Luta Contra a Tuberculose", type: "week", tags: ["br","week","infeccao"] },
        { date: "26/03", name: "Dia Mundial do Câncer de Colo de Útero", type: "world", tags: ["world","cancer"] },
        { date: "27/03", name: "Dia Nacional de Combate ao Câncer Colorretal", type: "br", tags: ["br","cancer"] },
        { date: "30/03", name: "Dia Mundial do Transtorno Bipolar", type: "world", tags: ["world","saude-mental"] },
        { date: "31/03", name: "Dia da Saúde e da Nutrição", type: "br", tags: ["br"] },
      ]
    },
    {
      month: "Abril", num: "04", badge: "Verde · Saúde no Trabalho",
      events: [
        { date: "Abril", name: "Abril Verde — Saúde e Segurança no Trabalho", type: "month", tags: ["br","month"] },
        { date: "02/04", name: "Dia Mundial de Conscientização sobre o Autismo", type: "world", tags: ["world","br","saude-mental"] },
        { date: "02–07/04", name: "Semana da Saúde no Brasil", type: "week", tags: ["br","week"] },
        { date: "04/04", name: "Dia Nacional do Portador da Doença de Parkinson", type: "br", tags: ["br"] },
        { date: "06/04", name: "Dia Mundial da Atividade Física", type: "world", tags: ["world"] },
        { date: "07/04", name: "Dia Mundial da Saúde (OMS)", type: "world", tags: ["world"] },
        { date: "11/04", name: "Dia do Infectologista", type: "prof", tags: ["prof"] },
        { date: "11/04", name: "Dia Mundial de Conscientização da Doença de Parkinson", type: "world", tags: ["world"] },
        { date: "12/04", name: "Dia do Obstetra", type: "prof", tags: ["prof"] },
        { date: "14/04", name: "Dia Mundial da Doença de Chagas (OMS)", type: "world", tags: ["world","infeccao"] },
        { date: "17/04", name: "Dia Mundial da Hemofilia", type: "world", tags: ["world"] },
        { date: "24/04", name: "Dia Mundial de Combate à Meningite", type: "world", tags: ["world","infeccao"] },
        { date: "23–30/04", name: "Semana de Vacinação nas Américas (OPAS)", type: "week", tags: ["world","week","infeccao"] },
        { date: "24–30/04", name: "Semana Mundial da Imunização (OMS)", type: "week", tags: ["world","week","infeccao"] },
        { date: "25/04", name: "Dia Mundial da Malária (OMS)", type: "world", tags: ["world","infeccao"] },
        { date: "26/04", name: "Dia Nacional de Prevenção e Combate à Hipertensão Arterial", type: "br", tags: ["br","cardio"] },
        { date: "28/04", name: "Dia Mundial da Segurança e Saúde no Trabalho (OIT)", type: "world", tags: ["world"] },
        { date: "28/04", name: "Dia Nacional — Vítimas de Acidentes e Doenças do Trabalho", type: "br", tags: ["br"] },
      ]
    },
    {
      month: "Maio", num: "05", badge: "Amarelo · Trânsito",
      events: [
        { date: "1ª ter.", name: "Dia Mundial de Combate à Asma", type: "world", tags: ["world"] },
        { date: "05/05", name: "Dia Mundial de Higienização das Mãos (OMS)", type: "world", tags: ["world","infeccao"] },
        { date: "05/05", name: "Dia Internacional da Parteira", type: "world", tags: ["world","prof"] },
        { date: "05/05", name: "Dia Nacional do Uso Racional de Medicamentos", type: "br", tags: ["br"] },
        { date: "07/05", name: "Dia Internacional da Luta contra a Endometriose", type: "world", tags: ["world"] },
        { date: "08/05", name: "Dia da Talassemia", type: "world", tags: ["world"] },
        { date: "08/05", name: "Dia Mundial do Câncer de Ovário", type: "world", tags: ["world","cancer"] },
        { date: "10/05", name: "Dia Mundial do Lúpus", type: "world", tags: ["world"] },
        { date: "12/05", name: "Dia da Enfermagem", type: "world", tags: ["world","prof"] },
        { date: "12/05", name: "Dia da Conscientização da Fibromialgia", type: "world", tags: ["world"] },
        { date: "14/05", name: "Dia Nacional — Doenças Cardiovasculares na Mulher", type: "br", tags: ["br","cardio"] },
        { date: "15/05", name: "Dia de Combate à Infecção Hospitalar", type: "world", tags: ["world","infeccao"] },
        { date: "16/05", name: "Dia Mundial de Conscientização sobre Doença Celíaca", type: "world", tags: ["world"] },
        { date: "17/05", name: "Dia Mundial da Hipertensão Arterial", type: "world", tags: ["world","cardio"] },
        { date: "18/05", name: "Dia Nacional da Luta Antimanicomial", type: "br", tags: ["br","saude-mental"] },
        { date: "19/05", name: "Dia Mundial da Doença Inflamatória Intestinal", type: "world", tags: ["world"] },
        { date: "19/05", name: "Dia Nacional de Doação de Leite Humano", type: "br", tags: ["br"] },
        { date: "19/05", name: "Dia Nacional de Combate à Cefaleia", type: "br", tags: ["br"] },
        { date: "22/05", name: "Dia Mundial da Pré-eclâmpsia", type: "world", tags: ["world","cardio"] },
        { date: "25/05", name: "Dia Mundial da Tireoide", type: "world", tags: ["world"] },
        { date: "28/05", name: "Dia Internacional de Ação pela Saúde da Mulher", type: "world", tags: ["world"] },
        { date: "29/05", name: "Dia Mundial da Saúde Digestiva (OMGE)", type: "world", tags: ["world"] },
        { date: "Últ. qua.", name: "Dia Mundial da Esclerose Múltipla", type: "world", tags: ["world"] },
        { date: "31/05", name: "Dia Mundial Sem Tabaco (OMS)", type: "world", tags: ["world","cancer"] },
      ]
    },
    {
      month: "Junho", num: "06", badge: "Laranja · Queimaduras",
      events: [
        { date: "Junho", name: "Junho Laranja — Prevenção a Queimaduras", type: "month", tags: ["br","month"] },
        { date: "Junho", name: "Junho Vermelho — Doação de Sangue", type: "month", tags: ["br","month"] },
        { date: "02/06", name: "Dia Mundial de Conscientização dos Transtornos Alimentares", type: "world", tags: ["world","saude-mental"] },
        { date: "05/06", name: "Dia Mundial do Meio Ambiente (ONU)", type: "world", tags: ["world"] },
        { date: "06/06", name: "Dia Nacional de Luta Contra Queimaduras", type: "br", tags: ["br"] },
        { date: "06/06", name: "Dia Nacional do Teste do Pezinho", type: "br", tags: ["br"] },
        { date: "07/06", name: "Dia Mundial da Segurança Alimentar (OMS)", type: "world", tags: ["world"] },
        { date: "09/06", name: "Dia Nacional da Imunização", type: "br", tags: ["br","infeccao"] },
        { date: "11/06", name: "Dia Mundial do Câncer de Próstata", type: "world", tags: ["world","cancer"] },
        { date: "14/06", name: "Dia Mundial do Doador de Sangue (OMS)", type: "world", tags: ["world"] },
        { date: "15/06", name: "Dia Mundial de Conscientização sobre o Abuso Contra a Pessoa Idosa", type: "world", tags: ["world"] },
        { date: "19/06", name: "Dia Mundial de Conscientização sobre a Doença Falciforme (ONU)", type: "world", tags: ["world"] },
        { date: "21/06", name: "Dia Nacional de Combate à Asma", type: "br", tags: ["br"] },
        { date: "21/06", name: "Dia Nacional de Luta Contra a ELA", type: "br", tags: ["br"] },
        { date: "25/06", name: "Dia Mundial do Vitiligo", type: "world", tags: ["world"] },
        { date: "26/06", name: "Dia Nacional do Diabetes", type: "br", tags: ["br"] },
        { date: "26/06", name: "Dia Internacional — Abuso e Tráfico Ilícito de Drogas (ONU)", type: "world", tags: ["world","saude-mental"] },
      ]
    },
    {
      month: "Julho", num: "07", badge: "Amarelo · Hepatites Virais",
      events: [
        { date: "Julho", name: "Julho Amarelo — Hepatites Virais", type: "month", tags: ["br","month","infeccao"] },
        { date: "01/07", name: "Dia da Vacina BCG", type: "br", tags: ["br","infeccao"] },
        { date: "02/07", name: "Dia do Hospital", type: "br", tags: ["br"] },
        { date: "06/07", name: "Dia Mundial das Zoonoses", type: "world", tags: ["world","infeccao"] },
        { date: "09/07", name: "Dia Nacional de Alerta Contra a Insuficiência Cardíaca", type: "br", tags: ["br","cardio"] },
        { date: "10/07", name: "Dia da Saúde Ocular", type: "br", tags: ["br"] },
        { date: "22/07", name: "Dia Mundial do Cérebro (FMN)", type: "world", tags: ["world"] },
        { date: "25/07", name: "Dia Mundial de Prevenção do Afogamento (OMS)", type: "world", tags: ["world"] },
        { date: "27/07", name: "Dia Mundial do Câncer de Cabeça e Pescoço", type: "world", tags: ["world","cancer"] },
        { date: "28/07", name: "Dia Mundial da Hepatite (OMS)", type: "world", tags: ["world","infeccao"] },
      ]
    },
    {
      month: "Agosto", num: "08", badge: "Dourado · Amamentação",
      events: [
        { date: "Agosto", name: "Agosto Dourado — Amamentação", type: "month", tags: ["br","month"] },
        { date: "01–07/08", name: "Semana Mundial da Amamentação (OMS)", type: "week", tags: ["world","week"] },
        { date: "01/08", name: "Dia Mundial de Combate ao Câncer de Pulmão", type: "world", tags: ["world","cancer"] },
        { date: "01/08", name: "Dia Nacional dos Portadores de Vitiligo", type: "br", tags: ["br"] },
        { date: "08/08", name: "Dia Nacional da Pessoa com Atrofia Muscular Espinhal (AME)", type: "br", tags: ["br"] },
        { date: "Sem. 10/08", name: "Semana Nacional de Controle e Combate à Leishmaniose", type: "week", tags: ["br","week","infeccao"] },
        { date: "12/08", name: "Dia Internacional da Juventude (ONU)", type: "world", tags: ["world"] },
        { date: "26/08", name: "Dia Nacional de Combate ao Colesterol", type: "br", tags: ["br","cardio"] },
        { date: "Últ. 5ª", name: "Dia Nacional da Diálise", type: "br", tags: ["br"] },
      ]
    },
    {
      month: "Setembro", num: "09", badge: "Amarelo-Verde · Suicídio",
      events: [
        { date: "Setembro", name: "Setembro Amarelo — Prevenção ao Suicídio", type: "month", tags: ["br","month","saude-mental"] },
        { date: "Setembro", name: "Setembro Verde — Doação de Órgãos", type: "month", tags: ["br","month"] },
        { date: "01/09", name: "Dia Mundial da Saúde do Coração", type: "world", tags: ["world","cardio"] },
        { date: "02/09", name: "Dia Nacional de Prevenção à Gravidez na Adolescência", type: "br", tags: ["br"] },
        { date: "05/09", name: "Dia Nacional da Doação de Sangue e Órgãos", type: "br", tags: ["br"] },
        { date: "10/09", name: "Dia Mundial de Prevenção ao Suicídio (OMS)", type: "world", tags: ["world","saude-mental"] },
        { date: "15/09", name: "Dia Internacional da Democracia (ONU)", type: "world", tags: ["world"] },
        { date: "17/09", name: "Dia Mundial da Segurança do Paciente (OMS)", type: "world", tags: ["world"] },
        { date: "21/09", name: "Dia Mundial da Doença de Alzheimer (ADI)", type: "world", tags: ["world","saude-mental"] },
        { date: "28/09", name: "Dia Internacional do Acesso Seguro ao Aborto", type: "world", tags: ["world"] },
        { date: "29/09", name: "Dia Mundial do Coração (OMS)", type: "world", tags: ["world","cardio"] },
      ]
    },
    {
      month: "Outubro", num: "10", badge: "Rosa · Câncer de Mama",
      events: [
        { date: "Outubro", name: "Outubro Rosa — Câncer de Mama", type: "month", tags: ["br","month","cancer"] },
        { date: "Outubro", name: "Outubro Azul — Saúde do Homem / Câncer de Próstata", type: "month", tags: ["br","month","cancer"] },
        { date: "04/10", name: "Dia da Medicina do Trabalho / Médico do Trabalho", type: "prof", tags: ["prof"] },
        { date: "05/10", name: "Dia Mundial de Saúde Mental (OMS)", type: "world", tags: ["world","saude-mental"] },
        { date: "10/10", name: "Dia Mundial da Saúde Mental (WFMH)", type: "world", tags: ["world","saude-mental"] },
        { date: "10/10", name: "Dia Nacional dos Direitos Fundamentais da Pessoa com Transtornos Mentais", type: "br", tags: ["br","saude-mental"] },
        { date: "11/10", name: "Dia Nacional de Prevenção da Obesidade", type: "br", tags: ["br"] },
        { date: "13/10", name: "Dia do Terapeuta Ocupacional e Fisioterapeuta", type: "prof", tags: ["prof"] },
        { date: "15/10", name: "Dia Mundial da Visão (OMS)", type: "world", tags: ["world"] },
        { date: "16/10", name: "Dia Mundial da Alimentação (FAO)", type: "world", tags: ["world"] },
        { date: "20/10", name: "Dia do Médico", type: "prof", tags: ["br","prof"] },
        { date: "20/10", name: "Dia Nacional do Câncer de Mama", type: "br", tags: ["br","cancer"] },
        { date: "22/10", name: "Dia Internacional de Atenção à Gagueira", type: "world", tags: ["world"] },
        { date: "23/10", name: "Dia Nacional de Combate à Dengue", type: "br", tags: ["br","infeccao"] },
        { date: "26/10", name: "Dia Nacional de Combate ao Câncer de Cabeça e Pescoço", type: "br", tags: ["br","cancer"] },
        { date: "29/10", name: "Dia Mundial do AVC (OMS)", type: "world", tags: ["world","cardio"] },
      ]
    },
    {
      month: "Novembro", num: "11", badge: "Azul · Saúde do Homem",
      events: [
        { date: "Novembro", name: "Novembro Azul — Saúde do Homem / Câncer de Próstata", type: "month", tags: ["br","month","cancer"] },
        { date: "03/11", name: "Dia Mundial e Nacional da Saúde Única (Lei nº 14.792/2024)", type: "br", tags: ["br","world"] },
        { date: "12/11", name: "Dia Mundial do Combate ao Diabetes (FID)", type: "world", tags: ["world"] },
        { date: "14/11", name: "Dia Mundial do Diabetes (OMS/FID)", type: "world", tags: ["world"] },
        { date: "17/11", name: "Dia Mundial da Prematuridade (OMS)", type: "world", tags: ["world"] },
        { date: "20/11", name: "Dia Nacional da Consciência Negra", type: "br", tags: ["br"] },
        { date: "21/11", name: "Dia do Odontologista", type: "prof", tags: ["prof"] },
        { date: "Penúlt. sáb.", name: "Dia Nacional de Combate à Dengue", type: "br", tags: ["br","infeccao"] },
        { date: "23/11", name: "Dia Nacional de Combate ao Câncer Infanto-Juvenil", type: "br", tags: ["br","cancer"] },
        { date: "25/11", name: "Dia Internacional pela Eliminação da Violência contra a Mulher", type: "world", tags: ["world"] },
      ]
    },
    {
      month: "Dezembro", num: "12", badge: "Vermelho · HIV/AIDS / Laranja · Câncer de Pele",
      events: [
        { date: "Dezembro", name: "Dezembro Vermelho — Prevenção ao HIV/AIDS", type: "month", tags: ["br","month","infeccao"] },
        { date: "Dezembro", name: "Dezembro Laranja — Câncer de Pele", type: "month", tags: ["br","month","cancer"] },
        { date: "01/12", name: "Dia Mundial de Luta Contra a AIDS (OMS)", type: "world", tags: ["world","infeccao"] },
        { date: "03/12", name: "Dia Internacional da Pessoa com Deficiência (ONU)", type: "world", tags: ["world"] },
        { date: "06/12", name: "Dia Nacional de Mobilização dos Homens pelo Fim da Violência contra Mulheres", type: "br", tags: ["br"] },
        { date: "09/12", name: "Dia da Nutrição e da Alimentação", type: "br", tags: ["br"] },
        { date: "10/12", name: "Dia dos Direitos Humanos (ONU)", type: "world", tags: ["world"] },
        { date: "17/12", name: "Dia Nacional dos Hansenianos", type: "br", tags: ["br","infeccao"] },
        { date: "27/12", name: "Dia do Médico Sanitarista", type: "prof", tags: ["prof"] },
      ]
    },
  ];

  const dotClass: Record<string, string> = { br: "type-br", world: "type-world", prof: "type-prof", week: "type-week", month: "type-month" };

  // --- Initial Data Load ---
  const loadData = async () => {
    try {
      const [cRes, mRes, tRes, wfRes] = await Promise.all([getClientes(), getMembros(), import('../store').then(m => m.getTransacoes()), getWorkflows()]);
      clientes = cRes;
      membros = mRes;
      transacoes = tRes;

      // Build deadline events from active workflows
      const activeWfs = wfRes.filter(w => w.status === 'ativo');
      const etapasResults = await Promise.all(activeWfs.map(w => getWorkflowEtapas(w.id!)));
      deadlineEvents = [];
      activeWfs.forEach((w, idx) => {
        const etapas = etapasResults[idx];
        const activeEtapa = etapas.find(e => e.status === 'ativo');
        if (!activeEtapa || !activeEtapa.iniciado_em) return;
        const cliente = clientes.find(c => c.id === w.cliente_id);
        const inicio = new Date(activeEtapa.iniciado_em);
        // Calculate deadline date by adding prazo_dias from inicio
        const deadlineDate = new Date(inicio);
        if (activeEtapa.tipo_prazo === 'uteis') {
          let added = 0;
          while (added < activeEtapa.prazo_dias) {
            deadlineDate.setDate(deadlineDate.getDate() + 1);
            const dow = deadlineDate.getDay();
            if (dow !== 0 && dow !== 6) added++;
          }
        } else {
          deadlineDate.setDate(deadlineDate.getDate() + activeEtapa.prazo_dias);
        }
        const now = new Date();
        const diffMs = deadlineDate.getTime() - now.getTime();
        const diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        deadlineEvents.push({
          workflowTitle: w.titulo,
          etapaNome: activeEtapa.nome,
          clienteNome: cliente?.nome || '—',
          clienteCor: cliente?.cor || '#888',
          deadlineDate,
          diasRestantes,
          estourado: diasRestantes < 0,
        });
      });

      render();
    } catch (e: unknown) {
      showToast('Erro ao carregar dados do calendário.', 'error');
    }
  };

  // --- Render Container with Tabs ---
  const render = () => {
    container.innerHTML = `
      <header class="header animate-up">
        <div class="header-title">
          <h1>${activeTab === 'financeiro' ? 'Agenda & Pagamentos' : 'Calendário <span>Médico</span>'}</h1>
          <p>${activeTab === 'financeiro' ? 'Visão geral mensal.' : 'Brasil & Mundial — Datas de Saúde & Conscientização'}</p>
        </div>
      </header>

      <div class="calendar-tabs animate-up" style="animation-delay: 0.1s;">
        <button class="calendar-tab ${activeTab === 'financeiro' ? 'active' : ''}" data-tab="financeiro">Calendário</button>
        <button class="calendar-tab ${activeTab === 'medico' ? 'active' : ''}" data-tab="medico">Datas Médicas</button>
      </div>

      <div id="calendar-content" class="animate-up" style="animation-delay: 0.15s;"></div>
    `;

    // Attach Tab Events
    container.querySelectorAll('.calendar-tab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        activeTab = (e.target as HTMLElement).getAttribute('data-tab') as 'financeiro' | 'medico';
        render(); // Full re-render to change headers
      });
    });

    const contentEl = container.querySelector('#calendar-content') as HTMLElement;
    if (activeTab === 'financeiro') {
      renderFinanceiro(contentEl);
    } else {
      renderMedico(contentEl);
    }
  };

  // --- Render Financeiro ---
  const renderFinanceiro = (el: HTMLElement) => {
    const isAgent = currentUserRole === 'agent';
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    const weekDays = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

    const selectedDay = selectedDate.getDate();
    const isSameMonth = selectedDate.getMonth() === month && selectedDate.getFullYear() === year;
    const selectedIncomes = isAgent ? [] : (isSameMonth ? clientes.filter(c => c.data_pagamento === selectedDay && c.status === 'ativo') : []);
    const selectedExpenses = isAgent ? [] : (isSameMonth ? membros.filter(m => m.data_pagamento === selectedDay) : []);
    const selectedDeadlines = isSameMonth ? deadlineEvents.filter(d => d.deadlineDate.getDate() === selectedDay && d.deadlineDate.getMonth() === month && d.deadlineDate.getFullYear() === year) : [];

    let gridHTML = '';
    
    // Empty prefix cells
    for (let i = 0; i < firstDay; i++) {
      gridHTML += `<div class="calendar-day empty"></div>`;
    }

    // Days cells
    const today = new Date();
    for (let i = 1; i <= daysInMonth; i++) {
      const isToday = today.getDate() === i && today.getMonth() === month && today.getFullYear() === year;
      const isSelected = selectedDay === i && isSameMonth;
      
      const dayIncomes = isAgent ? [] : clientes.filter(c => c.data_pagamento === i && c.status === 'ativo');
      const dayExpenses = isAgent ? [] : membros.filter(m => m.data_pagamento === i);
      const dayDeadlines = deadlineEvents.filter(d => d.deadlineDate.getDate() === i && d.deadlineDate.getMonth() === month && d.deadlineDate.getFullYear() === year);
      const hasEvents = dayIncomes.length > 0 || dayExpenses.length > 0 || dayDeadlines.length > 0;
      const dayOfWeek = new Date(year, month, i).getDay();
      const weekdayName = weekDays[dayOfWeek].slice(0,3);
      
      let eventsHTML = '';
      if (dayIncomes.length > 0) {
        eventsHTML += `<div class="event-pill income"><i class="ph ph-trend-up"></i> ${dayIncomes.length} Receb.</div>`;
      }
      if (dayExpenses.length > 0) {
        eventsHTML += `<div class="event-pill expense"><i class="ph ph-trend-down"></i> ${dayExpenses.length} Desp.</div>`;
      }
      if (dayDeadlines.length > 0) {
        const hasOverdue = dayDeadlines.some(d => d.estourado);
        eventsHTML += `<div class="event-pill deadline${hasOverdue ? ' overdue' : ''}"><i class="ph ph-flag-banner"></i> ${dayDeadlines.length} Entrega${dayDeadlines.length > 1 ? 's' : ''}</div>`;
      }

      gridHTML += `
        <div class="calendar-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${hasEvents ? 'has-events' : ''}" data-day="${i}">
          <span class="day-number" data-weekday="${weekdayName}">${i}</span>
          <div class="day-events">
            ${eventsHTML}
          </div>
        </div>
      `;
    }

    let panelItemsHTML = '';
    const isPaid = (refId: string) => transacoes.some(t => t.referencia_agendamento === refId);

    if (selectedIncomes.length === 0 && selectedExpenses.length === 0 && selectedDeadlines.length === 0) {
       panelItemsHTML = `<div style="text-align:center; padding: 2rem 0; color: var(--text-muted);"><i class="ph ph-calendar-x" style="font-size: 2.5rem; margin-bottom: 0.5rem; opacity: 0.5;"></i><p>Nenhuma movimentação neste dia.</p></div>`;
    } else {
      selectedIncomes.forEach(c => {
        const refId = `cliente_${c.id}_${year}_${String(month + 1).padStart(2, '0')}`;
        const paid = isPaid(refId);
        
        panelItemsHTML += `
          <div class="scheduled-item">
            <div class="item-top">
              <div>
                <div class="item-badge income" style="${paid ? 'background: var(--text-muted)' : ''}"></div>
                <div class="item-title" style="margin-top:0.8rem; ${paid ? 'text-decoration: line-through; color:var(--text-muted)' : ''}">${c.nome}</div>
                <div class="item-subtitle">Plano: ${c.plano || 'N/A'}</div>
              </div>
              <div>
                ${paid 
                  ? `<span class="badge badge-neutral"><i class="ph ph-check" style="margin-right:4px"></i>Pago</span>`
                  : `<button class="btn-primary btn-confirm-cal" style="padding: 0.4rem 0.8rem; font-size:0.75rem" 
                        data-refid="${refId}" data-desc="${c.nome}" data-val="${c.valor_mensal}" data-cat="Mensalidade Cliente" data-tipo="entrada">
                      <i class="ph ph-check-circle"></i> Confirmar
                    </button>`
                }
              </div>
            </div>
            <div class="item-meta">
              <i class="ph ph-money"></i> Previsto: ${formatBRL(c.valor_mensal)}
            </div>
          </div>
        `;
      });
      selectedExpenses.forEach(m => {
        const refId = `membro_${m.id}_${year}_${String(month + 1).padStart(2, '0')}`;
        const paid = isPaid(refId);

        panelItemsHTML += `
          <div class="scheduled-item">
            <div class="item-top">
              <div>
                <div class="item-badge expense" style="${paid ? 'background: var(--text-muted)' : ''}"></div>
                <div class="item-title" style="margin-top:0.8rem; ${paid ? 'text-decoration: line-through; color:var(--text-muted)' : ''}"><a href="#/membro/${m.id}" class="client-link">${m.nome}</a></div>
                <div class="item-subtitle">Equipe - ${m.cargo} (${m.tipo.replace('_', ' ')})</div>
              </div>
              <div>
                ${paid 
                  ? `<span class="badge badge-neutral"><i class="ph ph-check" style="margin-right:4px"></i>Pago</span>`
                  : `<button class="btn-secondary btn-confirm-cal" style="padding: 0.4rem 0.8rem; font-size:0.75rem" 
                        data-refid="${refId}" data-desc="Pagto. ${m.nome}" data-val="${m.custo_mensal || 0}" data-cat="Pagamento Equipe" data-tipo="saida">
                      <i class="ph ph-check-circle"></i> Confirmar
                    </button>`
                }
              </div>
            </div>
            <div class="item-meta">
              <i class="ph ph-money"></i> Previsto: ${formatBRL(m.custo_mensal || 0)}
            </div>
          </div>
        `;
      });
      selectedDeadlines.forEach(d => {
        const statusLabel = d.estourado ? `${Math.abs(d.diasRestantes)}d atrasado` : d.diasRestantes === 0 ? 'Vence hoje' : `${d.diasRestantes}d restante${d.diasRestantes > 1 ? 's' : ''}`;
        const statusColor = d.estourado ? 'var(--danger)' : d.diasRestantes <= 1 ? '#ea580c' : d.diasRestantes <= 3 ? '#eab308' : 'var(--success)';
        panelItemsHTML += `
          <div class="scheduled-item">
            <div class="item-top">
              <div>
                <div class="item-badge" style="background:${d.clienteCor}"></div>
                <div class="item-title" style="margin-top:0.8rem">${d.workflowTitle}</div>
                <div class="item-subtitle">${d.clienteNome} · Etapa: ${d.etapaNome}</div>
              </div>
              <div>
                <span class="badge" style="font-size:0.7rem"><i class="ph ph-flag-banner" style="margin-right:4px"></i>${statusLabel}</span>
              </div>
            </div>
            <div class="item-meta">
              <i class="ph ph-kanban"></i> Prazo da etapa
            </div>
          </div>
        `;
      });
    }

    el.innerHTML = `
      <div class="calendar-layout">
        <div class="calendar-main">
          <div class="calendar-header">
            <div class="calendar-title-group">
              <h2>${monthNames[month]}</h2>
              <span>${year}</span>
            </div>
            <div class="calendar-nav">
              <button id="btn-prev-month"><i class="ph ph-caret-left"></i></button>
              <button id="btn-next-month"><i class="ph ph-caret-right"></i></button>
            </div>
          </div>
          <div class="calendar-weekdays">
            ${weekDays.map(wd => `<div>${wd}</div>`).join('')}
          </div>
          <div class="calendar-grid">
            ${gridHTML}
          </div>
        </div>

        <div class="scheduled-panel">
          <div class="scheduled-header">
            <h3>Agendado</h3>
            <p>${selectedDate.getDate()} de ${monthNames[selectedDate.getMonth()]}, ${selectedDate.getFullYear()}</p>
          </div>
          <div class="scheduled-list custom-scrollbar">
            ${panelItemsHTML}
          </div>
        </div>
      </div>
    `;

    // Attach Events inside Financeiro
    el.querySelector('#btn-prev-month')?.addEventListener('click', () => {
      currentDate.setMonth(currentDate.getMonth() - 1);
      renderFinanceiro(el);
    });

    el.querySelector('#btn-next-month')?.addEventListener('click', () => {
      currentDate.setMonth(currentDate.getMonth() + 1);
      renderFinanceiro(el);
    });

    el.querySelectorAll('.calendar-day').forEach(dayEl => {
      dayEl.addEventListener('click', () => {
        const dayStr = dayEl.getAttribute('data-day');
        if (dayStr) {
          selectedDate = new Date(year, month, parseInt(dayStr));
          renderFinanceiro(el); // Re-render só o componente
        }
      });
    });

    el.querySelectorAll('.btn-confirm-cal').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const elBtn = btn as HTMLElement;
        const refId = elBtn.dataset.refid!;
        const desc = elBtn.dataset.desc!;
        const val = Number(elBtn.dataset.val);
        const cat = elBtn.dataset.cat!;
        const tipo = elBtn.dataset.tipo as 'entrada' | 'saida';

        openConfirm('Confirmar Agendamento', `Confirmar o recebimento/pagamento agendado de ${desc} (${formatBRL(val)})?`, async () => {
          try {
            const { addTransacao } = await import('../store');
            await addTransacao({
               descricao: desc,
               detalhe: 'Baixa efetuada pelo Calendário',
               categoria: cat,
               valor: val,
               data: new Date().toISOString().split('T')[0],
               tipo: tipo,
               status: 'pago',
               referencia_agendamento: refId
            });
            showToast('Pagamento confirmado e gravado em Caixa!', 'success');
            await loadData(); 
          } catch (err: unknown) {
             showToast('Erro: ' + (err instanceof Error ? err.message : 'Desconhecido'), 'error');
          }
        });
      });
    });
  };

  // --- Render Medico ---
  const renderMedico = (el: HTMLElement) => {
    let totalVisible = 0;
    let cardsHTML = '';

    medicalData.forEach(month => {
      const filtered = month.events.filter(e => {
        const matchFilter = activeFilter === "all" || e.tags.includes(activeFilter);
        const matchSearch = !searchTerm || e.name.toLowerCase().includes(searchTerm.toLowerCase()) || e.date.toLowerCase().includes(searchTerm.toLowerCase());
        return matchFilter && matchSearch;
      });

      if (filtered.length === 0) return;
      totalVisible += filtered.length;

      const eventsHTML = filtered.map(e => `
        <div class="event-item">
          <div class="event-date">${e.date}</div>
          <div class="event-dot ${dotClass[e.type] || 'type-world'}"></div>
          <div class="event-name">${e.name}</div>
        </div>
      `).join("");

      cardsHTML += `
        <div class="month-card">
          <div class="month-header">
            <div>
              <div class="month-name">${month.month}</div>
              <div class="month-num">${month.num}</div>
            </div>
            ${month.badge ? `<div class="month-badge">${month.badge}</div>` : ""}
          </div>
          <div class="month-events">
            ${eventsHTML}
          </div>
        </div>
      `;
    });

    if (totalVisible === 0) {
      cardsHTML = `<div class="no-results">Nenhuma data encontrada para "${searchTerm}"</div>`;
    }

    el.innerHTML = `
      <div class="legend">
        <div class="legend-item"><div class="legend-dot" style="background:var(--primary-color)"></div>Brasil</div>
        <div class="legend-item"><div class="legend-dot" style="background:var(--teal)"></div>Mundial / OMS / OPAS</div>
        <div class="legend-item"><div class="legend-dot" style="background:var(--warning)"></div>Profissões</div>
        <div class="legend-item"><div class="legend-dot" style="background:var(--pink)"></div>Semanas</div>
        <div class="legend-item"><div class="legend-dot" style="background:var(--danger)"></div>Meses temáticos</div>
      </div>
      <div class="med-controls">
        <button class="filter-btn ${activeFilter === 'all' ? 'active' : ''}" data-filter="all">Todos</button>
        <button class="filter-btn ${activeFilter === 'br' ? 'active' : ''}" data-filter="br">🇧🇷 Brasil</button>
        <button class="filter-btn ${activeFilter === 'world' ? 'active' : ''}" data-filter="world">🌍 Mundial</button>
        <button class="filter-btn ${activeFilter === 'cancer' ? 'active' : ''}" data-filter="cancer">Câncer</button>
        <button class="filter-btn ${activeFilter === 'saude-mental' ? 'active' : ''}" data-filter="saude-mental">Saúde Mental</button>
        <button class="filter-btn ${activeFilter === 'cardio' ? 'active' : ''}" data-filter="cardio">Cardio/Vascular</button>
        <button class="filter-btn ${activeFilter === 'infeccao' ? 'active' : ''}" data-filter="infeccao">Infecções</button>
        <button class="filter-btn ${activeFilter === 'prof' ? 'active' : ''}" data-filter="prof">Profissões</button>
        <input class="med-search-input" id="med-search" type="text" placeholder="Buscar data ou condição…" value="${searchTerm}">
      </div>

      <div class="count-bar"><span>${totalVisible}</span> datas exibidas</div>

      <div class="med-grid">
        ${cardsHTML}
      </div>
    `;

    // Attach Events inside Medico
    el.querySelectorAll('button.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        activeFilter = (e.target as HTMLElement).dataset.filter!;
        renderMedico(el); // Re-render so this portion updates
      });
    });

    const searchInput = el.querySelector('#med-search') as HTMLInputElement;
    searchInput?.addEventListener('input', (e) => {
      searchTerm = (e.target as HTMLInputElement).value;
      renderMedico(el);
      // Re-focus after render prevents losing focus, but simplest is to just re-query or not lose it.
      // Easiest trick is delay rendering or restore cursor. We'll restore cursor:
      const selStart = searchInput.selectionStart;
      setTimeout(() => {
         const newSearch = el.querySelector('#med-search') as HTMLInputElement;
         if (newSearch) { newSearch.focus(); newSearch.setSelectionRange(selStart, selStart); }
      }, 0);
    });
  };

  // --- Start Up ---
  container.innerHTML = `
    <header class="header animate-up">
      <div class="header-title">
        <h1>Agenda & Pagamentos</h1>
        <p>Carregando dados dos meses...</p>
      </div>
    </header>
    <div style="padding: 2rem; color: var(--text-muted); text-align: center;" class="animate-up">
      <i class="ph ph-circle-notch ph-spin" style="font-size: 2rem;"></i>
    </div>
  `;
  await loadData();
}
