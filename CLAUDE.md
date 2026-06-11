# Prospector Tributário — Contexto para Claude Code

Webapp client-side (HTML + CSS + JS puro, sem framework) que recebe um CNPJ
e gera um relatório de prospecção jurídico-tributária.

## Propósito

Apoiar escritórios de advocacia tributária na qualificação inicial de leads.
A partir do CNPJ, consulta dados públicos da Receita Federal, classifica o
perfil tributário da empresa e identifica teses de recuperação de créditos
aplicáveis. Foco: economia máxima de tokens de IA via pré-processamento
determinístico em JS.

## Arquitetura

Projeto plano, sem build step. Arquivos JS carregados em ordem por `<script>`
no `index.html`. Comunicação entre módulos via `window.{NAMESPACE}`
(simulação de módulos para evitar bundler).

```
index.html        Interface e modal de configurações
styles.css        Visual jurídico-corporativo, responsivo
cnaes.js          Mapeamento CNAE → seção → perfil tributário (lookup O(1))
teses.js          Catálogo de teses tributárias + funções de scoring
engine.js         Validação, inferência de regime, ranking de teses, contexto
api.js            BrasilAPI + fontes grátis de telefone + whois + cache 24h
transparencia.js  Portal da Transparência (CGU) via proxy: sanções + contratos
ai.js             Chamada Claude Haiku + fallback offline (template)
app.js            Orquestrador: DOM, fluxo, renderização do relatório
proxy/            Cloudflare Worker que faz proxy da API da CGU (token + CORS)
```

Ordem de carregamento (importante):
`cnaes → teses → engine → api → transparencia → ai → app`.

## Convenções

- Sem dependências de runtime (zero npm packages instalados). O `package.json`
  só serve para scripts.
- Não use bundler nem TypeScript no MVP. Mantenha JS vanilla.
- Cada módulo expõe via `window.NAMESPACE = { ... }` (CNAE, TESES, ENGINE,
  API, AI). Não usar `import/export` ESM enquanto o projeto rodar via
  `file://` ou servidor estático simples.
- Documentação em português brasileiro nos comentários de código.
- Strings de UI em português brasileiro.
- Logs em `console.warn`/`console.error` para falhas; `console.log` apenas
  durante desenvolvimento (remover antes de versionar).

## Decisões de design que NÃO devem ser revertidas sem discussão

1. **IA é o último passo, não o primeiro.** Todo o filtro de aplicabilidade
   de teses, classificação de setor e inferência de regime acontece em JS
   puro. A IA só recebe um resumo de ~150 tokens com as top-3 teses já
   ranqueadas. Isso mantém o custo por consulta em ~R$ 0,003.

2. **Modelo padrão: `claude-haiku-4-5-20251001`.** Não troque para Sonnet/
   Opus sem motivo claro — o ganho em qualidade da narrativa não justifica
   o custo extra para esse caso de uso.

3. **`max_tokens: 600` na chamada à API.** Suficiente para os 3 parágrafos
   esperados. Aumentar só se o prompt mudar substancialmente.

4. **Sem backend.** É BYOK (Bring Your Own Key) — chave da Anthropic salva
   em `localStorage`. Cabeçalho `anthropic-dangerous-direct-browser-access`
   é necessário porque a SDK normalmente bloqueia chamadas direto do browser.
   Para distribuir externamente, migrar para serverless (Cloudflare Workers,
   Vercel Functions).

5. **Datajud público NÃO é usado.** A API pública do CNJ anonimiza dados
   de partes — não retorna processos por CNPJ. Para esse sinal no futuro,
   considerar APIs pagas (Jusbrasil, Escavador, Codilo).

6. **Cache de Receita: 24h em localStorage.** Evita rate limit da BrasilAPI
   e reduz latência em consultas repetidas.

