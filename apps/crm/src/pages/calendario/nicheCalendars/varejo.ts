import type { NicheCalendarDef } from './types';

export const varejoDef: NicheCalendarDef = {
  key: 'varejo',
  label: 'Varejo',
  title: 'Calendário de Varejo',
  subtitle: 'Brasil & Mundial — Datas de Consumo & Comércio',
  filterLabels: {
    sazonal: 'Sazonal / Liquidação',
    ecommerce: 'E-commerce',
    consumidor: 'Consumidor',
    moda: 'Moda',
    pet: 'Pet',
    casa: 'Casa & Decoração',
  },
  data: [
    {
      month: 'Janeiro',
      num: '01',
      badge: 'Verão · Liquidação',
      events: [
        {
          date: 'Janeiro',
          name: 'Liquidação de Verão',
          type: 'month',
          tags: ['br', 'month', 'sazonal', 'moda'],
        },
        {
          date: 'Janeiro',
          name: 'Troca de Presentes de Natal — pico de trocas e devoluções',
          type: 'month',
          tags: ['br', 'month'],
        },
        {
          date: 'Janeiro–Fevereiro',
          name: 'Volta às Aulas — início da temporada (material escolar, uniformes, tecnologia)',
          type: 'month',
          tags: ['br', 'month', 'sazonal'],
        },
        {
          date: '06/01',
          name: 'Dia de Reis — encerramento do ciclo natalino',
          type: 'br',
          tags: ['br'],
        },
      ],
    },
    {
      month: 'Fevereiro',
      num: '02',
      badge: 'Carnaval · Volta às Aulas',
      events: [
        {
          date: 'Fev/Mar (móvel)',
          name: 'Carnaval — fantasias, moda e beleza (data móvel, confira o ano)',
          type: 'month',
          tags: ['br', 'month', 'moda'],
        }, // também listado em Março
        {
          date: 'Fevereiro',
          name: 'Volta às Aulas — reta final da temporada',
          type: 'month',
          tags: ['br', 'month', 'sazonal'],
        },
        {
          date: '01/02',
          name: 'Dia do Publicitário',
          type: 'prof',
          tags: ['br', 'prof'],
        }, // fonte: Decreto nº 57.690, de 1º/02/1966, que regulamenta a profissão (Lei 4.680/1965)
        {
          date: '14/02',
          name: "Dia de São Valentim (Valentine's Day)",
          type: 'world',
          tags: ['world'],
        },
      ],
    },
    {
      month: 'Março',
      num: '03',
      badge: 'Consumidor · E-commerce',
      events: [
        {
          date: 'Fev/Mar (móvel)',
          name: 'Carnaval — fantasias, moda e beleza (data móvel, confira o ano)',
          type: 'month',
          tags: ['br', 'month', 'moda'],
        }, // mesmo evento móvel listado em Fevereiro
        {
          date: 'Mar/Abr (móvel)',
          name: 'Páscoa — data móvel, confira o ano corrente',
          type: 'month',
          tags: ['br', 'month'],
        }, // também listado em Abril
        {
          date: '08/03',
          name: 'Dia Internacional da Mulher',
          type: 'world',
          tags: ['world', 'moda'],
        },
        {
          date: '11/03',
          name: 'Entrada em vigor do Código de Defesa do Consumidor (1991)',
          type: 'br',
          tags: ['br', 'consumidor'],
        }, // fonte: Lei nº 8.078 sancionada em 11/09/1990, com vacatio legis de 6 meses (vigência em 11/03/1991)
        {
          date: '12/03',
          name: 'Dia do E-commerce',
          type: 'br',
          tags: ['br', 'prof', 'ecommerce'],
        }, // fonte: instituído pela ABComm, data alusiva à criação da web por Tim Berners-Lee em 12/03/1989
        {
          date: '09–15/03',
          name: 'Semana do Consumidor',
          type: 'week',
          tags: ['br', 'week', 'consumidor'],
        }, // datas variam por varejista; a maioria concentra a campanha na semana anterior ao dia 15
        {
          date: '15/03',
          name: 'Dia Mundial do Consumidor (Dia do Consumidor)',
          type: 'br',
          tags: ['br', 'world', 'consumidor'],
        }, // fonte: origem no discurso de J.F. Kennedy em 15/03/1962; oficializado pela ONU em 1985
      ],
    },
    {
      month: 'Abril',
      num: '04',
      badge: 'Design · Livro',
      events: [
        {
          date: 'Mar/Abr (móvel)',
          name: 'Páscoa — data móvel, confira o ano corrente',
          type: 'month',
          tags: ['br', 'month'],
        }, // mesmo evento móvel listado em Março
        {
          date: '22/04',
          name: 'Dia da Terra — consumo consciente e sustentabilidade',
          type: 'world',
          tags: ['world', 'consumidor'],
        },
        {
          date: '23/04',
          name: 'Dia Mundial do Livro e do Direito de Autor',
          type: 'world',
          tags: ['world'],
        }, // fonte: instituído pela UNESCO em 1995, comemorado desde 1996
        {
          date: '27/04',
          name: 'Dia Mundial do Design (Design Gráfico)',
          type: 'world',
          tags: ['world', 'prof'],
        }, // fonte: ICOGRADA (hoje International Council of Design), em memória de sua fundação em 27/04/1963
        {
          date: 'Últ. sem.',
          name: 'Dia do Frete Grátis',
          type: 'week',
          tags: ['br', 'week', 'ecommerce'],
        }, // fonte: criado por associações de e-commerce brasileiras, tradicionalmente na última semana de abril
      ],
    },
    {
      month: 'Maio',
      num: '05',
      badge: 'Dia das Mães',
      events: [
        {
          date: '01/05',
          name: 'Dia do Trabalho — feriado com liquidações pontuais no varejo',
          type: 'br',
          tags: ['br'],
        },
        { date: '2º dom.', name: 'Dia das Mães', type: 'br', tags: ['br'] },
        {
          date: '08/05',
          name: 'Dia do Profissional de Marketing',
          type: 'prof',
          tags: ['br', 'prof'],
        }, // data amplamente adotada no mercado desde 2010; sem lei federal de instituição
        {
          date: '2º sáb.',
          name: 'Dia Mundial do Comércio Justo (Fair Trade Day)',
          type: 'world',
          tags: ['world', 'consumidor'],
        }, // fonte: convocado pela WFTO (World Fair Trade Organization) desde 2001, em +50 países
        {
          date: '17/05',
          name: 'Dia Mundial da Reciclagem',
          type: 'world',
          tags: ['world', 'consumidor'],
        }, // fonte: data ligada a iniciativa da UNESCO
        {
          date: '+60d da Páscoa (móvel)',
          name: 'Corpus Christi — feriado prolongado, pico de viagens e lazer',
          type: 'month',
          tags: ['br', 'month'],
        }, // Páscoa + 60 dias cai entre 21/mai e 24/jun conforme o ano; também listado em Junho
      ],
    },
    {
      month: 'Junho',
      num: '06',
      badge: 'Namorados · Festa Junina',
      events: [
        {
          date: 'Junho',
          name: 'Festa Junina — decoração, alimentação e vestuário típico',
          type: 'month',
          tags: ['br', 'month'],
        },
        {
          date: 'Junho–Julho',
          name: 'Liquidação de Inverno',
          type: 'month',
          tags: ['br', 'month', 'sazonal', 'moda'],
        },
        { date: '12/06', name: 'Dia dos Namorados', type: 'br', tags: ['br'] },
        {
          date: '+60d da Páscoa (móvel)',
          name: 'Corpus Christi — feriado prolongado, pico de viagens e lazer',
          type: 'month',
          tags: ['br', 'month'],
        }, // mesmo evento móvel listado em Maio
        { date: '24/06', name: 'São João — ápice da Festa Junina', type: 'br', tags: ['br'] },
      ],
    },
    {
      month: 'Julho',
      num: '07',
      badge: 'Inverno · Comerciante',
      events: [
        {
          date: 'Julho',
          name: 'Férias Escolares de Julho — turismo, lazer e brinquedos',
          type: 'month',
          tags: ['br', 'month'],
        },
        {
          date: '07/07',
          name: 'Dia Mundial do Chocolate',
          type: 'world',
          tags: ['world'],
        }, // não oficializada pela ONU, mas amplamente celebrada pela indústria e pelo varejo alimentício
        {
          date: '16/07',
          name: 'Dia do Comerciante',
          type: 'prof',
          tags: ['br', 'prof'],
        }, // fonte: Lei nº 2.048/1953; homenageia José da Silva Lisboa, o Visconde de Cairu
        { date: '20/07', name: 'Dia do Amigo', type: 'br', tags: ['br'] },
        { date: '26/07', name: 'Dia dos Avós', type: 'br', tags: ['br'] },
      ],
    },
    {
      month: 'Agosto',
      num: '08',
      badge: 'Dia dos Pais',
      events: [
        { date: '2º dom.', name: 'Dia dos Pais', type: 'br', tags: ['br'] },
        {
          date: '08/08',
          name: 'Dia Internacional do Gato',
          type: 'world',
          tags: ['world', 'pet'],
        }, // fonte: criado em 2002 pelo IFAW (International Fund for Animal Welfare)
        {
          date: '21/08',
          name: 'Dia Mundial da Moda',
          type: 'world',
          tags: ['world', 'moda'],
        }, // data amplamente adotada no mercado da moda; sem origem institucional única confirmada
      ],
    },
    {
      month: 'Setembro',
      num: '09',
      badge: 'Semana do Brasil · Cliente',
      events: [
        {
          date: '01–15/09',
          name: 'Semana do Brasil',
          type: 'week',
          tags: ['br', 'week', 'ecommerce', 'sazonal'],
        }, // fonte: criada em 2019 pela Secom (governo federal), geralmente na 1ª quinzena de setembro
        {
          date: '07/09',
          name: 'Dia da Independência — feriado prolongado e promoções patrióticas',
          type: 'br',
          tags: ['br'],
        },
        {
          date: '11/09',
          name: 'Sanção do Código de Defesa do Consumidor (1990)',
          type: 'br',
          tags: ['br', 'consumidor'],
        }, // fonte: Lei nº 8.078, sancionada por Fernando Collor em 11/09/1990
        {
          date: '15/09',
          name: 'Dia do Cliente',
          type: 'br',
          tags: ['br'],
        }, // fonte: criado em 2003 por João Carlos Rego (RS); hoje adotado em 14 estados e 167 municípios
        { date: '27/09', name: 'Dia Mundial do Turismo', type: 'world', tags: ['world'] }, // fonte: OMT/UNWTO
      ],
    },
    {
      month: 'Outubro',
      num: '10',
      badge: 'Crianças · Comerciário',
      events: [
        {
          date: '01/10',
          name: 'Dia do Vendedor',
          type: 'prof',
          tags: ['br', 'prof'],
        }, // fonte: Lei nº 3.207/1957; data definida no Congresso Pan-americano de Viajantes de 1937
        {
          date: '01/10',
          name: 'Dia Mundial do Café (International Coffee Day)',
          type: 'world',
          tags: ['world'],
        },
        {
          date: '04/10',
          name: 'Dia Mundial dos Animais (São Francisco de Assis)',
          type: 'world',
          tags: ['world', 'pet'],
        },
        {
          date: '05/10',
          name: 'Dia do Empreendedor',
          type: 'prof',
          tags: ['br', 'prof'],
        }, // fonte: Lei nº 9.841/1999 (Estatuto da Microempresa e da Empresa de Pequeno Porte)
        { date: '12/10', name: 'Dia das Crianças', type: 'br', tags: ['br'] },
        { date: '16/10', name: 'Dia Mundial da Alimentação (FAO)', type: 'world', tags: ['world'] },
        {
          date: '29/10',
          name: 'Dia Nacional do Livro',
          type: 'br',
          tags: ['br'],
        }, // fonte: fundação da Biblioteca Nacional do Rio de Janeiro em 29/10/1810
        {
          date: '30/10',
          name: 'Dia do Comerciário',
          type: 'prof',
          tags: ['br', 'prof'],
        }, // fonte: Lei nº 12.790/2013; patrono São Crispim
        { date: '31/10', name: 'Halloween', type: 'world', tags: ['world', 'moda'] },
      ],
    },
    {
      month: 'Novembro',
      num: '11',
      badge: 'Black Friday · Solteiros',
      events: [
        {
          date: 'Novembro',
          name: 'Início do Natal Antecipado — pré-campanha e vitrines',
          type: 'month',
          tags: ['br', 'month', 'casa'],
        },
        {
          date: '02/11',
          name: 'Finados — vendas de flores e artigos religiosos',
          type: 'br',
          tags: ['br'],
        },
        {
          date: '05/11',
          name: 'Dia do Designer Gráfico (Brasil)',
          type: 'prof',
          tags: ['br', 'prof'],
        }, // homenagem ao nascimento de Aloísio Magalhães
        {
          date: '11/11',
          name: "Dia dos Solteiros (Singles' Day)",
          type: 'world',
          tags: ['world', 'ecommerce'],
        }, // fonte: criado pela Alibaba em 2009; popularizado no Brasil por AliExpress e Shopee
        {
          date: 'Semana anterior',
          name: 'Black Week — semana de ofertas antecipadas antes da Black Friday',
          type: 'week',
          tags: ['br', 'week', 'ecommerce'],
        },
        {
          date: 'Últ. sex.',
          name: 'Black Friday',
          type: 'br',
          tags: ['br', 'world', 'week', 'ecommerce', 'moda', 'casa'],
        }, // fonte: sempre a ÚLTIMA sexta-feira de novembro — nem sempre a 4ª (ex.: em 2019 caiu em 29/11, a 5ª sexta-feira do mês)
        {
          date: 'Seg. pós-BF',
          name: 'Cyber Monday',
          type: 'br',
          tags: ['br', 'world', 'ecommerce'],
        }, // fonte: sempre a 1ª segunda-feira após a Black Friday; criada nos EUA em 2005, chegou ao Brasil em 2011
        {
          date: 'Últ. sáb.',
          name: 'Dia Mundial Sem Compras (Buy Nothing Day)',
          type: 'world',
          tags: ['world', 'consumidor'],
        }, // fonte: no Brasil e ~60 países é o último sábado de novembro (nos EUA/Canadá é a sexta pós-Ação de Graças, mesma data da Black Friday)
      ],
    },
    {
      month: 'Dezembro',
      num: '12',
      badge: 'Natal · Réveillon',
      events: [
        {
          date: 'Dezembro',
          name: 'Compras de Natal — pico de vendas do varejo',
          type: 'month',
          tags: ['br', 'month', 'sazonal', 'casa'],
        },
        { date: '24/12', name: 'Véspera de Natal', type: 'br', tags: ['br'] },
        { date: '25/12', name: 'Natal', type: 'br', tags: ['br', 'casa'] },
        {
          date: '31/12',
          name: 'Réveillon — moda branca e brinde de Ano Novo',
          type: 'br',
          tags: ['br', 'moda'],
        },
      ],
    },
  ],
};
