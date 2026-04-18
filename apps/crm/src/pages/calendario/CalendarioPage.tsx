import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Globe, Flag } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import {
  getClientes, getMembros, getTransacoes, getWorkflows, getWorkflowEtapas,
  addTransacao, formatBRL, formatDate, getAllClienteDatas,
  type Cliente, type Membro, type Transacao, type ClienteData,
} from '../../store';
import { useAuth } from '../../context/AuthContext';

// ---- Types ----
interface DeadlineEvent {
  workflowTitle: string;
  etapaNome: string;
  clienteNome: string;
  clienteCor: string;
  deadlineDate: Date;
  diasRestantes: number;
  estourado: boolean;
}

// ---- Medical Calendar Data ----
const medicalData = [
  {
    month: "Janeiro", num: "01", badge: "Roxo · Hanseníase",
    events: [
      { date: "02/01", name: "Dia do Sanitarista", type: "prof", tags: ["br", "prof"] },
      { date: "04/01", name: "Dia do Hemofílico", type: "br", tags: ["br"] },
      { date: "19/01", name: "Dia Mundial do Terapeuta Ocupacional", type: "world", tags: ["world", "prof"] },
      { date: "20/01", name: "Dia do Farmacêutico", type: "prof", tags: ["br", "prof"] },
      { date: "20/01", name: "Dia Nacional da Parteira Tradicional", type: "br", tags: ["br", "prof"] },
      { date: "29/01", name: "Dia Nacional da Visibilidade Trans", type: "br", tags: ["br"] },
      { date: "30/01", name: "Dia Mundial das Doenças Tropicais Negligenciadas", type: "world", tags: ["world", "infeccao"] },
      { date: "Último dom.", name: "Dia Nacional de Combate e Prevenção da Hanseníase", type: "br", tags: ["br", "infeccao"] },
    ]
  },
  {
    month: "Fevereiro", num: "02", badge: "Laranja · Leucemia",
    events: [
      { date: "01–08/02", name: "Semana Nacional de Prevenção da Gravidez na Adolescência", type: "week", tags: ["br", "week"] },
      { date: "04/02", name: "Dia Mundial do Câncer (OMS)", type: "world", tags: ["world", "cancer"] },
      { date: "05/02", name: "Dia Nacional da Mamografia", type: "br", tags: ["br", "cancer"] },
      { date: "10/02", name: "Dia Internacional da Epilepsia", type: "world", tags: ["world", "saude-mental"] },
      { date: "13/02", name: "Dia Internacional do Preservativo", type: "world", tags: ["world", "infeccao"] },
      { date: "14/02", name: "Dia Mundial dos Enfermos", type: "world", tags: ["world"] },
      { date: "15/02", name: "Dia Internacional de Luta contra o Câncer Infantil", type: "world", tags: ["world", "cancer"] },
      { date: "18/02", name: "Dia Nacional da Criança Traqueostomizada", type: "br", tags: ["br"] },
      { date: "20/02", name: "Dia Nacional de Combate às Drogas e Alcoolismo", type: "br", tags: ["br", "saude-mental"] },
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
      { date: "04/03", name: "Dia Internacional de Conscientização sobre HPV", type: "world", tags: ["world", "cancer", "infeccao"] },
      { date: "08/03", name: "Dia Internacional da Mulher", type: "world", tags: ["world"] },
      { date: "10/03", name: "Dia Nacional de Combate ao Sedentarismo", type: "br", tags: ["br"] },
      { date: "10–16/03", name: "Semana Mundial do Glaucoma", type: "week", tags: ["world", "week"] },
      { date: "2ª qui.", name: "Dia Mundial do Rim (OMS)", type: "world", tags: ["world"] },
      { date: "15/03", name: "Dia Mundial de Conscientização sobre Covid Longa", type: "world", tags: ["world", "infeccao"] },
      { date: "18/03", name: "Dia Mundial do Sono", type: "world", tags: ["world"] },
      { date: "20/03", name: "Dia Mundial da Saúde Bucal", type: "world", tags: ["world"] },
      { date: "21/03", name: "Dia Mundial e Nacional da Síndrome de Down", type: "world", tags: ["world", "br"] },
      { date: "22/03", name: "Dia Mundial da Água (OMS)", type: "world", tags: ["world"] },
      { date: "24/03", name: "Dia Mundial de Combate à Tuberculose (OMS)", type: "world", tags: ["world", "infeccao"] },
      { date: "24–31/03", name: "Semana Nacional de Luta Contra a Tuberculose", type: "week", tags: ["br", "week", "infeccao"] },
      { date: "26/03", name: "Dia Mundial do Câncer de Colo de Útero", type: "world", tags: ["world", "cancer"] },
      { date: "27/03", name: "Dia Nacional de Combate ao Câncer Colorretal", type: "br", tags: ["br", "cancer"] },
      { date: "30/03", name: "Dia Mundial do Transtorno Bipolar", type: "world", tags: ["world", "saude-mental"] },
      { date: "31/03", name: "Dia da Saúde e da Nutrição", type: "br", tags: ["br"] },
    ]
  },
  {
    month: "Abril", num: "04", badge: "Verde · Saúde no Trabalho",
    events: [
      { date: "Abril", name: "Abril Verde — Saúde e Segurança no Trabalho", type: "month", tags: ["br", "month"] },
      { date: "02/04", name: "Dia Mundial de Conscientização sobre o Autismo", type: "world", tags: ["world", "br", "saude-mental"] },
      { date: "02–07/04", name: "Semana da Saúde no Brasil", type: "week", tags: ["br", "week"] },
      { date: "04/04", name: "Dia Nacional do Portador da Doença de Parkinson", type: "br", tags: ["br"] },
      { date: "06/04", name: "Dia Mundial da Atividade Física", type: "world", tags: ["world"] },
      { date: "07/04", name: "Dia Mundial da Saúde (OMS)", type: "world", tags: ["world"] },
      { date: "11/04", name: "Dia do Infectologista", type: "prof", tags: ["prof"] },
      { date: "11/04", name: "Dia Mundial de Conscientização da Doença de Parkinson", type: "world", tags: ["world"] },
      { date: "12/04", name: "Dia do Obstetra", type: "prof", tags: ["prof"] },
      { date: "14/04", name: "Dia Mundial da Doença de Chagas (OMS)", type: "world", tags: ["world", "infeccao"] },
      { date: "17/04", name: "Dia Mundial da Hemofilia", type: "world", tags: ["world"] },
      { date: "24/04", name: "Dia Mundial de Combate à Meningite", type: "world", tags: ["world", "infeccao"] },
      { date: "23–30/04", name: "Semana de Vacinação nas Américas (OPAS)", type: "week", tags: ["world", "week", "infeccao"] },
      { date: "24–30/04", name: "Semana Mundial da Imunização (OMS)", type: "week", tags: ["world", "week", "infeccao"] },
      { date: "25/04", name: "Dia Mundial da Malária (OMS)", type: "world", tags: ["world", "infeccao"] },
      { date: "26/04", name: "Dia Nacional de Prevenção e Combate à Hipertensão Arterial", type: "br", tags: ["br", "cardio"] },
      { date: "28/04", name: "Dia Mundial da Segurança e Saúde no Trabalho (OIT)", type: "world", tags: ["world"] },
      { date: "28/04", name: "Dia Nacional — Vítimas de Acidentes e Doenças do Trabalho", type: "br", tags: ["br"] },
    ]
  },
  {
    month: "Maio", num: "05", badge: "Amarelo · Trânsito",
    events: [
      { date: "1ª ter.", name: "Dia Mundial de Combate à Asma", type: "world", tags: ["world"] },
      { date: "05/05", name: "Dia Mundial de Higienização das Mãos (OMS)", type: "world", tags: ["world", "infeccao"] },
      { date: "05/05", name: "Dia Internacional da Parteira", type: "world", tags: ["world", "prof"] },
      { date: "05/05", name: "Dia Nacional do Uso Racional de Medicamentos", type: "br", tags: ["br"] },
      { date: "07/05", name: "Dia Internacional da Luta contra a Endometriose", type: "world", tags: ["world"] },
      { date: "08/05", name: "Dia da Talassemia", type: "world", tags: ["world"] },
      { date: "08/05", name: "Dia Mundial do Câncer de Ovário", type: "world", tags: ["world", "cancer"] },
      { date: "10/05", name: "Dia Mundial do Lúpus", type: "world", tags: ["world"] },
      { date: "12/05", name: "Dia da Enfermagem", type: "world", tags: ["world", "prof"] },
      { date: "12/05", name: "Dia da Conscientização da Fibromialgia", type: "world", tags: ["world"] },
      { date: "14/05", name: "Dia Nacional — Doenças Cardiovasculares na Mulher", type: "br", tags: ["br", "cardio"] },
      { date: "15/05", name: "Dia de Combate à Infecção Hospitalar", type: "world", tags: ["world", "infeccao"] },
      { date: "16/05", name: "Dia Mundial de Conscientização sobre Doença Celíaca", type: "world", tags: ["world"] },
      { date: "17/05", name: "Dia Mundial da Hipertensão Arterial", type: "world", tags: ["world", "cardio"] },
      { date: "18/05", name: "Dia Nacional da Luta Antimanicomial", type: "br", tags: ["br", "saude-mental"] },
      { date: "19/05", name: "Dia Mundial da Doença Inflamatória Intestinal", type: "world", tags: ["world"] },
      { date: "19/05", name: "Dia Nacional de Doação de Leite Humano", type: "br", tags: ["br"] },
      { date: "19/05", name: "Dia Nacional de Combate à Cefaleia", type: "br", tags: ["br"] },
      { date: "22/05", name: "Dia Mundial da Pré-eclâmpsia", type: "world", tags: ["world", "cardio"] },
      { date: "25/05", name: "Dia Mundial da Tireoide", type: "world", tags: ["world"] },
      { date: "28/05", name: "Dia Internacional de Ação pela Saúde da Mulher", type: "world", tags: ["world"] },
      { date: "29/05", name: "Dia Mundial da Saúde Digestiva (OMGE)", type: "world", tags: ["world"] },
      { date: "Últ. qua.", name: "Dia Mundial da Esclerose Múltipla", type: "world", tags: ["world"] },
      { date: "31/05", name: "Dia Mundial Sem Tabaco (OMS)", type: "world", tags: ["world", "cancer"] },
    ]
  },
  {
    month: "Junho", num: "06", badge: "Laranja · Queimaduras",
    events: [
      { date: "Junho", name: "Junho Laranja — Prevenção a Queimaduras", type: "month", tags: ["br", "month"] },
      { date: "Junho", name: "Junho Vermelho — Doação de Sangue", type: "month", tags: ["br", "month"] },
      { date: "02/06", name: "Dia Mundial de Conscientização dos Transtornos Alimentares", type: "world", tags: ["world", "saude-mental"] },
      { date: "05/06", name: "Dia Mundial do Meio Ambiente (ONU)", type: "world", tags: ["world"] },
      { date: "06/06", name: "Dia Nacional de Luta Contra Queimaduras", type: "br", tags: ["br"] },
      { date: "06/06", name: "Dia Nacional do Teste do Pezinho", type: "br", tags: ["br"] },
      { date: "07/06", name: "Dia Mundial da Segurança Alimentar (OMS)", type: "world", tags: ["world"] },
      { date: "09/06", name: "Dia Nacional da Imunização", type: "br", tags: ["br", "infeccao"] },
      { date: "11/06", name: "Dia Mundial do Câncer de Próstata", type: "world", tags: ["world", "cancer"] },
      { date: "14/06", name: "Dia Mundial do Doador de Sangue (OMS)", type: "world", tags: ["world"] },
      { date: "15/06", name: "Dia Mundial de Conscientização sobre o Abuso Contra a Pessoa Idosa", type: "world", tags: ["world"] },
      { date: "19/06", name: "Dia Mundial de Conscientização sobre a Doença Falciforme (ONU)", type: "world", tags: ["world"] },
      { date: "21/06", name: "Dia Nacional de Combate à Asma", type: "br", tags: ["br"] },
      { date: "21/06", name: "Dia Nacional de Luta Contra a ELA", type: "br", tags: ["br"] },
      { date: "25/06", name: "Dia Mundial do Vitiligo", type: "world", tags: ["world"] },
      { date: "26/06", name: "Dia Nacional do Diabetes", type: "br", tags: ["br"] },
      { date: "26/06", name: "Dia Internacional — Abuso e Tráfico Ilícito de Drogas (ONU)", type: "world", tags: ["world", "saude-mental"] },
    ]
  },
  {
    month: "Julho", num: "07", badge: "Amarelo · Hepatites Virais",
    events: [
      { date: "Julho", name: "Julho Amarelo — Hepatites Virais", type: "month", tags: ["br", "month", "infeccao"] },
      { date: "01/07", name: "Dia da Vacina BCG", type: "br", tags: ["br", "infeccao"] },
      { date: "02/07", name: "Dia do Hospital", type: "br", tags: ["br"] },
      { date: "06/07", name: "Dia Mundial das Zoonoses", type: "world", tags: ["world", "infeccao"] },
      { date: "09/07", name: "Dia Nacional de Alerta Contra a Insuficiência Cardíaca", type: "br", tags: ["br", "cardio"] },
      { date: "10/07", name: "Dia da Saúde Ocular", type: "br", tags: ["br"] },
      { date: "22/07", name: "Dia Mundial do Cérebro (FMN)", type: "world", tags: ["world"] },
      { date: "25/07", name: "Dia Mundial de Prevenção do Afogamento (OMS)", type: "world", tags: ["world"] },
      { date: "27/07", name: "Dia Mundial do Câncer de Cabeça e Pescoço", type: "world", tags: ["world", "cancer"] },
      { date: "28/07", name: "Dia Mundial da Hepatite (OMS)", type: "world", tags: ["world", "infeccao"] },
    ]
  },
  {
    month: "Agosto", num: "08", badge: "Dourado · Amamentação",
    events: [
      { date: "Agosto", name: "Agosto Dourado — Amamentação", type: "month", tags: ["br", "month"] },
      { date: "01–07/08", name: "Semana Mundial da Amamentação (OMS)", type: "week", tags: ["world", "week"] },
      { date: "01/08", name: "Dia Mundial de Combate ao Câncer de Pulmão", type: "world", tags: ["world", "cancer"] },
      { date: "01/08", name: "Dia Nacional dos Portadores de Vitiligo", type: "br", tags: ["br"] },
      { date: "08/08", name: "Dia Nacional da Pessoa com Atrofia Muscular Espinhal (AME)", type: "br", tags: ["br"] },
      { date: "Sem. 10/08", name: "Semana Nacional de Controle e Combate à Leishmaniose", type: "week", tags: ["br", "week", "infeccao"] },
      { date: "12/08", name: "Dia Internacional da Juventude (ONU)", type: "world", tags: ["world"] },
      { date: "26/08", name: "Dia Nacional de Combate ao Colesterol", type: "br", tags: ["br", "cardio"] },
      { date: "Últ. 5ª", name: "Dia Nacional da Diálise", type: "br", tags: ["br"] },
    ]
  },
  {
    month: "Setembro", num: "09", badge: "Amarelo-Verde · Suicídio",
    events: [
      { date: "Setembro", name: "Setembro Amarelo — Prevenção ao Suicídio", type: "month", tags: ["br", "month", "saude-mental"] },
      { date: "Setembro", name: "Setembro Verde — Doação de Órgãos", type: "month", tags: ["br", "month"] },
      { date: "01/09", name: "Dia Mundial da Saúde do Coração", type: "world", tags: ["world", "cardio"] },
      { date: "02/09", name: "Dia Nacional de Prevenção à Gravidez na Adolescência", type: "br", tags: ["br"] },
      { date: "05/09", name: "Dia Nacional da Doação de Sangue e Órgãos", type: "br", tags: ["br"] },
      { date: "10/09", name: "Dia Mundial de Prevenção ao Suicídio (OMS)", type: "world", tags: ["world", "saude-mental"] },
      { date: "15/09", name: "Dia Internacional da Democracia (ONU)", type: "world", tags: ["world"] },
      { date: "17/09", name: "Dia Mundial da Segurança do Paciente (OMS)", type: "world", tags: ["world"] },
      { date: "21/09", name: "Dia Mundial da Doença de Alzheimer (ADI)", type: "world", tags: ["world", "saude-mental"] },
      { date: "28/09", name: "Dia Internacional do Acesso Seguro ao Aborto", type: "world", tags: ["world"] },
      { date: "29/09", name: "Dia Mundial do Coração (OMS)", type: "world", tags: ["world", "cardio"] },
    ]
  },
  {
    month: "Outubro", num: "10", badge: "Rosa · Câncer de Mama",
    events: [
      { date: "Outubro", name: "Outubro Rosa — Câncer de Mama", type: "month", tags: ["br", "month", "cancer"] },
      { date: "Outubro", name: "Outubro Azul — Saúde do Homem / Câncer de Próstata", type: "month", tags: ["br", "month", "cancer"] },
      { date: "04/10", name: "Dia da Medicina do Trabalho / Médico do Trabalho", type: "prof", tags: ["prof"] },
      { date: "05/10", name: "Dia Mundial de Saúde Mental (OMS)", type: "world", tags: ["world", "saude-mental"] },
      { date: "10/10", name: "Dia Mundial da Saúde Mental (WFMH)", type: "world", tags: ["world", "saude-mental"] },
      { date: "10/10", name: "Dia Nacional dos Direitos Fundamentais da Pessoa com Transtornos Mentais", type: "br", tags: ["br", "saude-mental"] },
      { date: "11/10", name: "Dia Nacional de Prevenção da Obesidade", type: "br", tags: ["br"] },
      { date: "13/10", name: "Dia do Terapeuta Ocupacional e Fisioterapeuta", type: "prof", tags: ["prof"] },
      { date: "15/10", name: "Dia Mundial da Visão (OMS)", type: "world", tags: ["world"] },
      { date: "16/10", name: "Dia Mundial da Alimentação (FAO)", type: "world", tags: ["world"] },
      { date: "20/10", name: "Dia do Médico", type: "prof", tags: ["br", "prof"] },
      { date: "20/10", name: "Dia Nacional do Câncer de Mama", type: "br", tags: ["br", "cancer"] },
      { date: "22/10", name: "Dia Internacional de Atenção à Gagueira", type: "world", tags: ["world"] },
      { date: "23/10", name: "Dia Nacional de Combate à Dengue", type: "br", tags: ["br", "infeccao"] },
      { date: "26/10", name: "Dia Nacional de Combate ao Câncer de Cabeça e Pescoço", type: "br", tags: ["br", "cancer"] },
      { date: "29/10", name: "Dia Mundial do AVC (OMS)", type: "world", tags: ["world", "cardio"] },
    ]
  },
  {
    month: "Novembro", num: "11", badge: "Azul · Saúde do Homem",
    events: [
      { date: "Novembro", name: "Novembro Azul — Saúde do Homem / Câncer de Próstata", type: "month", tags: ["br", "month", "cancer"] },
      { date: "03/11", name: "Dia Mundial e Nacional da Saúde Única (Lei nº 14.792/2024)", type: "br", tags: ["br", "world"] },
      { date: "12/11", name: "Dia Mundial do Combate ao Diabetes (FID)", type: "world", tags: ["world"] },
      { date: "14/11", name: "Dia Mundial do Diabetes (OMS/FID)", type: "world", tags: ["world"] },
      { date: "17/11", name: "Dia Mundial da Prematuridade (OMS)", type: "world", tags: ["world"] },
      { date: "20/11", name: "Dia Nacional da Consciência Negra", type: "br", tags: ["br"] },
      { date: "21/11", name: "Dia do Odontologista", type: "prof", tags: ["prof"] },
      { date: "Penúlt. sáb.", name: "Dia Nacional de Combate à Dengue", type: "br", tags: ["br", "infeccao"] },
      { date: "23/11", name: "Dia Nacional de Combate ao Câncer Infanto-Juvenil", type: "br", tags: ["br", "cancer"] },
      { date: "25/11", name: "Dia Internacional pela Eliminação da Violência contra a Mulher", type: "world", tags: ["world"] },
    ]
  },
  {
    month: "Dezembro", num: "12", badge: "Vermelho · HIV/AIDS / Laranja · Câncer de Pele",
    events: [
      { date: "Dezembro", name: "Dezembro Vermelho — Prevenção ao HIV/AIDS", type: "month", tags: ["br", "month", "infeccao"] },
      { date: "Dezembro", name: "Dezembro Laranja — Câncer de Pele", type: "month", tags: ["br", "month", "cancer"] },
      { date: "01/12", name: "Dia Mundial de Luta Contra a AIDS (OMS)", type: "world", tags: ["world", "infeccao"] },
      { date: "03/12", name: "Dia Internacional da Pessoa com Deficiência (ONU)", type: "world", tags: ["world"] },
      { date: "06/12", name: "Dia Nacional de Mobilização dos Homens pelo Fim da Violência contra Mulheres", type: "br", tags: ["br"] },
      { date: "09/12", name: "Dia da Nutrição e da Alimentação", type: "br", tags: ["br"] },
      { date: "10/12", name: "Dia dos Direitos Humanos (ONU)", type: "world", tags: ["world"] },
      { date: "17/12", name: "Dia Nacional dos Hansenianos", type: "br", tags: ["br", "infeccao"] },
      { date: "27/12", name: "Dia do Médico Sanitarista", type: "prof", tags: ["prof"] },
    ]
  },
];

