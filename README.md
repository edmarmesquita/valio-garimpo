# Valiô Garimpo

Frontend Vite/React e API Express publicada como Vercel Function. A conexão OAuth com o Mercado Livre usa PostgreSQL exclusivo deste projeto.

## Preparação do OAuth

1. Crie um banco PostgreSQL/Neon **separado do projeto Valiô principal** e execute `migrations/001_mercado_livre_oauth.sql` uma vez antes do deploy. Use a URL de conexão com pool do Neon e TLS obrigatório.
2. Configure no ambiente da API (`.env` local; Environment Variables em Production na Vercel): `DATABASE_URL`, `MELI_TOKEN_ENCRYPTION_KEY`, `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET` e `MELI_REDIRECT_URI`. O `.env.example` contém somente os nomes. A URI de produção é `https://valio-garimpo.vercel.app/api/mercadolivre/callback`, igual à do DevCenter.
3. Gere `MELI_TOKEN_ENCRYPTION_KEY` como 32 bytes aleatórios em Base64 (por exemplo, `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`). Guarde o valor apenas no gerenciador de segredos; mantenha a mesma chave entre deployments. A troca da chave sem migração dos dados criptografados exige nova autorização.

`npm run server` inicia a API local; `npm run dev` inicia o frontend. Para autorizar localmente, use uma redirect URI local também cadastrada no DevCenter e definida em `MELI_REDIRECT_URI`. Nunca coloque segredo ou token em variáveis `VITE_*`.

## Fluxo e segurança

`GET /api/mercadolivre/auth/iniciar` cria `state` e PKCE S256. O banco guarda apenas hashes do `state` e do cookie de sessão e o `code_verifier` criptografado. O navegador recebe somente um cookie opaco HttpOnly/SameSite=Lax. O callback consome o `state` uma única vez, troca o código por tokens, consulta `/users/me` para identificar a conta e grava access/refresh tokens criptografados com AES-256-GCM. A gravação da conexão e a associação ao cookie são transacionais.

`GET /api/mercadolivre/status` consulta o banco e devolve apenas `connected`, `account` (ID e apelido) ou `requiresReconnect`, nunca tokens. Sem sessão ou vínculo retorna `200 {"connected":false}`. Falha de banco/configuração/renovação retorna `503`. Quando o access token está perto de expirar, a renovação usa bloqueio de linha PostgreSQL (`FOR UPDATE`) e atualiza access/refresh tokens juntos. Isto evita que instâncias concorrentes usem o mesmo refresh token de uso único. Se o provedor devolver `invalid_grant`, a conta passa a exigir nova autorização. Uma falha de processo entre a rotação no provedor e o commit no banco ainda pode exigir reconexão; essa etapa não pode ser transacional entre dois sistemas.

Até haver login próprio do Garimpo, o cookie de sessão é a prova de vínculo do navegador com a conta conectada. Perder/expirar o cookie requer nova autorização. A tabela de conexões já usa o ID da conta Mercado Livre, permitindo vincular uma identidade própria futuramente. Restrinja o acesso ao banco e seus backups; a chave e `MELI_CLIENT_SECRET` devem ficar só no servidor. `/api/health` e `/api/garimpo/status` não consultam o banco OAuth.

Não há consulta/importação de produtos nesta integração.
