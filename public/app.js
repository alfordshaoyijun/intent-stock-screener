let state = {
  parse: null,
  conditions: [],
  result: null,
  tab: "selected",
  revision: 0,
  restored: false
};

const $ = (selector) => document.querySelector(selector);
const CATEGORY_LABELS = { financial: "财务", valuation: "估值", universe: "股票范围", quote: "行情", volume: "量能", liquidity: "流动性", trend: "趋势", technical: "技术指标", setup: "形态", quality: "盈利质量", risk: "风险", income: "分红", money_flow: "资金流", sector: "板块" };
const TYPE_LABELS = { metric: "指标", scope: "范围", rank: "排名", comparison: "比较", event: "事件", exclude: "排除", modify: "修改", time: "时点", logic: "逻辑", unsupported: "待核验" };
const icons = () => window.lucide?.createIcons();
const escapeHtml = (value) => { const node = document.createElement("span"); node.textContent = String(value ?? ""); return node.innerHTML; };
const localTime = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value || "未知") : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" }).format(date); };
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

async function api(path, body) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw data;
  return data;
}

function renderAmbiguities() {
  const box = $("#ambiguities");
  box.innerHTML = "";
  for (const item of state.parse?.ambiguities || []) {
    const node = el("div", "note");
    node.append(el("strong", "", item.phrase), el("div", "", item.decision), el("div", "muted", item.editable ? "待确认，可修改。" : "当前能力说明。"));
    box.append(node);
  }
}

function renderRegistryMeta() {
  const metrics = state.parse?.metricRegistry || [];
  const counts = metrics.reduce((acc, item) => {
    acc[item.availability] = (acc[item.availability] || 0) + 1;
    return acc;
  }, {});
  $("#registryMeta").innerHTML = metrics.length ? `
    <span>指标注册表 ${metrics.length} 个</span>
    <span class="support ok">可执行 ${counts.executable || 0}</span>
    <span class="support mid">待核验 ${counts.unverified || 0}</span>
    <span class="support gap">缺数据 ${counts.missing || 0}</span>
  ` : "";
}

function renderAiFrame() {
  const box = $("#aiFrame");
  const frame = state.parse?.aiFrame;
  const status = state.parse?.aiStatus;
  if (!frame) {
    box.innerHTML = status?.fallback
      ? `<div class="ai-status">本地 AI 未完成结构化整理，已回落到规则解析。<span>${status.error || ""}</span></div>`
      : "";
    return;
  }

  const defs = state.parse?.fieldDefs || {};
  const intentRows = frame.intents.map((intent) => {
    const metrics = intent.metric_ids.map((id) => defs[id]?.label || id).join("、") || "暂未匹配";
    return `
      <div class="intent-row">
        <span class="chip">${TYPE_LABELS[intent.type] || "条件"}</span>
        <div>
          <strong>${escapeHtml(intent.meaning || intent.evidence)}</strong>
          <div class="muted">原文：${escapeHtml(intent.evidence || "未标注")} · 指标：${escapeHtml(metrics)}</div>
        </div>
      </div>
    `;
  }).join("");
  const unsupported = frame.unsupported.map((item) =>
    `<div class="muted">暂不支持：${escapeHtml(item.meaning || item.evidence)}</div>`
  ).join("");

  box.innerHTML = `
    <div class="ai-frame-head">
      <h3>AI 整理意图</h3>
      <span class="support ok">本地 AI</span>
    </div>
    <div class="ai-strategy">${escapeHtml(frame.strategy)}</div>
    <div class="intent-list">${intentRows || "<div class=\"muted\">未拆出明确条件。</div>"}</div>
    ${unsupported ? `<div class="unsupported-list">${unsupported}</div>` : ""}
  `;
}

