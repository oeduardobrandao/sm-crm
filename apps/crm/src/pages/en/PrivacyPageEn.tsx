import type { ReactNode } from 'react';
import { CookiePreferencesLink } from '../../components/consent/CookiePreferencesLink';
import { sanitizeUrl } from '../../utils/security';
import { LegalPageShellEn, linkStyle, type LegalSectionEn } from './LegalPageShellEn';

const PRIVACY_EMAIL = 'privacidade@mesaas.com.br';
const YOUTUBE_TERMS_URL = 'https://www.youtube.com/t/terms';
const GOOGLE_PRIVACY_URL = 'https://policies.google.com/privacy';
const GOOGLE_PERMISSIONS_URL = 'https://myaccount.google.com/permissions';
const GOOGLE_USER_DATA_POLICY_URL =
  'https://developers.google.com/terms/api-services-user-data-policy';

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={sanitizeUrl(href)} target="_blank" rel="noopener noreferrer" style={linkStyle}>
      {children}
    </a>
  );
}

function PrivacyEmail() {
  return (
    <a href={`mailto:${PRIVACY_EMAIL}`} style={linkStyle}>
      {PRIVACY_EMAIL}
    </a>
  );
}

/** Opt-out control. Opens the cookie preferences dialog until the dedicated action exists. */
function DoNotSellLink() {
  return (
    <CookiePreferencesLink>Do Not Sell or Share My Personal Information</CookiePreferencesLink>
  );
}

const cellStyle = {
  verticalAlign: 'top',
  padding: '0.5rem',
  borderBottom: '1px solid var(--border-color)',
} as const;

const COOKIE_ROWS: [string, string, string][] = [
  [
    'Always on',
    'Login session, language, theme, protection against outdated versions of the app and the record of your cookie choice. Error monitoring (Sentry, details kept up to 30 days) and aggregate visit counts (Vercel Analytics, no cookies, visit identifier discarded within 24 hours).',
    'Needed for Mesaas to work, stay secure and measure failures. These cannot be turned off.',
  ],
  [
    'Analytics and support',
    'PostHog (European Union): pages and actions in the app, user and workspace identifiers, session recordings and an identifier stored in your browser. Events are kept up to 1 year and session recordings up to 3 weeks. Crisp (European Union): support chat messages, name and email of the signed-in user, kept up to 1 year.',
    'On by default on our US site. You can turn it off in Cookie settings.',
  ],
  [
    'Advertising',
    'Google Ads, Meta Pixel and the ChatGPT ads pixel (OpenAI), all in the United States: pages visited, the ad click that brought you (gclid, fbclid, oppref), signups and subscriptions after it, and identifiers stored in your browser (Google and Meta cookies up to 90 days, OpenAI cookies up to 30 days).',
    'On by default on our US site unless your browser sends Global Privacy Control. You can turn it off with "Do Not Sell or Share My Personal Information" or in Cookie settings.',
  ],
];

