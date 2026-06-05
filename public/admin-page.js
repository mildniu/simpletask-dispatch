const state = {
  user: null,
  tasks: [],
  users: [],
  tab: "dashboard",
};

const els = {};
const ids = [
  "adminAuth", "adminApp", "adminLoginForm", "adminUsername", "adminPassword",
  "adminMeta", "pageTitle", "refreshAdmin", "adminLogout", "adminStats",
  "statusBars", "recentTasks", "dashboardView", "tasksView", "usersView",
  "taskSearch", "taskStatusFilter", "adminTaskRows", "adminUserSearch",
  "adminRoleFilter", "adminUserRows", "showCreateUser", "createUserForm",
  "createUsername", "createName", "createPassword", "createPosition",
  "createRole", "taskDrawer", "closeDrawer", "drawerBody",
];

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

function cacheElements() {
  ids.forEach((id) => { els[id] = document.querySelector(`#${id}`); });
}

function bindEvents() {
  els.adminLoginForm.addEventListener("submit", login);
  els.refreshAdmin.addEventListener("click", loadData);
  els.adminLogout.addEventListener("click", logout);
  els.taskSearch.addEventListener("input", renderTasks);
  els.taskStatusFilter.addEventListener("change", renderTasks);
  els.adminUserSearch.addEventListener("input", renderUsers);
  els.adminRoleFilter.addEventListener("change", renderUsers);
  els.showCreateUser.addEventListener("click", () => els.createUserForm.classList.toggle("hidden"));
  els.createUserForm.addEventListener("submit", createUser);
  els.closeDrawer.addEventListener("click", () => els.taskDrawer.classList.add("hidden"));
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.adminTab));
  });
}

async function init() {
  cacheElements();
  bindEvents();
  const status = await api("/api/auth/status");
  if (!status.user) return showLogin();
  if (status.user.role !== "admin") return showDenied(status.user);
  await enterAdmin(status.user);
}

function showLogin() {
  els.adminAuth.classList.remove("hidden");
  els.adminApp.classList.add("hidden");
}

function showDenied(user) {
  els.adminAuth.classList.remove("hidden");
  els.adminApp.classList.add("hidden");
  els.adminLoginForm.innerHTML = `
    <h1>无访问权限</h1>
    <p>${escapeHtml(user.name)} 当前不是系统管理员。</p>
    <a class="back-link" href="/">返回业务端</a>
  `;
}

async function login(event) {
  event.preventDefault();
  const data = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({
      username: els.adminUsername.value.trim(),
      password: els.adminPassword.value,
    }),
  });
  if (data.user.role !== "admin") return showDenied(data.user);
  await enterAdmin(data.user);
}

async function enterAdmin(user) {
  state.user = user;
  els.adminAuth.classList.add("hidden");
  els.adminApp.classList.remove("hidden");
  els.adminMeta.textContent = `${roleLabel(user.role)} / ${user.name}`;
  await loadData();
}

async function logout() {
  await api("/api/logout", { method: "POST", body: "{}" });
  location.href = "/";
}

async function loadData() {
  const [tasks, users] = await Promise.all([
    api("/api/tasks"),
    api("/api/users"),
  ]);
  state.tasks = tasks.tasks;
  state.users = users.users;
  renderAll();
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adminTab === tab);
  });
  renderAll();
}

function renderAll() {
  const titles = { dashboard: "总览", tasks: "任务管理", users: "用户管理" };
  els.pageTitle.textContent = titles[state.tab];
  for (const name of ["dashboard", "tasks", "users"]) {
    els[`${name}View`].classList.toggle("hidden", state.tab !== name);
  }
  renderDashboard();
  renderTasks();
  renderUsers();
}

