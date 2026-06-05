/**
 * Cloudflare Worker — proxy para consulta de PROCESSOS por CNPJ (Jusbrasil).
 *
 * Mesma motivação do proxy da Transparência:
 *   1. A API do Jusbrasil exige token (Bearer) que NÃO pode ficar no navegador.
 *   2. Não há CORS — o browser bloqueia a chamada direta.
 *
 * Este worker recebe GET /processos?cnpj=XXXXX, chama o Jusbrasil com o token,
 * e devolve um formato NORMALIZADO (independente do provedor):
 *   { total, comoAutor, comoReu, processos: [ { numero, tribunal, classe,
 *     assuntos:[string], polo:"ATIVO"|"PASSIVO"|null, status, ano } ] }
 *
 * Deploy:
 *   1. Contrate o Jusbrasil Consulta PRO e gere o token (painel → Configurações).
 *   2. wrangler secret put JUSBRASIL_TOKEN
 *   3. (opcional) ALLOWED_ORIGIN no wrangler.toml
 *   4. wrangler deploy  →  cole a URL em Configurações do app.
 *
 * ⚠️ AJUSTE NECESSÁRIO: o endpoint exato e os nomes de campo da resposta do
 * Jusbrasil ficam atrás do login (Consulta PRO). Confirme em
 * https://api.jusbrasil.com.br/docs/ e ajuste `ENDPOINT_JUSBRASIL` e a função
 * `mapearJusbrasil()` com um exemplo real de resposta. O resto do app não muda,
 * pois consome o formato normalizado.
 *
 * Trocar de provedor (Escavador/Judit, que têm self-service): basta reescrever
 * `consultarProvedor()` e `mapear*()` — o contrato com o app permanece igual.
 */

// Confirme o caminho exato na doc do Consulta PRO. Placeholder plausível:
const ENDPOINT_JUSBRASIL = "https://api.jusbrasil.com.br/v2/lawsuits/search";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET" || url.pathname !== "/processos") {
      return json({ error: "Use GET /processos?cnpj=" }, 404, cors);
    }
    const cnpj = (url.searchParams.get("cnpj") || "").replace(/\D/g, "");
    if (cnpj.length !== 14) return json({ error: "cnpj inválido" }, 400, cors);
    if (!env.JUSBRASIL_TOKEN) return json({ error: "JUSBRASIL_TOKEN não configurado" }, 500, cors);

    let bruto;
    try {
      bruto = await consultarProvedor(cnpj, env.JUSBRASIL_TOKEN);
    } catch (e) {
      return json({ error: "Falha ao consultar o provedor.", detalhe: String(e) }, 502, cors);
    }
    return json(mapearJusbrasil(bruto, cnpj), 200, cors);
  },
};

// Chamada ao provedor. Ajuste método/params conforme a doc do Consulta PRO.
async function consultarProvedor(cnpj, token) {
  const u = `${ENDPOINT_JUSBRASIL}?cpf_cnpj=${cnpj}`;
  const r = await fetch(u, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}

// Normaliza a resposta do Jusbrasil para o formato do app. DEFENSIVO: tenta
// vários nomes de campo. Ajuste com um exemplo real quando tiver acesso.
function mapearJusbrasil(d, cnpj) {
  const lista = d.lawsuits || d.processos || d.results || d.data || [];
  const processos = (Array.isArray(lista) ? lista : []).map((p) => {
    const partes = p.parties || p.partes || [];
    const polo = inferirPolo(partes, cnpj);
    const assuntos = (p.subjects || p.assuntos || p.subject || [])
      .map((a) => (typeof a === "string" ? a : a.name || a.descricao || a.title))
      .filter(Boolean);
    return {
      numero: p.cnj || p.number || p.numero || p.id || "",
      tribunal: p.court || p.tribunal || p.tribunal_sigla || "",
      classe: p.class || p.classe || p.className || "",
      assuntos,
      polo,
      status: p.status || p.situacao || "",
      ano: p.year || p.ano || "",
    };
  });
  const comoAutor = processos.filter((p) => p.polo === "ATIVO").length;
  const comoReu = processos.filter((p) => p.polo === "PASSIVO").length;
  return { total: processos.length, comoAutor, comoReu, processos };
}

function inferirPolo(partes, cnpj) {
  for (const parte of partes || []) {
    const doc = String(parte.document || parte.cnpj || parte.cpf_cnpj || "").replace(/\D/g, "");
    if (doc === cnpj) {
      const tipo = String(parte.role || parte.polo || parte.type || "").toUpperCase();
      if (/ATIV|AUTOR|REQUERENTE|EXEQUENTE/.test(tipo)) return "ATIVO";
      if (/PASSIV|R[ÉE]U|REQUERID|EXECUTAD/.test(tipo)) return "PASSIVO";
    }
  }
  return null;
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}