function renderCandidates() {
  const box = $("#candidates");
  box.innerHTML = "";
  const defs = state.parse?.fieldDefs || {};
  $("#candidateCount").textContent = state.parse?.candidates?.length || 0;
  if (!state.parse?.candidates?.length) box.append(el("div", "empty-state", "暂无候选条件"));
  for (const [index, candidate] of (state.parse?.candidates || []).entries()) {
    const def = defs[candidate.field];
    const availability = candidate.availability || def?.availability || "missing";
    const availabilityLabel = {
      executable: "可执行",
      unverified: "待核验",
      missing: "缺数据"
    }[availability] || "缺数据";
    const supported = availability === "executable";
    const card = el("label", `candidate ${candidate.selected ? "active" : ""}`);
    card.innerHTML = `
      <input type="checkbox" ${candidate.selected ? "checked" : ""}>
      <div>
        <div class="candidate-top">
          <span class="chip">${CATEGORY_LABELS[candidate.category] || "自定义"}</span>
          <strong>${def?.label || candidate.field}</strong>
          <span class="${supported ? "support ok" : "support gap"}">${availabilityLabel}</span>
        </div>
        <div class="candidate-rule">${candidate.computation ? "公式条件 · " : ""}${candidate.value == null ? "阈值待确认" : `${candidate.op} ${candidate.value}${candidate.unit ?? def?.unit ?? ""}`}</div>
        <div class="muted">${({ user_explicit: "用户明确数值", product_preset: "产品建议，待确认", data_derived: "数据计算阈值" })[candidate.value_origin] || "数值未确定"}</div>
        <div class="muted">${escapeHtml(candidate.reason)}</div>
        ${candidate.clarification ? `<div class="muted">歧义提示：${escapeHtml(candidate.clarification)}</div>` : ""}
      </div>
    `;
    const input = card.querySelector("input");
    input.onchange = () => {
      state.parse.candidates[index].selected = input.checked;
      card.classList.toggle("active", input.checked);
    };
    const suggestion = thresholdSuggestion(candidate);
    if (suggestion && (candidate.value == null || candidate.requires_confirmation || candidate.value_origin === "product_preset")) {
      const fill = el("button", "small auto-threshold", "自动填写");
      fill.type = "button";
      fill.onclick = (event) => {
        event.preventDefault(); event.stopPropagation();
        applyThreshold(candidate, suggestion);
        renderCandidates();
      };
      card.querySelector("div").append(fill);
    }
    if (!suggestion && candidate.value == null) card.querySelector("div").append(el("div", "muted", "暂无适用预设，请明确口径或手动填写阈值。"));
    if (candidate.threshold_reason) card.querySelector("div").append(el("div", "threshold-reason", `填写原因：${candidate.threshold_reason} 请勾选并确认后执行。`));
    box.append(card);
  }
}

function thresholdSuggestion(condition) {
  const descriptiveKeys = ["candidate_metrics", "degree"];
  if (condition.computation || Object.keys(condition.params || {}).some((key) => !descriptiveKeys.includes(key))) return null;
  if (/比较对象|百分点|百分比|口径|历史|排名|冲突/.test(condition.numeric_error || "")) return null;
  const direction = (op) => op?.startsWith(">") ? ">" : op?.startsWith("<") ? "<" : op;
  return state.parse?.thresholdPresets?.find((p) => p.field === condition.field && direction(p.op) === direction(condition.op) && p.unit === (condition.unit ?? state.parse.fieldDefs[condition.field]?.unit)) || null;
}

function applyThreshold(condition, suggestion) {
  if (condition.params?.candidate_metrics || condition.params?.degree) {
    const { candidate_metrics, degree, ...params } = condition.params;
    condition.params = params;
  }
  condition.value = suggestion.value;
  condition.unit = suggestion.unit;
  condition.value_origin = "product_preset";
  condition.origin = "ai_proposed";
  condition.threshold_reason = suggestion.reason;
  condition.requires_confirmation = true;
  condition.raw_value = null;
}

function renderTemplates() {
  const box = $("#templates");
  box.innerHTML = "";
  for (const template of state.parse?.templates || []) {
    const card = el("button", "template-card");
    card.innerHTML = `<strong>${template.name}</strong><span>${template.description}</span>`;
    card.onclick = () => {
      const fields = new Set(template.fields);
      const candidates = state.parse.candidates;
      for (const item of state.parse.conditionLibrary || []) {
        if (!fields.has(item.field)) continue;
        const exists = candidates.some((candidate) =>
          candidate.field === item.field && candidate.op === item.op && Number(candidate.value) === Number(item.value)
        );
        if (!exists) candidates.push({ ...item });
      }
      for (const candidate of state.parse.candidates) {
        candidate.selected = fields.has(candidate.field);
      }
      renderCandidates();
      confirmCandidates();
    };
    box.append(card);
  }
}

function confirmCandidates() {
  state.conditions = (state.parse?.candidates || [])
    .filter((candidate) => candidate.selected)
    .map(({ category, reason, aliases, confidence, selected, intent, clarification, ...condition }) => ({
      ...condition,
      group: condition.group || category,
      requires_confirmation: condition.value_origin === "product_preset" ? false : condition.requires_confirmation,
      numeric_error: condition.value_origin === "product_preset" ? null : condition.numeric_error,
      origin: "user_confirmed"
    }));
  renderConditions();
}

