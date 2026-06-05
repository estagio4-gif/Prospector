/**
 * Camada de IA — Claude Haiku 4.5.
 *
 * Estratégia de economia de tokens:
 *  1. System prompt curto e reutilizável (cacheável em produção).
 *  2. User message envia só o RESUMO compacto (não o JSON da Receita).
 *  3. Limitamos max_tokens da resposta.
 *  4. Prompt direciona o modelo a uma estrutura JSON pequena.
 *
 * Custo estimado por consulta: ~600 tokens entrada + ~500 saída
 *   = ~0,0006 USD com Claude Haiku 4.5 ($1/MTok input, $5/MTok output)
 */

const MODELO = "claude-haiku-4-5-20251001";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `Você é um analista tributário brasileiro especializado em recuperação de créditos.
Receberá um resumo estruturado de uma empresa-alvo (já pré-classificada) e a lista das 3 teses
mais aderentes (já filtradas por algoritmo).

Sua tarefa: produzir um JSON com 3 campos:
{
  "abertura": "1 parágrafo (40-60 palavras) caracterizando a empresa e sua relevância como prospect.",
  "racional": "1 parágrafo (60-90 palavras) explicando por que essa empresa é candidata para essas teses, citando as características que justificam.",
  "abordagem": "1 frase (15-25 palavras) sugerindo o ângulo de abordagem comercial."
}

Tom: técnico, objetivo, sem floreios. Português brasileiro formal. Não inclua disclaimers nem
explique o que é cada tese (presume-se que o advogado já sabe). Retorne APENAS o JSON, sem
markdown, sem texto antes ou depois.`;

/**
 * Chama o Claude Haiku para gerar a narrativa do relatório.
 * Recebe `resumo` (objeto compacto produzido por ENGINE.resumoParaIA).
 */
async function gerarNarrativa(resumo, apiKey) {
  if (!apiKey) throw new Error("Chave da API Anthropic não configurada.");

  const userMessage = `Empresa-alvo:\n${JSON.stringify(resumo, null, 2)}\n\nGere o JSON conforme instrução.`;

  const body = {
    model: MODELO,
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  };

  const resp = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    let detail = "";
    try { detail = (await resp.json())?.error?.message || ""; } catch {}
    throw new Error(`Falha na chamada à IA (HTTP ${resp.status}). ${detail}`);
  }

  const data = await resp.json();
  const textoBruto = data?.content?.[0]?.text || "";

  // Parse robusto: tenta JSON direto, depois extrai bloco entre {...}
  try {
    return JSON.parse(textoBruto);
  } catch {
    const match = textoBruto.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    // Fallback: devolve estrutura mínima com o texto bruto na abertura
    return {
      abertura: textoBruto.trim() || "Análise gerada.",
      racional: "",
      abordagem: "",
    };
  }
}

/**
 * Versão totalmente offline (sem IA). Gera narrativa por templates a partir do contexto.
 * Útil para quando o usuário desmarca "Usar IA" — economia máxima: zero tokens.
 */
function narrativaTemplate(contexto, top3) {
  const tesesNomes = top3.map((t) => `"${t.titulo}"`).join(", ");
  const regimeStr = contexto.regimeConfianca > 0.7 ? contexto.regime : `provavelmente ${contexto.regime}`;
  const anosStr = contexto.tempoExistenciaAnos > 0 ? `${contexto.tempoExistenciaAnos} anos de atividade` : "atividade recente";
  const folhaStr = contexto.perfil.foliaIntensiva ? "folha de pagamento relevante" : "folha de pagamento moderada";

  return {
    abertura: `${contexto.razaoSocial}${contexto.nomeFantasia ? ` (${contexto.nomeFantasia})` : ""} atua no setor de ${contexto.setor.toLowerCase()} (${contexto.cnaeDescricao || "CNAE " + contexto.cnae}), com porte ${contexto.porte} e ${anosStr} em ${contexto.municipio}/${contexto.uf}. Regime tributário ${regimeStr}.`,
    racional: `O perfil indica ${folhaStr} e regime ${contexto.regime}, configuração típica para revisão das teses ${tesesNomes}. O tempo de existência permite revisão dos últimos 5 anos (prescrição quinquenal), com janela ampla de recuperação.`,
    abordagem: `Sugere-se abordagem via diagnóstico tributário gratuito focado nas top 2-3 teses, com proposta de honorários de êxito sobre o crédito apurado.`,
  };
}

window.AI = { gerarNarrativa, narrativaTemplate };