7. **Telefone é multi-fonte (gratuito).** Além da BrasilAPI, `api.js`
   agrega telefones de CNPJ.ws (`publica.cnpj.ws`), Minha Receita
   (`minhareceita.org`) e ReceitaWS (reforço, limite 3/min). Tudo
   best-effort: falha de CORS/rate-limit/404 é silenciosa. A normalização,
   classificação (fixo/celular via 3º dígito), validação de DDD e dedup
   ficam em `engine.js` (`montarTelefone`, `mesclarTelefones`,
   `aplicarTelefonesExtras`). Cada fonte tem cache próprio 24h; `false` no
   cache = "consultado, sem dados". Para enriquecimento pago (Econodata,
   Casa dos Dados), adicionar mais uma fonte em `coletarTelefones`
   devolvendo objetos no mesmo formato de `montarTelefone`.

8. **Portal da Transparência (CGU) via proxy obrigatório.** `transparencia.js`
   consulta CEIS/CNEP/CEPIM (sanções → red flags) e contratos federais por CNPJ
   (proxy de faturamento/porte → flag positiva no risco). A API da CGU exige
   token (`chave-api-dados`) e **não tem CORS**, então NÃO dá para chamar do
   browser: o módulo fala com um proxy serverless (`proxy/transparencia-worker.js`,
   Cloudflare Worker) cuja URL o usuário configura no modal. O token fica no
   worker (secret), nunca no localStorage. Sem proxy configurado, a seção
   simplesmente não aparece. Endpoints: `ceis?codigoSancionado=`,
   `cnep?codigoSancionado=`, `cepim?cnpjSancionado=`,
   `contratos/cpf-cnpj?cpfCnpj=`. A lógica de risco/oportunidade fica em
   `ENGINE.analisarTransparencia` / `mesclarRiscoTransparencia`.

9. **Cadastro tem fallback entre fontes gratuitas.** `API.buscarReceita`
   encadeia BrasilAPI → Minha Receita → CNPJ.ws → OpenCNPJ → CNPJá; cada fonte
   é normalizada para o MESMO shape (o da BrasilAPI) que `montarContexto`
   consome. A primeira com `razao_social` vence. Se a BrasilAPI cair, a análise
   não para. O enriquecimento de telefone (`coletarTelefones`) também usa
   OpenCNPJ e CNPJá além de CNPJ.ws/Minha Receita/ReceitaWS.

10. **CNAEs secundários entram no scoring.** `montarContexto` deriva `secoes`
   (principal + secundárias) e um `perfil` combinado (OR das flags por seção).
   As teses checam `ctx.secoes` (não só `ctx.secao`). Ex.: prestadora de
   serviço com atividade secundária de comércio passa a pontuar nas teses de
   ICMS.

11. **Estimativa de crédito é heurística e opcional.** Só aparece se o usuário
   informar o faturamento (`parseFaturamento`). `ENGINE.estimarCreditoTese`
   usa fatores médios por tese (`FATOR_CREDITO_ANUAL`) × 5 anos, com banda de
   ±40%. É ORDEM DE GRANDEZA para priorização — NÃO é cálculo de crédito; a UI
   deixa isso explícito. Não confundir com apuração real (que exige SPED).

12. **Processos/litígio (Jusbrasil) via proxy, provider-agnóstico.**
   `processos.js` consulta processos por CNPJ através de um proxy
   (`proxy/processos-worker.js`) que devolve formato NORMALIZADO. O adaptador
   do Jusbrasil fica no worker (auth `Bearer`, exige contrato Consulta PRO ~R$1k/mês,
   sem self-service, sem CORS). `ENGINE.marcarTesesAjuizadas` cruza a matéria de
   cada tese (mapa `MATERIA_TESE`) com os assuntos dos processos e marca
   `jaAjuizada` (a UI risca e mostra "⚖ Já ajuizada" — para NÃO oferecer).
   `ENGINE.analisarProcessos` gera flag positiva quando a empresa litiga em
   tributário. ⚠️ O endpoint exato e o mapeamento da resposta do Jusbrasil
   estão atrás do login — `mapearJusbrasil()` no worker é defensivo e precisa
   de ajuste com um exemplo real. Trocar para Escavador/Judit (self-service)
   = só reescrever o adaptador no worker; o app não muda.

