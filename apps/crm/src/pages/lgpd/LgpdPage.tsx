export default function LgpdPage() {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1rem' }} className="animate-up">
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '2.5rem', color: 'var(--text-main)', marginBottom: '0.5rem' }}>
          LGPD — Proteção de Dados
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>
          Como o Mesaas se adequa à Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018).
        </p>
      </div>

      <div className="card" style={{ lineHeight: 1.7 }}>
        <div style={{ marginBottom: '2rem', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          <p>
            A <strong>EBS IT SOLUTIONS</strong> (CNPJ 63.758.902/0001-01), operadora da plataforma <strong>Mesaas</strong>,
            está comprometida com a proteção dos dados pessoais de seus usuários em conformidade com a Lei Geral de Proteção
            de Dados Pessoais (LGPD — Lei nº 13.709/2018).
          </p>
          <p style={{ marginTop: '0.5rem' }}>
            Este documento complementa nossa{' '}
            <a href="/politica-de-privacidade" style={{ color: 'var(--primary-color)', textDecoration: 'underline' }}>
              Política de Privacidade
            </a>{' '}
            e nossos{' '}
            <a href="/termos-de-uso" style={{ color: 'var(--primary-color)', textDecoration: 'underline' }}>
              Termos de Uso
            </a>
            , detalhando as práticas específicas de proteção de dados adotadas pela plataforma.
          </p>
        </div>

        {[
          {
            title: '1. Controlador e Encarregado de Dados',
            content: (
              <>
                <p><strong>Controlador:</strong> EBS IT SOLUTIONS — CNPJ 63.758.902/0001-01, com sede em Fortaleza/CE.</p>
                <p style={{ marginTop: '0.5rem' }}>
                  <strong>Encarregado de Dados (DPO):</strong> Para exercer seus direitos ou esclarecer dúvidas sobre o
                  tratamento de dados pessoais, entre em contato pelo e-mail{' '}
                  <a href="mailto:privacidade@mesaas.com.br" style={{ color: 'var(--primary-color)', textDecoration: 'underline' }}>
                    privacidade@mesaas.com.br
                  </a>
                  .
                </p>
              </>
            ),
          },
          {
            title: '2. Bases Legais para Tratamento',
            content: (
              <>
                <p>O Mesaas trata dados pessoais com base nas seguintes hipóteses previstas no art. 7º da LGPD:</p>
                <ul>
                  <li><strong>Execução de contrato</strong> (art. 7º, V) — para fornecer os serviços contratados na plataforma;</li>
                  <li><strong>Consentimento</strong> (art. 7º, I) — para comunicações de marketing e funcionalidades opcionais;</li>
                  <li><strong>Legítimo interesse</strong> (art. 7º, IX) — para melhoria dos serviços, segurança e prevenção a fraudes;</li>
                  <li><strong>Cumprimento de obrigação legal</strong> (art. 7º, II) — para atender exigências fiscais e regulatórias.</li>
                </ul>
              </>
            ),
          },
          {
            title: '3. Dados Pessoais Coletados',
            content: (
              <>
                <p>Coletamos e tratamos as seguintes categorias de dados pessoais:</p>
                <ul>
                  <li><strong>Dados de identificação:</strong> nome, e-mail, telefone, CPF/CNPJ;</li>
                  <li><strong>Dados de acesso:</strong> credenciais de login, endereço IP, logs de acesso;</li>
                  <li><strong>Dados de uso:</strong> funcionalidades utilizadas, preferências de configuração;</li>
                  <li><strong>Dados de integração:</strong> tokens de acesso a plataformas de terceiros (armazenados de forma criptografada);</li>
                  <li><strong>Dados financeiros:</strong> informações de faturamento e pagamento (quando aplicável).</li>
                </ul>
              </>
            ),
          },
          {
            title: '4. Direitos do Titular',
            content: (
              <>
                <p>Conforme os artigos 17 a 22 da LGPD, você tem direito a:</p>
                <ul>
                  <li><strong>Confirmação e acesso</strong> — saber se tratamos seus dados e acessar uma cópia;</li>
                  <li><strong>Correção</strong> — solicitar a correção de dados incompletos, inexatos ou desatualizados;</li>
                  <li><strong>Anonimização, bloqueio ou eliminação</strong> — de dados desnecessários, excessivos ou tratados em desconformidade;</li>
                  <li><strong>Portabilidade</strong> — receber seus dados em formato estruturado para transferência a outro fornecedor;</li>
                  <li><strong>Eliminação</strong> — solicitar a exclusão de dados tratados com base em consentimento;</li>
                  <li><strong>Revogação do consentimento</strong> — retirar o consentimento a qualquer momento;</li>
                  <li><strong>Oposição</strong> — se opor ao tratamento quando realizado em desconformidade com a LGPD;</li>
                  <li><strong>Revisão de decisões automatizadas</strong> — solicitar a revisão de decisões tomadas exclusivamente com base em tratamento automatizado.</li>
                </ul>
                <p>
                  Para exercer qualquer desses direitos, envie sua solicitação para{' '}
                  <a href="mailto:privacidade@mesaas.com.br" style={{ color: 'var(--primary-color)', textDecoration: 'underline' }}>
                    privacidade@mesaas.com.br
                  </a>
                  . Responderemos em até 15 dias úteis.
                </p>
              </>
            ),
          },
          {
            title: '5. Medidas de Segurança',
            content: (
              <>
                <p>Adotamos medidas técnicas e administrativas para proteger os dados pessoais, incluindo:</p>
                <ul>
                  <li>Criptografia de dados em trânsito (HTTPS/TLS) e em repouso;</li>
                  <li>Criptografia de tokens de integração com chave dedicada (<code>TOKEN_ENCRYPTION_KEY</code>);</li>
                  <li>Controle de acesso baseado em papéis (owner, admin, agent);</li>
                  <li>Row Level Security (RLS) no banco de dados para isolamento de dados entre workspaces;</li>
                  <li>Autenticação segura via Supabase Auth;</li>
                  <li>Logs de auditoria para operações sensíveis.</li>
                </ul>
              </>
            ),
          },
          {
            title: '6. Compartilhamento de Dados',
            content: (
              <>
                <p>Os dados pessoais podem ser compartilhados com:</p>
                <ul>
                  <li><strong>Supabase</strong> — infraestrutura de banco de dados e autenticação;</li>
                  <li><strong>Vercel</strong> — hospedagem da aplicação;</li>
                  <li><strong>Cloudflare</strong> — armazenamento de mídia (R2);</li>
                  <li><strong>Meta/Instagram</strong> — quando o usuário conecta suas contas voluntariamente.</li>
                </ul>
                <p>
                  Todos os prestadores de serviço são contratados sob obrigações de confidencialidade e proteção de dados
                  compatíveis com a LGPD. <strong>Não vendemos</strong> dados pessoais a terceiros.
                </p>
              </>
            ),
          },
          {
            title: '7. Transferência Internacional de Dados',
            content: (
              <p>
                Alguns dos nossos prestadores de serviço podem estar localizados fora do Brasil. Nestes casos, garantimos que a
                transferência internacional de dados ocorre em conformidade com o art. 33 da LGPD, adotando cláusulas contratuais
                padrão e verificando que o país de destino oferece grau de proteção adequado ou que existem garantias suficientes.
              </p>
            ),
          },
          {
            title: '8. Retenção de Dados',
            content: (
              <>
                <p>Os dados pessoais são mantidos pelo tempo necessário para:</p>
                <ul>
                  <li>Cumprir as finalidades para as quais foram coletados;</li>
                  <li>Atender obrigações legais e regulatórias;</li>
                  <li>Exercer direitos em processos judiciais, administrativos ou arbitrais.</li>
                </ul>
                <p>
                  Após o cancelamento da conta, os dados são eliminados em até 30 dias, exceto quando houver obrigação legal
                  de retenção ou necessidade de guarda para fins de auditoria.
                </p>
              </>
            ),
          },
          {
            title: '9. Incidentes de Segurança',
            content: (
              <p>
                Em caso de incidente de segurança que possa acarretar risco ou dano relevante aos titulares de dados,
                o Mesaas comunicará a Autoridade Nacional de Proteção de Dados (ANPD) e os titulares afetados em prazo
                razoável, conforme o art. 48 da LGPD, descrevendo a natureza dos dados afetados, os riscos envolvidos
                e as medidas adotadas para reverter ou mitigar os efeitos do incidente.
              </p>
            ),
          },
          {
            title: '10. Autoridade Nacional de Proteção de Dados',
            content: (
              <p>
                Se você acredita que o tratamento de seus dados pessoais viola a LGPD, você tem o direito de apresentar
                reclamação à Autoridade Nacional de Proteção de Dados (ANPD), por meio do site{' '}
                <a href="https://www.gov.br/anpd" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary-color)', textDecoration: 'underline' }}>
                  www.gov.br/anpd
                </a>
                .
              </p>
            ),
          },
          {
            title: '11. Atualizações',
            content: (
              <p>
                Este documento pode ser atualizado periodicamente para refletir mudanças nas nossas práticas ou na legislação
                aplicável. Alterações significativas serão comunicadas por e-mail ou por notificação na plataforma com
                antecedência mínima de 15 dias.
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
