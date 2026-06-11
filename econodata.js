/**
 * Enriquecimento premium via API da Econodata (v3) — preenche as lacunas que as
 * fontes públicas não têm: melhor telefone (validado por assertividade), decisor
 * + LinkedIn, e-mail validado, faturamento e funcionários presumidos, PAT.
 *
 * Provider via PROXY (mesmo padrão de Transparência/Processos):
 *   - A API exige token (header `x-api-token`) — não pode ficar no navegador.
 *   - Provável ausência de CORS — o proxy resolve.
 * O proxy chama `POST {base}/v3/companies` e devolve o objeto NORMALIZADO abaixo.
 *
 * Formato normalizado esperado do proxy (GET {proxy}/econodata?cnpj=XXX):
 *   {
 *     melhorTelefone, telefones: [{numero, assertividade}],
 *     emails: [{email, assertividade}], emailReceita,
 *     decisores: [{nome, cargo, nivel, linkedin, foto}],
 *     faturamentoPresumido, funcionariosEstimados, porteEstimado,
 *     pat: {funcionarios, email, telefone}
 *   }
 *
 * Custo: 1 crédito por empresa desbloqueada (reconsulta não recobra).
 */

(function () {
  "use strict";

  const CACHE_PREFIX = "prosp_econo_";
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const PROXY_KEY = "prosp_econo_proxy";

  function getProxyUrl() {
    return (localStorage.getItem(PROXY_KEY) || "").trim().replace(/\/+$/, "");
  }
  function setProxyUrl(v) {
    const clean = (v || "").trim().replace(/\/+$/, "");
    if (clean) localStorage.setItem(PROXY_KEY, clean);
    else localStorage.removeItem(PROXY_KEY);
  }
  function disponivel() { return !!getProxyUrl(); }

  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (Date.now() - p.t > CACHE_TTL_MS) { localStorage.removeItem(CACHE_PREFIX + key); return null; }
      return p.v;
    } catch { return null; }
  }
  function cacheSet(key, value) {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value })); } catch {}
  }

  async function consultar(cnpj) {
    if (!disponivel()) return null;
    const cnpjLimpo = window.ENGINE.limparCnpj(cnpj);
    const cached = cacheGet(cnpjLimpo);
    if (cached) return cached;

    try {
      const resp = await fetch(`${getProxyUrl()}/econodata?cnpj=${cnpjLimpo}`);
      if (!resp.ok) { console.warn("Proxy Econodata respondeu", resp.status); return null; }
      const d = await resp.json();
      if (d && d.erro) { console.warn("Econodata:", d.erro); return null; }
      cacheSet(cnpjLimpo, d);
      return d;
    } catch (e) {
      console.warn("Falha ao consultar o proxy Econodata:", e);
      return null;
    }
  }

  window.ECONODATA = { consultar, disponivel, getProxyUrl, setProxyUrl };
})();