const sections: LegalSectionEn[] = [
  {
    title: '1. Who we are',
    content: (
      <>
        <p>
          Mesaas is a platform for social media managers and marketing agencies. It is operated by{' '}
          <strong>EBS IT SOLUTIONS</strong>, a company based in Salvador, Bahia, Brazil ("Mesaas",
          "we", "us"). This Privacy Policy explains what personal information we collect, how we use
          and share it, and the choices and rights you have, including under the privacy laws of
          California and other US states.
        </p>
        <p>
          For any privacy question or request, write to <PrivacyEmail />.
        </p>
      </>
    ),
  },
  {
    title: '2. Information we collect',
    content: (
      <>
        <p>We collect the following categories of personal information:</p>
        <ul>
          <li>
            <strong>Account information (identifiers):</strong> name, email address, phone number,
            password (stored only as a hash) and the name of your workspace;
          </li>
          <li>
            <strong>Workspace and client content:</strong> the information you add about your
            clients, leads, team, posts, files, contracts and finances, and messages exchanged with
            your clients in the client portal;
          </li>
          <li>
            <strong>Connected social accounts:</strong> profile data, account statistics, posts and
            their metrics, and access tokens (stored encrypted) from the accounts you connect. See
            section 4;
          </li>
          <li>
            <strong>Usage information (internet activity):</strong> pages and features you use,
            actions in the app, and logs;
          </li>
          <li>
            <strong>Device information:</strong> IP address, browser and device type, and
            approximate location derived from the IP address (country or region, never precise
            location);
          </li>
          <li>
            <strong>Cookies and similar technologies:</strong> see{' '}
            <a href="#cookies" style={linkStyle}>
              Cookies
            </a>
            ;
          </li>
          <li>
            <strong>Payment information (commercial information):</strong> your plan, billing
            history and billing address. Card payments are processed by Stripe. We never receive or
            store your full card number;
          </li>
          <li>
            <strong>Support communications:</strong> messages you send to our support team.
          </li>
        </ul>
        <p>
          The only sensitive personal information we collect is your account login (email and
          password), which we use only to let you sign in and keep your account secure.
        </p>
      </>
    ),
  },
  {
    title: '3. How we use information',
    content: (
      <>
        <p>We use personal information to:</p>
        <ul>
          <li>Provide, operate and maintain Mesaas, including the client portal;</li>
          <li>
            Publish to connected accounts the content you or your client approved and scheduled;
          </li>
          <li>Process payments and send receipts, billing notices and service emails;</li>
          <li>Provide support;</li>
          <li>Understand how Mesaas is used and improve it;</li>
          <li>Measure our advertising and show our ads to people who visited our site;</li>
          <li>Send product and marketing emails, which you can unsubscribe from at any time;</li>
          <li>Detect, prevent and fix technical and security problems, and comply with the law.</li>
        </ul>
        <p>
          Some features use AI providers: Google Gemini for report summaries and Cloudflare Workers
          AI for comment analysis and audio transcription. We send them only the content needed for
          the feature you used.
        </p>
      </>
    ),
  },
  {
    title: '4. Connected social accounts (Instagram, TikTok, YouTube and Google Business Profile)',
    content: (
      <>
        <p>
          When you connect a client's account, Mesaas receives from the platform, with the
          authorization of the account holder: profile data (username, display name, photo and
          link), account statistics, the account's own posts and their metrics, and access tokens,
          which we store encrypted. On Instagram, when you turn on comment automations, we also
          receive post comments and the username of the commenter, to reply under the rules you set.
        </p>
        <p>
          When you connect a YouTube channel, Mesaas reads the channel profile, channel statistics
          and videos with their metrics, and publishes the Shorts you scheduled. When you link a
          Google Business Profile location, Mesaas reads the location profile, performance metrics,
          search terms and reviews, including the reviewer's display name.
        </p>
        <p>
          Mesaas uses YouTube API Services. By connecting a channel you also agree to the{' '}
          <ExternalLink href={YOUTUBE_TERMS_URL}>YouTube Terms of Service</ExternalLink>, and Google
          handles your data under the{' '}
          <ExternalLink href={GOOGLE_PRIVACY_URL}>Google Privacy Policy</ExternalLink>. Mesaas's use
          and transfer of information received from Google APIs follows the{' '}
          <ExternalLink href={GOOGLE_USER_DATA_POLICY_URL}>
            Google API Services User Data Policy
          </ExternalLink>
          , including the Limited Use requirements.
        </p>
        <p>
          We use this data only to show account performance to your workspace and to publish the
          content you approved. We do not sell it and do not use it for advertising.
        </p>
        <p>
          You can disconnect an account at any time in the client's Social networks tab. On TikTok,
          disconnecting revokes access with the platform and deletes the tokens and imported posts.
          Google access can also be revoked at{' '}
          <ExternalLink href={GOOGLE_PERMISSIONS_URL}>
            myaccount.google.com/permissions
          </ExternalLink>
          .
        </p>
      </>
    ),
  },
  {
    title: '5. How we share information',
    content: (
      <>
        <p>
          We share personal information only with the service providers below, which process it on
          our behalf under contract, and when required by law or in a merger, sale of assets or
          acquisition of the company.
        </p>
        <ul>
          <li>
            <strong>Supabase</strong> (database and authentication);
          </li>
          <li>
            <strong>Vercel</strong> (application hosting and aggregate visit counts);
          </li>
          <li>
            <strong>Cloudflare</strong> (media storage and video, and AI features through Workers
            AI);
          </li>
          <li>
            <strong>Stripe</strong> (payment processing in US dollars);
          </li>
          <li>
            <strong>PostHog</strong> (product analytics, servers in the European Union);
          </li>
          <li>
            <strong>Resend</strong> and <strong>Loops</strong> (service, product and marketing
            emails);
          </li>
          <li>
            <strong>Crisp</strong> (support chat, servers in the European Union);
          </li>
          <li>
            <strong>Sentry</strong> (error monitoring);
          </li>
          <li>
            <strong>Google</strong> (Google Ads measurement, Gemini AI summaries, and the YouTube
            and Google Business Profile APIs when you connect them);
          </li>
          <li>
            <strong>Meta</strong> (Meta Pixel ad measurement, and the official Meta API for the
            Instagram accounts you connect);
          </li>
          <li>
            <strong>TikTok</strong> (the TikTok API for the accounts you connect);
          </li>
          <li>
            <strong>OpenAI</strong> (the ChatGPT ads pixel, for ad measurement only).
          </li>
        </ul>
        <p>
          <strong>International transfers.</strong> We are based in Brazil and our providers process
          data in the United States, the European Union and other countries. When your information
          is transferred, we rely on our providers' contractual commitments to protect it.
        </p>
      </>
    ),
  },
  {
    title: '6. Sale and sharing of personal information',
    content: (
      <>
        <p>
          We do not sell personal information for money. However, our site uses advertising pixels
          from Google, Meta and OpenAI. They receive identifiers and internet activity (pages
          visited, the ad click that brought you, signups and subscriptions) so we can measure our
          ads and show them to people who visited our site. Under California law and other US state
          laws this may be a "sale" or "sharing" of personal information for cross-context
          behavioral advertising (targeted advertising). In the last 12 months we disclosed these
          two categories, identifiers and internet activity, to these advertising partners.
        </p>
        <p>
          We never send client content, media, payment information or data from connected social
          accounts to advertising partners. We do not knowingly sell or share personal information
          of anyone under 16.
        </p>
        <p>
          You can opt out at any time: <DoNotSellLink />
        </p>
      </>
    ),
  },
  {
    title: '7. Global Privacy Control',
    content: (
      <p>
        We honor Global Privacy Control (GPC). If your browser sends a GPC signal, we treat it as a
        request to opt out of the sale and sharing of your personal information: advertising pixels
        stay off for that browser, on every page of Mesaas, and the advertising switch in Cookie
        settings stays off.
      </p>
    ),
  },
  {
    title: '8. Your privacy rights',
    content: (
      <>
        <p>
          Depending on the state where you live (including California, Colorado, Connecticut,
          Virginia, Utah, Texas, Oregon and other states with privacy laws), you have the following
          rights:
        </p>
        <ul>
          <li>
            <strong>Right to know and access:</strong> ask what personal information we collected
            about you, the sources, the purposes and the categories of third parties we disclosed it
            to, and get a copy of it in a portable format;
          </li>
          <li>
            <strong>Right to delete:</strong> ask us to delete the personal information we collected
            from you;
          </li>
          <li>
            <strong>Right to correct:</strong> ask us to correct inaccurate personal information;
          </li>
          <li>
            <strong>Right to opt out</strong> of the sale or sharing of your personal information
            and of targeted advertising (see section 6);
          </li>
          <li>
            <strong>Right to limit</strong> the use of sensitive personal information. We use it
            only to provide the service and keep your account secure, which the law allows without
            an opt-out;
          </li>
          <li>
            <strong>Right to non-discrimination:</strong> we will not deny you the service, charge a
            different price or give you a different level of service because you used any of these
            rights;
          </li>
          <li>
            <strong>Authorized agent:</strong> you can use an authorized agent to make a request for
            you. We will ask for proof that the agent has your signed permission and may ask you to
            verify your identity directly;
          </li>
          <li>
            <strong>Right to appeal:</strong> if we decline your request, you can appeal our
            decision (see section 9).
          </li>
        </ul>
      </>
    ),
  },
  {
    title: '9. How to exercise your rights',
    content: (
      <>
        <p>
          Email <PrivacyEmail /> from the email address of your Mesaas account, saying which right
          you want to use. To opt out of sale and sharing you can also use the <DoNotSellLink />{' '}
          control, which opens Cookie settings so you can turn advertising off in that browser.
        </p>
        <p>
          We verify your identity by matching the request to your account before acting on it. We
          confirm receipt within 10 business days and respond within 45 days. If we need more time
          (up to another 45 days), we will tell you why.
        </p>
        <p>
          To appeal a decision, reply to our answer with the word "Appeal" within 60 days. We will
          respond within 60 days of your appeal, explaining what we decided and why. If we deny your
          appeal, you can contact the Attorney General of your state.
        </p>
        <p>
          If you are a client of an agency that uses Mesaas, the agency decides what information
          about you it stores in Mesaas. Please send your request to the agency first; we will help
          them answer it.
        </p>
      </>
    ),
  },
  {
    title: '10. Data retention',
    content: (
      <>
        <p>We keep personal information only as long as needed for the purposes above:</p>
        <ul>
          <li>
            Account and workspace data: while your account is active. After you cancel your account,
            we delete it within 30 days, except when the law requires us to keep it or for audit
            purposes;
          </li>
          <li>Product analytics events: up to 1 year. Session recordings: up to 3 weeks;</li>
          <li>Support chat conversations: up to 1 year;</li>
          <li>Error monitoring details: up to 30 days;</li>
          <li>
            Email delivery records (who an email went to and whether it was delivered or opened):
            personal details deleted after 90 days;
          </li>
          <li>Advertising cookies: up to 90 days (Google and Meta) and 30 days (OpenAI);</li>
          <li>
            YouTube data: deleted within 7 days after you disconnect the channel, in Mesaas or in
            your Google account, including data in reports already generated;
          </li>
          <li>
            Google Business Profile history: deleted 30 days after you disconnect. Numbers and
            featured reviews already included in generated reports stay in those reports;
          </li>
          <li>
            Metrics history from other connected accounts: deleted on request through our support.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: '11. Security',
    content: (
      <p>
        We use technical and organizational measures to protect your information, including HTTPS
        for all traffic, password hashing, encryption of social account tokens and access controls.
        No system is perfectly secure, but we work to protect your data and will notify you of a
        security incident as required by law.
      </p>
    ),
  },
  {
    title: '12. Cookies',
    id: 'cookies',
    content: (
      <>
        <p>
          We use browser storage (cookies and localStorage) and third-party tools in three
          categories:
        </p>
        <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <caption className="sr-only">Cookie categories used by Mesaas</caption>
            <thead>
              <tr>
                {['Category', 'What it covers', 'Your choice'].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    style={{
                      textAlign: 'left',
                      padding: '0.5rem',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COOKIE_ROWS.map(([category, covers, choice]) => (
                <tr key={category}>
                  <td style={cellStyle}>
                    <strong>{category}</strong>
                  </td>
                  <td style={cellStyle}>{covers}</td>
                  <td style={cellStyle}>{choice}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: '1rem' }}>
          Help Center articles inside the app may embed videos and tutorials from YouTube, Loom,
          Arcade and Scribe, which can set their own cookies when the article loads.
        </p>
        <p style={{ marginTop: '1rem' }}>
          You can change your choices at any time in{' '}
          <CookiePreferencesLink>Cookie settings</CookiePreferencesLink>. When you turn a tool off,
          we stop sending it data right away and remove its current identifier from your browser.
        </p>
      </>
    ),
  },
  {
    title: '13. Children',
    content: (
      <p>
        Mesaas is a business tool and is not directed to children. We do not knowingly collect
        personal information from children under 13. If you believe a child gave us personal
        information, write to <PrivacyEmail /> and we will delete it.
      </p>
    ),
  },
  {
    title: '14. Changes to this policy',
    content: (
      <p>
        We may update this policy from time to time. We will announce significant changes in the app
        or by email at least 15 days before they take effect, and update the date at the top of this
        page.
      </p>
    ),
  },
  {
    title: '15. Contact',
    content: (
      <p>
        EBS IT SOLUTIONS, Salvador, Bahia, Brazil. Email: <PrivacyEmail />. See also our{' '}
        <a href="/en/terms" style={linkStyle}>
          Terms of Service
        </a>
        .
      </p>
    ),
  },
];

export default function PrivacyPageEn() {
  return (
    <LegalPageShellEn
      title="Privacy Policy"
      subtitle="How Mesaas collects, uses and protects your information."
      sections={sections}
    />
  );
}