function renderDashboard() {
  const summary = buildSummary(state.tasks);
  els.adminStats.innerHTML = [
    statCard("全部任务", summary.total),
    statCard("处理中", summary.doing),
    statCard("待确认", summary.review),
    statCard("已完成", summary.done),
    statCard("启用用户", state.users.filter((user) => user.status === "active").length),
  ].join("");
  renderStatusBars(summary);
  els.recentTasks.innerHTML = state.tasks.slice(0, 8).map((task) => `
    <article class="recent-item">
      <strong>${escapeHtml(task.title)}</strong>
      <span class="badge ${badgeClass(task.status)}">${escapeHtml(task.status)}</span>
      <span class="muted">${escapeHtml(task.creator_name)} → ${escapeHtml(task.assignee_name)}</span>
      <span class="muted">${formatDate(task.updated_at)}</span>
    </article>
  `).join("") || `<p class="muted">暂无任务</p>`;
}

function statCard(label, count) {
  return `<article class="stat-card"><span>${label}</span><strong>${count}</strong></article>`;
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
  els.statusBars.innerHTML = rows.map(([label, count]) => `
    <div class="status-row">
      <span>${label}</span>
      <i><b style="width:${Math.round((count / max) * 100)}%"></b></i>
      <strong>${count}</strong>
    </div>
  `).join("");
}

function buildSummary(tasks) {
  return {
    total: tasks.length,
    pending: countStatus(tasks, "待接单"),
    doing: countStatus(tasks, "处理中"),
    review: countStatus(tasks, "待确认"),
    done: countStatus(tasks, "已完成"),
    returned: countStatus(tasks, "已退回"),
  };
}

function countStatus(tasks, status) {
  return tasks.filter((task) => task.status === status).length;
}

function renderTasks() {
  const keyword = els.taskSearch.value.trim().toLowerCase();
  const status = els.taskStatusFilter.value;
  const tasks = state.tasks.filter((task) => {
    const text = `${task.title} ${task.creator_name} ${task.assignee_name}`.toLowerCase();
    return (!keyword || text.includes(keyword)) && (status === "all" || task.status === status);
  });
  els.adminTaskRows.innerHTML = tasks.map(renderTaskRow).join("") || emptyRow(6, "暂无任务");
  bindTaskRows();
}

function renderTaskRow(task) {
  return `
    <tr>
      <td><div class="cell-title">${escapeHtml(task.title)}</div></td>
      <td><span class="badge ${badgeClass(task.status)}">${escapeHtml(task.status)}</span></td>
      <td>${escapeHtml(task.creator_name)}</td>
      <td>${escapeHtml(task.assignee_name)}</td>
      <td>${formatDate(task.due_date)}</td>
      <td>
        <div class="row-actions">
          <button data-task-action="detail" data-id="${task.id}" type="button">详情</button>
          <button class="ghost" data-task-action="status" data-id="${task.id}" type="button">改状态</button>
          <button class="danger" data-task-action="delete" data-id="${task.id}" type="button">删除</button>
        </div>
      </td>
    </tr>
  `;
}

function bindTaskRows() {
  els.adminTaskRows.querySelectorAll("[data-task-action]").forEach((button) => {
    button.addEventListener("click", () => runTaskAction(button.dataset.taskAction, Number(button.dataset.id)));
  });
}

async function runTaskAction(action, taskId) {
  if (action === "detail") return showTaskDetail(taskId);
  if (action === "status") return changeTaskStatus(taskId);
  if (action === "delete") return deleteTask(taskId);
}

async function showTaskDetail(taskId) {
  const data = await api(`/api/tasks/${taskId}/events`);
  els.drawerBody.innerHTML = `
    <section class="detail-block">
      <h3>${escapeHtml(data.task.title)}</h3>
      <p>${escapeHtml(data.task.description)}</p>
    </section>
    <section class="detail-block">
      <h3>任务信息</h3>
      <p>状态：${escapeHtml(data.task.status)}</p>
      <p>派单人：${escapeHtml(data.task.creator_name)}</p>
      <p>负责人：${escapeHtml(data.task.assignee_name)}</p>
      <p>截止：${formatDate(data.task.due_date)}</p>
    </section>
    <section class="detail-block">
      <h3>流转记录</h3>
      ${data.events.map((event) => `<p>${formatDate(event.created_at)} · ${escapeHtml(event.actor_name)} · ${escapeHtml(event.action)}</p>`).join("") || "<p>暂无记录</p>"}
    </section>
  `;
  els.taskDrawer.classList.remove("hidden");
}