13. **Capital social — link para a Junta Comercial (fonte oficial).** Não há
   API pública gratuita das Juntas por CNPJ (certidão é paga, autenticada,
   com CAPTCHA, por estado — ações que o agente não executa). O capital exibido
   vem da Receita, que recebe o valor ARQUIVADO na Junta via REDESIM. `juntas.js`
   (`window.JUNTAS.porUF`) mapeia as 27 UFs → Junta + URL; o relatório mostra,
   sob o Capital Social, um deep-link "certidão simplificada" da Junta do estado
   (fé pública) para confirmação manual em 1 clique.

14. **Econodata (enriquecimento premium) via proxy.** `econodata.js` consulta a
   API v3 (`POST /v3/companies`, header `x-api-token`, 1 crédito/empresa) através
   de um proxy que devolve formato normalizado. Preenche o que as fontes públicas
   não têm: melhor telefone (por assertividade), decisor + LinkedIn, e-mail
   validado, faturamento e funcionários presumidos, PAT. Quando presente,
   substitui as seções 🔒 "Heads & decisores"/"Contato do financeiro" e o
   faturamento presumido auto-preenche a estimativa de crédito. O mapeamento em
   `proxy/local-proxy.py` (`_mapear_econodata`) é defensivo — ajustar com a
   resposta real do plano. Substitui o Speedio como fonte premium recomendada.

## Pontos de extensão prováveis

Se o usuário pedir para evoluir, esses são os caminhos esperados:

- **Mais teses.** Adicionar entradas em `teses.js` seguindo o formato
  existente (`id`, `titulo`, `descricao`, `prescricaoAnos`, `criterios`).
  Cada `criterios(ctx)` deve devolver 0–100 e usar filtros duros (return 0)
  para pré-requisitos não-negociáveis.

- **CNAEs específicos com peso diferente.** Hoje só usamos a seção (letra).
  Se precisar de granularidade (ex: CNAE 4530-7 — comércio de peças automotivas
  com perfil específico de ICMS-ST), criar tabela em `cnaes.js` mapeando
  códigos específicos para overrides do perfil.

- **Exportação de PDF.** Usar `window.print()` com CSS `@media print` ou
  biblioteca como `jspdf`. Manter como funcionalidade opcional.

- **Cálculo de crédito potencial em R$.** Requer estimativa de receita
  bruta (não disponível em fontes públicas) — só faz sentido se o usuário
  inserir manualmente, ou se integrarmos com base paga.

- **Backend para distribuir externamente.** Migrar `ai.js` para chamar um
  endpoint próprio (`/api/narrar`), mover a chave da Anthropic para
  variável de ambiente no servidor. Cloudflare Workers é o caminho mais
  simples (free tier generoso).

## Comandos comuns

```bash
# Servir localmente (qualquer servidor estático)
npx serve .
# ou
python3 -m http.server 8000

# Validar sintaxe de todos os JS
for f in *.js; do node --check "$f"; done

# Rodar testes do motor (Node, sem browser)
node test-engine.js   # arquivo de teste local, não versionado
```

## O que NÃO fazer

- Não envie o JSON cru da Receita para o modelo. Sempre passe pelo
  `ENGINE.resumoParaIA`.
- Não adicione `console.log` em produção.
- Não armazene CNPJs analisados em nenhum lugar persistente (privacidade).
  O cache em localStorage é só dos dados públicos da Receita, indexado
  por CNPJ, e o usuário pode limpar a qualquer momento via DevTools.
- Não inclua disclaimers jurídicos extensos na saída da IA — o público
  é advogado, presume-se conhecimento técnico.

## Stack

- HTML5, CSS3 (variáveis, grid, flex)
- JavaScript (ES2020, sem transpilação)
- Anthropic Messages API (`claude-haiku-4-5-20251001`)
- BrasilAPI (gratuita, sem auth)
