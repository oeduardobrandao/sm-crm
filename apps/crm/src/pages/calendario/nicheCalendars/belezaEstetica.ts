import type { NicheCalendarDef } from './types';

export const belezaEsteticaDef: NicheCalendarDef = {
  key: 'beleza-estetica',
  label: 'Beleza & Estética',
  title: 'Calendário de Beleza & Estética',
  subtitle: 'Brasil & Mundial — Datas de Beleza & Bem-estar',
  data: [
    {
      month: 'Janeiro',
      num: '01',
      events: [
        // fonte: Lei nº 12.592, de 18/01/2012 (planalto.gov.br) — institui o "Dia Nacional
        // do Cabeleireiro, Barbeiro, Esteticista, Manicure, Pedicure, Depilador e Maquiador"
        // na data de promulgação da própria lei (18/01, não 19/01 como alguns blogs afirmam)
        {
          date: '18/01',
          name: 'Dia do Cabeleireiro',
          type: 'prof',
          tags: ['br', 'prof', 'capilar'],
        },
        { date: '18/01', name: 'Dia do Barbeiro', type: 'prof', tags: ['br', 'prof', 'barbearia'] },
        { date: '18/01', name: 'Dia do Esteticista', type: 'prof', tags: ['br', 'prof', 'pele'] },
        {
          date: '18/01',
          name: 'Dia da Manicure e Pedicure',
          type: 'prof',
          tags: ['br', 'prof', 'unhas'],
        },
        { date: '18/01', name: 'Dia do Depilador', type: 'prof', tags: ['br', 'prof'] },
        {
          // fonte: mesma Lei 12.592/2012 (18/01). Vários blogs de maquiagem divulgam 13/10
          // como "Dia do Maquiador" — é uma data alternativa popularizada pelo setor, não a oficial
          date: '18/01',
          name: 'Dia do Maquiador',
          type: 'prof',
          tags: ['br', 'prof', 'maquiagem'],
        },
        {
          date: '29/01',
          name: 'Dia Nacional da Visibilidade Trans',
          type: 'br',
          tags: ['br'],
        },
      ],
    },
    {
      month: 'Fevereiro',
      num: '02',
      events: [
        // fonte: Sociedade Brasileira de Dermatologia (SBD) — fundada em 5/2/1912, data
        // comemorada como "Dia do Dermatologista" desde 2000
        {
          date: '05/02',
          name: 'Dia do Dermatologista',
          type: 'prof',
          tags: ['br', 'prof', 'pele'],
        },
        {
          // data móvel (pode cair em fevereiro ou março, conforme a Páscoa) — maior pico
          // sazonal do setor de beleza no Brasil: glitter, penteados, maquiagem à prova d'água
          date: 'Carnaval',
          name: "Carnaval — alta temporada de glitter e maquiagem à prova d'água",
          type: 'br',
          tags: ['br'],
        },
      ],
    },
    {
      month: 'Março',
      num: '03',
      events: [
        { date: '08/03', name: 'Dia Internacional da Mulher', type: 'world', tags: ['world'] },
        // fonte: Resolução da Assembleia Geral da ONU 66/281 (2012), proposta pelo Butão
        {
          date: '20/03',
          name: 'Dia Internacional da Felicidade',
          type: 'world',
          tags: ['world', 'bem-estar'],
        },
      ],
    },
    {
      month: 'Abril',
      num: '04',
      events: [
        // fonte: data instituída por lei estadual em Santa Catarina (Assembleia Legislativa
        // de SC) para terapeutas capilares e tricologistas — não é uma data federal/nacional
        {
          date: '07/04',
          name: 'Dia do Terapeuta Capilar e do Tricologista',
          type: 'prof',
          tags: ['br', 'prof', 'capilar'],
        },
        // fonte: "Rosacea Awareness Month", campanha internacional de dermatologia; o dia
        // específico varia entre 25/04 e 27/04 conforme a fonte, por isso optei pelo mês inteiro
        {
          date: 'Abril',
          name: 'Mês de Conscientização da Rosácea',
          type: 'month',
          tags: ['world', 'month', 'pele'],
        },
      ],
    },
    {
      month: 'Maio',
      num: '05',
      events: [
        {
          date: '06/05',
          name: 'Dia Internacional Sem Dieta',
          type: 'world',
          tags: ['world', 'bem-estar'],
        },
        // fonte: instituído por leis municipais (Piracicaba-SP, Campo Grande-MS) e noticiado
        // pela Rádio Câmara da Câmara dos Deputados como "Dia Nacional do Barbeiro"
        {
          date: '11/05',
          name: 'Dia Nacional do Barbeiro',
          type: 'prof',
          tags: ['br', 'prof', 'barbearia'],
        },
        // fonte: origem contestada (ONU 2005 vs. terapeuta Will Williams em 2017), mas a
        // data de 21/05 é consistente entre as fontes consultadas
        {
          date: '21/05',
          name: 'Dia Mundial da Meditação',
          type: 'world',
          tags: ['world', 'bem-estar'],
        },
        {
          date: '25/05',
          name: 'Dia do Massoterapeuta',
          type: 'prof',
          tags: ['br', 'prof', 'bem-estar'],
        },
        {
          // reenquadrado para o contexto estético: tabagismo acelera o envelhecimento da pele
          date: '31/05',
          name: 'Dia Mundial Sem Tabaco',
          type: 'world',
          tags: ['world', 'pele'],
        },
      ],
    },
    {
      month: 'Junho',
      num: '06',
      events: [
        {
          date: '2ª sáb.',
          name: 'Dia Mundial do Bem-Estar (Global Wellness Day)',
          type: 'world',
          tags: ['world', 'bem-estar'],
        },
        // fonte: data informal, sem lei ou conselho profissional por trás, mas replicada de
        // forma consistente por designers de sobrancelha e salões nas redes sociais há anos
        {
          date: '17/06',
          name: 'Dia da Designer de Sobrancelhas',
          type: 'prof',
          tags: ['br', 'prof'],
        },
        // fonte: Resolução da Assembleia Geral da ONU 69/131 (2014), proposta pela Índia
        {
          date: '21/06',
          name: 'Dia Internacional da Ioga',
          type: 'world',
          tags: ['world', 'bem-estar'],
        },
        { date: '25/06', name: 'Dia Mundial do Vitiligo', type: 'world', tags: ['world', 'pele'] },
      ],
    },
    {
      month: 'Julho',
      num: '07',
      events: [
        // fonte: Liga Internacional de Sociedades Dermatológicas (ILDS) e Sociedade
        // Internacional de Dermatologia (ISD)
        {
          date: '08/07',
          name: 'Dia Mundial da Saúde da Pele',
          type: 'world',
          tags: ['world', 'pele'],
        },
        {
          date: '11/07',
          name: 'Dia Mundial da Massagem',
          type: 'world',
          tags: ['world', 'bem-estar'],
        },
        // fonte: instituído pela OMS em 2011
        {
          date: '24/07',
          name: 'Dia Internacional do Autocuidado',
          type: 'world',
          tags: ['world', 'bem-estar'],
        },
        // fonte: Lei estadual de SP 16.682/2018; celebrado nacionalmente pelo movimento do
        // cabelo crespo/cacheado desde a 1ª Marcha do Orgulho Crespo (Av. Paulista, 2015)
        {
          date: '26/07',
          name: 'Dia do Orgulho Crespo',
          type: 'br',
          tags: ['br', 'capilar'],
        },
      ],
    },
    {
      month: 'Agosto',
      num: '08',
      events: [
        {
          date: '1ª sáb.',
          name: 'Dia Mundial da Alopecia',
          type: 'world',
          tags: ['world', 'capilar'],
        },
        // fonte: data criada durante a Nails Fashion Week (SP), replicada pelo setor de
        // unhas desde ~2012
        { date: '01/08', name: 'Dia do Esmalte', type: 'br', tags: ['br', 'unhas'] },
        {
          date: '19/08',
          name: 'Dia Mundial da Fotografia',
          type: 'world',
          tags: ['world', 'maquiagem'],
        },
      ],
    },
    {
      month: 'Setembro',
      num: '09',
      badge: 'Mês da Noiva',
      events: [
        {
          date: '1ª sáb.',
          name: 'Dia Mundial da Barba',
          type: 'world',
          tags: ['world', 'barbearia'],
        },
        // fonte: criado em 1995 pela seção russa do CIDESCO (Comité International
        // d'Esthétique et de Cosmétologie)
        { date: '09/09', name: 'Dia Internacional da Beleza', type: 'world', tags: ['world'] },
        {
          date: '15/09',
          name: 'Dia Mundial do Cabelo Afro',
          type: 'world',
          tags: ['world', 'capilar'],
        },
        // temporada de casamentos no Brasil — salões costumam antecipar pacotes para
        // noivas, madrinhas e convidadas neste mês
        { date: 'Setembro', name: 'Mês da Noiva', type: 'month', tags: ['br', 'month'] },
      ],
    },
    {
      month: 'Outubro',
      num: '10',
      badge: 'Rosa · Outubro Rosa (ação solidária)',
      events: [
        {
          date: '01/10',
          name: 'Dia Internacional da Pessoa Idosa',
          type: 'world',
          tags: ['world', 'pele'],
        },
        {
          date: '10/10',
          name: 'Dia Mundial da Saúde Mental',
          type: 'world',
          tags: ['world', 'bem-estar'],
        },
        // fonte: Sociedade Internacional da Menopausa, em parceria com a OMS, desde 2009
        {
          date: '18/10',
          name: 'Dia Mundial da Menopausa',
          type: 'world',
          tags: ['world', 'pele'],
        },
        { date: '29/10', name: 'Dia Mundial da Psoríase', type: 'world', tags: ['world', 'pele'] },
        // reenquadrado para o setor: mês em que salões e cabeleireiros promovem campanhas
        // solidárias de doação de cabelo para perucas oncológicas
        {
          date: 'Outubro',
          name: 'Outubro Rosa — ação solidária dos salões',
          type: 'month',
          tags: ['br', 'month', 'capilar'],
        },
      ],
    },
    {
      month: 'Novembro',
      num: '11',
      events: [
        // fonte: tradição católica — 3/11 é o dia de São Martinho de Porres, padroeiro dos
        // cabeleireiros e barbeiros; data distinta da instituída pela Lei 12.592/2012 (18/01)
        {
          date: '03/11',
          name: 'Dia do Cabeleireiro (padroeiro São Martinho de Porres)',
          type: 'br',
          tags: ['br', 'capilar'],
        },
        // fonte: criado em 1999 em Trinidad e Tobago pelo Dr. Jerome Teelucksingh
        {
          date: '19/11',
          name: 'Dia Internacional do Homem',
          type: 'world',
          tags: ['world', 'barbearia'],
        },
        {
          date: '20/11',
          name: 'Dia Nacional da Consciência Negra',
          type: 'br',
          tags: ['br'],
        },
      ],
    },
    {
      month: 'Dezembro',
      num: '12',
      badge: 'Laranja · Câncer de Pele',
      events: [
        // fonte: fundação da Associação Brasileira de Podólogos em 4/12/1964
        { date: '04/12', name: 'Dia do Podólogo', type: 'prof', tags: ['br', 'prof', 'unhas'] },
        // fonte: campanha da Sociedade Brasileira de Dermatologia (SBD), criada em 2014
        {
          date: 'Dezembro',
          name: 'Dezembro Laranja — prevenção do câncer de pele',
          type: 'month',
          tags: ['br', 'month', 'pele'],
        },
        {
          date: '25/12',
          name: 'Natal — temporada de festas (penteados e maquiagem)',
          type: 'br',
          tags: ['br'],
        },
        {
          date: '31/12',
          name: 'Réveillon — simpatias de virada (cores de roupa e esmalte)',
          type: 'br',
          tags: ['br'],
        },
      ],
    },
  ],
  filterLabels: {
    capilar: 'Capilar',
    pele: 'Pele',
    unhas: 'Unhas',
    maquiagem: 'Maquiagem',
    'bem-estar': 'Bem-estar',
    barbearia: 'Barbearia',
  },
};