function renderConditions() {
  const box = $("#conditions");
  box.innerHTML = "";
  const fields = Object.entries(state.parse?.fieldDefs || {});
  $("#conditionCount").textContent = state.conditions.length;
  if (!state.conditions.length) box.append(el("div", "empty-state", "暂无执行条件"));
  for (const [index, condition] of state.conditions.entries()) {
    const row = el("div", "condition");
    const def = state.parse?.fieldDefs?.[condition.field];
    const availability = condition.availability || def?.availability || "missing";
    const availabilityLabel = {
      executable: "可执行",
      unverified: "待核验",
      missing: "缺数据"
    }[availability] || "缺数据";
    const group = el("div", "muted", `${CATEGORY_LABELS[condition.group] || condition.group} · ${availabilityLabel}${condition.unit ? ` · ${condition.unit}` : ""}`);
    if (condition.computation) group.append(el("div", "", `${({ difference: "差值", ratio: "比值", percent_change: "变化率" })[condition.computation.kind] || "公式"} · ${condition.computation.operands.map((id) => state.parse?.fieldDefs?.[id]?.label || id).join(" / ")}`));
    const field = el("select");
    for (const [key, def] of fields) {
      const option = el("option", "", def.label);
      option.value = key;
      option.selected = condition.field === key;
      field.append(option);
    }
    field.onchange = () => {
      condition.field = field.value;
      condition.metric_id = field.value;
      condition.availability = state.parse?.fieldDefs?.[field.value]?.availability || "missing";
      condition.unit = state.parse?.fieldDefs?.[field.value]?.unit || "";
      condition.computation = null;
      condition.threshold_reason = "";
      condition.params = {};
      condition.value = null;
      condition.requires_confirmation = true;
      renderConditions();
    };
    const op = el("select");
    for (const operator of [">", ">=", "<", "<=", "="]) {
      const option = el("option", "", operator);
      option.value = operator;
      option.selected = condition.op === operator;
      op.append(option);
    }
    op.onchange = () => { condition.op = op.value; condition.threshold_reason = ""; renderConditions(); };
    const value = el("input");
    value.type = "number";
    value.step = "0.1";
    value.value = condition.value ?? "";
    value.placeholder = "待确认";
    value.title = `单位：${condition.unit ?? def?.unit ?? "无单位"}`;
    value.oninput = () => {
      condition.value = value.value === "" ? null : Number(value.value);
      condition.value_origin = "user_explicit";
      condition.origin = "user_confirmed";
      condition.raw_value = value.value;
      condition.requires_confirmation = value.value === "";
      condition.numeric_error = null;
      condition.threshold_reason = "";
    };
    const remove = el("button", "remove");
    remove.innerHTML = '<i data-lucide="trash-2"></i>';
    remove.title = "删除条件";
    remove.setAttribute("aria-label", "删除条件");
    remove.onclick = () => {
      state.conditions.splice(index, 1);
      renderConditions();
    };
    row.append(group, field, op, value, remove);
    const suggestion = thresholdSuggestion(condition);
    if (suggestion && (condition.value == null || condition.requires_confirmation || condition.value_origin === "product_preset")) {
      const tools = el("div", "threshold-tools");
      const fill = el("button", "small", "自动填写");
      fill.onclick = () => { applyThreshold(condition, suggestion); renderConditions(); };
      tools.append(fill);
      if (condition.threshold_reason && condition.requires_confirmation) {
        const accept = el("button", "small", "采用此阈值");
        accept.onclick = () => { condition.requires_confirmation = false; condition.origin = "user_confirmed"; renderConditions(); };
        tools.append(accept);
      }
      row.append(tools);
    }
    if (condition.threshold_reason) row.append(el("div", "threshold-reason", `填写原因：${condition.threshold_reason}${condition.requires_confirmation ? " 待确认。" : " 已确认，可修改。"}`));
    if (!suggestion && condition.value == null) row.append(el("div", "threshold-reason", "暂无适用预设，请明确口径或手动填写阈值。"));
    box.append(row);
  }
  icons();
}

function statusText(status) {
  return { selected: "入选", excluded: "排除", unknown: "无法判断" }[status];
}