const dotColorMap: Record<string, string> = {
  br: '#eab308',
  world: '#14b8a6',
  prof: '#f59e0b',
  week: '#ec4899',
  month: '#ef4444',
};

// ---- Financeiro Calendar ----
function FinanceiroCalendar({
  clientes,
  membros,
  transacoes,
  deadlineEvents,
  datasImportantes,
  role,
}: {
  clientes: Cliente[];
  membros: Membro[];
  transacoes: Transacao[];
  deadlineEvents: DeadlineEvent[];
  datasImportantes: ClienteData[];
  role: string;
}) {
  const qc = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(new Date().getDate());
  const [confirmPayload, setConfirmPayload] = useState<{ refId: string; desc: string; val: number; cat: string; tipo: 'entrada' | 'saida' } | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  const isAgent = role === 'agent';
  const today = new Date();
  const isSameMonth = currentDate.getMonth() === today.getMonth() && currentDate.getFullYear() === today.getFullYear();
  const isToday = (d: number) => today.getDate() === d && isSameMonth;

  const isPaid = (refId: string) => transacoes.some(t => t.referencia_agendamento === refId);

  const selectedIncomes = isAgent ? [] : clientes.filter(c => c.data_pagamento === selectedDay && c.status === 'ativo' && currentDate.getMonth() === currentDate.getMonth());
  const selectedExpenses = isAgent ? [] : membros.filter(m => m.data_pagamento === selectedDay);
  const selectedDeadlines = deadlineEvents.filter(d =>
    d.deadlineDate.getDate() === selectedDay &&
    d.deadlineDate.getMonth() === month &&
    d.deadlineDate.getFullYear() === year
  );

  // Birthday events for this month (recurring annually by month+day — stored as MM-DD)
  const birthdayClients = clientes.filter(c => {
    if (!c.data_aniversario) return false;
    const [bdMm, bdDd] = c.data_aniversario.split('-').map(Number);
    return (bdMm - 1) === month && bdDd === selectedDay;
  });

  // Important dates for this month/day
  const selectedDatas = datasImportantes.filter(d => {
    const dt = new Date(d.data + 'T00:00:00');
    return dt.getMonth() === month && dt.getDate() === selectedDay && dt.getFullYear() === year;
  });

  const handleConfirm = (refId: string, desc: string, val: number, cat: string, tipo: 'entrada' | 'saida') => {
    setConfirmPayload({ refId, desc, val, cat, tipo });
  };

  const handleConfirmExecute = async () => {
    if (!confirmPayload) return;
    const { refId, desc, val, cat, tipo } = confirmPayload;
    try {
      await addTransacao({
        descricao: desc,
        detalhe: 'Baixa efetuada pelo Calendário',
        categoria: cat,
        valor: val,
        data: new Date().toISOString().split('T')[0],
        tipo,
        status: 'pago',
        referencia_agendamento: refId,
      });
      toast.success('Pagamento confirmado!');
      qc.invalidateQueries({ queryKey: ['transacoes'] });
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro');
    } finally {
      setConfirmPayload(null);
    }
  };

  return (
    <>
      <div className="calendar-layout">
        <div className="calendar-main">
          <div className="calendar-header">
            <div className="calendar-title-group">
              <h2>{monthNames[month]}</h2>
              <span>{year}</span>
            </div>
            <div className="calendar-nav">
              <button onClick={() => setCurrentDate(d => { const n = new Date(d); n.setMonth(n.getMonth() - 1); return n; })}>‹</button>
              <button onClick={() => setCurrentDate(d => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n; })}>›</button>
            </div>
          </div>
          <div className="calendar-weekdays">
            {weekDays.map(wd => <div key={wd}>{wd}</div>)}
          </div>
          <div className="calendar-grid">
            {Array.from({ length: firstDay }, (_, i) => (
              <div key={`e${i}`} className="calendar-day empty" />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const d = i + 1;
              const dayIncomes = isAgent ? [] : clientes.filter(c => c.data_pagamento === d && c.status === 'ativo');
              const dayExpenses = isAgent ? [] : membros.filter(m => m.data_pagamento === d);
              const dayDeadlines = deadlineEvents.filter(de =>
                de.deadlineDate.getDate() === d &&
                de.deadlineDate.getMonth() === month &&
                de.deadlineDate.getFullYear() === year
              );
              const dayBirthdays = clientes.filter(c => {
                if (!c.data_aniversario) return false;
                const [bdMm, bdDd] = c.data_aniversario.split('-').map(Number);
                return (bdMm - 1) === month && bdDd === d;
              });
              const dayDatas = datasImportantes.filter(di => {
                const dt = new Date(di.data + 'T00:00:00');
                return dt.getMonth() === month && dt.getDate() === d && dt.getFullYear() === year;
              });
              const hasEvents = dayIncomes.length > 0 || dayExpenses.length > 0 || dayDeadlines.length > 0 || dayBirthdays.length > 0 || dayDatas.length > 0;
              return (
                <div
                  key={d}
                  className={`calendar-day ${isToday(d) ? 'today' : ''} ${selectedDay === d ? 'selected' : ''} ${hasEvents ? 'has-events' : ''}`}
                  onClick={() => setSelectedDay(d)}
                >
                  <span className="day-number">{d}</span>
                  <div className="day-events">
                    {dayIncomes.length > 0 && <div className="event-pill income">↗ {dayIncomes.length} Receb.</div>}
                    {dayExpenses.length > 0 && <div className="event-pill expense">↘ {dayExpenses.length} Desp.</div>}
                    {dayDeadlines.length > 0 && (
                      <div className={`event-pill deadline${dayDeadlines.some(dl => dl.estourado) ? ' overdue' : ''}`}>
                        ⚑ {dayDeadlines.length} Entrega{dayDeadlines.length > 1 ? 's' : ''}
                      </div>
                    )}
                    {dayBirthdays.length > 0 && (
                      <div className="event-pill" style={{ background: 'rgba(236, 72, 153, 0.12)', color: '#ec4899', fontWeight: 600 }}>
                        🎂 {dayBirthdays.length} Aniv.
                      </div>
                    )}
                    {dayDatas.length > 0 && (
                      <div className="event-pill" style={{ background: 'rgba(99, 102, 241, 0.12)', color: '#6366f1', fontWeight: 600 }}>
                        📅 {dayDatas.length} Data{dayDatas.length > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="scheduled-panel">
          <div className="scheduled-header">
            <h3>Agendado</h3>
            <p>{selectedDay} de {monthNames[month]}, {year}</p>
          </div>
          <div className="scheduled-list">
            {selectedIncomes.length === 0 && selectedExpenses.length === 0 && selectedDeadlines.length === 0 && birthdayClients.length === 0 && selectedDatas.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
                <p>Nenhuma movimentação neste dia.</p>
              </div>
            ) : (
              <>
                {selectedIncomes.map(c => {
                  const refId = `cliente_${c.id}_${year}_${String(month + 1).padStart(2, '0')}`;
                  const paid = isPaid(refId);
                  return (
                    <div key={c.id} className="scheduled-item">
                      <div className="item-top">
                        <div className="item-badge income" style={paid ? { background: 'var(--text-muted)' } : {}} />
                        {paid ? (
                          <span className="badge badge-neutral"><i className="ph ph-check-circle" style={{ marginRight: 4 }} /> PAGO</span>
                        ) : (
                          <button
                            className="btn-confirmar"
                            onClick={() => handleConfirm(refId, c.nome, c.valor_mensal, 'Mensalidade Cliente', 'entrada')}
                          >
                            <i className="ph ph-check-circle" /> CONFIRMAR
                          </button>
                        )}
                      </div>
                      <div className="item-title" style={paid ? { textDecoration: 'line-through', color: 'var(--text-muted)' } : {}}>
                        {c.nome}
                      </div>
                      <div className="item-subtitle">PLANO: {c.plano?.toUpperCase() || 'N/A'}</div>
                      <div className="item-divider" />
                      <div className="item-meta">
                        <i className="ph ph-money" /> Previsto: {formatBRL(c.valor_mensal)}
                      </div>
                    </div>
                  );
                })}

                {selectedExpenses.map(m => {
                  const refId = `membro_${m.id}_${year}_${String(month + 1).padStart(2, '0')}`;
                  const paid = isPaid(refId);
                  return (
                    <div key={m.id} className="scheduled-item">
                      <div className="item-top">
                        <div className="item-badge expense" style={paid ? { background: 'var(--text-muted)' } : {}} />
                        {paid ? (
                          <span className="badge badge-neutral"><i className="ph ph-check-circle" style={{ marginRight: 4 }} /> PAGO</span>
                        ) : (
                          <button
                            className="btn-confirmar"
                            onClick={() => handleConfirm(refId, `Pagto. ${m.nome}`, m.custo_mensal || 0, 'Pagamento Equipe', 'saida')}
                          >
                            <i className="ph ph-check-circle" /> CONFIRMAR
                          </button>
                        )}
                      </div>
                      <div className="item-title" style={paid ? { textDecoration: 'line-through', color: 'var(--text-muted)' } : {}}>
                        {m.nome}
                      </div>
                      <div className="item-subtitle">EQUIPE - {m.cargo?.toUpperCase()} ({m.tipo.replace('_', ' ').toUpperCase()})</div>
                      <div className="item-divider" />
                      <div className="item-meta">
                        <i className="ph ph-money" /> Previsto: {formatBRL(m.custo_mensal || 0)}
                      </div>
                    </div>
                  );
                })}

                {selectedDeadlines.map((d, i) => {
                  const statusLabel = d.estourado
                    ? `${Math.abs(d.diasRestantes)}d atrasado`
                    : d.diasRestantes === 0 ? 'Vence hoje'
                      : `${d.diasRestantes}d restante${d.diasRestantes > 1 ? 's' : ''}`;
                  return (
                    <div key={i} className="scheduled-item">
                      <div className="item-top">
                        <div className="item-badge" style={{ background: d.clienteCor }} />
                        <span className="badge" style={{ fontSize: '0.65rem' }}>⚑ {statusLabel.toUpperCase()}</span>
                      </div>
                      <div className="item-title">{d.workflowTitle}</div>
                      <div className="item-subtitle">{d.clienteNome} · ETAPA: {d.etapaNome}</div>
                      <div className="item-divider" />
                      <div className="item-meta">
                        <i className="ph ph-flag" /> Prazo da etapa
                      </div>
                    </div>
                  );
                })}

                {birthdayClients.map(c => (
                  <div key={`bday-${c.id}`} className="scheduled-item">
                    <div className="item-top">
                      <div className="item-badge" style={{ background: '#ec4899' }} />
                      <span className="badge" style={{ fontSize: '0.65rem', background: 'rgba(236, 72, 153, 0.12)', color: '#ec4899' }}>🎂 ANIVERSÁRIO</span>
                    </div>
                    <div className="item-title">{c.nome}</div>
                    <div className="item-subtitle">{(() => {
                      if (!c.data_aniversario) return '';
                      const [mm, dd] = c.data_aniversario.split('-');
                      const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
                      return `${parseInt(dd)} de ${meses[parseInt(mm) - 1]}`;
                    })()}</div>
                    <div className="item-divider" />
                    <div className="item-meta">
                      <i className="ph ph-cake" /> Aniversário do cliente
                    </div>
                  </div>
                ))}

                {selectedDatas.map(d => {
                  const clienteNome = clientes.find(c => c.id === d.cliente_id)?.nome || '—';
                  return (
                    <div key={`data-${d.id}`} className="scheduled-item">
                      <div className="item-top">
                        <div className="item-badge" style={{ background: '#6366f1' }} />
                        <span className="badge" style={{ fontSize: '0.65rem', background: 'rgba(99, 102, 241, 0.12)', color: '#6366f1' }}>📅 DATA IMPORTANTE</span>
                      </div>
                      <div className="item-title">{d.titulo}</div>
                      <div className="item-subtitle">{clienteNome}</div>
                      <div className="item-divider" />
                      <div className="item-meta">
                        <i className="ph ph-calendar" /> {formatDate(d.data)}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={confirmPayload !== null} onOpenChange={open => { if (!open) setConfirmPayload(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Agendamento</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmPayload && `Confirmar o recebimento/pagamento agendado de ${confirmPayload.desc} (${formatBRL(confirmPayload.val)})?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmExecute}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---- Medical Calendar ----
function MedicoCalendar() {
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  const filterOptions = [
    { key: 'all', label: 'Todos' },
    { key: 'br', label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Flag className="h-3.5 w-3.5" /> Brasil</span> },
    { key: 'world', label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Globe className="h-3.5 w-3.5" /> Mundial</span> },
    { key: 'prof', label: 'Profissional' },
    { key: 'cancer', label: 'Câncer' },
    { key: 'cardio', label: 'Cardiologia' },
    { key: 'saude-mental', label: 'Saúde Mental' },
    { key: 'infeccao', label: 'Infecção' },
  ];

  let totalVisible = 0;
  medicalData.forEach(monthData => {
    monthData.events.forEach(e => {
      const matchFilter = activeFilter === 'all' || e.tags?.includes(activeFilter);
      const matchSearch = !searchTerm || e.name.toLowerCase().includes(searchTerm.toLowerCase()) || e.date.toLowerCase().includes(searchTerm.toLowerCase());
      if (matchFilter && matchSearch) totalVisible++;
    });
  });

  return (
    <div>
      <div className="med-controls">
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {filterOptions.map(f => (
            <button
              key={f.key}
              className={`calendar-nav button ${activeFilter === f.key ? 'active' : ''}`}
              style={{
                background: activeFilter === f.key ? 'var(--primary-color)' : 'var(--surface-hover)',
                color: activeFilter === f.key ? '#fff' : 'var(--text-main)',
                border: '1px solid var(--border-color)',
                width: 'auto',
                padding: '0 0.8rem',
                borderRadius: '6px',
                height: 32,
                fontSize: '0.8rem',
                cursor: 'pointer',
                alignItems: 'center',
              }}
              onClick={() => setActiveFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <input
            type="text"
            placeholder="Buscar data..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{
              marginLeft: '0.5rem',
              background: 'var(--surface-main)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-main)',
              fontFamily: 'var(--font-main)',
              fontSize: '0.85rem',
              padding: '0.4rem 1rem',
              borderRadius: 6,
              outline: 'none',
              width: 240,
            }}
          />
        </div>

        <div className="med-count">
          <span>{totalVisible}</span> DATAS EXIBIDAS
        </div>
      </div>

      <div className="med-legend" style={{ marginBottom: '2rem' }}>
        <div className="med-legend-item"><div className="med-legend-dot" style={{ background: dotColorMap.br }} />Brasil</div>
        <div className="med-legend-item"><div className="med-legend-dot" style={{ background: dotColorMap.world }} />Mundial / OMS / OPAS</div>
        <div className="med-legend-item"><div className="med-legend-dot" style={{ background: dotColorMap.prof }} />Profissões</div>
        <div className="med-legend-item"><div className="med-legend-dot" style={{ background: dotColorMap.week }} />Semanas</div>
        <div className="med-legend-item"><div className="med-legend-dot" style={{ background: dotColorMap.month }} />Meses temáticos</div>
      </div>

      <div className="med-grid">
        {medicalData.map(monthData => {
          const filtered = monthData.events.filter(e => {
            const matchFilter = activeFilter === 'all' || e.tags?.includes(activeFilter);
            const matchSearch = !searchTerm || e.name.toLowerCase().includes(searchTerm.toLowerCase()) || e.date.toLowerCase().includes(searchTerm.toLowerCase());
            return matchFilter && matchSearch;
          });
          if (filtered.length === 0) return null;

          return (
            <div key={monthData.month} className="med-month-card">
              <div className="med-month-header">
                <div>
                  <div className="med-month-name">{monthData.month}</div>
                  <div className="med-month-num">{monthData.num}</div>
                </div>
                {monthData.badge && (
                  <span className="med-month-badge">
                    {monthData.badge}
                  </span>
                )}
              </div>
              <div className="med-events">
                {filtered.map((e, i) => (
                  <div key={i} className="med-event-item">
                    <div className="med-event-date">{e.date}</div>
                    <div className="med-event-dot" style={{ background: dotColorMap[e.type] || '#888' }} />
                    <div className="med-event-name">{e.name}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Main Page ----
export default function CalendarioPage() {
  const [activeTab, setActiveTab] = useState<'financeiro' | 'medico'>('financeiro');
  const { role } = useAuth();

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const { data: membros = [] } = useQuery({ queryKey: ['membros'], queryFn: getMembros });
  const { data: transacoes = [] } = useQuery({ queryKey: ['transacoes'], queryFn: getTransacoes });
  const { data: workflows = [] } = useQuery({ queryKey: ['workflows'], queryFn: getWorkflows });
  const { data: datasImportantes = [] } = useQuery({ queryKey: ['allClienteDatas'], queryFn: getAllClienteDatas });

  // Build deadline events from active workflows
  const { data: deadlineEvents = [] } = useQuery({
    queryKey: ['calendar-deadlines', workflows.map(w => w.id).join(',')],
    queryFn: async () => {
      const activeWfs = workflows.filter(w => w.status === 'ativo');
      const etapasResults = await Promise.all(activeWfs.map(w => getWorkflowEtapas(w.id!)));
      const events: DeadlineEvent[] = [];
      activeWfs.forEach((w, idx) => {
        const etapas = etapasResults[idx];
        const activeEtapa = etapas.find(e => e.status === 'ativo');
        if (!activeEtapa || !activeEtapa.iniciado_em) return;
        const cliente = clientes.find(c => c.id === w.cliente_id);
        const inicio = new Date(activeEtapa.iniciado_em);
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
        events.push({
          workflowTitle: w.titulo,
          etapaNome: activeEtapa.nome,
          clienteNome: cliente?.nome || '—',
          clienteCor: cliente?.cor || '#888',
          deadlineDate,
          diasRestantes,
          estourado: diasRestantes < 0,
        });
      });
      return events;
    },
    enabled: workflows.length > 0,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <header className="header animate-up">
        <div className="header-title">
          <h1>{activeTab === 'financeiro' ? 'Calendário' : 'Calendário Médico'}</h1>
          <p style={{ color: 'var(--text-muted)' }}>
            {activeTab === 'financeiro' ? 'Visão geral mensal.' : 'Brasil & Mundial — Datas de Saúde & Conscientização'}
          </p>
        </div>
      </header>

      <div className="calendar-tabs animate-up">
        <button
          className={`calendar-tab${activeTab === 'financeiro' ? ' active' : ''}`}
          onClick={() => setActiveTab('financeiro')}
        >
          Calendário
        </button>
        <button
          className={`calendar-tab${activeTab === 'medico' ? ' active' : ''}`}
          onClick={() => setActiveTab('medico')}
        >
          Datas Médicas
        </button>
      </div>

      <div className="animate-up">
        {activeTab === 'financeiro' ? (
          <FinanceiroCalendar
            clientes={clientes}
            membros={membros}
            transacoes={transacoes}
            deadlineEvents={deadlineEvents}
            datasImportantes={datasImportantes}
            role={role || 'owner'}
          />
        ) : (
          <MedicoCalendar />
        )}
      </div>
    </div>
  );
}
