# NoteTron

App de anotações e estudo para computador e celular. É um app web instalável (PWA): roda em Windows, macOS, Android e iPhone e funciona offline.

## Estrutura

```
web/                      → o app (arquivos estáticos; é isso que vai para a hospedagem)
  index.html, css/, js/, icons/, sw.js, manifest.webmanifest
  js/config.js            → URL e chave pública do Supabase, e-mail do dono
supabase/
  migrations/…init.sql    → tabelas, índices e regras de acesso (RLS)
  functions/ai/           → IA (OpenAI), liberada só para o e-mail do dono
  functions/note-key/     → recuperação/troca da senha das anotações por e-mail
```

## Configuração (uma vez)

### 1. Banco de dados
Aplique `supabase/migrations/20261008000000_notetron_init.sql`. Pode ser pelo SQL Editor do painel do Supabase ou pelo conector MCP.

### 2. Edge Functions
Publique as funções `ai` e `note-key`:

```bash
npx supabase functions deploy ai note-key --project-ref urzqfpktczpfeyupdasm
```

### 3. Segredos das funções
Configure em **Painel → Edge Functions → Secrets**:

| Nome | Valor |
|---|---|
| `OPENAI_API_KEY` | sua chave da OpenAI (nunca coloque no código do app) |
| `RECOVERY_SECRET` | texto aleatório longo, gerado pelo comando abaixo |
| `OPENAI_MODEL` | opcional; o padrão é `gpt-4o-mini` |

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

> Guarde o `RECOVERY_SECRET`. Se ele for trocado, as recuperações por e-mail já existentes deixam de funcionar.

### 4. Chave pública no app
Em **Painel → Project Settings → API**, copie a chave **anon / publishable** para `SUPABASE_ANON_KEY` em `web/js/config.js`. Essa chave é pública. Nunca use a `service_role`.

### 5. Autenticação
- **Authentication → URL Configuration**: em *Site URL* e *Redirect URLs*, coloque o endereço onde o app ficar hospedado (ex.: `https://notetron.netlify.app`).
- **SMTP próprio** (Authentication → Emails → SMTP): o envio de e-mail padrão do Supabase só entrega para membros do projeto e tem limite baixo por hora. Para distribuir o app, configure um provedor (Resend, Brevo, SendGrid…).
- **Authentication → Emails → Templates**, para os e-mails trazerem **código e link**:
  - **Confirm signup**: assunto `Confirme seu e-mail no NoteTron`, corpo `supabase/templates/confirm-signup.html`.
  - **Magic Link**: assunto `Seu código do NoteTron`, corpo `supabase/templates/magic-link.html` (troca/recuperação de senha das anotações).
- **Authentication → Providers → Email**: deixe **Confirm email** ligado (sem confirmar, a conta não entra).

### 6. Hospedagem
Publique a pasta `web/` em qualquer hospedagem estática com HTTPS, como Netlify, Vercel, Cloudflare Pages ou GitHub Pages.

### 7. Conta do dono
Abra o app, vá em **Criar conta** e use o e-mail do dono. Depois de confirmar o e-mail, os botões de IA aparecem.

## Instalar como aplicativo
- **Chrome/Edge (PC ou Android):** ícone "Instalar" na barra de endereço, ou menu → *Instalar app* / *Adicionar à tela inicial*.
- **iPhone/iPad (Safari):** Compartilhar → *Adicionar à Tela de Início*.

## Como funcionam as senhas das anotações
- O conteúdo é criptografado **no aparelho** (AES-256-GCM). A chave da anotação é protegida pela senha (PBKDF2, 310 mil iterações). O servidor guarda só dados cifrados. O título fica visível na Gaveta.
- Para permitir a troca ou recuperação por e-mail, uma cópia da chave fica guardada cifrada com o `RECOVERY_SECRET`, que só a função `note-key` conhece. Ela só devolve essa chave quando o login atual foi confirmado por um link ou código enviado ao e-mail nos últimos 15 minutos.
- Na prática: um vazamento do banco de dados sozinho não expõe as anotações. Quem tiver acesso ao painel do Supabase com os segredos das funções conseguiria recuperá-las. Esse é o preço da recuperação por e-mail.

## Testar localmente
```bash
npx -y http-server@14.1.1 web -p 5173 -c-1
```
Abra http://localhost:5173. Sem o Supabase configurado, use **"Usar sem conta"**: os dados ficam só naquele navegador.
