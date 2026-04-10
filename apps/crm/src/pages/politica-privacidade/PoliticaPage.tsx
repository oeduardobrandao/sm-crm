export default function PoliticaPage() {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1rem' }} className="animate-up">
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '2.5rem', color: 'var(--text-main)', marginBottom: '0.5rem' }}>
          Política de Privacidade
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>
          Entenda como tratamos e protegemos os seus dados no Mesaas.
        </p>
      </div>

      <div className="card" style={{ lineHeight: 1.7 }}>
        {[
          {
            title: '1. Coleta de Dados',
            content: (
              <>
                <p>Coletamos as informações que você nos fornece diretamente, como:</p>
                <ul>
                  <li>Dados de cadastro (nome, e-mail, telefone);</li>
                  <li>Informações inseridas na plataforma sobre seus leads, clientes e equipe;</li>
                  <li>Dados financeiros e de contratos gerenciados no sistema;</li>
                  <li>Comunicações com nosso suporte técnico.</li>
                </ul>
              </>
            ),
          },
          {
            title: '2. Uso das Informações',
            content: (
              <>
                <p>Utilizamos os dados coletados exclusivamente para:</p>
                <ul>
                  <li>Fornecer, operar e manter os serviços da plataforma Mesaas;</li>
                  <li>Melhorar e personalizar a experiência do usuário;</li>
                  <li>Processar transações e enviar avisos relacionados;</li>
                  <li>Detectar, prevenir e resolver problemas técnicos ou de segurança.</li>
                </ul>
              </>
            ),
          },
          {
            title: '3. Compartilhamento de Dados',
            content: (
              <>
                <p>O Mesaas <strong>não vende</strong> seus dados pessoais ou comerciais para terceiros. O compartilhamento só ocorre nas seguintes situações:</p>
                <ul>
                  <li>Com provedores de serviços terceirizados estritamente essenciais para a operação, sob contratos de confidencialidade;</li>
                  <li>Para cumprir obrigações legais, processos judiciais ou solicitações governamentais;</li>
                  <li>Em caso de fusão, venda de ativos ou aquisição da empresa.</li>
                </ul>
              </>
            ),
          },
          {
            title: '4. Segurança',
            content: <p>Implementamos medidas técnicas e organizacionais rígidas (como criptografia de senhas e comunicação via HTTPS) para proteger seus dados contra acesso não autorizado.</p>,
          },
          {
            title: '5. Seus Direitos (LGPD)',
            content: (
              <>
                <p>Você tem o direito de:</p>
                <ul>
                  <li>Acessar e confirmar a existência do tratamento dos seus dados;</li>
                  <li>Corrigir dados incompletos, inexatos ou desatualizados;</li>
                  <li>Solicitar a anonimização, bloqueio ou eliminação de dados desnecessários;</li>
                  <li>Solicitar a portabilidade ou exclusão total da sua conta e dados.</li>
                </ul>
                <p>Para exercer esses direitos, entre em contato através do nosso suporte.</p>
              </>
            ),
          },
          {
            title: '6. Alterações nesta Política',
            content: <p>Podemos atualizar esta política periodicamente. Avisaremos sobre mudanças significativas destacando-as na plataforma ou via e-mail.</p>,
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
        Última atualização: {new Date().toLocaleDateString('pt-BR')}<br />
        Mesaas - Gestão Inteligente
      </p>
    </div>
  );
}