function renderResults() {
  const result = state.result;
  $("#summary").innerHTML = result ? `
    <div class="metric"><span>入选</span><strong>${result.selected.length}</strong></div>
    <div class="metric"><span>排除</span><strong>${result.excluded.length}</strong></div>
    <div class="metric"><span>无法判断</span><strong>${result.unknown.length}</strong></div>
    <div class="metric"><span>股票池</span><strong>${result.poolSize}</strong></div>
  ` : "";
  $("#emptyHint").textContent = result && result.selected.length === 0
    ? "没有入选结果。可以放宽 PE 阈值、提高振幅上限，或删除一个经营改善条件后重新执行。"
    : "";

  const box = $("#results");
  box.innerHTML = "";
  if (!result?.[state.tab]?.length) box.append(el("div", "empty-state", result ? "该分类暂无股票" : "尚未执行筛选"));
  for (const stock of result?.[state.tab] || []) {
    const card = el("div", `stock ${state.tab}`);
    const checks = stock.explanation.checks.map((check) =>
      `<div class="check ${check.status}"><strong>${escapeHtml(check.label)}</strong>：${escapeHtml(check.sentence)}${check.threshold_reason ? `<div class="muted">阈值来源：产品建议 · ${escapeHtml(check.threshold_reason)}</div>` : ""}<div class="muted">口径：${escapeHtml(check.definition || "未提供")} · 单位：${escapeHtml(check.unit || "无单位")}</div><div class="muted">${escapeHtml(check.source)}</div>${(check.provenance || []).map((p) => `<div class="muted provenance">行情时间：${escapeHtml(p.observedAt || "接口未返回")} · 指标报告期：${escapeHtml(p.reportPeriod || "接口未返回")} · 公告日期：${escapeHtml(p.publishedAt || "接口未返回")}<br>取数：${escapeHtml(localTime(p.fetchedAt))}${p.window ? `<br>${escapeHtml(p.window)}` : ""}<details><summary>查询与参数</summary>${escapeHtml(p.query)}<br>${escapeHtml(JSON.stringify(p.parameters))}</details></div>`).join("")}</div>`
    ).join("");
    card.innerHTML = `
      <div class="stock-head">
        <label><input type="checkbox" class="pick" value="${stock.symbol}"> <span class="stock-title">${stock.name}</span> ${stock.symbol}</label>
        <span class="status">${statusText(state.tab)}</span>
      </div>
      <details class="stock-detail" ${state.tab === "selected" ? "" : "open"}><summary>${stock.explanation.failedCount ? `${stock.explanation.failedCount} 项不满足` : stock.explanation.unknownCount ? `${stock.explanation.unknownCount} 项无法判断` : `${stock.explanation.checks.length} 项条件满足`} · 条件依据<i data-lucide="chevron-down"></i></summary>${checks}</details>
      <div class="stock-source">行情：${escapeHtml(stock.quoteTime || "接口未返回")} · 证券最新报告期：${escapeHtml(stock.latestFinancialReportPeriod || "接口未返回")} · 财报披露日期：${escapeHtml(stock.latestFinancialPublicationDate || "接口未返回")}<br>取数：${escapeHtml(localTime(stock.fetchedAt))} · ${escapeHtml(stock.sourceName)}<br>证券最新报告期不代表每项指标的报告期，以逐项口径为准。</div>
    `;
    box.append(card);
  }
  icons();
}

