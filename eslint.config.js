import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import i18next from 'eslint-plugin-i18next';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'supabase/functions/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'no-empty': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
  // i18n ratchet: CRM areas already on react-i18next must not regain hardcoded JSX copy.
  // Add a directory here when its module migrates. Notifications and the incident banner are
  // left out on purpose: their text comes from the untranslated notification catalog.
  {
    files: [
      'apps/crm/src/pages/{dashboard,clientes,leads,automacoes,login,entregas,calendario,configuracao,tarefas,cliente-detalhe}/**/*.tsx',
      'apps/crm/src/components/billing/**/*.tsx',
      'apps/crm/src/components/layout/**/*.tsx',
    ],
    ignores: [
      '**/__tests__/**',
      'apps/crm/src/components/layout/{NotificationBell,NotificationPopover,PhoneNotifications,IncidentBanner}.tsx',
    ],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-text-only',
          // Setting `words` drops the plugin's defaults, so punctuation, arrows and single-key
          // hints (⌘K) are re-allowed here alongside brand names.
          words: { exclude: [/^[^\p{L}]*\p{L}?[^\p{L}]*$/u, /^(Instagram|TikTok)$/] },
        },
      ],
    },
  },
  prettier,
);