async function changeTaskStatus(taskId) {
  const options = ["待接单", "处理中", "待确认", "已完成", "已退回"];
  const status = prompt(`请输入新状态：${options.join(" / ")}`);
  if (!status) return;
  if (!options.includes(status)) return alert("状态不正确");
  await api(`/api/tasks/${taskId}/status`, {
    method: "POST",
    body: JSON.stringify({ status, note: "管理员后台变更状态" }),
  });
  await loadData();
}

async function deleteTask(taskId) {
  if (!confirm("确认删除这个任务？删除后不可恢复。")) return;
  await api(`/api/tasks/${taskId}/delete`, { method: "POST", body: "{}" });
  await loadData();
}

function renderUsers() {
  const keyword = els.adminUserSearch.value.trim().toLowerCase();
  const role = els.adminRoleFilter.value;
  const users = state.users.filter((user) => {
    const text = `${user.name} ${user.username} ${user.position || ""}`.toLowerCase();
    return (!keyword || text.includes(keyword)) && (role === "all" || user.role === role);
  });
  els.adminUserRows.innerHTML = users.map(renderUserRow).join("") || emptyRow(6, "暂无用户");
  bindUserRows();
}

function renderUserRow(user) {
  return `
    <tr data-id="${user.id}" data-role="${user.role}" data-status="${user.status}">
      <td>${escapeHtml(user.name)}</td>
      <td>${escapeHtml(user.username)}</td>
      <td>
        <select data-field="role">
          ${roleOption("member", "成员", user.role)}
          ${roleOption("branch", "支局长", user.role)}
          ${roleOption("supervisor", "主管", user.role)}
          ${roleOption("manager", "经理", user.role)}
          ${roleOption("admin", "系统管理员", user.role)}
        </select>
      </td>
      <td>${escapeHtml(user.position || "")}</td>
      <td><span class="badge user-status ${user.status}">${user.status === "active" ? "启用" : "停用"}</span></td>
      <td>
        <div class="row-actions">
          <button data-user-action="save" type="button">保存</button>
          <button class="ghost" data-user-action="password" type="button">改密码</button>
          <button class="danger" data-user-action="toggle" type="button">${user.status === "active" ? "停用" : "启用"}</button>
        </div>
      </td>
    </tr>
  `;
}

function bindUserRows() {
  els.adminUserRows.querySelectorAll("[data-user-action]").forEach((button) => {
    const row = button.closest("tr");
    button.addEventListener("click", () => runUserAction(button.dataset.userAction, row));
  });
}

async function runUserAction(action, row) {
  const payload = { role: row.querySelector("[data-field='role']").value };
  if (action === "toggle") payload.status = row.dataset.status === "active" ? "disabled" : "active";
  if (action === "password") {
    const password = prompt("请输入新密码");
    if (!password) return;
    payload.password = password;
  }
  await api(`/api/users/${row.dataset.id}/update`, { method: "POST", body: JSON.stringify(payload) });
  await loadData();
}

async function createUser(event) {
  event.preventDefault();
  await api("/api/users", {
    method: "POST",
    body: JSON.stringify({
      username: els.createUsername.value.trim(),
      name: els.createName.value.trim(),
      password: els.createPassword.value,
      position: els.createPosition.value.trim(),
      role: els.createRole.value,
    }),
  });
  els.createUserForm.reset();
  els.createUserForm.classList.add("hidden");
  await loadData();
}

function roleOption(value, label, current) {
  return `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`;
}

function emptyRow(cols, text) {
  return `<tr><td colspan="${cols}" class="muted">${text}</td></tr>`;
}

function roleLabel(role) {
  return { admin: "系统管理员", manager: "经理", supervisor: "主管", branch: "支局长", member: "成员" }[role] || role;
}

function badgeClass(status) {
  if (status === "已完成") return "done";
  if (status === "已退回") return "returned";
  return "";
}

function formatDate(value) {
  return value ? String(value).replace("T", " ").slice(0, 16) : "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[char]));
}

document.addEventListener("DOMContentLoaded", () => init().catch((error) => alert(error.message)));
