import type { NicheCalendarDef } from './types';

export const gastronomiaDef: NicheCalendarDef = {
  key: 'gastronomia',
  label: 'Gastronomia',
  title: 'Calendário de Gastronomia',
  subtitle: 'Brasil & Mundial — Datas de Gastronomia & Alimentação',
  data: [
    {
      month: 'Janeiro',
      num: '01',
      events: [
        { date: '02/01', name: 'Dia do Confeiteiro', type: 'prof', tags: ['br', 'prof', 'doces'] },
        { date: '04/01', name: 'Dia Nacional do Espaguete', type: 'world', tags: ['world'] }, // fonte: National Spaghetti Day (origem nos EUA), replicado em calendários gastronômicos brasileiros
        {
          date: '16/01',
          name: 'Dia Internacional da Comida Picante',
          type: 'world',
          tags: ['world'],
        },
        { date: '20/01', name: 'Dia Mundial do Queijo', type: 'world', tags: ['world'] }, // fonte: origem provável em adaptação do "Cheese Lovers Day" americano; Minas Gerais usa 16/05 como data alternativa
        { date: '23/01', name: 'Dia Mundial da Torta', type: 'world', tags: ['world', 'doces'] }, // fonte: National Pie Day, chancelado pelo American Pie Council (EUA) desde 1986
        {
          date: '27/01',
          name: 'Dia Mundial do Bolo de Chocolate',
          type: 'world',
          tags: ['world', 'doces'],
        },
        {
          date: '30/01',
          name: 'Dia Mundial do Croissant',
          type: 'world',
          tags: ['world', 'doces'],
        }, // fonte: National Croissant Day (EUA), sem instituição oficial documentada
      ],
    },
    {
      month: 'Fevereiro',
      num: '02',
      events: [
        { date: '01/02', name: 'Dia do Tomate', type: 'world', tags: ['world'] }, // fonte: recorrente em calendários gastronômicos, sem instituição oficial localizada
        { date: '05/02', name: 'Dia Mundial da Nutella', type: 'world', tags: ['world', 'doces'] }, // fonte: criado em 2007 pela blogueira Sara Rosso, hoje sob gestão da Ferrero
        { date: '09/02', name: 'Dia Mundial da Pizza', type: 'world', tags: ['world'] }, // fonte: data popularizada comercialmente, origem histórica não documentada oficialmente
        {
          date: '10/02',
          name: 'Dia Mundial das Leguminosas',
          type: 'world',
          tags: ['world', 'sustentabilidade'],
        },
        { date: '18/02', name: 'Dia Mundial do Vinho', type: 'world', tags: ['world', 'bebidas'] }, // fonte: "National Drink Wine Day" (EUA); não confundir com o National Wine Day de 25/05
        {
          date: '22/02',
          name: 'Dia Mundial da Margarita',
          type: 'world',
          tags: ['world', 'bebidas'],
        },
        { date: 'Carnaval', name: 'Semana de Carnaval', type: 'week', tags: ['br', 'bebidas'] }, // data móvel — cai em fevereiro ou março conforme o ano
      ],
    },
    {
      month: 'Março',
      num: '03',
      events: [
        { date: '11/03', name: 'Dia da Pipoca', type: 'world', tags: ['world'] }, // fonte: data distinta do National Popcorn Day americano (19/01)
        { date: '17/03', name: 'Dia de São Patrício', type: 'world', tags: ['world', 'bebidas'] },
        {
          date: '20/03',
          name: 'Dia Mundial sem Carne',
          type: 'world',
          tags: ['world', 'sustentabilidade'],
        },
        { date: '21/03', name: 'Dia do Pão Francês', type: 'br', tags: ['br'] },
        { date: '21/03', name: 'Dia do Tiramisù', type: 'world', tags: ['world', 'doces'] }, // fonte: criado em 2017 pelos jornalistas italianos Clara e Gigi Padovani
        { date: '25/03', name: 'Dia do Waffle', type: 'world', tags: ['world', 'doces'] },
        { date: '31/03', name: 'Dia Nacional da Saúde e Nutrição', type: 'br', tags: ['br'] },
      ],
    },
    {
      month: 'Abril',
      num: '04',
      events: [
        { date: '14/04', name: 'Dia Mundial do Café', type: 'world', tags: ['world', 'bebidas'] }, // fonte: origem exata incerta; distinto do Dia Nacional (24/05, ABIC) e do Dia Internacional (01/10, OIC)
        { date: '19/04', name: 'Dia do Alho', type: 'world', tags: ['world'] },
        { date: '22/04', name: 'Dia da Mandioca', type: 'br', tags: ['br', 'culinaria-regional'] },
        { date: '24/04', name: 'Dia do Churrasco', type: 'br', tags: ['br', 'culinaria-regional'] },
        {
          date: '24/04',
          name: 'Dia do Chimarrão',
          type: 'br',
          tags: ['br', 'bebidas', 'culinaria-regional'],
        },
        { date: '24/04', name: 'Dia Internacional do Milho', type: 'world', tags: ['world'] },
        { date: '26/04', name: 'Dia do Pretzel', type: 'world', tags: ['world', 'doces'] }, // fonte: National Pretzel Day (EUA)
        { date: 'Páscoa', name: 'Semana da Páscoa', type: 'week', tags: ['br', 'world', 'doces'] }, // data móvel — chocolate, colomba pascal e pratos de peixe entram no cardápio
      ],
    },
    {
      month: 'Maio',
      num: '05',
      events: [
        { date: '02/05', name: 'Dia Mundial do Atum', type: 'world', tags: ['world'] },
        { date: '10/05', name: 'Dia do Cozinheiro', type: 'prof', tags: ['br', 'prof'] },
        {
          date: '13/05',
          name: 'Dia Nacional do Chef de Cozinha',
          type: 'prof',
          tags: ['br', 'prof'],
        }, // criado pela ABAGA em 1999
        {
          date: '13/05',
          name: 'Dia Mundial do Coquetel',
          type: 'world',
          tags: ['world', 'bebidas'],
        }, // instituído pelo Museum of the American Cocktail em 2006
        { date: '13/05', name: 'Dia Internacional do Homus', type: 'world', tags: ['world'] }, // fonte: criado em 2012 por Ben Lang e Miriam Young
        {
          date: '3º sáb.',
          name: 'Dia Mundial do Whisky',
          type: 'world',
          tags: ['world', 'bebidas'],
        }, // data móvel (3º sábado de maio) — criado em 2012 por Blair Bowman
        {
          date: '17/05',
          name: 'Dia Mundial da Pastelaria',
          type: 'world',
          tags: ['world', 'doces'],
        }, // fonte: celebração não oficial, criada por entusiastas em worldbakingday.com
        { date: '18/05', name: 'Dia da Coxinha', type: 'br', tags: ['br', 'culinaria-regional'] },
        {
          date: '21/05',
          name: 'Dia Internacional do Chá',
          type: 'world',
          tags: ['world', 'bebidas'],
        }, // data oficial da ONU (Resolução A/RES/73/328)
        { date: '24/05', name: 'Dia Nacional do Café', type: 'br', tags: ['br', 'bebidas'] }, // instituído pela ABIC em 2005
        { date: '24/05', name: 'Dia do Barista', type: 'prof', tags: ['br', 'prof'] }, // criado pela BSCA em 2015
        { date: '28/05', name: 'Dia Internacional do Hambúrguer', type: 'world', tags: ['world'] },
        { date: '30/05', name: 'Dia Mundial da Batata Frita', type: 'world', tags: ['world'] },
      ],
    },
    {
      month: 'Junho',
      num: '06',
      badge: 'Festas Juninas',
      events: [
        { date: '01/06', name: 'Dia Mundial do Leite', type: 'world', tags: ['world', 'bebidas'] },
        { date: '1º dom.', name: 'Dia Nacional do Vinho', type: 'br', tags: ['br', 'bebidas'] }, // data móvel (1º domingo de junho) — Lei nº 15.460/2026, em vigor a partir de 2027
        {
          date: '1ª sex.',
          name: 'Dia Mundial da Rosquinha (Donut)',
          type: 'world',
          tags: ['world', 'doces'],
        }, // data móvel (1ª sexta-feira de junho) — National Donut Day, criado pelo Exército da Salvação (EUA) em 1938
        { date: '05/06', name: 'Dia da Cerveja Brasileira', type: 'br', tags: ['br', 'bebidas'] }, // fonte: criado em 2012 pelos Blogueiros Brasileiros de Cerveja, em homenagem ao mestre-cervejeiro catarinense Rupprecht Loeffler
        {
          date: '07/06',
          name: 'Dia Mundial da Segurança dos Alimentos',
          type: 'world',
          tags: ['world'],
        }, // ONU/OMS/FAO, desde 2018
        {
          date: '18/06',
          name: 'Dia da Gastronomia Sustentável',
          type: 'world',
          tags: ['world', 'sustentabilidade'],
        }, // ONU, desde 2016
        { date: '28/06', name: 'Dia do Ceviche', type: 'world', tags: ['world'] }, // fonte: Dia Nacional do Ceviche do Peru, oficializado por decreto do governo peruano em 2008
      ],
    },
    {
      month: 'Julho',
      num: '07',
      events: [
        {
          date: '06/07',
          name: 'Dia da Gastronomia Mineira',
          type: 'br',
          tags: ['br', 'culinaria-regional'],
        },
        {
          date: '07/07',
          name: 'Dia Mundial do Chocolate',
          type: 'world',
          tags: ['world', 'doces'],
        },
        { date: '08/07', name: 'Dia do Panificador', type: 'prof', tags: ['br', 'prof'] },
        { date: '10/07', name: 'Dia da Pizza', type: 'br', tags: ['br'] },
        { date: '14/07', name: 'Dia do Macarrão com Queijo', type: 'world', tags: ['world'] }, // fonte: National Mac and Cheese Day (EUA)
        { date: '15/07', name: 'Dia da Tapioca', type: 'br', tags: ['br', 'culinaria-regional'] },
        {
          date: '3º dom.',
          name: 'Dia Mundial do Sorvete',
          type: 'world',
          tags: ['world', 'doces'],
        }, // data móvel (3º domingo de julho) — National Ice Cream Day, proclamado nos EUA em 1984
        { date: '20/07', name: 'Dia Nacional do Biscoito', type: 'br', tags: ['br', 'doces'] },
        {
          date: '24/07',
          name: 'Dia Internacional da Tequila',
          type: 'world',
          tags: ['world', 'bebidas'],
        },
        { date: '29/07', name: 'Dia da Lasanha', type: 'world', tags: ['world'] },
        {
          date: '30/07',
          name: 'Dia Mundial do Cheesecake',
          type: 'world',
          tags: ['world', 'doces'],
        }, // fonte: National Cheesecake Day (EUA); listagens que citam 25/10 estão incorretas
      ],
    },
    {
      month: 'Agosto',
      num: '08',
      events: [
        {
          date: '1ª sex.',
          name: 'Dia Internacional da Cerveja',
          type: 'world',
          tags: ['world', 'bebidas'],
        }, // data móvel (1ª sexta-feira de agosto) — fixada nesse formato em 2012
        { date: '05/08', name: 'Dia Mundial da Ostra', type: 'world', tags: ['world'] }, // fonte: National Oyster Day (EUA), origem exata não documentada
        { date: '11/08', name: 'Dia do Garçom', type: 'prof', tags: ['br', 'prof'] },
        {
          date: '17/08',
          name: 'Dia do Pão de Queijo',
          type: 'br',
          tags: ['br', 'culinaria-regional'],
        },
        { date: '25/08', name: 'Dia do Feirante', type: 'br', tags: ['br'] },
        { date: '29/08', name: 'Dia da Pimenta-do-Reino', type: 'br', tags: ['br'] },
        {
          date: '29/08',
          name: 'Dia Nacional do Sommelier',
          type: 'prof',
          tags: ['br', 'prof', 'bebidas'],
        }, // fonte: profissão regulamentada pela Lei nº 12.467/2011
        { date: '31/08', name: 'Dia do Nutricionista', type: 'prof', tags: ['br', 'prof'] },
      ],
    },
    {
      month: 'Setembro',
      num: '09',
      events: [
        { date: '05/09', name: 'Dia do Açaí', type: 'br', tags: ['br', 'culinaria-regional'] }, // fonte: instituído pela Lei Ordinária nº 8.519/2017
        { date: '09/09', name: 'Dia do Cachorro-Quente', type: 'br', tags: ['br'] },
        {
          date: '09/09',
          name: 'Dia Nacional da Esfirra',
          type: 'br',
          tags: ['br', 'culinaria-regional'],
        },
        {
          date: '10/09',
          name: 'Dia Mundial do Vinho do Porto',
          type: 'world',
          tags: ['world', 'bebidas'],
        }, // fonte: data ligada à demarcação da região do Douro, em 1756
        { date: '10/09', name: 'Dia do Brigadeiro', type: 'br', tags: ['br', 'doces'] },
        { date: '13/09', name: 'Dia Nacional da Cachaça', type: 'br', tags: ['br', 'bebidas'] },
        { date: '18/09', name: 'Dia do Cheeseburguer', type: 'world', tags: ['world'] }, // fonte: National Cheeseburger Day (EUA)
        { date: '22/09', name: 'Dia da Banana', type: 'br', tags: ['br'] },
        { date: '23/09', name: 'Dia do Sorvete', type: 'br', tags: ['br', 'doces'] },
        {
          date: '29/09',
          name: 'Dia Internacional de Conscientização sobre Perda e Desperdício de Alimentos',
          type: 'world',
          tags: ['world', 'sustentabilidade'],
        }, // ONU, desde 2020
      ],
    },
    {
      month: 'Outubro',
      num: '10',
      events: [
        {
          date: '01/10',
          name: 'Dia Mundial do Vegetarianismo',
          type: 'world',
          tags: ['world', 'sustentabilidade'],
        }, // North American Vegetarian Society, desde 1977
        {
          date: '01/10',
          name: 'Dia Mundial do Cacau e do Chocolate',
          type: 'world',
          tags: ['world', 'doces'],
        }, // fonte: criado em 2010 pela Academia Francesa do Chocolate e da Confeitaria
        { date: '04/10', name: 'Dia do Barman', type: 'prof', tags: ['br', 'prof', 'bebidas'] },
        { date: '04/10', name: 'Dia do Pastel', type: 'br', tags: ['br', 'culinaria-regional'] },
        { date: '09/10', name: 'Dia do Açougueiro', type: 'prof', tags: ['br', 'prof'] }, // fonte: Lei nº 12.958/2014
        { date: '09/10', name: 'Dia da Sobremesa', type: 'br', tags: ['br', 'doces'] },
        { date: '2ª sex.', name: 'Dia Mundial do Ovo', type: 'world', tags: ['world'] }, // data móvel (2ª sexta-feira de outubro) — instituído em Viena, em 1996
        { date: '16/10', name: 'Dia Mundial da Alimentação', type: 'world', tags: ['world'] },
        { date: '16/10', name: 'Dia Mundial do Pão', type: 'world', tags: ['world'] },
        {
          date: '20/10',
          name: 'Dia Internacional do Chef de Cozinha',
          type: 'world',
          tags: ['world', 'prof'],
        },
        { date: '25/10', name: 'Dia Mundial do Macarrão', type: 'world', tags: ['world'] }, // instituído em Roma, em 1995
      ],
    },
    {
      month: 'Novembro',
      num: '11',
      events: [
        { date: '01/11', name: 'Dia do Sushi', type: 'br', tags: ['br'] },
        {
          date: '01/11',
          name: 'Dia Mundial do Veganismo',
          type: 'world',
          tags: ['world', 'sustentabilidade'],
        }, // desde 1994
        { date: '03/11', name: 'Dia do Sanduíche', type: 'world', tags: ['world'] },
        { date: '10/11', name: 'Dia do Trigo', type: 'br', tags: ['br'] },
      ],
    },
    {
      month: 'Dezembro',
      num: '12',
      badge: 'Ceia de Natal',
      events: [
        {
          date: '09/12',
          name: 'Dia do Profissional de Culinária',
          type: 'prof',
          tags: ['br', 'prof'],
        },
      ],
    },
  ],
  filterLabels: {
    bebidas: 'Bebidas',
    doces: 'Doces & Confeitaria',
    'culinaria-regional': 'Culinária Regional',
    sustentabilidade: 'Sustentabilidade',
  },
};
