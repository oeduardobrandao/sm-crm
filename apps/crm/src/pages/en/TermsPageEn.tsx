import { LegalPageShellEn, linkStyle, type LegalSectionEn } from './LegalPageShellEn';

const CONTACT_EMAIL = 'contato@mesaas.com.br';

const sections: LegalSectionEn[] = [
  {
    title: '1. The service',
    content: (
      <>
        <p>
          Mesaas offers management tools for social media managers and marketing agencies,
          including:
        </p>
        <ul>
          <li>Client, lead and contract management;</li>
          <li>Kanban boards to organize deliverables and content;</li>
          <li>Integrations with Instagram, TikTok, YouTube and Google Business Profile;</li>
          <li>A client portal (Hub) for content approval;</li>
          <li>Financial tracking of revenue and expenses;</li>
          <li>Team management, for employees and freelancers;</li>
          <li>Editorial calendar and analytics reports.</li>
        </ul>
      </>
    ),
  },
  {
    title: '2. Your account',
    content: (
      <>
        <p>
          To use Mesaas you must create an account with true and complete information. You are
          responsible for:
        </p>
        <ul>
          <li>Keeping your login credentials confidential;</li>
          <li>All activity in your account;</li>
          <li>Telling us right away about any unauthorized use of your account.</li>
        </ul>
        <p>We may suspend or close accounts that break these terms or show suspicious activity.</p>
      </>
    ),
  },
  {
    title: '3. Plans, billing and automatic renewal',
    content: (
      <>
        <p>
          Mesaas offers a free plan (Free) with usage limits, and paid subscription plans with more
          features and higher limits, described on our pricing page. On our US site, paid plans are
          priced and charged in US dollars (USD) through Stripe, monthly or annually.
        </p>
        <div
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius)',
            padding: '1rem',
            margin: '1rem 0',
          }}
        >
          <p>
            <strong>
              Automatic renewal. Your paid subscription renews automatically at the end of each
              billing period (every month or every year, depending on the plan you chose) and your
              card is charged the then-current price for that period, until you cancel. You can
              cancel at any time in the app, in your workspace's billing settings. Cancellation
              takes effect at the end of the current billing period: you keep access to the paid
              plan until then, and you are not charged again.
            </strong>
          </p>
        </div>
        <p>
          <strong>14 days of Pro, no card required.</strong> When you create an account, your
          workspace can use the Pro plan for 14 days with no credit card and no charge. Each person
          gets one trial, even if they create other workspaces. If no card is added by the end of
          the trial, the workspace moves to the Free plan automatically. Nothing you created is
          deleted, but the Free limits apply: finance and contracts become read-only, automatic
          Instagram replies stop, and client portal links are paused starting 7 days after the end
          of the trial, until the workspace returns to a paid plan.
        </p>
        <p>
          <strong>Card added during the trial.</strong> If you add a card during the 14-day trial,
          the first charge happens on the day the trial ends, for the amount shown when you added
          the card. Nothing is charged before that. If you cancel before that day, the workspace
          stays on the trial until it ends and then moves to Free.
        </p>
        <p>
          <strong>Trial with card.</strong> When offered, the trial with card lasts 30 days, or the
          period shown at checkout. Nothing is charged during the trial. When there is time, we
          email you 7 days before the first charge with the amount and date. If you do not cancel
          before the trial ends, the subscription starts and the first charge happens automatically.
        </p>
        <p>After you have used a trial, a paid plan is charged when you subscribe.</p>
        <p>On paid plans:</p>
        <ul>
          <li>
            We may change plan prices with 30 days' notice by email. The new price applies from your
            next renewal after the notice period, and you can cancel before it does;
          </li>
          <li>
            <strong>Refunds:</strong> there are no refunds for partial billing periods after you
            cancel. You keep access until the end of the period you already paid for.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: '4. Usage limits',
    content: (
      <>
        <p>
          Each plan has specific limits (number of clients, team members, integrations and so on).
          If you go over them, we may:
        </p>
        <ul>
          <li>Limit features until usage fits the plan;</li>
          <li>Ask you to adjust your usage;</li>
          <li>Suggest a plan that fits your current usage.</li>
        </ul>
      </>
    ),
  },
  {
    title: '5. Acceptable use',
    content: (
      <>
        <p>You may not use Mesaas to store, publish or distribute content that:</p>
        <ul>
          <li>Infringes intellectual property or other rights of others;</li>
          <li>Is illegal, defamatory, discriminatory or offensive;</li>
          <li>Promotes violence, hate or illegal activity;</li>
          <li>Is spam, malware or an attempt to break or overload the service.</li>
        </ul>
        <p>
          You also agree to follow the terms and policies of the social platforms you connect to
          Mesaas.
        </p>
      </>
    ),
  },
  {
    title: '6. Your content',
    content: (
      <p>
        You keep ownership of all content you add to Mesaas (text, images, client data and so on).
        You give us a limited license to store, process and display that content only to provide the
        service to you. You are responsible for having the rights and permissions needed for the
        content and client data you add, including your clients' consent where required.
      </p>
    ),
  },
  {
    title: '7. Connected social accounts',
    content: (
      <>
        <p>
          Mesaas connects to third-party platforms (Instagram and Facebook from Meta, TikTok, and
          YouTube and Google Business Profile from Google) through their official APIs. When you
          connect an account, you authorize Mesaas to access its data according to the permissions
          requested, and you confirm that you or your client control the account.
        </p>
        <p>We are not responsible for:</p>
        <ul>
          <li>Changes to third-party APIs or policies that affect the integrations;</li>
          <li>Outages of third-party services;</li>
          <li>Content published through the integrations, which is your responsibility.</li>
        </ul>
        <p>
          Mesaas uses YouTube API Services. By connecting a YouTube channel you also agree to the
          YouTube Terms of Service.
        </p>
      </>
    ),
  },
  {
    title: '8. AI features',
    content: (
      <p>
        Some features use artificial intelligence, for example report summaries, comment analysis
        and audio transcription. AI output can be inaccurate or incomplete. Review it before you
        rely on it or share it with your clients. You are responsible for what you publish or send.
      </p>
    ),
  },
  {
    title: '9. Intellectual property',
    content: (
      <p>
        The Mesaas platform, including its source code, design, brand, logo and documentation,
        belongs to EBS IT SOLUTIONS. No part of it may be copied, modified, distributed or used
        without our prior written permission.
      </p>
    ),
  },
  {
    title: '10. Privacy',
    content: (
      <p>
        Our{' '}
        <a href="/en/privacy" style={linkStyle}>
          Privacy Policy
        </a>{' '}
        explains how we handle personal information and is part of these terms.
      </p>
    ),
  },
  {
    title: '11. Suspension and cancellation',
    content: (
      <>
        <p>We may suspend or close your account if:</p>
        <ul>
          <li>You break any part of these terms;</li>
          <li>You use Mesaas for illegal or fraudulent activity;</li>
          <li>Payment stays overdue for a long period (when applicable);</li>
          <li>The account is inactive for more than 12 months.</li>
        </ul>
        <p>
          You can cancel your subscription or close your account at any time in the app or by
          contacting support.
        </p>
      </>
    ),
  },
  {
    title: '12. Disclaimer of warranties',
    content: (
      <>
        <p>
          MESAAS IS PROVIDED "AS IS" AND "AS AVAILABLE". TO THE EXTENT ALLOWED BY LAW, WE DO NOT
          WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE OR MEET ALL OF YOUR SPECIFIC
          REQUIREMENTS.
        </p>
        <p>We are not responsible for:</p>
        <ul>
          <li>Business results you get from using Mesaas;</li>
          <li>Data loss caused by failures of third-party services;</li>
          <li>Indirect, incidental or consequential damages.</li>
        </ul>
      </>
    ),
  },
  {
    title: '13. Limitation of liability',
    content: (
      <p>
        TO THE EXTENT ALLOWED BY LAW, OUR TOTAL LIABILITY FOR ANY CLAIM IS LIMITED TO THE AMOUNT YOU
        PAID US IN THE 12 MONTHS BEFORE THE EVENT THAT GAVE RISE TO THE CLAIM.
      </p>
    ),
  },
  {
    title: '14. Changes to these terms',
    content: (
      <p>
        We may update these terms. We will announce significant changes at least 15 days in advance
        by email or in the app. If you keep using Mesaas after the changes take effect, you accept
        the new terms. If you do not agree, you can cancel before they take effect.
      </p>
    ),
  },
  {
    title: '15. Governing law and jurisdiction',
    content: (
      <p>
        These terms are governed by the laws of the Federative Republic of Brazil. The courts of
        Salvador, Bahia, Brazil have jurisdiction over any dispute arising from these terms.
      </p>
    ),
  },
  {
    title: '16. Contact',
    content: (
      <p>
        For questions about these terms, email{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} style={linkStyle}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    ),
  },
];

export default function TermsPageEn() {
  return (
    <LegalPageShellEn
      title="Terms of Service"
      subtitle="Please read the terms that govern your use of Mesaas."
      intro={
        <>
          <p>
            These Terms of Service govern access to and use of <strong>Mesaas</strong>, operated by{' '}
            <strong>EBS IT SOLUTIONS</strong>, a company based in Salvador, Bahia, Brazil ("Mesaas",
            "we", "us").
          </p>
          <p style={{ marginTop: '0.5rem' }}>
            By creating an account or using any feature of Mesaas, you agree to these terms. If you
            do not agree, please do not use the service.
          </p>
        </>
      }
      sections={sections}
    />
  );
}