function renderCompare() {
  const picked = [...document.querySelectorAll(".pick:checked")].map((input) => input.value);
  const all = [...(state.result?.selected || []), ...(state.result?.excluded || []), ...(state.result?.unknown || [])];
  const stocks = all.filter((stock) => picked.includes(stock.symbol));
  if (!stocks.length) {
    $("#compare").textContent = "请先在当前结果列表勾选股票。";
    return;
  }
  const checks = stocks[0].explanation.checks;
  $("#compare").innerHTML = `
    <table>
      <thead><tr><th>股票</th>${checks.map((check) => `<th>${escapeHtml(check.label)}<br>${escapeHtml(check.op)} ${escapeHtml(check.thresholdText)}</th>`).join("")}</tr></thead>
      <tbody>
        ${stocks.map((stock) => `<tr><td>${escapeHtml(stock.name)}<br><span class="muted">${escapeHtml(stock.symbol)} · 行情 ${escapeHtml(stock.quoteTime || "未知")}</span></td>${stock.explanation.checks.map((check) => `<td>${escapeHtml(check.actualText)}<br>${escapeHtml(({pass:"满足",fail:"不满足",unknown:"无法判断"})[check.status])}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>
  `;
}

async function parseAndRender() {
  if ($("#parseBtn").disabled) return;
  $("#parseBtn").disabled = true;
  const revision = ++state.revision;
  $("#requestStatus").textContent = "正在整理条件…";
  try {
  $("#validation").textContent = "";
  const parsed = await api("/api/parse", { text: $("#intent").value });
  if (revision !== state.revision) return;
  state.parse = parsed;
  state.conditions = state.parse.conditions.map((condition) => ({ ...condition }));
  renderRegistryMeta();
  renderAiFrame();
  renderAmbiguities();
  renderTemplates();
  renderCandidates();
  renderConditions();
  if (state.parse.validation?.ok === false) {
    $("#validation").textContent = state.parse.validation.errors.join("；");
  }
  $("#requestStatus").textContent = state.parse.aiStatus?.fallback ? "规则建议 · AI 未完成" : "解析完成";
  } catch (error) {
    $("#requestStatus").textContent = "解析失败";
    $("#validation").textContent = error.error || error.message || "解析服务暂不可用";
  } finally {
    $("#parseBtn").disabled = false;
  }
}

async function runScreen() {
  if (!state.conditions.length) {
    $("#validation").textContent = "请先确认至少一个筛选条件。";
    return;
  }
  $("#validation").textContent = "正在获取数据并筛选…";
  $("#runBtn").disabled = true;
  try {
    const revision = state.revision;
    const result = await api("/api/screen", { conditions: state.conditions });
    if (revision !== state.revision) return;
    state.result = result;
    $("#validation").textContent = "";
    renderResults();
  } catch (error) {
    $("#validation").textContent = (error.errors || [error.error || "筛选失败"]).join("；");
  }
  finally { $("#runBtn").disabled = false; }
}

async function init() {
  renderCandidates();
  renderConditions();
  renderResults();
  await loadStrategies();
  const pool = await api("/api/pool");
  const discovered = pool.discoveredSize && pool.discoveredSize !== pool.size ? ` / 接口发现 ${pool.discoveredSize} 只` : "";
  const limited = pool.limitedTo ? ` / 当前限制 ${pool.limitedTo} 只` : "";
  $("#poolMeta").textContent = `${pool.size} 只${discovered}${limited} · ${pool.source}`;
}

async function loadStrategies() {
  try {
    const { strategies } = await api("/api/strategies");
    const box = $("#saved");
    box.replaceChildren();
    if (!strategies.length) box.append(el("div", "empty-state", "暂无保存记录"));
    for (const strategy of strategies) {
      const row = el("div", "saved-row");
      const info = el("div");
      info.append(el("strong", "", strategy.name), el("div", "muted", `${strategy.conditions.length} 项条件 · 已保存于 ${localTime(strategy.savedAt)}`));
      const restore = el("button", "small", "恢复策略");
      restore.onclick = async () => {
        restore.disabled = true;
        try {
          const { strategy: saved, editingContext } = await api(`/api/strategies/${encodeURIComponent(strategy.id)}`);
          ++state.revision;
          state.restored = true;
          state.parse = { ...editingContext, ambiguities: [], aiFrame: null, aiStatus: null, candidates: saved.conditions.map((c) => ({ ...c, selected: true })) };
          state.conditions = structuredClone(saved.conditions);
          state.result = null;
          $("#intent").value = saved.text;
          $("#compare").textContent = "暂无比较记录";
          $("#validation").textContent = "已恢复条件，请重新执行筛选获取数据。";
          $("#requestStatus").textContent = `已恢复：${saved.name}`;
          renderRegistryMeta(); renderAiFrame(); renderAmbiguities(); renderTemplates(); renderCandidates(); renderConditions(); renderResults();
        } catch (error) { $("#saveStatus").textContent = error.error || error.message || "恢复失败"; }
        finally { restore.disabled = false; }
      };
      row.append(info, restore); box.append(row);
    }
  } catch (error) { $("#saveStatus").textContent = error.error || error.message || "保存记录读取失败"; }
}

$("#parseBtn").onclick = parseAndRender;
$("#confirmBtn").onclick = confirmCandidates;
$("#runBtn").onclick = runScreen;
$("#compareBtn").onclick = renderCompare;
$("#saveBtn").onclick = async () => {
  $("#saveBtn").disabled = true;
  try {
    if (!state.conditions.length) { $("#saveStatus").textContent = "暂无可保存的执行条件。"; return; }
    const saved = await api("/api/save", { name: state.parse?.aiFrame?.strategy || $("#intent").value.slice(0, 60), text: $("#intent").value, conditions: state.conditions });
    $("#saveStatus").textContent = `${saved.name} · 保存成功`;
    await loadStrategies();
  } catch (error) { $("#saveStatus").textContent = (error.errors || [error.error || "保存失败"]).join("；"); }
  finally { $("#saveBtn").disabled = false; }
};
for (const tab of document.querySelectorAll(".tab")) {
  tab.onclick = () => {
    state.tab = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach((item) => { item.classList.toggle("active", item === tab); item.setAttribute("aria-selected", String(item === tab)); });
    renderResults();
  };
}

for (const link of document.querySelectorAll(".nav-item")) {
  link.onclick = () => document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item === link));
}
icons();

init().catch((error) => {
  $("#validation").textContent = error.message || "初始化失败";
});
