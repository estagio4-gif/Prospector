/**
 * Integração com a API do Portal da Transparência (CGU).
 *
 *   https://api.portaldatransparencia.gov.br/api-de-dados
 *
 * Endpoints usados (todos por CNPJ):
 *   /api-de-dados/ceis?codigoSancionado={cnpj}            — empresas inidôneas/suspensas
 *   /api-de-dados/cnep?codigoSancionado={cnpj}            — empresas punidas (Lei Anticorrupção)
 *   /api-de-dados/cepim?cnpjSancionado={cnpj}             — entidades sem fins lucrativos impedidas
 *   /api-de-dados/contratos/cpf-cnpj?cpfCnpj={cnpj}       — contratos federais como fornecedor
 *
 * IMPORTANTE — por que isto fala com um PROXY e não direto com a CGU:
 *   1. A API exige um token (`chave-api-dados`). Token não pode ficar no
 *      browser (qualquer um leria no DevTools). Fica no backend.
 *   2. A API NÃO envia cabeçalhos CORS — o navegador bloqueia a chamada direta.
 *   Por isso este módulo chama um proxy serverless (ver proxy/transparencia-worker.js),
 *   que guarda o token e repassa a requisição. A URL do proxy é configurável
 *   no modal de Configurações e salva em localStorage.
 *
 * Tudo é best-effort: sem proxy configurado, ou em qualquer falha, a seção
 * simplesmente não aparece e o resto do relatório segue normal.
 */

(function () {
  "use strict";

  const CACHE_PREFIX = "prosp_transp_";
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
  const PROXY_KEY = "prosp_transp_proxy";

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

  // Chama um recurso do proxy. O proxy expõe os mesmos paths da CGU:
  // {proxy}/api-de-dados/ceis?... etc. Devolve array (ou [] em qualquer falha).
  async function getProxy(path, params) {
    const base = getProxyUrl();
    if (!base) return [];
    const qs = new URLSearchParams(params).toString();
    const url = `${base}${path}?${qs}`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        console.warn("Portal da Transparência respondeu", resp.status, path);
        return [];
      }
      const data = await resp.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn("Falha ao consultar o proxy da Transparência:", e);
      return [];
    }
  }

  // ---------- Normalizadores defensivos ----------
  // A CGU aninha campos de formas diferentes entre cadastros; extraímos com
  // vários fallbacks para não quebrar quando a estrutura variar.

  function texto(...candidatos) {
    for (const c of candidatos) {
      if (c == null) continue;
      if (typeof c === "string" && c.trim()) return c.trim();
      if (typeof c === "object") {
        const v = c.nome || c.descricao || c.descricaoResumida || c.descricaoCompleta;
        if (v) return String(v).trim();
      }
    }
    return "";
  }

  function normalizarSancao(item, fonte) {
    return {
      fonte,
      tipo: texto(item.tipoSancao, item.descricaoResumida, item.tipo) || "Sanção",
      orgao: texto(item.orgaoSancionador, item.orgaoEntidade, item.orgao),
      inicio: texto(item.dataInicioSancao, item.dataInicio, item.dataReferencia),
      fim: texto(item.dataFimSancao, item.dataFinalSancao, item.dataFim),
      descricao: texto(
        item.textoPublicacao,
        item.fundamentacao && item.fundamentacao[0] && item.fundamentacao[0].descricao,
        item.tipoSancao
      ),
    };
  }

  function valorContrato(item) {
    const cands = [
      item.valorInicialCompra, item.valorFinalCompra, item.valorContrato,
      item.valor, item.valorInicial, item.valorFinal,
    ];
    for (const c of cands) {
      const n = Number(c);
      if (!isNaN(n) && n > 0) return n;
    }
    return 0;
  }

  function normalizarContrato(item) {
    return {
      orgao: texto(item.unidadeGestora, item.orgao, item.orgaoVinculado, item.poder),
      objeto: texto(item.objeto, item.descricaoObjeto),
      numero: texto(item.numero, item.numeroContrato),
      valor: valorContrato(item),
      inicioVigencia: texto(item.dataInicioVigencia, item.dataAssinatura, item.dataPublicacao),
      fimVigencia: texto(item.dataFimVigencia, item.dataFim),
    };
  }

  /**
   * Consulta os 4 cadastros por CNPJ e devolve um resumo normalizado, ou null
   * se o proxy não estiver configurado. Faz cache de 24h por CNPJ.
   */
  async function consultar(cnpj) {
    if (!disponivel()) return null;
    const cnpjLimpo = window.ENGINE.limparCnpj(cnpj);

    const cacheKey = cnpjLimpo;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const [ceis, cnep, cepim, contratosRaw] = await Promise.all([
      getProxy("/api-de-dados/ceis", { codigoSancionado: cnpjLimpo, pagina: 1 }),
      getProxy("/api-de-dados/cnep", { codigoSancionado: cnpjLimpo, pagina: 1 }),
      getProxy("/api-de-dados/cepim", { cnpjSancionado: cnpjLimpo, pagina: 1 }),
      getProxy("/api-de-dados/contratos/cpf-cnpj", { cpfCnpj: cnpjLimpo, pagina: 1 }),
    ]);

    const sancoes = [
      ...ceis.map((i) => normalizarSancao(i, "CEIS")),
      ...cnep.map((i) => normalizarSancao(i, "CNEP")),
      ...cepim.map((i) => normalizarSancao(i, "CEPIM")),
    ];

    const lista = contratosRaw.map(normalizarContrato);
    const valorTotal = lista.reduce((s, c) => s + c.valor, 0);
    const contratos = {
      quantidade: lista.length,
      valorTotal,
      // Mostra os de maior valor primeiro (mais relevantes para inferir porte).
      recentes: lista.sort((a, b) => b.valor - a.valor).slice(0, 5),
    };

    const resultado = {
      consultadoEm: new Date().toISOString(),
      sancoes,
      contratos,
    };
    cacheSet(cacheKey, resultado);
    return resultado;
  }

  window.TRANSPARENCIA = { consultar, disponivel, getProxyUrl, setProxyUrl };
})();
