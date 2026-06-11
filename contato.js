/**
 * Telefones e contato cadastral — parte do `window.ENGINE`.
 *
 * Normalização, classificação (fixo/celular), dedup multi-fonte e montagem do
 * objeto `contato`. Separado do núcleo (engine.js) por coesão. Carregar depois
 * do engine.js (montarContexto chama `normalizarContato` em tempo de execução).
 */

function formatarTelefoneBr(numero) {
  const d = String(numero || "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return numero || "";
}

// DDDs válidos no Brasil (todos os códigos de área em uso).
const DDDS_VALIDOS = new Set([
  11,12,13,14,15,16,17,18,19, 21,22,24,27,28, 31,32,33,34,35,37,38,
  41,42,43,44,45,46,47,48,49, 51,53,54,55, 61,62,63,64,65,66,67,68,69,
  71,73,74,75,77,79, 81,82,83,84,85,86,87,88,89,
  91,92,93,94,95,96,97,98,99,
]);

/**
 * Reduz qualquer telefone ao padrão nacional em dígitos (10 = fixo, 11 = celular
 * com DDD). Remove +55, zero de operadora (0xx) e qualquer pontuação. Devolve
 * `null` quando o número não é um telefone brasileiro plausível — isso filtra
 * lixo que às vezes vem das bases públicas (CEP, CNAE, etc. em campo errado).
 */
function digitosTelefone(numero) {
  let d = String(numero || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2); // remove +55
  if (d.length === 12 && d.startsWith("0")) d = d.slice(1); // 0 + 11
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1); // 0 + 10
  if (d.length !== 10 && d.length !== 11) return null;
  if (!DDDS_VALIDOS.has(parseInt(d.slice(0, 2), 10))) return null;
  // Celular tem 11 dígitos com o 3º dígito = 9. Fixo tem 10.
  if (d.length === 11 && d[2] !== "9") return null;
  return d;
}

function classificarTipoTel(d) {
  if (!d) return "desconhecido";
  if (d.length === 11 && d[2] === "9") return "celular";
  if (d.length === 10) return "fixo";
  return "desconhecido";
}

/** Constrói um telefone normalizado `{raw, formatado, tipo, whatsapp, fonte}` ou null. */
function montarTelefone(numero, fonte) {
  const d = digitosTelefone(numero);
  if (!d) return null;
  const tipo = classificarTipoTel(d);
  return {
    raw: d,
    formatado: formatarTelefoneBr(d),
    tipo,
    whatsapp: tipo === "celular",
    fonte: fonte || "—",
  };
}

/**
 * Junta telefones de várias fontes, deduplicando pelo número (raw). Quando o
 * mesmo número aparece em fontes diferentes, agrega os nomes das fontes — mais
 * fontes concordando = maior confiança. Ordena celulares primeiro (mais úteis
 * para abordagem comercial).
 */
function mesclarTelefones(listas) {
  const mapa = new Map();
  (listas || []).flat().forEach((tel) => {
    if (!tel || !tel.raw) return;
    const existente = mapa.get(tel.raw);
    if (existente) {
      const fontes = new Set(existente.fonte.split(" + "));
      fontes.add(tel.fonte);
      existente.fonte = Array.from(fontes).join(" + ");
    } else {
      mapa.set(tel.raw, { ...tel });
    }
  });
  return Array.from(mapa.values()).sort((a, b) => {
    if (a.tipo === b.tipo) return 0;
    return a.tipo === "celular" ? -1 : 1;
  });
}

/**
 * Mescla telefones/e-mails extras (de fontes externas) ao contato cadastral já
 * montado, mantendo `telefones` como array de strings formatadas para retro-
 * compatibilidade e adicionando `telefonesDetalhe` (com tipo e fonte).
 */
function aplicarTelefonesExtras(contato, extras) {
  if (!contato) return contato;
  const detalhe = mesclarTelefones([
    contato.telefonesDetalhe || [],
    (extras && extras.telefones) || [],
  ]);
  const emails = Array.from(new Set([
    ...(contato.emails || (contato.email ? [contato.email] : [])),
    ...((extras && extras.emails) || []),
  ].filter(Boolean)));
  return {
    ...contato,
    telefonesDetalhe: detalhe,
    telefones: detalhe.map((t) => t.formatado),
    emails,
    email: contato.email || emails[0] || "",
  };
}

function formatarCep(cep) {
  const d = String(cep || "").replace(/\D/g, "");
  if (d.length !== 8) return cep || "";
  return `${d.slice(0,5)}-${d.slice(5)}`;
}

function normalizarContato(receita) {
  // BrasilAPI v1 entrega `ddd_telefone_1` no formato "11999999999".
  const telefonesDetalhe = mesclarTelefones([[
    montarTelefone(receita.ddd_telefone_1, "Receita (BrasilAPI)"),
    montarTelefone(receita.ddd_telefone_2, "Receita (BrasilAPI)"),
    // Alguns endpoints retornam um campo `telefone` simples.
    montarTelefone(receita.telefone, "Receita (BrasilAPI)"),
  ].filter(Boolean)]);

  const partesEnd = [
    receita.descricao_tipo_de_logradouro,
    receita.logradouro,
    receita.numero,
    receita.complemento,
    receita.bairro,
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  const endereco = partesEnd
    ? `${partesEnd}${receita.cep ? " · CEP " + formatarCep(receita.cep) : ""}`
    : "";

  const emails = Array.from(new Set(
    [receita.email, receita.email_contato].filter(Boolean)
  ));

  return {
    telefones: telefonesDetalhe.map((t) => t.formatado),
    telefonesDetalhe,
    email: emails[0] || "",
    emails,
    endereco,
    municipio: receita.municipio || "",
    uf: receita.uf || "",
    cep: receita.cep ? formatarCep(receita.cep) : "",
  };
}

window.ENGINE = Object.assign(window.ENGINE || {}, {
  montarTelefone,
  mesclarTelefones,
  aplicarTelefonesExtras,
  classificarTipoTel,
  digitosTelefone,
  formatarTelefoneBr,
  normalizarContato,
});
