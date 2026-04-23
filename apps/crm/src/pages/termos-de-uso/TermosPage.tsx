export default function TermosPage() {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1rem' }} className="animate-up">
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '2.5rem', color: 'var(--text-main)', marginBottom: '0.5rem' }}>
          Termos de Uso
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>
          Leia com atenção os termos que regem o uso da plataforma Mesaas.
        </p>
      </div>

      <div className="card" style={{ lineHeight: 1.7 }}>
        <div style={{ marginBottom: '2rem', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          <p>
            Estes Termos de Uso regulam o acesso e a utilização da plataforma <strong>Mesaas</strong>, operada por{' '}
            <strong>EBS IT SOLUTIONS</strong>, inscrita no CNPJ 63.758.902/0001-01, com sede em Salvador/BA, Brasil.
          </p>
          <p style={{ marginTop: '0.5rem' }}>
            Ao criar uma conta ou utilizar qualquer funcionalidade da plataforma, você concorda integralmente com estes termos.
            Caso não concorde, por favor não utilize o serviço.
          </p>
        </div>

        {[
          {
            title: '1. Objeto dos Serviços',
            content: (
              <>
                <p>A plataforma Mesaas oferece ferramentas de gestão para social media managers e agências de marketing digital, incluindo:</p>
                <ul>
                  <li>Gestão de clientes, leads e contratos;</li>
                  <li>Quadro Kanban para organização de entregas e conteúdos;</li>
                  <li>Integração com plataformas de redes sociais (Instagram, Meta);</li>
                  <li>Portal do cliente (Hub) para aprovação de conteúdos;</li>
                  <li>Controle financeiro de receitas e despesas;</li>
                  <li>Gestão de equipe (CLT e freelancers);</li>
                  <li>Calendário editorial e relatórios analíticos.</li>
                </ul>
              </>
            ),
          },
          {
            title: '2. Conta do Usuário',
            content: (
              <>
                <p>Para utilizar o Mesaas, é necessário criar uma conta fornecendo informações verdadeiras e completas. Você é responsável por:</p>
                <ul>
                  <li>Manter a confidencialidade de suas credenciais de acesso;</li>
                  <li>Todas as atividades realizadas em sua conta;</li>
                  <li>Notificar imediatamente qualquer uso não autorizado da sua conta.</li>
                </ul>
                <p>O Mesaas se reserva o direito de suspender ou encerrar contas que violem estes termos ou que apresentem atividade suspeita.</p>
              </>
            ),
          },
          {
            title: '3. Conexão com Plataformas de Terceiros',
            content: (
              <>
                <p>
                  O Mesaas permite a integração com plataformas de terceiros, como Instagram e Meta, por meio de suas APIs oficiais.
                  Ao conectar sua conta, você autoriza o Mesaas a acessar dados conforme as permissões solicitadas.
                </p>
                <p>O Mesaas não se responsabiliza por:</p>
                <ul>
                  <li>Alterações nas APIs ou políticas de terceiros que afetem o funcionamento das integrações;</li>
                  <li>Indisponibilidade dos serviços de terceiros;</li>
                  <li>Conteúdos publicados por meio das integrações — a responsabilidade é exclusivamente do usuário.</li>
                </ul>
              </>
            ),
          },
          {
            title: '4. Conteúdo do Usuário',
            content: (
              <>
                <p>
                  Você mantém a propriedade sobre todo conteúdo inserido na plataforma (textos, imagens, dados de clientes, etc.).
                  Ao utilizar o Mesaas, você concede uma licença limitada para que possamos processar e exibir esse conteúdo exclusivamente
                  dentro da plataforma.
                </p>
                <p>É proibido utilizar a plataforma para armazenar ou distribuir conteúdo que:</p>
                <ul>
                  <li>Viole direitos de propriedade intelectual de terceiros;</li>
                  <li>Seja ilegal, difamatório, discriminatório ou ofensivo;</li>
                  <li>Promova violência, ódio ou atividades ilegais;</li>
                  <li>Viole a legislação brasileira vigente, incluindo o Marco Civil da Internet e a LGPD.</li>
                </ul>
              </>
            ),
          },
          {
            title: '5. Planos, Pagamentos e Renovações',
            content: (
              <>
                <p>
                  O Mesaas oferece planos de assinatura com diferentes funcionalidades e limites.
                  Durante o período beta, todas as funcionalidades estão disponíveis gratuitamente.
                </p>
                <p>Quando os planos pagos entrarem em vigor:</p>
                <ul>
                  <li>As assinaturas serão renovadas automaticamente ao final de cada ciclo, salvo cancelamento prévio;</li>
                  <li>O Mesaas poderá alterar os valores dos planos mediante aviso prévio de 30 dias;</li>
                  <li>Não há reembolso para períodos parciais de uso após o cancelamento.</li>
                </ul>
              </>
            ),
          },
          {
            title: '6. Limitações de Uso',
            content: (
              <>
                <p>Cada plano possui limites específicos de uso (número de clientes, membros de equipe, integrações, etc.). O Mesaas pode:</p>
                <ul>
                  <li>Suspender funcionalidades caso os limites sejam excedidos;</li>
                  <li>Notificar o usuário para adequação ao plano contratado;</li>
                  <li>Sugerir upgrade para um plano compatível com o uso atual.</li>
                </ul>
              </>
            ),
          },
          {
            title: '7. Propriedade Intelectual',
            content: (
              <p>
                A plataforma Mesaas, incluindo seu código-fonte, design, marca, logotipo e documentação, é de propriedade exclusiva
                da EBS IT SOLUTIONS. Nenhuma parte da plataforma pode ser copiada, modificada, distribuída ou utilizada
                sem autorização prévia por escrito.
              </p>
            ),
          },
          {
            title: '8. Privacidade e Dados',
            content: (
              <p>
                O tratamento de dados pessoais é regido pela nossa{' '}
                <a href="/politica-de-privacidade" style={{ color: 'var(--primary-color)', textDecoration: 'underline' }}>
                  Política de Privacidade
                </a>
                , que integra estes Termos de Uso. Cumprimos integralmente a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018).
              </p>
            ),
          },
          {
            title: '9. Suspensão e Cancelamento',
            content: (
              <>
                <p>O Mesaas pode suspender ou cancelar sua conta nas seguintes situações:</p>
                <ul>
                  <li>Violação de qualquer cláusula destes Termos de Uso;</li>
                  <li>Uso da plataforma para atividades ilegais ou fraudulentas;</li>
                  <li>Inadimplência prolongada (quando aplicável);</li>
                  <li>Inatividade por período superior a 12 meses.</li>
                </ul>
                <p>Você pode cancelar sua conta a qualquer momento pelas configurações da plataforma ou entrando em contato com o suporte.</p>
              </>
            ),
          },
          {
            title: '10. Isenção de Garantias',
            content: (
              <>
                <p>
                  O Mesaas é fornecido "como está" (<em>as is</em>). Não garantimos que o serviço será ininterrupto, livre de erros
                  ou que atenderá a todos os seus requisitos específicos.
                </p>
                <p>O Mesaas não se responsabiliza por:</p>
                <ul>
                  <li>Resultados comerciais obtidos com o uso da plataforma;</li>
                  <li>Perda de dados decorrente de falhas em serviços de terceiros;</li>
                  <li>Danos indiretos, incidentais ou consequenciais.</li>
                </ul>
              </>
            ),
          },
          {
            title: '11. Limitação de Responsabilidade',
            content: (
              <p>
                A responsabilidade total do Mesaas, em qualquer hipótese, será limitada ao valor pago pelo usuário nos 12 meses
                anteriores ao evento que originou a reclamação. Esta limitação aplica-se na extensão máxima permitida pela
                legislação brasileira.
              </p>
            ),
          },
          {
            title: '12. Alterações nos Termos',
            content: (
              <p>
                O Mesaas poderá atualizar estes Termos de Uso a qualquer momento. Alterações significativas serão comunicadas
                com antecedência mínima de 15 dias por e-mail ou notificação na plataforma. O uso continuado após a data de
                vigência das alterações constitui aceitação dos novos termos.
              </p>
            ),
          },
          {
            title: '13. Legislação Aplicável e Foro',
            content: (
              <p>
                Estes Termos de Uso são regidos pela legislação da República Federativa do Brasil. Fica eleito o foro da
                Comarca de Salvador/BA para dirimir quaisquer controvérsias decorrentes destes termos, com renúncia expressa
                a qualquer outro, por mais privilegiado que seja.
              </p>
            ),
          },
          {
            title: '14. Contato',
            content: (
              <p>
                Para dúvidas, sugestões ou solicitações relacionadas a estes Termos de Uso, entre em contato pelo e-mail{' '}
                <a href="mailto:contato@mesaas.com.br" style={{ color: 'var(--primary-color)', textDecoration: 'underline' }}>
                  contato@mesaas.com.br
                </a>
                .
              </p>
            ),
          },
        ].map(({ title, content }) => (
          <div key={title} style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.5rem', color: 'var(--primary-color)', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>
              {title}
            </h2>
            {content}
          </div>
        ))}
      </div>

      <p style={{ textAlign: 'center', marginTop: '3rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
        Última atualização: abril de 2025<br />
        Mesaas — EBS IT SOLUTIONS · CNPJ 63.758.902/0001-01
      </p>
    </div>
  );
}
