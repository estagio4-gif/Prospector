/**
 * Métricas de uso (para o piloto / candidatura). Guarda APENAS agregados
 * anônimos em localStorage — NENHUM CNPJ é armazenado (regra de privacidade).
 *
 * Serve para gerar números de tração: quantas análises, % com telefone,
 * % com celular, telefones confirmados por +1 fonte, crédito potencial somado.
 */

(function () {
  "use strict";

  const KEY = "prosp_metrics";

  function base() {
    return {
      analises: 0,
      comTelefone: 0,
      comCelular: 0,
      telConfirmados: 0,   // telefone confirmado por +1 fonte
      comEmail: 0,
      comFaturamento: 0,
      somaCreditoCentral: 0,
      comProcessos: 0,
      copias: 0,
      impressoes: 0,
      porSetor: {},
      inicio: null,
      ultima: null,
    };
  }

  function load() {
    try { return Object.assign(base(), JSON.parse(localStorage.getItem(KEY)) || {}); }
    catch { return base(); }
  }
  function save(m) { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch {} }

  function registrarAnalise(contexto, teses, totalCreditoCentral, processos) {
    const m = load();
    const now = new Date().toISOString();
    m.analises++;
    if (!m.inicio) m.inicio = now;
    m.ultima = now;

    const c = (contexto && contexto.contato) || {};
    const tels = c.telefonesDetalhe || [];
    if (tels.length) m.comTelefone++;
    if (tels.some((t) => t.tipo === "celular")) m.comCelular++;
    if (tels.some((t) => (t.fonte || "").split(" + ").filter(Boolean).length > 1)) m.telConfirmados++;
    if ((c.emails && c.emails.length) || c.email) m.comEmail++;
    if (contexto && contexto.faturamentoInformado) {
      m.comFaturamento++;
      m.somaCreditoCentral += Number(totalCreditoCentral) || 0;
    }
    if (processos && processos.total) m.comProcessos++;

    const setor = (contexto && contexto.setor) || "—";
    m.porSetor[setor] = (m.porSetor[setor] || 0) + 1;
    save(m);
  }

  function registrarEvento(tipo) {
    const m = load();
    if (tipo === "copia") m.copias++;
    else if (tipo === "impressao") m.impressoes++;
    save(m);
  }

  function resumo() { return load(); }
  function limpar() { save(base()); }

  function pct(n, total) { return total ? Math.round((n / total) * 100) : 0; }

  // Texto pronto para copiar/colar em relatório do piloto.
  function texto() {
    const m = load();
    const fmt = (window.ENGINE && window.ENGINE.formatBRL) || ((x) => "R$ " + x);
    const linhas = [
      "MÉTRICAS DE USO — PROSPECTOR (piloto)",
      `Período: ${m.inicio ? new Date(m.inicio).toLocaleDateString("pt-BR") : "—"} a ${m.ultima ? new Date(m.ultima).toLocaleDateString("pt-BR") : "—"}`,
      ``,
      `Análises realizadas: ${m.analises}`,
      `Com telefone: ${m.comTelefone} (${pct(m.comTelefone, m.analises)}%)`,
      `Com celular: ${m.comCelular} (${pct(m.comCelular, m.analises)}%)`,
      `Telefone confirmado por +1 fonte: ${m.telConfirmados} (${pct(m.telConfirmados, m.analises)}%)`,
      `Com e-mail: ${m.comEmail} (${pct(m.comEmail, m.analises)}%)`,
      `Com processos localizados: ${m.comProcessos}`,
      `Análises com faturamento informado: ${m.comFaturamento}`,
      `Crédito potencial somado (estimativa): ${fmt(m.somaCreditoCentral)}`,
      `Resumos copiados: ${m.copias} · Impressões/PDF: ${m.impressoes}`,
    ];
    const setores = Object.entries(m.porSetor).sort((a, b) => b[1] - a[1]);
    if (setores.length) {
      linhas.push(``, `Por setor:`);
      setores.forEach(([s, n]) => linhas.push(`  ${s}: ${n}`));
    }
    return linhas.join("\n");
  }

  window.METRICAS = { registrarAnalise, registrarEvento, resumo, limpar, texto, pct };
})();
