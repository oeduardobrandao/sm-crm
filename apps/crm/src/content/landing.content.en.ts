import type { LandingContent } from './landing.content';

/** English (US) copy for `/en`. Same shape as `LANDING`; the parity test pins the counts.
 * No em-dashes, US spelling, and never "approved by Meta" ("official Meta API" is fine). */
export const LANDING_EN: LandingContent = {
  hero: {
    titleBefore: 'Stop running social media clients ',
    titleEm: 'from spreadsheets and group chats',
    titleAfter: '.',
    sub: 'Mesaas brings clients, deliverables, approvals, Instagram and TikTok scheduling, and analytics into one place. Built for anyone who manages social media, solo or with a team.',
    note: '14 days of Pro free, no card required. At the end, you decide whether to stay.',
    noteStrong: '14 days of Pro free, no card required.',
    ctaStart: 'Start free trial',
    ctaSignedIn: 'Open dashboard',
    ctaSecondary: 'See how it works',
  },
  ticker: [
    'Clients + contracts',
    'Deliverables board',
    'Instagram scheduling',
    'TikTok publishing',
    'Client portal',
    'Auto-publishing',
    'Content calendar',
    'Instagram analytics',
    'TikTok analytics',
    'Finance',
    'Team + tasks',
    'Approvals by link',
    'Feed, Reels and Carousel',
    'Official Meta API',
  ],
  featuresTitle: 'Everything you already do today. Just organized.',
  featuresSub:
    'Every module was built with people who live and breathe social media. Fewer open tabs, more time to create.',
  featureEyebrows: [
    'Deliverables',
    'Scheduling',
    'Analytics',
    'Client portal',
    'Calendar',
    'Automations',
  ],
  featuresMore: {
    button: 'See all features',
    note: 'Content calendar and automatic comment replies',
    ctaTitle: 'Try all of this with your agency.',
  },
  metricTiles: [
    { label: 'Followers', value: '45,798', delta: '+12%' },
    { label: 'Reach (28d)', value: '96,826', delta: '+8%' },
    { label: 'Engagement', value: '4.6%', delta: '+0.4 pp' },
    { label: 'Views', value: '242,080', delta: '+19%' },
  ],
  dmVisual: {
    comment: 'want it',
    commentTag: '(comment)',
    reply: 'Hi! Here is the winter menu guide. Download it free and pick your favorite.',
    button: 'Open link',
  },
  shotAlts: {
    entregas: 'Mesaas deliverables board with workflows by stage',
    analytics: 'Instagram analytics in Mesaas: followers, reach and engagement',
    hub: 'Mesaas client portal with approvals by link',
    calendario: 'Mesaas monthly content calendar',
  },
  heroAlts: {
    macbook:
      'MacBook showing the Mesaas deliverables board: workflows by stage, from briefing to client approval',
    iphone: 'iPhone showing the client Hub: pending approvals and the next post',
  },
  faqTitle: 'Frequently asked questions',
  features: [
    {
      title: 'A deliverables board your team gets on day one',
      description:
        'Drag each post from idea to publication. Every client, format and deadline in a single visual flow.',
      bullets: [
        '<strong>5 ready-made stages</strong>: idea, production, approval, scheduled, published',
        '<strong>Client, format, deadline and status</strong> visible on the card',
        'A <strong>late post</strong> turns red on its own, so you never have to check',
        'Filter by client or content type in one click',
      ],
    },
    {
      title: 'Schedule and publish to Instagram and TikTok without leaving Mesaas.',
      showBullets: true,
      description:
        'Pick a day and time, write the caption, and you are done: the post goes live on your client profile through the official Meta and TikTok APIs. One post can go to both networks, with no third-party app and no phone alarm.',
      bullets: [
        'The post is <strong>published automatically</strong> at the date and time you set',
        '<strong>Feed, Reels and Carousel</strong> on Instagram and <strong>videos on TikTok</strong>, with media validated before scheduling',
        '<strong>One post, two networks</strong>: each network caption in the same post, with a single client approval',
        'TikTok on the <strong>Pro and Max</strong> plans',
        'A <strong>publish now</strong> button for urgent ones',
      ],
    },
    {
      title: 'Instagram and TikTok analytics ready for the client report.',
      description:
        'Followers, reach, views, engagement and top posts updated daily on paid plans, straight from the official APIs. Reliable data to prove the results of your work.',
      bullets: [
        'Data from the <strong>official Meta and TikTok APIs</strong>, no scraping',
        'Follower growth, <strong>reach and engagement</strong> by period',
        'Top posts of the week front and center',
        'PDF report with <strong>one section per network</strong>, generated in one click',
      ],
    },
    {
      title: 'Your client approves with a link. No login, no app.',
      description:
        'Your client approves posts, follows the calendar and talks to your team through a <strong>single link</strong>. The portal carries their brand, not Mesaas, and they never have to create an account.',
      bullets: [
        'Access through a single link, <strong>no account to create</strong>',
        'Approve, request changes or comment on each post',
        'Content calendar and the client <strong>brand library</strong>',
        'Automatic notice when a post is waiting for their decision',
      ],
    },
    {
      title: 'A content calendar per client or for your whole operation',
      description:
        'See what was planned, scheduled and published this month. Switch between clients or view your entire operation at once, and spot empty weeks before they become a problem.',
      bullets: [
        '<strong>Monthly, weekly and per-client</strong> views',
        'One color per format: Feed, Reels, Story and Carousel',
        'Drag to <strong>reschedule</strong>',
        'Reschedule on the calendar and auto-publishing follows',
      ],
    },
    {
      title: 'They comment the keyword, the link lands in their DMs. Nobody has to reply.',
      showBullets: true,
      description:
        'Create a trigger for one post or for the whole profile. Mesaas replies to the comment in public and sends the DM with a link or card right away, at any hour of the day. Available on the Pro and Max plans.',
      bullets: [
        '<strong>Keyword</strong> trigger on Feed posts and Reels',
        '<strong>Varied</strong> public replies, so it never sounds automated',
        'DM with a <strong>card, image and link button</strong>',
        'All set up on the post itself, inside Mesaas',
      ],
    },
  ],
  agente: {
    eyebrow: 'Content agent',
    title: 'A content agent that writes in each client voice.',
    paragraphs: [
      'Connect Mesaas to Claude or ChatGPT and generate carousels, Reels scripts and captions from each client brief, brand identity and best-performing posts. Without leaving your workflow.',
    ],
    bullets: [
      'Learns the brief and identity of each brand',
      'Uses the best-performing posts as reference',
      'Works with Claude, ChatGPT or through the API',
    ],
    cta: 'Start free trial',
  },
  how: {
    title: 'Three steps to organize your operation.',
    sub: 'From zero to your first scheduled post in 5 minutes.',
    steps: [
      {
        n: '01',
        title: 'Set up your agency',
        description:
          'Start with 14 days of Pro free, no card required, import your clients from a spreadsheet and set up your contract templates.',
      },
      {
        n: '02',
        title: 'Build your delivery flow',
        description:
          'Connect each client Instagram and TikTok, assign tasks to your team and set deadlines on the board.',
      },
      {
        n: '03',
        title: 'Send the portal link to your client',
        description:
          'They approve posts, follow the calendar and see the analytics through a single link, with no account to create.',
      },
    ],
  },
  faq: [
    {
      q: 'Does Mesaas have a free plan?',
      a: 'Yes. The Free plan costs nothing and is a good way to get to know the platform. The limits and features of each plan are in the table above.',
    },
    {
      q: 'Do I need to install anything?',
      a: 'No. Mesaas runs in your browser, on your computer or phone. There is nothing to download or install.',
    },
    {
      q: 'Does my client need an account to use the portal?',
      a: 'No. You send your client a single link. They open it, approve and comment, with no login and no password.',
    },
    {
      q: 'How does the Instagram integration work?',
      a: 'You connect your client account through the official Meta API. From there, Mesaas pulls followers, reach, engagement and posts automatically, and you can schedule Feed, Reels and Carousel posts to go straight to the profile on the day and time you choose. No scraping: analytics and publishing go 100% through the official API.',
    },
    {
      q: 'Does Mesaas publish to TikTok?',
      a: 'Yes, on the Pro and Max plans. You connect your client TikTok account through the official TikTok API and schedule videos to go live on the profile on the day and time you choose. The same post can go to Instagram and TikTok, with a caption for each network, and your client approves once. Video analytics (views, likes, comments and shares) show up in Mesaas and feed into your reports.',
    },
    {
      q: 'Can I import my clients from a spreadsheet?',
      a: 'Yes. You can add them one by one or import them all at once from a spreadsheet. In a few minutes your whole client list is in Mesaas.',
    },
    {
      q: 'I use Notion, ClickUp or Trello today. Can I migrate my data?',
      a: 'Yes. Mesaas imports Notion, Trello and ClickUp exports directly, plus any CSV spreadsheet. You upload the file, check how the columns were mapped and confirm. Your clients and deliverables come in without any re-entry. If you prefer, ask your AI agent (Claude or ChatGPT) connected to Mesaas to run the migration for you.',
    },
    {
      q: 'Does it work for freelancers or only for agencies?',
      a: 'Both. Start is for freelancers who are getting going; Max is for agencies with dozens of clients and a full team.',
    },
    {
      q: 'What payment methods do you accept, and can I cancel anytime?',
      a: 'You pay by card through Stripe, billed in US dollars. You can cancel anytime with no fee, and your data stays available to export for 30 days after you cancel.',
    },
  ],
  finalCta: {
    signedInTitle: 'Welcome back!',
    signedInBody: 'Your account is active. Open the dashboard and pick up where you left off.',
    titleBefore: 'Ready to leave ',
    titleEm: 'the spreadsheets behind?',
    body: 'Use Pro for 14 days, no card required, and get your clients organized today. At the end, you decide whether to stay.',
    signIn: 'Sign in',
  },
  nav: [
    { id: 'features', label: 'Features' },
    { id: 'agente', label: 'AI agent' },
    { id: 'how', label: 'How it works' },
    { id: 'pricing', label: 'Pricing' },
    { id: 'faq', label: 'FAQ' },
  ],
  chrome: {
    skipLink: 'Skip to content',
    signIn: 'Sign in',
    createAccount: 'Create free account',
    createAccountShort: 'Sign up',
    createAccountAria: 'Create free account',
    openDashboard: 'Open dashboard',
    toggleTheme: 'Toggle theme',
    logoLabel: 'Mesaas',
  },
  footer: {
    tagline: 'Management for people who live on social media.',
    productLabel: 'Product',
    legalLabel: 'Legal',
    product: [
      'Features',
      'How it works',
      'Pricing',
      'FAQ',
      'Post approvals',
      'Client portal',
      'AI content agent',
      'About',
      'Changelog',
      'Blog',
    ],
    legal: ['Privacy Policy', 'Terms of Service'],
    copyright: '© {year} Mesaas, operated by EBS IT SOLUTIONS (Salvador, Brazil)',
    cookieSettings: 'Cookie settings',
    doNotSell: 'Do Not Sell or Share My Personal Information',
    otherLanguage: 'Versão em português',
    instagramLabel: 'Mesaas on Instagram',
    linkedinLabel: 'Mesaas on LinkedIn',
    youtubeLabel: 'Mesaas on YouTube',
  },
  pricing: {
    title: 'Start small and grow without switching tools.',
    promo: 'Create your account and use Pro for 14 days, no card required.',
    body: 'If you would rather pick a plan now, paid plans include a 30-day free trial with a card. No lock-in, cancel anytime.',
    promoNote: '14 days of Pro free, no card required. No coupon.',
    periodLabel: 'Billing period',
    monthly: 'Monthly',
    yearly: 'Yearly',
    loading: 'Loading plans',
    loadError: 'We could not load the plans right now.',
    retry: 'Try again',
    unavailable: 'Plans are temporarily unavailable.',
    popular: 'Most popular',
    onRequest: 'Contact us',
    perMonth: '/mo',
    trialNote: '30-day free trial with a card',
    unlimited: 'Unlimited',
    unlimitedSuffix: 'unlimited',
    client: ['client', 'clients'],
    user: ['user', 'users'],
    openDashboard: 'Open dashboard',
    subscribeTemplate: 'Subscribe to {plan}',
    discoverTemplate: 'Meet the {plan} plan',
    billedAnnuallyTemplate: 'billed annually ({total}/year)',
  },
  planComparison: {
    title: 'Compare plans',
    sub: 'See what each plan includes.',
    swipeHint: 'Swipe to compare →',
    regionLabel: 'Plan comparison table',
    caption: 'Detailed plan comparison',
    featureColumn: 'Feature',
    capacityGroup: 'Capacity',
    featuresGroup: 'Features',
    included: 'Included',
    notIncluded: 'Not included',
    choosePlan: 'Choose your plan',
    capacityRows: {
      max_instagram_accounts: 'Instagram accounts',
      storage_quota_bytes: 'Storage',
      max_workflow_templates: 'Workflow templates',
      max_hub_tokens: 'Client portals',
      rate_report_generations_per_month: 'Reports per month',
    },
    featureRows: {
      feature_post_scheduling: 'Post scheduling',
      feature_tiktok: 'TikTok',
      feature_leads: 'Leads',
      feature_financial: 'Finance',
      feature_contracts: 'Contracts',
      feature_brand_customization: 'Brand customization',
      feature_mcp: 'Agent integration (MCP)',
      feature_instagram_automation: 'Automations',
      feature_briefing_audio: 'Audio briefing',
    },
  },
  planMarketing: {
    free: { description: 'To get to know the platform.', cta: 'Use Free' },
    start: { description: 'For freelancers building their client list.', cta: 'Start free trial' },
    pro: {
      description: 'For freelancers with a full client list.',
      cta: 'Start free trial',
      highlight: true,
    },
    max: { description: 'For agencies with a team.', cta: 'Start free trial' },
  },
};
