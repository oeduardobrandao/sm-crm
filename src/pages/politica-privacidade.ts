export async function renderPoliticaPrivacidade(container: HTMLElement): Promise<void> {
  if (!document.getElementById('privacy-styles')) {
    const style = document.createElement('style');
    style.id = 'privacy-styles';
    style.innerHTML = `
      .privacy-container {
        max-width: 800px;
        margin: 0 auto;
        padding: 2rem 1rem;
      }
      .privacy-header {
        text-align: center;
        margin-bottom: 3rem;
      }
      .privacy-header h1 {
        font-family: var(--font-heading);
        font-size: 2.5rem;
        color: var(--text-main);
        margin-bottom: 0.5rem;
      }
      .privacy-header p {
        color: var(--text-muted);
        font-size: 1.1rem;
      }
      .privacy-content {
        background: var(--card-bg);
        border: 1px solid var(--border-color);
        border-radius: var(--radius);
        padding: 2.5rem;
        box-shadow: var(--shadow);
        color: var(--text-main);
        line-height: 1.7;
      }
      .privacy-section {
        margin-bottom: 2rem;
      }
      .privacy-section:last-child {
        margin-bottom: 0;
      }
      .privacy-section h2 {
        font-family: var(--font-heading);
        font-size: 1.5rem;
        color: var(--primary-color);
        margin-bottom: 1rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid var(--border-color);
      }
      .privacy-section h3 {
        font-size: 1.2rem;
        margin-top: 1.5rem;
        margin-bottom: 0.5rem;
        color: var(--text-main);
      }
      .privacy-section p {
        margin-bottom: 1rem;
      }
      .privacy-section ul {
        list-style-type: disc;
        margin-left: 1.5rem;
        margin-bottom: 1rem;
      }
      .privacy-section li {
        margin-bottom: 0.5rem;
      }
      .privacy-footer {
        text-align: center;
        margin-top: 3rem;
        color: var(--text-muted);
        font-size: 0.9rem;
      }
      @media (max-width: 768px) {
        .privacy-content {
          padding: 1.5rem;
        }
        .privacy-header h1 {
          font-size: 2rem;
        }
      }
    `;
    document.head.appendChild(style);
  }

  container.innerHTML = `
    <div class="privacy-container animate-up">
      <div class="privacy-header">
        <h1>Política de Privacidade</h1>
        <p>Entenda como tratamos e protegemos os seus dados no Mesaas.</p>
      </div>

      <div class="privacy-content">
        <div class="privacy-section">
          <h2>1. Coleta de Dados</h2>
          <p>Coletamos as informações que você nos fornece diretamente, como:</p>
          <ul>
            <li>Dados de cadastro (nome, e-mail, telefone);</li>
            <li>Informações inseridas na plataforma sobre seus leads, clientes e equipe;</li>
            <li>Dados financeiros e de contratos gerenciados no sistema;</li>
            <li>Comunicações com nosso suporte técnico.</li>
          </ul>
        </div>

        <div class="privacy-section">
          <h2>2. Uso das Informações</h2>
          <p>Utilizamos os dados coletados exclusivamente para:</p>
          <ul>
            <li>Fornecer, operar e manter os serviços da plataforma Mesaas;</li>
            <li>Melhorar e personalizar a experiência do usuário;</li>
            <li>Processar transações e enviar avisos relacionados;</li>
            <li>Detectar, prevenir e resolver problemas técnicos ou de segurança.</li>
          </ul>
        </div>

        <div class="privacy-section">
          <h2>3. Compartilhamento de Dados</h2>
          <p>O Mesaas <strong>não vende</strong> seus dados pessoais ou comerciais para terceiros. O compartilhamento só ocorre nas seguintes situações:</p>
          <ul>
            <li>Com provedores de serviços terceirizados (ex: hospedagem, gateways de pagamento) estritamente essenciais para a operação da plataforma, sob contratos de confidencialidade;</li>
            <li>Para cumprir obrigações legais, processos judiciais ou solicitações governamentais;</li>
            <li>Em caso de fusão, venda de ativos ou aquisição da empresa.</li>
          </ul>
        </div>

        <div class="privacy-section">
          <h2>4. Segurança</h2>
          <p>Implementamos medidas técnicas e organizacionais rígidas (como criptografia de senhas e comunicação via HTTPS) para preteger seus dados contra acesso, alteração, divulgação ou destruição não autorizados. No entanto, nenhum método de transmissão pela internet é 100% seguro.</p>
        </div>

        <div class="privacy-section">
          <h2>5. Seus Direitos (LGPD)</h2>
          <p>Você tem o direito de:</p>
          <ul>
            <li>Acessar e confirmar a existência do tratamento dos seus dados;</li>
            <li>Corrigir dados incompletos, inexatos ou desatualizados;</li>
            <li>Solicitar a anonimização, bloqueio ou eliminação de dados desnecessários;</li>
            <li>Solicitar a portabilidade ou exclusão total da sua conta e dados.</li>
          </ul>
          <p>Para exercer esses direitos, entre em contato através do nosso suporte.</p>
        </div>

        <div class="privacy-section">
          <h2>6. Alterações nesta Política</h2>
          <p>Podemos atualizar esta política de privacidade periodicamente. Avisaremos sobre mudanças significativas destacando-as na plataforma ou enviando um e-mail para o endereço cadastrado na sua conta.</p>
        </div>
      </div>

      <div class="privacy-footer">
        Última atualização: ${new Date().toLocaleDateString('pt-BR')} <br/>
        Mesaas - Gestão Inteligente
      </div>
    </div>
  `;
}
