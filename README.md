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

A integração OAuth não consulta nem importa produtos.

## Publicação manual no Valiô (Fase 2A)

Execute manualmente [migrations/002_valio_produtos_supabase.sql](migrations/002_valio_produtos_supabase.sql) no SQL Editor do projeto Supabase do Valiô. O script cria `public.produtos` com `mercado_livre_id` único, RLS e leitura pública apenas para linhas `ativo = true`; não migra os produtos atuais do Valiô. Confira também se o schema `public` está exposto na Data API do projeto.

Configure **somente no backend** (`.env` local e Environment Variables na Vercel):

- `SUPABASE_URL`: URL HTTPS do projeto Supabase;
- `SUPABASE_SERVICE_ROLE_KEY`: chave administrativa do projeto, nunca em `VITE_*` ou no navegador;
- `VALIO_PUBLISH_TOKEN`: segredo aleatório de pelo menos 32 caracteres para proteger `POST /api/valio/produtos`.

Gere um token local com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Digite **esse token de publicação** na tela `/extrair-afiliados`; ele fica apenas na memória da página. A Service Role nunca deve ser digitada ali nem reutilizada como token de publicação. A rota aceita um produto por requisição, exige `Authorization: Bearer <VALIO_PUBLISH_TOKEN>` e retorna `acao: criado` ou `acao: atualizado`. Um ID repetido é atualizado por upsert, mantendo `ativo = true`. O JSON para copiar continua disponível como fallback.

Para provar o fluxo com **um** produto: inicie a API com `npm run server` e o frontend com `npm run dev`; cole o JSON bruto manualmente, extraia, digite o token de publicação, selecione um card que tenha preço, imagem, link e ITEM_ID, escolha a coleção e clique em **Enviar novos para o Valiô** ou **Atualizar existentes**, conforme o badge. Confira o resumo na tela e, no SQL Editor, execute `select mercado_livre_id, titulo, preco, ativo from public.produtos where mercado_livre_id = 'MLB...';` substituindo pelo ID do teste. A tabela não é criada pelo aplicativo.

## Manutenção da vitrine (Fase 4)

### Métricas de cliques (fase preparada)

Execute manualmente [migrations/003_valio_produto_cliques.sql](migrations/003_valio_produto_cliques.sql) no SQL Editor do Supabase antes de usar esta função. O script cria `public.produto_cliques` com apenas ITEM_ID, horário, origem e categoria, dois índices e a view agregada `public.produto_cliques_diario`; não é executado pelo aplicativo. A tabela não concede leitura ou escrita direta a `anon`/`authenticated`. A Service Role fica somente no backend.

O futuro Valiô principal deverá chamar `POST /api/valio/cliques` no Garimpo com JSON como `{ "mercadoLivreId": "MLB123", "categoria": "Achados para Casa", "origem": "vitrine" }`. `categoria` e `origem` são opcionais; origens aceitas: `vitrine`, `busca`, `colecao`. A rota pública aceita apenas esses campos, valida o ITEM_ID e limita a 600 tentativas por minuto por instância, sem usar IP ou cookies para limitar. No clique do botão de oferta, envie o `fetch` com `keepalive: true` e `credentials: 'omit'`, sem aguardar sua conclusão; mantenha o redirecionamento atual para o Mercado Livre mesmo se a API falhar. A resposta de sucesso é HTTP 201 com `{ "ok": true }`.

O painel **Métricas da vitrine** usa `GET /api/valio/metricas/cliques?periodo=hoje|7dias|30dias|todos`, protegido pelo `VALIO_PUBLISH_TOKEN`. Exibe totais, produtos ativos sem clique, top 10 produtos, categorias e cliques por dia. Os períodos e dias usam `America/Sao_Paulo`. A API lê somente dados agregados da view e os títulos/categorias do catálogo, sem expor eventos individuais. Nenhum nome, email, IP, localização, fingerprint, cookie ou identificador de visitante é gravado. Não é necessário criar cookie novo; eventual menção genérica a métricas agregadas na política de privacidade pode ser avaliada antes da integração no Valiô principal.

Na página `/extrair-afiliados`, informe o token de publicação em **Acesso à vitrine** e clique em **Carregar catálogo** na área **Manutenção da vitrine**. O painel consulta o Supabase pelo backend e inclui produtos ativos e inativos. A Service Role permanece no servidor.

O preço é classificado por `data_preco` (dd/mm/aaaa): até 7 dias, **Atualizado**; de 8 a 15 dias, **Revisar em breve**; acima de 15 dias, **Precisa revisão**. Há filtros por status e idade, ordenação por data, preço e categoria, além de **Revisar catálogo**, que prioriza preços antigos, preços alterados, inativos e outros dados alterados.

