/**
 * Renderização do relatório (HTML puro a partir do contexto/dados).
 * Sem DOM/estado: cada função recebe dados e devolve string HTML.
 * `window.RENDER.relatorio(...)` devolve { html, top, narrativaTexto } — o
 * app.js injeta no DOM e faz o binding dos botões.
 */
(function () {
  "use strict";

  const { escapeHtml, fmtBRL, fmtData, classeTeseItem, iniciais, fmtParticipacao } = window.UTIL;

  function renderSocios(socios) {
    if (!socios || !socios.length) {
      return `<p class="hint">Quadro societário não informado para este CNPJ.</p>`;
    }
    // Decisores primeiro
    const ordenados = [...socios].sort((a, b) => {
      if (a.decisor !== b.decisor) return a.decisor ? -1 : 1;
      const pa = a.participacao ?? -1;
      const pb = b.participacao ?? -1;
      return pb - pa;
    });
    return ordenados.map((s) => {
      const tag = s.decisor ? `<span class="socio-tag">Decisor</span>` : "";
      const participacao = s.participacao != null
        ? `<span class="socio-participacao">${fmtParticipacao(s.participacao)}</span>`
        : "";
      const desde = s.desde ? `desde ${fmtData(s.desde)}` : "";
      const metaParts = [s.qualificacao, desde, participacao].filter(Boolean);
      return `
        <div class="socio-card ${s.decisor ? "decisor" : ""}">
          <div class="socio-avatar">${escapeHtml(iniciais(s.nome))}</div>
          <div class="socio-body">
            <div class="socio-nome" title="${escapeHtml(s.nome)}">${escapeHtml(s.nome)}</div>
            <div class="socio-meta">
              ${tag}
              ${metaParts.map((p) => typeof p === "string" ? `<span>${escapeHtml(p)}</span>` : p).join("")}
            </div>
          </div>
        </div>`;
    }).join("");
  }

  function renderContato(contato) {
    if (!contato) return "";
    const cards = [];

    // Usa o detalhe com tipo/fonte quando disponível; cai para strings simples.
    const telsDet = (contato.telefonesDetalhe && contato.telefonesDetalhe.length)
      ? contato.telefonesDetalhe
      : (contato.telefones || []).map((f) => ({
          formatado: f, raw: f.replace(/\D/g, ""), tipo: "desconhecido", whatsapp: false, fonte: "",
        }));

    if (telsDet.length) {
      const tels = telsDet.map((t) => {
        const raw = t.raw || (t.formatado || "").replace(/\D/g, "");
        const tagLabel = t.tipo === "celular" ? "Celular" : t.tipo === "fixo" ? "Fixo" : "";
        const tag = tagLabel
          ? `<span class="contato-tag contato-tag-${t.tipo}">${tagLabel}</span>` : "";
        const wa = t.whatsapp
          ? ` <a class="contato-wa" href="https://wa.me/55${raw}" target="_blank" rel="noopener">WhatsApp</a>` : "";
        // #8 — confiança: nº de fontes que confirmaram o mesmo número.
        const nFontes = t.fonte ? t.fonte.split(" + ").filter(Boolean).length : 0;
        const conf = nFontes > 1
          ? `<span class="contato-conf" title="Número confirmado por ${nFontes} fontes independentes">✓ ${nFontes} fontes</span>` : "";
        const fonte = t.fonte
          ? `<span class="contato-fonte" title="Fonte do número">${escapeHtml(t.fonte)}</span>` : "";
        return `<div class="contato-valor"><a href="tel:+55${raw}">${escapeHtml(t.formatado)}</a>${tag}${conf}${wa}${fonte}</div>`;
      }).join("");
      cards.push(`
        <div class="contato-card">
          <div class="contato-icon">📞</div>
          <div class="contato-body">
            <div class="contato-label">Telefones (${telsDet.length})</div>
            ${tels}
          </div>
        </div>`);
    }

    const emails = (contato.emails && contato.emails.length)
      ? contato.emails
      : (contato.email ? [contato.email] : []);
    if (emails.length) {
      const mails = emails.map((e) =>
        `<div class="contato-valor"><a href="mailto:${escapeHtml(e)}">${escapeHtml(e)}</a></div>`
      ).join("");
      cards.push(`
        <div class="contato-card">
          <div class="contato-icon">✉</div>
          <div class="contato-body">
            <div class="contato-label">E-mail${emails.length > 1 ? "s" : ""}</div>
            ${mails}
          </div>
        </div>`);
    }
    if (contato.endereco || contato.municipio) {
      const linha = contato.endereco
        || `${contato.municipio || ""}${contato.uf ? "/" + contato.uf : ""}`;
      cards.push(`
        <div class="contato-card">
          <div class="contato-icon">📍</div>
          <div class="contato-body">
            <div class="contato-label">Endereço</div>
            <div class="contato-valor">${escapeHtml(linha)}</div>
          </div>
        </div>`);
    }
    if (!cards.length) {
      return `<p class="hint">Contato cadastral não informado para este CNPJ.</p>`;
    }
    return `<div class="contato-grid">${cards.join("")}</div>`;
  }

  function renderLocked(titulo, descricao, ctaTexto) {
    return `
      <div class="locked-section">
        <div class="locked-icon">🔒</div>
        <div class="locked-title">${escapeHtml(titulo)}</div>
        <div class="locked-desc">${escapeHtml(descricao)}</div>
        <button class="locked-cta" type="button" data-locked-cta>${escapeHtml(ctaTexto)}</button>
      </div>`;
  }

  function renderRisco(risco) {
    if (!risco) return "";
    const iconePorTipo = { risco: "!", alerta: "?", positivo: "✓" };
    const labelPorNivel = {
      baixo: "Lead saudável",
      moderado: "Lead viável com ressalvas",
      alto: "Lead com sinais de risco",
    };

    const flagsHtml = risco.flags.map((f) => `
      <div class="flag-item tipo-${f.tipo}">
        <div class="flag-icon">${iconePorTipo[f.tipo] || "i"}</div>
        <div class="flag-body">
          <div class="flag-titulo">${escapeHtml(f.titulo)}</div>
          <div class="flag-descricao">${escapeHtml(f.descricao)}</div>
        </div>
      </div>`).join("");

    return `
      <div class="risco-header nivel-${risco.nivel}">
        <div class="risco-medidor nivel-${risco.nivel}">${risco.score}</div>
        <div class="risco-body">
          <div class="risco-nivel">Perfil de risco · ${escapeHtml(risco.nivel)}</div>
          <div class="risco-titulo">${escapeHtml(labelPorNivel[risco.nivel] || "Análise")}</div>
          <div class="risco-recomendacao">${escapeHtml(risco.recomendacao)}</div>
        </div>
      </div>
      ${risco.flags.length ? `<div class="flags-list">${flagsHtml}</div>` : `<p class="hint">Nenhum sinal de atenção identificado.</p>`}
    `;
  }

  function renderTransparencia(transp) {
    if (!transp) return "";
    const fmt = window.ENGINE.formatBRL;
    const blocos = [];

    const sancoes = transp.sancoes || [];
    if (sancoes.length) {
      const itens = sancoes.map((s) => {
        const periodo = [s.inicio, s.fim].filter(Boolean).join(" – ");
        const meta = [s.orgao, periodo].filter(Boolean).join(" · ");
        return `
          <div class="transp-sancao">
            <span class="transp-badge transp-badge-${escapeHtml(s.fonte.toLowerCase())}">${escapeHtml(s.fonte)}</span>
            <div class="transp-sancao-body">
              <div class="transp-sancao-tipo">${escapeHtml(s.tipo || "Sanção")}</div>
              ${meta ? `<div class="transp-sancao-meta">${escapeHtml(meta)}</div>` : ""}
            </div>
          </div>`;
      }).join("");
      blocos.push(`
        <div class="transp-bloco transp-risco">
          <div class="transp-bloco-titulo">⚠ Sanções (${sancoes.length})</div>
          ${itens}
        </div>`);
    }

    const c = transp.contratos || {};
    if (c.quantidade > 0) {
      const linhas = (c.recentes || []).map((ct) => {
        const detalhe = [ct.orgao, ct.objeto].filter(Boolean).join(" — ");
        return `
          <div class="transp-contrato">
            <div class="transp-contrato-valor">${ct.valor ? fmt(ct.valor) : "—"}</div>
            <div class="transp-contrato-det">${escapeHtml(detalhe || "Contrato federal")}</div>
          </div>`;
      }).join("");
      blocos.push(`
        <div class="transp-bloco transp-positivo">
          <div class="transp-bloco-titulo">🏛 Contratos federais — ${c.quantidade} · total ~${fmt(c.valorTotal)}</div>
          <p class="hint" style="margin:2px 0 8px;">Proxy de faturamento e formalidade. Maiores contratos:</p>
          ${linhas}
        </div>`);
    }

    if (!blocos.length) {
      return `<p class="hint">Nada encontrado no Portal da Transparência para este CNPJ (sem sanções nem contratos federais).</p>`;
    }
    return `<div class="transp-grid">${blocos.join("")}</div>`;
  }

  function renderProcessos(proc) {
    if (!proc) return "";
    if (!proc.total) {
      return `<p class="hint">Nenhum processo localizado para este CNPJ na base consultada.</p>`;
    }
    const linhas = (proc.processos || []).slice(0, 8).map((p) => {
      const ass = (p.assuntos || []).join(", ");
      const polo = p.polo === "ATIVO" ? "Autora" : p.polo === "PASSIVO" ? "Ré" : "";
      const meta = [p.tribunal, p.classe, polo, p.status].filter(Boolean).join(" · ");
      return `
        <div class="proc-item">
          <div class="proc-num">${escapeHtml(p.numero || "—")}</div>
          <div class="proc-det">${escapeHtml([ass, meta].filter(Boolean).join(" — ") || "Processo")}</div>
        </div>`;
    }).join("");
    return `
      <div class="proc-resumo">${proc.total} processo(s) · ${proc.comoAutor} como autora · ${proc.comoReu} como ré</div>
      <div class="proc-list">${linhas}</div>`;
  }

  // Link para a Junta Comercial do estado — fonte oficial (fé pública) do capital.
  function linkJunta(uf) {
    const j = window.JUNTAS ? window.JUNTAS.porUF(uf) : null;
    if (!j) return "";
    return `<div class="fact-fonte">Confirmar na fonte oficial: <a href="${j.url}" target="_blank" rel="noopener" title="${escapeHtml(j.nome)} — emitir certidão simplificada">${escapeHtml(j.sigla)} · certidão simplificada ↗</a></div>`;
  }

  function renderEconodata(e) {
    if (!e || e.erro) return "";
    const cards = [];

    if (e.decisores && e.decisores.length) {
      const lis = e.decisores.slice(0, 6).map((d) => {
        const cargo = [d.cargo, d.nivel].filter(Boolean).join(" · ");
        const li = d.linkedin ? ` · <a href="${escapeHtml(d.linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a>` : "";
        return `<div class="econo-decisor"><span class="econo-nome">${escapeHtml(d.nome || "—")}</span>${cargo ? ` <span class="econo-cargo">${escapeHtml(cargo)}</span>` : ""}${li}</div>`;
      }).join("");
      cards.push(`<div class="econo-bloco"><div class="econo-titulo">👤 Decisores</div>${lis}</div>`);
    }

    if (e.telefones && e.telefones.length) {
      const tl = e.telefones.slice(0, 5).map((t) => {
        const raw = (t.numero || "").replace(/\D/g, "");
        const tag = t.assertividade ? `<span class="contato-tag contato-tag-${t.assertividade === "alta" ? "celular" : "fixo"}">${escapeHtml(t.assertividade)}</span>` : "";
        return `<div class="contato-valor"><a href="tel:+55${raw}">${escapeHtml(t.numero)}</a> ${tag}</div>`;
      }).join("");
      cards.push(`<div class="econo-bloco"><div class="econo-titulo">📞 Telefones (por assertividade)</div>${tl}</div>`);
    }

    if (e.emails && e.emails.length) {
      const el = e.emails.slice(0, 5).map((m) =>
        `<div class="contato-valor"><a href="mailto:${escapeHtml(m.email)}">${escapeHtml(m.email)}</a>${m.assertividade ? ` <span class="econo-cargo">${escapeHtml(m.assertividade)}</span>` : ""}</div>`
      ).join("");
      cards.push(`<div class="econo-bloco"><div class="econo-titulo">✉ E-mails enriquecidos</div>${el}</div>`);
    }

    const facts = [];
    if (e.faturamentoTexto) facts.push(`<div class="fact"><div class="fact-label">Faturamento presumido</div><div class="fact-value">${escapeHtml(e.faturamentoTexto)}</div></div>`);
    if (e.funcionariosTexto) facts.push(`<div class="fact"><div class="fact-label">Funcionários (estim.)</div><div class="fact-value">${escapeHtml(e.funcionariosTexto)}</div></div>`);
    if (e.porteEstimado) facts.push(`<div class="fact"><div class="fact-label">Porte estimado</div><div class="fact-value">${escapeHtml(e.porteEstimado)}</div></div>`);
    if (e.regimeTributario) facts.push(`<div class="fact"><div class="fact-label">Regime tributário</div><div class="fact-value">${escapeHtml(e.regimeTributario)}</div></div>`);
    if (e.setorAmigavel) facts.push(`<div class="fact"><div class="fact-label">Setor</div><div class="fact-value">${escapeHtml(e.setorAmigavel)}</div></div>`);
    if (e.pat && e.pat.funcionarios) facts.push(`<div class="fact"><div class="fact-label">PAT — funcionários</div><div class="fact-value">${escapeHtml(String(e.pat.funcionarios))}</div></div>`);
    const factsHtml = facts.length ? `<div class="fact-grid">${facts.join("")}</div>` : "";

    if (!cards.length && !factsHtml) return `<p class="hint">Sem dados de enriquecimento para este CNPJ.</p>`;
    return `${factsHtml}${cards.length ? `<div class="econo-grid">${cards.join("")}</div>` : ""}`;
  }

  // Site + redes sociais — não depende do whois. Usa site da Econodata + domínio
  // do e-mail + deep-links de busca.
  function renderSiteRedes(contexto, econodata) {
    const nome = contexto.nomeFantasia || contexto.razaoSocial || "";
    const sites = new Set();
    if (econodata && Array.isArray(econodata.sites)) econodata.sites.forEach((s) => s && sites.add(s));

    // Domínio do e-mail (cadastral + Econodata), excluindo provedores genéricos.
    const provGen = /(gmail|hotmail|outlook|yahoo|bol|uol|terra|icloud|live|msn)\./i;
    const emails = [];
    if (contexto.contato) {
      (contexto.contato.emails || []).forEach((e) => emails.push(e));
      if (contexto.contato.email) emails.push(contexto.contato.email);
    }
    if (econodata && econodata.emails) econodata.emails.forEach((e) => emails.push(e.email));
    emails.forEach((em) => {
      const dom = String(em || "").split("@")[1];
      if (dom && !provGen.test(dom)) sites.add(dom.toLowerCase().trim());
    });

    const siteList = Array.from(sites)
      .map((s) => s.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "").trim())
      .filter(Boolean);
    const siteUnique = Array.from(new Set(siteList)).slice(0, 5);

    const sitesHtml = siteUnique.length
      ? siteUnique.map((s) => `<div class="contato-valor"><a href="https://${escapeHtml(s)}" target="_blank" rel="noopener">${escapeHtml(s)} ↗</a></div>`).join("")
      : `<p class="hint">Site não identificado em fontes diretas — use os botões de busca.</p>`;

    const r = (econodata && econodata.redes) || {};
    const q = encodeURIComponent(nome);
    const btns = [];
    btns.push(`<a class="rede-btn" href="${escapeHtml(r.linkedin || `https://www.linkedin.com/search/results/companies/?keywords=${q}`)}" target="_blank" rel="noopener">in LinkedIn</a>`);
    btns.push(`<a class="rede-btn" href="${escapeHtml(r.instagram || `https://www.google.com/search?q=${q}+site:instagram.com`)}" target="_blank" rel="noopener">◎ Instagram</a>`);
    if (r.facebook) btns.push(`<a class="rede-btn" href="${escapeHtml(r.facebook)}" target="_blank" rel="noopener">f Facebook</a>`);
    btns.push(`<a class="rede-btn" href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">G Buscar</a>`);

    return `
      <div class="contato-card">
        <div class="contato-icon">🌐</div>
        <div class="contato-body">
          <div class="contato-label">Site${siteUnique.length > 1 ? "s" : ""}</div>
          ${sitesHtml}
        </div>
      </div>
      <div class="rede-row">${btns.join("")}</div>`;
  }

  /**
   * Monta o HTML completo do relatório. Devolve { html, top, narrativaTexto }
   * — o app.js injeta no DOM e liga os botões (copiar/imprimir/nova/CTA).
   */
  function relatorio(contexto, teses, narrativa, risco, whois, transparencia, processos, econodata) {
    const top = teses.slice(0, 8);
    const faturamento = contexto.faturamentoInformado || 0;
    let totalCentral = 0;
    const tesesHtml = top.map((t) => {
      const sc = window.ENGINE.classificarScore(t.score);
      const est = window.ENGINE.estimarCreditoTese(t.id, faturamento);
      let estHtml = "";
      if (est && !t.jaAjuizada) {
        if (t.score >= 40) totalCentral += est.central;
        estHtml = `<div class="tese-credito">≈ Crédito potencial (5 anos): <strong>${fmtBRL(est.min)} – ${fmtBRL(est.max)}</strong></div>`;
      }
      const ajuizadaBadge = t.jaAjuizada
        ? `<span class="tese-ajuizada" title="${t.processoRef ? "Processo " + escapeHtml(t.processoRef) : "Processo localizado"}">⚖ Já ajuizada${t.ajuizadaComoAutor ? " (autora)" : ""}</span>`
        : "";
      return `
        <div class="tese-item ${classeTeseItem(t.score)} ${t.jaAjuizada ? "tese-ja-ajuizada" : ""}">
          <div class="tese-head">
            <div class="tese-title">${escapeHtml(t.titulo)} ${ajuizadaBadge}</div>
            <span class="tese-score ${sc.classe}">${t.score} · ${sc.label}</span>
          </div>
          <div class="tese-desc">${escapeHtml(t.descricao)}</div>
          <div class="tese-meta">Prescrição típica: 5 anos · ID: ${t.id}</div>
          ${estHtml}
        </div>`;
    }).join("");

    // Cabeçalho de crédito potencial (só quando o faturamento foi informado).
    const creditoResumoHtml = faturamento
      ? `<div class="credito-resumo">
           <div class="credito-resumo-valor">Potencial agregado (teses ≥ 40): <strong>${fmtBRL(totalCentral * 0.6)} – ${fmtBRL(totalCentral * 1.4)}</strong></div>
           <p class="hint" style="margin:4px 0 0;">Estimativa grosseira de ordem de grandeza sobre faturamento informado de ${fmtBRL(faturamento)}/ano × 5 anos. <strong>Não é cálculo de crédito</strong> — confirmar com SPED/escrituração.</p>
         </div>`
      : "";

    const situacaoBadge = /ATIV/i.test(contexto.situacao)
      ? `<span class="badge badge-ok">${escapeHtml(contexto.situacao)}</span>`
      : `<span class="badge badge-danger">${escapeHtml(contexto.situacao)}</span>`;

    const regimeBadge = contexto.regimeConfianca > 0.7
      ? `<span class="badge badge-ok">${contexto.regime}</span>`
      : `<span class="badge badge-warn">${contexto.regime} (estimado)</span>`;

    // Monta a narrativa de forma robusta (sem linhas vazias se algum campo faltar)
    const narrativaPartes = [
      narrativa.abertura,
      narrativa.racional,
      narrativa.abordagem ? "Sugestão de abordagem: " + narrativa.abordagem : "",
    ].filter(Boolean);
    const narrativaTexto = narrativaPartes.join("\n\n");

    const html = `
      <article class="report">
        <header class="report-header">
          <h3>${escapeHtml(contexto.razaoSocial)}</h3>
          <div class="subtitle">
            <span>${escapeHtml(contexto.cnpj)}</span>
            <span class="subtitle-sep">·</span>
            <span>${escapeHtml(contexto.municipio)}/${escapeHtml(contexto.uf)}</span>
            <span class="subtitle-sep">·</span>
            ${situacaoBadge} ${regimeBadge}
          </div>
        </header>

        <div class="report-actions">
          <button class="btn-ghost" id="btnCopy" type="button">📋 Copiar resumo</button>
          <button class="btn-ghost" id="btnPrint" type="button">🖨 Imprimir / PDF</button>
          <button class="btn-ghost" id="btnNew" type="button">↻ Nova análise</button>
        </div>

        <section class="report-section">
          <h4>Resumo da análise</h4>
          <div class="narrative">${escapeHtml(narrativaTexto)}</div>
        </section>

        <section class="report-section">
          <h4>Perfil de risco do lead <span style="color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; font-size: 11.5px;">(análise local)</span></h4>
          ${renderRisco(risco)}
        </section>

        <section class="report-section">
          <h4>Dados cadastrais</h4>
          <div class="fact-grid">
            <div class="fact"><div class="fact-label">Nome Fantasia</div><div class="fact-value">${escapeHtml(contexto.nomeFantasia || "—")}</div></div>
            <div class="fact"><div class="fact-label">Setor</div><div class="fact-value">${escapeHtml(contexto.setor)}</div></div>
            <div class="fact"><div class="fact-label">CNAE Principal</div><div class="fact-value">${escapeHtml(contexto.cnae || "—")}${contexto.cnaeDescricao ? " — " + escapeHtml(contexto.cnaeDescricao) : ""}</div></div>
            <div class="fact"><div class="fact-label">Porte</div><div class="fact-value">${escapeHtml(contexto.porte)}</div></div>
            <div class="fact"><div class="fact-label">Capital Social</div><div class="fact-value">${fmtBRL(contexto.capital)}${linkJunta(contexto.uf)}</div></div>
            <div class="fact"><div class="fact-label">Abertura</div><div class="fact-value">${fmtData(contexto.dataAbertura)} (${contexto.tempoExistenciaAnos} anos)</div></div>
          </div>
        </section>

        <section class="report-section">
          <h4>Perfil tributário inferido</h4>
          <div class="fact-grid">
            <div class="fact"><div class="fact-label">Folha intensiva?</div><div class="fact-value">${contexto.perfil.foliaIntensiva ? "Sim (típico do setor)" : "Não tipicamente"}</div></div>
            <div class="fact"><div class="fact-label">Usa insumos (PIS/COFINS)?</div><div class="fact-value">${contexto.perfil.usaInsumos ? "Sim" : "Não tipicamente"}</div></div>
            <div class="fact"><div class="fact-label">Sujeito a ICMS-ST?</div><div class="fact-value">${contexto.perfil.sujeitoST ? "Possivelmente" : "Não tipicamente"}</div></div>
            <div class="fact"><div class="fact-label">Setor exportador?</div><div class="fact-value">${contexto.perfil.exportador ? "Possivelmente" : "Não tipicamente"}</div></div>
          </div>
        </section>

        <section class="report-section">
          <h4>Quadro societário <span style="color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; font-size: 11.5px;">(Receita Federal)</span></h4>
          <div class="socios-list">${renderSocios(contexto.socios)}</div>
        </section>

        <section class="report-section">
          <h4>Contato <span style="color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; font-size: 11.5px;">(Receita + fontes públicas)</span></h4>
          ${renderContato(contexto.contato)}
        </section>

        <section class="report-section">
          <h4>Site &amp; presença online <span style="color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; font-size: 11.5px;">(Econodata + e-mail + busca)</span></h4>
          ${renderSiteRedes(contexto, econodata)}
        </section>
${transparencia ? `
        <section class="report-section">
          <h4>Relacionamento com o setor público <span style="color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; font-size: 11.5px;">(Portal da Transparência · CGU)</span></h4>
          ${renderTransparencia(transparencia)}
        </section>` : ""}
${processos ? `
        <section class="report-section">
          <h4>Processos / litígio já ajuizado <span style="color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; font-size: 11.5px;">(Jusbrasil)</span></h4>
          ${renderProcessos(processos)}
        </section>` : ""}

${(econodata && !econodata.erro) ? `
        <section class="report-section">
          <h4>Decisores e contato premium <span style="color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; font-size: 11.5px;">(Econodata)</span></h4>
          ${renderEconodata(econodata)}
        </section>` : `
        <section class="report-section">
          <h4>Heads &amp; decisores <span style="color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; font-size: 11.5px;">(fonte externa)</span></h4>
          ${renderLocked(
            "C-Level e principais decisores",
            "Diretor financeiro, contábil, jurídico e tributário — incluindo LinkedIn, e-mail e função. Conecte o proxy da Econodata em Configurações para preencher.",
            "Conectar Econodata"
          )}
        </section>

        <section class="report-section">
          <h4>Contato do financeiro <span style="color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; font-size: 11.5px;">(fonte externa)</span></h4>
          ${renderLocked(
            "Departamento financeiro / fiscal",
            "Telefone e e-mail direto do financeiro/fiscal/contabilidade. Conecte o proxy da Econodata em Configurações para preencher.",
            "Conectar Econodata"
          )}
        </section>`}

        <section class="report-section">
          <h4>Teses tributárias aderentes (ranqueadas)</h4>
          ${creditoResumoHtml}
          <div class="tese-list">${tesesHtml || '<p class="hint">Nenhuma tese com aderência relevante para este perfil.</p>'}</div>
        </section>

        <section class="report-section">
          <h4>Ações sugeridas</h4>
          <ul class="action-list">
            <li>Solicitar acesso a SPED Contribuições e folha de pagamento dos últimos 5 anos para apuração precisa.</li>
            <li>Confirmar regime tributário efetivo via consulta de optante do Simples no Portal do Simples Nacional.</li>
            <li>Consultar passivo tributário via CARF, PGFN e Procuradorias estaduais para mapear contencioso ativo.</li>
            <li>Calcular potencial de crédito estimado e formalizar proposta de honorários de êxito.</li>
          </ul>
        </section>
      </article>
    `;

    return { html, top, narrativaTexto };
  }

  window.RENDER = { relatorio };
})();
