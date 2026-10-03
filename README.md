# React + TypeScript + Vite

## OAuth Mercado Livre (prova inicial)

Configure `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET` e `MELI_REDIRECT_URI` somente no backend. A URI de retorno deve ser exatamente a cadastrada no DevCenter: `https://valio-garimpo.vercel.app/api/mercadolivre/callback`. O botão na página inicial inicia a autorização; o callback troca o código por tokens no servidor. O navegador recebe apenas um cookie de sessão opaco, HttpOnly, e o resultado da conexão. `GET /api/mercadolivre/status` retorna somente `connected`, sem tokens.

Nesta prova, `state`, `code_verifier` e tokens ficam **apenas na memória da instância Node**. Na Vercel, chamadas consecutivas podem chegar a instâncias diferentes ou uma instância pode reiniciar; nesse caso, o callback ou o status pode falhar mesmo após a autorização. Antes de uso contínuo, substitua os mapas em memória por armazenamento persistente seguro com expiração, acesso restrito e criptografia dos tokens. A renovação de tokens ainda não foi implementada.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
