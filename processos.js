/**
 * Consulta de processos por CNPJ (litígio já ajuizado) — eixo "o que a empresa
 * já levou ao Judiciário". Serve para NÃO oferecer uma tese que o cliente já
 * ajuizou e para sinalizar leads que litigam em matéria tributária.
 *
 * Provider-agnóstico: este módulo fala com um PROXY que devolve um formato
 * normalizado. O adaptador da fonte (Jusbrasil por padrão; poderia ser
 * Escavador/Judit) fica no proxy — ver proxy/processos-worker.js.
 *
 * Por que proxy (igual à Transparência):
 *   1. A API do Jusbrasil exige token (Bearer) — não pode ficar no navegador.
 *   2. Não há CORS — o browser bloqueia a chamada direta.
 * A URL do proxy é configurável no modal e salva em localStorage. Sem proxy
 * configurado, a seção simplesmente não aparece.
 *
 * Formato normalizado esperado do proxy (GET {proxy}/processos?cnpj=XXemvar):
 *   {
 *     total: number,
 *     comoAutor: number, comoReu: number,
 *     processos: [ { numero, tribunal, classe, assuntos:[string],
 *                    polo: "ATIVO"|"PASSIVO"|null, status, ano } ],
 *   }
 */

(function () {
  "use strict";

  const CACHE_PREFIX = "prosp_proc_";
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const PROXY_KEY = "prosp_proc_proxy";

  function getProxyUrl() {
    return (localStorage.getItem(PROXY_KEY) || "").trim().replace(/\/+$/, "");
  }
  function setProxyUrl(v) {
    const clean = (v || "").trim().replace(/\/+$/, "");
    if (clean) localStorage.setItem(PROXY_KEY, clean);
    else localStorage.removeItem(PROXY_KEY);
  }
  function disponivel() {
    return !!getProxyUrl();
  }

  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.t > CACHE_TTL_MS) {
        localStorage.removeItem(CACHE_PREFIX + key);
        return null;
      }
      return parsed.v;
    } catch {
      return null;
    }
  }
  function cacheSet(key, value) {
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
    } catch {}
  }

  /**
   * Consulta processos do CNPJ via proxy. Best-effort: devolve null se não há
   * proxy ou em qualquer falha. Cache de 24h.
   */
  async function consultar(cnpj) {
    if (!disponivel()) return null;
    const cnpjLimpo = window.ENGINE.limparCnpj(cnpj);
    const cached = cacheGet(cnpjLimpo);
    if (cached) return cached;

    const url = `${getProxyUrl()}/processos?cnpj=${cnpjLimpo}`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        console.warn("Proxy de processos respondeu", resp.status);
        return null;
      }
      const data = await resp.json();
      // Garante o formato mínimo esperado.
      const out = {
        total: Number(data.total) || (Array.isArray(data.processos) ? data.processos.length : 0),
        comoAutor: Number(data.comoAutor) || 0,
        comoReu: Number(data.comoReu) || 0,
        processos: Array.isArray(data.processos) ? data.processos : [],
        consultadoEm: new Date().toISOString(),
      };
      cacheSet(cnpjLimpo, out);
      return out;
    } catch (e) {
      console.warn("Falha ao consultar o proxy de processos:", e);
      return null;
    }
  }

  window.PROCESSOS = { consultar, disponivel, getProxyUrl, setProxyUrl };
})();
