const StatsApp = window.App;

StatsApp.renderHomeStats = function renderHomeStats() {
  const tasks = StatsApp.state.tasks;
  const summary = buildSummary(tasks);
  StatsApp.els.taskStats.innerHTML = [
    statItem(summary.total, "全部"),
    statItem(summary.doing, "进行中"),
    statItem(summary.review, "待确认"),
    statItem(summary.overdue, "已逾期"),
  ].join("");
};

StatsApp.renderStatsPage = function renderStatsPage() {
  const tasks = filterByRange(StatsApp.state.tasks, StatsApp.state.statsRange);
  const summary = buildSummary(tasks);
  const people = buildPeopleStats(tasks);
  const dispatchers = buildDispatcherStats(tasks);
  StatsApp.els.statsBody.innerHTML = `
    <section class="stats-card"><h3>${rangeLabel()}</h3>${renderMetricCards(summary)}</section>
    <section class="stats-card risk-card">${renderRiskPanel(summary)}</section>
    <section class="stats-card"><h3>人员效能对比</h3>${renderPeopleStats(people)}</section>
    <section class="stats-card"><h3>派单来源对比</h3>${renderDispatcherStats(dispatchers)}</section>
    <section class="stats-card"><h3>任务状态分布</h3>${renderStatusBars(summary)}</section>
  `;
};

function filterByRange(tasks, range) {
  if (range === "all") return tasks;
  const now = new Date();
  const start = range === "week" ? new Date(now.getTime() - 7 * 86400000) : new Date(now.getFullYear(), now.getMonth(), 1);
  return tasks.filter((task) => new Date(task.created_at || task.updated_at) >= start);
}

function buildSummary(tasks) {
  const urgent = tasks.filter((task) => task.priority === "紧急").length;
  const active = tasks.filter((task) => !["已完成"].includes(task.status)).length;
  return {
    total: tasks.length,
    pending: byStatus(tasks, "待接单"),
    doing: byStatus(tasks, "处理中"),
    review: byStatus(tasks, "待确认"),
    done: byStatus(tasks, "已完成"),
    returned: byStatus(tasks, "已退回"),
    overdue: tasks.filter(isOverdueTask).length,
    urgent,
    active,
    doneRate: tasks.length ? Math.round((byStatus(tasks, "已完成") / tasks.length) * 100) : 0,
    riskCount: urgent + tasks.filter(isOverdueTask).length + byStatus(tasks, "已退回"),
  };
}

function byStatus(tasks, status) {
  return tasks.filter((task) => task.status === status).length;
}

function isOverdueTask(task) {
  return task.status !== "已完成" && task.due_date && new Date(task.due_date) < new Date();
}

function renderMetricCards(summary) {
  const items = [
    ["任务总量", summary.total, "全部可见任务"],
    ["进行中", summary.active, "未完成任务"],
    ["完成率", `${summary.doneRate}%`, "已完成 / 总量"],
    ["待接单", summary.pending, "需要负责人响应"],
    ["待确认", summary.review, "需要派单人确认"],
    ["风险项", summary.riskCount, "紧急/逾期/退回"],
  ];
  return `<div class="stats-grid">${items.map(([label, count, hint]) => `
    <div class="metric">
      <span class="metric-icon"></span>
      <div>
        <p>${label}</p>
        <strong class="${label.includes("风险") ? "danger-text" : ""}">${count}</strong>
        <em>${hint}</em>
      </div>
    </div>
  `).join("")}</div>`;
}

function renderRiskPanel(summary) {
  return `
    <div class="risk-main">
      <strong class="${summary.riskCount ? "danger-text" : ""}">${summary.riskCount}</strong>
      <span>风险任务</span>
    </div>
    <div class="risk-list">
      ${riskItem("紧急", summary.urgent)}
      ${riskItem("逾期", summary.overdue)}
      ${riskItem("退回", summary.returned)}
    </div>
  `;
}

function riskItem(label, count) {
  return `<div><span>${label}</span><strong>${count}</strong></div>`;
}

function buildPeopleStats(tasks) {
  return Object.values(tasks.reduce((map, task) => {
    const name = task.assignee_name || "未分配";
    map[name] ||= { name, done: 0, total: 0, active: 0, overdue: 0, review: 0 };
    map[name].total += 1;
    if (task.status === "已完成") map[name].done += 1;
    else map[name].active += 1;
    if (task.status === "待确认") map[name].review += 1;
    if (isOverdueTask(task)) map[name].overdue += 1;
    return map;
  }, {})).map((row) => ({
    ...row,
    rate: row.total ? Math.round((row.done / row.total) * 100) : 0,
  })).sort((a, b) => b.total - a.total || b.rate - a.rate).slice(0, 6);
}

function renderPeopleStats(rows) {
  if (!rows.length) return `<p class="muted">暂无排行数据</p>`;
  const max = Math.max(...rows.map((row) => row.total), 1);
  return `<div class="eff-list">${rows.map((row) => peopleRow(row, max)).join("")}</div>`;
}

function peopleRow(row, max) {
  return `
    <div class="eff-row">
      <span class="avatar mini">${StatsApp.escapeHtml(row.name.slice(0, 1))}</span>
      <div>
        <strong>${StatsApp.escapeHtml(row.name)}</strong>
        <small>承接 ${row.total} · 完成 ${row.done} · 待确认 ${row.review}</small>
      </div>
      <i><b style="width:${Math.max(8, Math.round((row.total / max) * 100))}%"></b></i>
      <em>${row.rate}%</em>
    </div>
  `;
}

function buildDispatcherStats(tasks) {
  return Object.values(tasks.reduce((map, task) => {
    const name = task.creator_name || "未知";
    map[name] ||= { name, total: 0, done: 0, returned: 0 };
    map[name].total += 1;
    if (task.status === "已完成") map[name].done += 1;
    if (task.status === "已退回") map[name].returned += 1;
    return map;
  }, {})).sort((a, b) => b.total - a.total).slice(0, 5);
}

function renderDispatcherStats(rows) {
  if (!rows.length) return `<p class="muted">暂无派单数据</p>`;
  const max = Math.max(...rows.map((row) => row.total), 1);
  return `<div class="dispatch-list">${rows.map((row) => `
    <div class="dispatch-row">
      <strong>${StatsApp.escapeHtml(row.name)}</strong>
      <i><b style="width:${Math.max(8, Math.round((row.total / max) * 100))}%"></b></i>
      <span>派出 ${row.total} · 完成 ${row.done} · 退回 ${row.returned}</span>
    </div>
  `).join("")}</div>`;
}

function renderStatusBars(summary) {
  const rows = [
    ["待接单", summary.pending],
    ["处理中", summary.doing],
    ["待确认", summary.review],
    ["已完成", summary.done],
    ["已退回", summary.returned],
  ];
  const max = Math.max(...rows.map((row) => row[1]), 1);
  return `<div class="status-bars">${rows.map(([label, count]) => `
    <div class="bar-row"><span>${label}</span><i><b style="height:${Math.max(12, Math.round((count / max) * 100))}%"></b></i><strong>${count}</strong></div>
  `).join("")}</div>`;
}

function statItem(count, label) {
  return `<div class="stat-item"><strong>${count}</strong><span>${label}</span></div>`;
}

function rangeLabel() {
  return { week: "最近一周", month: "本月概览", all: "全部任务" }[StatsApp.state.statsRange];
}

StatsApp.isOverdueTask = isOverdueTask;