Após extrair um lote da Central, o painel compara os itens pelo ITEM_ID e mostra alterações de preço, título, imagem, link e categoria atribuída. Um item ausente do lote recebe apenas uma indicação informativa. **Atualizar existentes** continua sendo a ação manual que aplica os dados extraídos pelo UPSERT atual.

`GET /api/valio/catalogo` lista o catálogo. `PATCH /api/valio/produtos/:mercadoLivreId/status` aceita somente `{ "ativo": true | false }` e altera apenas `ativo`, com confirmação visual antes de desativar. `PATCH /api/valio/produtos/:mercadoLivreId/categoria` aceita somente uma das categorias do Valiô e altera apenas `categoria` e `updated_at`. As três rotas exigem `Authorization: Bearer <VALIO_PUBLISH_TOKEN>`.

### Revisão de preços em lote (Fase 4.1)

Na **Fila de revisão de preços**, cole cada JSON da Central e use **Adicionar lote**. Os lotes ficam apenas na memória da página; o ITEM_ID deduplica os produtos e a entrada mais recente prevalece. **Limpar lotes de revisão** remove todos os lotes. A fila cruza esses IDs com o catálogo carregado e prioriza preços com mais de 15 dias, depois os de 8 a 15 dias. Produtos atualizados podem ser incluídos pelo controle da fila. As listas mostram 40 itens por página.

Selecione os encontrados com preço alterado para **Atualizar preços selecionados** (`preco`, `data_preco`, `updated_at`) ou os encontrados com preço igual para **Confirmar preços iguais selecionados** (somente `data_preco` e `updated_at`). A data usa o dia corrente em `America/Sao_Paulo`. As ações enviam blocos de até 50 itens sequencialmente para `PATCH /api/valio/produtos/precos-lote`, autenticada pelo mesmo Bearer. A rota atualiza somente IDs existentes, devolve resultado por ITEM_ID e permite identificar falhas parciais. Título, imagem, link, categoria, rating e status não são alterados por essa rota; a atualização completa continua em **Atualizar existentes**.

## Verificação de produtos cadastrados (Fase 3)

Com o token informado, a tela consulta `POST /api/valio/produtos/verificar` em um único lote de ITEM_IDs válidos e únicos. A rota exige o mesmo Bearer de publicação, consulta a tabela com a Service Role apenas no backend e inclui registros inativos. O resultado alimenta badges, contagens e o filtro de cadastro; diferenças de preço são exibidas sem atualizar automaticamente. **Enviar novos** usa apenas selecionados ausentes da consulta; **Atualizar existentes** usa apenas selecionados encontrados e mantém o upsert por `mercado_livre_id`. Depois de um envio bem-sucedido, a tela consulta novamente. Sem verificação confiável, ambos os envios ficam desabilitados; a geração e cópia de JSON permanecem disponíveis.

## Migração do catálogo estático (Fase 3.1)

`npm run migrar:produtos:dry` lê `../valio/src/data/products-legacy-backup.ts`, consulta apenas os `mercado_livre_id` dos candidatos no Supabase e gera `migration-reports/valio-produtos-migracao.json` e `.md`. O dry-run não grava produtos. O JSON inclui os payloads exatos dos candidatos migráveis; o Markdown lista separadamente os antigos sem ITEM_ID. O script não executa o backup nem infere IDs por título, link ou imagem. O catálogo ativo em `products.ts` pode permanecer vazio.

A execução real está preparada em `npm run migrar:produtos -- --confirm=INSERIR_APENAS_NOVOS`. Ela exige confirmação explícita, insere apenas candidatos com marketplaceId válido e dados completos, ignora conflitos pelo `mercado_livre_id` e nunca atualiza ou remove registros existentes. Revise o relatório do dry-run antes de autorizar essa execução. Esta fase preparou a ferramenta e o relatório; a execução real não foi feita.

Na futura Fase 2B, o Valiô poderá consultar a Data API do Supabase com chave **publishable** e RLS: `GET <SUPABASE_URL>/rest/v1/produtos?ativo=eq.true&select=id,mercado_livre_id,titulo,descricao,preco,data_preco,link_afiliado,categoria,rating,imagem`. Use os cabeçalhos `apikey: <SUPABASE_PUBLISHABLE_KEY>` e `Authorization: Bearer <SUPABASE_PUBLISHABLE_KEY>`. Nenhuma leitura foi adicionada ao projeto principal nesta etapa.

O status `criado`/`atualizado` é determinado por uma leitura antes do upsert. A chave única impede duplicação mesmo com envios simultâneos, mas duas publicações concorrentes do mesmo ID podem fazer o status de uma delas ser impreciso. Para esta etapa manual, evite publicar o mesmo ID em duas abas ao mesmo tempo.
