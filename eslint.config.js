import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  /**
   * `site/` IS ITS OWN PROJECT and lints itself.
   *
   * It is a separate Next app with its own eslint.config.mjs and its own
   * node_modules, and `eslint .` from here walked straight into it — loading
   * ITS eslint-plugin-react against THIS ESLint 10, which throws outright:
   *
   *   TypeError: Error while loading rule 'react/display-name':
   *   contextOrFilename.getFilename is not a function
   *
   * So `npm run lint` did not report a single problem with the app, it died on
   * the marketing site. A lint that cannot run is a lint nobody reads.
   *
   * Lint the site from inside site/, where its own config and its own plugin
   * versions agree with each other.
   */
  globalIgnores(['dist', 'site', 'android', 'node_modules', 'scripts/.tmp']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      /**
       * A LEADING UNDERSCORE MEANS "ON PURPOSE", AND TYPESCRIPT ALREADY AGREES.
       *
       * `tsconfig.app.json` runs with `noUnusedLocals` and `noUnusedParameters`
       * on, and the type-check is clean — because TypeScript honours the
       * leading underscore. ESLint's copy of the same rule did not, so the two
       * linters held opposite opinions about the same five lines and the build
       * only heard one of them.
       *
       * Every one of those five is the destructure-to-omit idiom:
       *
       *   const { overhangM: _drop, ...rest } = a.ridge
       *
       * The name is how the key gets dropped. It cannot be deleted, because
       * deleting it puts the key back. Renaming the convention across the tree
       * to satisfy a rule TypeScript already exempts is churn, not a fix.
       *
       * `ignoreRestSiblings` is the half that makes the idiom legal at all;
       * the patterns are what let the intent be spelled out in the name.
       */
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
])
