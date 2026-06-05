# Proxy do Portal da Transparência (CGU)

Proxy serverless mínimo para habilitar a seção **"Relacionamento com o setor
público"** no Prospector Tributário (sanções CEIS/CNEP/CEPIM + contratos
federais por CNPJ).

## Por que é necessário

A [API da CGU](https://api.portaldatransparencia.gov.br/) tem duas barreiras
para uso direto no navegador:

1. **Token obrigatório** (`chave-api-dados`) — não pode ficar no front-end.
2. **Sem CORS** — o navegador bloqueia a chamada direta.

Este worker resolve as duas: guarda o token e libera CORS para a sua app.
Ele só repassa 4 endpoints (whitelist) — nada além disso.

## Passo a passo

1. **Token grátis da CGU:** cadastre um e-mail em
   <https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email>
   e copie a chave recebida.

2. **Instale o Wrangler** (CLI do Cloudflare):
   ```bash
   npm install -g wrangler
   wrangler login
   ```

3. **Configure o token como segredo** (a partir desta pasta `proxy/`):
   ```bash
   wrangler secret put PORTAL_API_TOKEN
   # cole o token quando pedir
   ```

4. **(Opcional) Trave a origem** editando `ALLOWED_ORIGIN` no `wrangler.toml`
   para a URL da sua app (ex.: `https://seu-app.pages.dev`).

5. **Deploy:**
   ```bash
   wrangler deploy
   ```
   O Wrangler imprime a URL final (algo como
   `https://prospector-transparencia.SEU-SUBDOMINIO.workers.dev`).

6. **Conecte na app:** abra o Prospector → ⚙ Configurações → cole a URL no
   campo **"URL do proxy do Portal da Transparência"** → Salvar.

Pronto. A partir daí, cada análise de CNPJ consulta sanções e contratos federais.

## Teste rápido

```bash
curl "https://SEU-WORKER.workers.dev/api-de-dados/contratos/cpf-cnpj?cpfCnpj=00000000000191&pagina=1"
```

Deve retornar JSON (array). Se vier `401`, o token está errado — ou tente trocar
o header `chave-api-dados` por `Authorization` no `transparencia-worker.js`.

## Limites

A API da CGU limita ~90 requisições/minuto (mais à noite). O worker não adiciona
limite próprio; o cache de 24h no front-end (`transparencia.js`) já reduz bastante
as chamadas repetidas.
