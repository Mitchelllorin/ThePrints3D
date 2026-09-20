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
  },
])
