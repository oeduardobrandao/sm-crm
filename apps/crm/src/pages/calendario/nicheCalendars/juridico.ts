import type { NicheCalendarDef } from './types';

export const juridicoDef: NicheCalendarDef = {
  key: 'juridico',
  label: 'Jurídico',
  title: 'Calendário Jurídico',
  subtitle: 'Brasil & Mundial — Datas do Direito & Justiça',
  data: [
    {
      month: 'Janeiro',
      num: '01',
      events: [
        {
          date: '28/01',
          name: 'Dia Nacional de Combate ao Trabalho Escravo',
          type: 'br',
          tags: ['br', 'trabalhista'],
        }, // fonte: Lei 12.064/2009; Chacina de Unaí (MG), 2004
        {
          date: '28/01',
          name: 'Dia do Auditor Fiscal do Trabalho',
          type: 'prof',
          tags: ['br', 'prof', 'trabalhista'],
        }, // fonte: comemorado na mesma data que o Combate ao Trabalho Escravo, Lei 12.064/2009
        {
          date: '28/01',
          name: 'Dia Internacional da Proteção de Dados',
          type: 'world',
          tags: ['world', 'digital'],
        }, // fonte: Convenção 108 do Conselho da Europa (1981), assinada em 28/01
      ],
    },
    {
      month: 'Fevereiro',
      num: '02',
      events: [
        {
          date: '2ª ter. fev.',
          name: 'Dia da Internet Segura (Safer Internet Day)',
          type: 'world',
          tags: ['world', 'digital'],
        }, // fonte: rede Insafe — 2ª terça-feira de fevereiro, data varia a cada ano
        {
          date: '20/02',
          name: 'Dia Mundial da Justiça Social',
          type: 'world',
          tags: ['world'],
        }, // fonte: ONU, Resolução 62/10 (2007)
        {
          date: '24/02',
          name: 'Criação da Justiça Eleitoral (1932)',
          type: 'br',
          tags: ['br'],
        }, // fonte: Código Eleitoral de 1932, Decreto 21.076
        {
          date: '24/02',
          name: 'Dia da Conquista do Voto Feminino no Brasil',
          type: 'br',
          tags: ['br'],
        }, // fonte: Lei 13.086/2015
        {
          date: '28/02',
          name: 'Instalação do Supremo Tribunal Federal (1891)',
          type: 'br',
          tags: ['br', 'prof'],
        }, // fonte: STF instalado em 28/02/1891
      ],
    },
    {
      month: 'Março',
      num: '03',
      events: [
        {
          date: '07/03',
          name: 'Dia Nacional da Advocacia Pública',
          type: 'prof',
          tags: ['br', 'prof', 'tributario'],
        }, // fonte: Lei 12.636/2012
        { date: '08/03', name: 'Dia Internacional da Mulher', type: 'world', tags: ['world'] },
        {
          date: '11/03',
          name: 'Código de Defesa do Consumidor entra em vigor',
          type: 'br',
          tags: ['br', 'consumidor'],
        }, // fonte: Lei 8.078/1990, vigência a partir de 11/03/1991
        {
          date: '15/03',
          name: 'Dia Mundial do Consumidor',
          type: 'world',
          tags: ['world', 'consumidor'],
        }, // fonte: discurso de John Kennedy em 1962; adotado pela Consumers International
        {
          date: '21/03',
          name: 'Dia Internacional pela Eliminação da Discriminação Racial',
          type: 'world',
          tags: ['world', 'criminal'],
        }, // fonte: ONU, massacre de Sharpeville (1960); Lei Caó (7.716/1989) tipifica o racismo como crime
        {
          date: '24/03',
          name: 'Dia Internacional do Direito à Verdade sobre Violações de Direitos Humanos',
          type: 'world',
          tags: ['world', 'br'],
        }, // fonte: ONU, Resolução 65/196 (2010); no Brasil, Lei 13.605/2018
        {
          date: '25/03',
          name: 'Dia da Constituição',
          type: 'br',
          tags: ['br'],
        }, // fonte: outorga da 1ª Constituição brasileira em 1824 — não confundir com a de 1988
        {
          date: '25/03',
          name: 'Dia do Oficial de Justiça',
          type: 'prof',
          tags: ['br', 'prof'],
        }, // fonte: Lei 13.157/2015
      ],
    },
    {
      month: 'Abril',
      num: '04',
      badge: 'Verde · Segurança e Saúde no Trabalho',
      events: [
        {
          date: 'Abril',
          name: 'Abril Verde — Normas Regulamentadoras (NRs) de Segurança e Saúde no Trabalho',
          type: 'month',
          tags: ['br', 'month', 'trabalhista'],
        },
        {
          date: '19/04',
          name: 'Dia dos Povos Indígenas',
          type: 'br',
          tags: ['br'],
        }, // fonte: Lei 14.402/2022, substituiu o "Dia do Índio"
        {
          date: '23/04',
          name: 'Marco Civil da Internet completa aniversário',
          type: 'br',
          tags: ['br', 'digital'],
        }, // fonte: Lei 12.965/2014
        {
          date: '23/04',
          name: 'Dia Mundial do Livro e do Direito de Autor',
          type: 'world',
          tags: ['world', 'empresarial'],
        }, // fonte: UNESCO, celebrado desde 1996
        {
          date: '26/04',
          name: 'Dia Mundial da Propriedade Intelectual',
          type: 'world',
          tags: ['world', 'empresarial', 'digital'],
        }, // fonte: OMPI, celebrado desde 2000
      ],
    },
    {
      month: 'Maio',
      num: '05',
      badge: 'Laranja · Combate ao Abuso Infantil',
      events: [
        {
          date: '01/05',
          name: 'Dia do Trabalhador — instalação da Justiça do Trabalho (1941)',
          type: 'br',
          tags: ['br', 'trabalhista'],
        }, // fonte: Justiça do Trabalho instalada em 01/05/1941; a CLT também é de 01/05/1943
        {
          date: '03/05',
          name: 'Dia Mundial da Liberdade de Imprensa',
          type: 'world',
          tags: ['world'],
        }, // fonte: UNESCO, celebrado desde 1993
        {
          date: '13/05',
          name: 'Assinatura da Lei Áurea (1888)',
          type: 'br',
          tags: ['br'],
        },
        {
          date: '15/05',
          name: 'Dia Internacional das Famílias',
          type: 'world',
          tags: ['world', 'civil'],
        }, // fonte: ONU, Resolução 47/237 (1993)
        {
          date: '18/05',
          name: 'Maio Laranja — Combate ao Abuso e à Exploração Sexual de Crianças e Adolescentes',
          type: 'br',
          tags: ['br', 'criminal'],
        }, // fonte: instituído em 2000; Caso Araceli (Vitória-ES, 1973)
        {
          date: '19/05',
          name: 'Dia do Defensor Público',
          type: 'prof',
          tags: ['br', 'prof'],
        }, // fonte: Lei 10.448/2002
        {
          date: '25/05',
          name: 'Dia Nacional da Adoção',
          type: 'br',
          tags: ['br', 'civil'],
        }, // fonte: Lei 10.447/2002
        {
          date: 'Últ. sem. mai.',
          name: 'Semana Nacional da Conciliação Trabalhista (CNJ/TST)',
          type: 'week',
          tags: ['br', 'week', 'trabalhista'],
        }, // fonte: costuma ocorrer na última semana de maio (ex.: 26–30/05/2025) — data varia a cada ano
      ],
    },
    {
      month: 'Junho',
      num: '06',
      events: [
        {
          date: '04/06',
          name: 'Dia Internacional das Crianças Inocentes Vítimas de Agressão',
          type: 'world',
          tags: ['world', 'criminal'],
        }, // fonte: ONU, celebrado desde 1982
        { date: '05/06', name: 'Dia Mundial do Meio Ambiente', type: 'world', tags: ['world'] },
        {
          date: '12/06',
          name: 'Dia Mundial contra o Trabalho Infantil',
          type: 'world',
          tags: ['world', 'trabalhista'],
        }, // fonte: OIT, celebrado desde 2002
        {
          date: '18/06',
          name: 'Instituição do Tribunal do Júri no Brasil (1822)',
          type: 'br',
          tags: ['br', 'criminal'],
        }, // fonte: decreto do Príncipe Regente D. Pedro I, 18/06/1822
        {
          date: '20/06',
          name: 'Dia Mundial do Refugiado',
          type: 'world',
          tags: ['world'],
        }, // fonte: ONU, celebrado desde 2001; no Brasil, Lei 9.474/1997
        {
          date: '26/06',
          name: 'Dia Internacional Contra o Abuso e o Tráfico Ilícito de Drogas',
          type: 'world',
          tags: ['world', 'criminal'],
        }, // fonte: ONU, celebrado desde 1987
        {
          date: '26/06',
          name: 'Dia Internacional de Apoio às Vítimas de Tortura',
          type: 'world',
          tags: ['world', 'criminal'],
        }, // fonte: ONU, Resolução 52/149 (1997)
        {
          date: '27/06',
          name: 'Dia Internacional das Micro, Pequenas e Médias Empresas',
          type: 'world',
          tags: ['world', 'empresarial'],
        }, // fonte: ONU, Resolução 71/279 (2017)
      ],
    },
    {
      month: 'Julho',
      num: '07',
      events: [
        {
          date: '13/07',
          name: 'Estatuto da Criança e do Adolescente (ECA) é sancionado',
          type: 'br',
          tags: ['br', 'civil'],
        }, // fonte: Lei 8.069/1990
        {
          date: '13/07',
          name: 'Reforma Trabalhista completa aniversário',
          type: 'br',
          tags: ['br', 'trabalhista'],
        }, // fonte: Lei 13.467/2017
        {
          date: '17/07',
          name: 'Dia da Justiça Penal Internacional',
          type: 'world',
          tags: ['world', 'criminal'],
        }, // fonte: adotado em Kampala (2010); marca o Estatuto de Roma, de 17/07/1998
        {
          date: '30/07',
          name: 'Dia Mundial contra o Tráfico de Pessoas',
          type: 'world',
          tags: ['world', 'criminal'],
        }, // fonte: ONU, celebrado desde 2014
      ],
    },
    {
      month: 'Agosto',
      num: '08',
      badge: 'Lilás · Enfrentamento à Violência contra a Mulher',
      events: [
        {
          date: '07/08',
          name: 'Lei Maria da Penha completa aniversário',
          type: 'br',
          tags: ['br', 'criminal'],
        }, // fonte: Lei 11.340/2006
        { date: '11/08', name: 'Dia do Advogado', type: 'prof', tags: ['br', 'prof'] },
        {
          date: '11/08',
          name: 'Dia do Magistrado',
          type: 'prof',
          tags: ['br', 'prof'],
        }, // fonte: mesma lei de 1827 que criou os primeiros cursos jurídicos do Brasil
        {
          date: '14/08',
          name: 'LGPD é publicada (2018)',
          type: 'br',
          tags: ['br', 'digital'],
        }, // fonte: ANPD marca 14/08 como a data de publicação da Lei 13.709/2018
        {
          date: 'Agosto',
          name: 'Agosto Lilás — Enfrentamento à Violência Doméstica e Familiar contra a Mulher',
          type: 'month',
          tags: ['br', 'month', 'criminal'],
        }, // fonte: Lei 14.448/2022; referência à sanção da Lei Maria da Penha em 07/08/2006
        {
          date: '30/08',
          name: 'Dia Internacional das Vítimas de Desaparecimento Forçado',
          type: 'world',
          tags: ['world', 'criminal'],
        }, // fonte: ONU, celebrado desde dezembro de 2010
      ],
    },
    {
      month: 'Setembro',
      num: '09',
      events: [
        {
          date: '11/09',
          name: 'Código de Defesa do Consumidor é sancionado',
          type: 'br',
          tags: ['br', 'consumidor'],
        }, // fonte: Lei 8.078, de 11/09/1990 (vigência apenas em 11/03/1991)
        {
          date: '15/09',
          name: 'Dia Internacional da Democracia',
          type: 'world',
          tags: ['world'],
        }, // fonte: ONU, celebrado desde 2008
        {
          date: '21/09',
          name: 'Dia Nacional de Luta da Pessoa com Deficiência',
          type: 'br',
          tags: ['br', 'civil'],
        }, // fonte: Lei 11.133/2005
        {
          date: '21/09',
          name: 'Dia do Auditor Fiscal',
          type: 'prof',
          tags: ['br', 'prof', 'tributario'],
        }, // fonte: distinto do Auditor Fiscal do Trabalho (28/01)
        {
          date: '21/09',
          name: 'Dia Internacional da Paz',
          type: 'world',
          tags: ['world'],
        }, // fonte: ONU, fixado em 21/09 desde 2002
        {
          date: '28/09',
          name: 'Dia Internacional do Acesso Universal à Informação',
          type: 'world',
          tags: ['world', 'digital'],
        }, // fonte: UNESCO (2015)/ONU (2019); dialoga com a Lei de Acesso à Informação (12.527/2011)
      ],
    },
    {
      month: 'Outubro',
      num: '10',
      events: [
        {
          date: '02/10',
          name: 'Dia Internacional do Notário',
          type: 'world',
          tags: ['world', 'prof', 'civil'],
        }, // fonte: UINL, celebrado desde 1948
        {
          date: '02/10',
          name: 'Dia Internacional da Não-Violência',
          type: 'world',
          tags: ['world'],
        }, // fonte: ONU (2007); aniversário de Mahatma Gandhi
        {
          date: '05/10',
          name: 'Dia do Empreendedor',
          type: 'br',
          tags: ['br', 'empresarial'],
        }, // fonte: Lei 9.841/1999 (Estatuto da Microempresa e da EPP)
        {
          date: '05/10',
          name: 'Constituição Cidadã completa aniversário (1988)',
          type: 'br',
          tags: ['br'],
        },
        {
          date: '11/10',
          name: 'Dia Internacional da Menina',
          type: 'world',
          tags: ['world'],
        }, // fonte: ONU, celebrado desde 2012
        {
          date: '12/10',
          name: 'ECA entra em vigor',
          type: 'br',
          tags: ['br', 'civil'],
        }, // fonte: vigência a partir de 12/10/1990, mesma data do Dia das Crianças
        {
          date: '17/10',
          name: 'Dia Internacional para a Erradicação da Pobreza',
          type: 'world',
          tags: ['world'],
        }, // fonte: ONU, celebrado desde 1993
        { date: '24/10', name: 'Dia das Nações Unidas', type: 'world', tags: ['world'] },
      ],
    },
    {
      month: 'Novembro',
      num: '11',
      events: [
        {
          date: '1ª sem. nov.',
          name: 'Semana Nacional da Conciliação (CNJ)',
          type: 'week',
          tags: ['br', 'week'],
        }, // fonte: costuma ocorrer na 1ª semana de novembro (ex.: 03–07/11/2025) — data varia a cada ano
        {
          date: '02/11',
          name: 'Dia Internacional pelo Fim da Impunidade dos Crimes contra Jornalistas',
          type: 'world',
          tags: ['world', 'criminal'],
        }, // fonte: ONU, celebrado desde 2013
        {
          date: '18/11',
          name: 'Dia Nacional do Notário e do Registrador',
          type: 'prof',
          tags: ['br', 'prof', 'civil'],
        }, // fonte: Lei 11.630/2007
        {
          date: '18/11',
          name: 'Fundação da OAB (1930)',
          type: 'br',
          tags: ['br', 'prof'],
        }, // fonte: Decreto 19.408, assinado por Getúlio Vargas
        {
          date: '19/11',
          name: 'Dia Mundial para a Prevenção do Abuso contra Crianças e Jovens',
          type: 'world',
          tags: ['world', 'criminal'],
        }, // fonte: WWSF, celebrado desde 2000
        {
          date: '20/11',
          name: 'Dia Nacional de Zumbi e da Consciência Negra',
          type: 'br',
          tags: ['br', 'criminal'],
        }, // fonte: feriado nacional desde 2023; Lei Caó (7.716/1989) tipifica o racismo como crime
        {
          date: '20/11',
          name: 'Dia Universal dos Direitos da Criança',
          type: 'world',
          tags: ['world'],
        }, // fonte: Convenção da ONU sobre os Direitos da Criança (1989)
        {
          date: '25/11',
          name: 'Dia Internacional pela Eliminação da Violência contra a Mulher',
          type: 'world',
          tags: ['world', 'criminal'],
        },
      ],
    },
    {
      month: 'Dezembro',
      num: '12',
      events: [
        {
          date: '02/12',
          name: 'Dia Internacional para a Abolição da Escravatura',
          type: 'world',
          tags: ['world', 'criminal'],
        }, // fonte: ONU, celebrado desde 1985
        {
          date: '03/12',
          name: 'Dia do Delegado de Polícia',
          type: 'prof',
          tags: ['br', 'prof', 'criminal'],
        }, // fonte: Lei 13.567/2017
        {
          date: '04/12',
          name: 'Dia do Perito Criminal',
          type: 'prof',
          tags: ['br', 'prof', 'criminal'],
        }, // fonte: Lei 11.654/2008
        {
          date: '08/12',
          name: 'Dia da Justiça',
          type: 'br',
          tags: ['br', 'prof'],
        }, // fonte: Decreto-Lei 8.292/1945; referência a Nossa Senhora da Conceição, padroeira da Justiça
        {
          date: '09/12',
          name: 'Dia Internacional Contra a Corrupção',
          type: 'world',
          tags: ['world'],
        }, // fonte: Convenção de Mérida (2003), proposta pela delegação brasileira
        { date: '10/12', name: 'Dia dos Direitos Humanos (ONU)', type: 'world', tags: ['world'] },
        {
          date: '14/12',
          name: 'Dia Nacional do Ministério Público',
          type: 'prof',
          tags: ['br', 'prof'],
        }, // fonte: Lei Complementar 40/1981
        {
          date: '18/12',
          name: 'Dia Internacional dos Migrantes',
          type: 'world',
          tags: ['world'],
        }, // fonte: ONU, celebrado desde 2000
      ],
    },
  ],
  filterLabels: {
    trabalhista: 'Trabalhista',
    civil: 'Civil',
    criminal: 'Criminal',
    tributario: 'Tributário',
    consumidor: 'Consumidor',
    empresarial: 'Empresarial',
    digital: 'Digital',
  },
};
