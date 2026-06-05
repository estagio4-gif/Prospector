/**
 * Cloudflare Worker — proxy para a API do Portal da Transparência (CGU).
 *
 * Por que existe:
 *   - A API da CGU exige um token (`chave-api-dados`) que NÃO pode ficar no
 *     navegador. Este worker guarda o token (variável de ambiente) e o injeta.
 *   - A API da CGU não envia cabeçalhos CORS; o navegador bloqueia a chamada
 *     direta. Este worker devolve a resposta com CORS liberado para a sua app.
 *
 * Só repassa os 4 endpoints que o Prospector usa (whitelist) — nada mais.
 *
 * Deploy (resumo):
 *   1. Tenha uma conta Cloudflare (free) e o `wrangler` instalado (`npm i -g wrangler`).
 *   2. Obtenha o token grátis da CGU em:
 *      https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email
 *   3. Configure os segredos:
 *        wrangler secret put PORTAL_API_TOKEN      # cole o token da CGU
 *      (opcional) defina ALLOWED_ORIGIN no wrangler.toml para travar a origem.
 *   4. `wrangler deploy`
 *   5. Cole a URL do worker em Configurações → "URL do proxy do Portal da Transparência".
 *
 * Nota: o cabeçalho de autenticação da CGU é `chave-api-dados`. Se você receber
 * 401, tente trocar para `Authorization` (o swagger nomeia o esquema assim).
 */

const UPSTREAM = "https://api.portaldatransparencia.gov.br";

const ALLOWED_PATHS = new Set([
  "/api-de-dados/ceis",
  "/api-de-dados/cnep",
  "/api-de-dados/cepim",
  "/api-de-dados/contratos/cpf-cnpj",
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    if (request.method !== "GET") {
      return json({ error: "Método não permitido." }, 405, cors);
    }
    if (!ALLOWED_PATHS.has(url.pathname)) {
      return json({ error: "Endpoint não permitido por este proxy." }, 403, cors);
    }
    if (!env.PORTAL_API_TOKEN) {
      return json({ error: "PORTAL_API_TOKEN não configurado no worker." }, 500, cors);
    }

    const upstreamUrl = UPSTREAM + url.pathname + url.search;
    let resp;
    try {
      resp = await fetch(upstreamUrl, {
        headers: {
          "chave-api-dados": env.PORTAL_API_TOKEN,
          "Accept": "application/json",
        },
      });
    } catch (e) {
      return json({ error: "Falha ao alcançar a CGU.", detalhe: String(e) }, 502, cors);
    }

    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
    });
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}
