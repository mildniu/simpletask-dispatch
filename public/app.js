window.App = {
  state: {
    currentUser: null,
    initialized: false,
    users: [],
    managedUsers: [],
    tasks: [],
    activePage: "tasks",
    filter: "all",
    roleFilter: "all",
    statsRange: "month",
    submitTaskId: null,
    returnTaskId: null,
  },
  els: {},
};

const App = window.App;

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
  const ids = [
    "authView", "appView", "authForm", "authHint", "authUsername", "authPassword",
    "authName", "authNameWrap", "authSubmit", "appTopbar", "userMeta", "logout", "userManage",
    "adminConsole", "assignee", "taskForm", "taskList", "message", "taskStats",
    "tasksView", "createView", "statsView", "mineView", "submitDialog", "submitForm",
    "resultText", "resultFile", "submitSummary", "closeSubmit",
    "detailDialog", "detailBody", "closeDetail",
    "returnDialog", "returnForm", "returnReason", "returnSummary",
    "returnCount", "closeReturn", "cancelReturn",
    "statsBody", "openStats", "navCreate", "navMine",
    "userDialog", "closeUsers", "userForm", "userList", "newUsername",
    "newName", "newPassword", "newRole", "userSearch", "showUserForm",
    "profileForm", "profileAvatar", "avatarInput",
    "profileName", "profileMeta", "profilePhone", "profilePassword", "profilePasswordConfirm",
    "imagePreviewOverlay", "imagePreviewImg", "imagePreviewName", "closeImagePreview",
  ];
  ids.forEach((id) => { App.els[id] = document.querySelector(`#${id}`); });
}

function showMessage(text) {
  App.els.message.textContent = text;
  if (text) setTimeout(() => (App.els.message.textContent = ""), 2500);
}

async function init() {
  cacheElements();
  bindBaseEvents();
  try {
    const status = await api("/api/auth/status");
    App.state.initialized = status.initialized;
    if (!status.initialized) return showAuth("setup");
    if (!status.user) return showAuth("login");
    await enterApp(status.user);
  } catch (error) {
    showAuth("login");
    App.els.authHint.textContent = "连接服务失败，请稍后重试";
  }
}

function bindBaseEvents() {
  App.els.authForm.addEventListener("submit", submitAuth);
  App.els.logout.addEventListener("click", logout);
  App.els.adminConsole.addEventListener("click", () => { location.href = "/admin.html"; });
  document.querySelectorAll(".bottom-nav [data-page]").forEach((button) => {
    button.addEventListener("click", () => setActivePage(button.dataset.page));
  });
  App.els.profileForm.addEventListener("submit", saveProfile);
  App.els.avatarInput.addEventListener("change", previewAvatar);
  App.els.closeSubmit.addEventListener("click", () => App.els.submitDialog.close());
  App.els.closeDetail.addEventListener("click", closeDetailDialog);
  App.els.closeReturn.addEventListener("click", () => App.els.returnDialog.close());
  App.els.cancelReturn.addEventListener("click", () => App.els.returnDialog.close());
  App.els.closeImagePreview.addEventListener("click", closeImagePreview);
  App.els.imagePreviewOverlay.addEventListener("click", (event) => {
    if (event.target === App.els.imagePreviewOverlay) closeImagePreview();
  });
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => setFilter(button.dataset.filter));
  });
  document.querySelectorAll("[data-stats-range]").forEach((button) => {
    button.addEventListener("click", () => setStatsRange(button.dataset.statsRange));
  });
}

function showAuth(mode) {
  App.els.authView.classList.remove("hidden");
  App.els.appView.classList.add("hidden");
  const setup = mode === "setup";
  App.els.authNameWrap.classList.toggle("hidden", !setup);
  App.els.authName.required = setup;
  App.els.authHint.textContent = setup ? "首次使用，请初始化管理员账号" : "高效 · 协同 · 可追踪";
  App.els.authSubmit.textContent = setup ? "初始化管理员" : "登录";
}

async function submitAuth(event) {
  event.preventDefault();
  const body = {
    username: App.els.authUsername.value.trim(),
    password: App.els.authPassword.value,
    name: App.els.authName.value.trim(),
  };
  const path = App.state.initialized ? "/api/login" : "/api/setup";
  const data = await api(path, { method: "POST", body: JSON.stringify(body) });
  App.state.initialized = true;
  await enterApp(data.user);
}

async function enterApp(user) {
  App.state.currentUser = user;
  App.els.authView.classList.add("hidden");
  App.els.appView.classList.remove("hidden");
  App.els.userMeta.textContent = `${roleLabel(user.role)} / ${user.name}`;
  App.els.userManage.classList.toggle("hidden", !isAdmin());
  App.els.adminConsole.classList.toggle("hidden", !isAdmin());
  await App.loadAssignees();
  await App.loadTasks();
  setActivePage("tasks");
}

async function logout() {
  await api("/api/logout", { method: "POST", body: "{}" });
  App.state.currentUser = null;
  showAuth("login");
}

function setFilter(filter) {
  App.state.filter = filter;
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === filter);
  });
  App.renderTasks();
}

function setStatsRange(range) {
  App.state.statsRange = range;
  document.querySelectorAll("[data-stats-range]").forEach((button) => {
    button.classList.toggle("active", button.dataset.statsRange === range);
  });
  App.renderStatsPage();
}

function setActivePage(page) {
  App.state.activePage = page;
  for (const name of ["tasks", "create", "stats", "mine"]) {
    App.els[`${name}View`].classList.toggle("hidden", name !== page);
  }
  document.querySelectorAll(".bottom-nav [data-page]").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });
  if (page === "stats") App.renderStatsPage();
  if (page === "mine") renderMinePage();
  App.els.appTopbar.classList.toggle("hidden", page !== "tasks");
  window.scrollTo({ top: 0, behavior: "instant" });
}

function closeTopDialog() {
  if (App.els.imagePreviewOverlay && !App.els.imagePreviewOverlay.classList.contains("hidden")) {
    closeImagePreview();
    return true;
  }
  for (const dialog of [App.els.detailDialog, App.els.submitDialog, App.els.returnDialog]) {
    if (dialog && dialog.open) {
      dialog.close();
      return true;
    }
  }
  return false;
}

function openImagePreview(src, name) {
  App.els.imagePreviewImg.src = src;
  App.els.imagePreviewName.textContent = name || "图片附件";
  App.els.imagePreviewOverlay.classList.remove("hidden");
  if (!App.els.imagePreviewOverlay.open) App.els.imagePreviewOverlay.showModal();
}

function closeImagePreview() {
  if (App.els.imagePreviewOverlay.open) App.els.imagePreviewOverlay.close();
  App.els.imagePreviewOverlay.classList.add("hidden");
  App.els.imagePreviewImg.removeAttribute("src");
  App.els.imagePreviewName.textContent = "";
}

function closeDetailDialog() {
  if (history.state && history.state.dialog === "detail") {
    history.back();
    return;
  }
  App.els.detailDialog.close();
}

function renderMinePage() {
  const user = App.state.currentUser;
  App.els.profileName.textContent = user.name;
  App.els.profileMeta.textContent = `${roleLabel(user.role)} / ${user.position || "未设置岗位"}`;
  App.els.profilePhone.value = user.username;
  App.els.profilePassword.value = "";
  App.els.profilePasswordConfirm.value = "";
  renderAvatar(user.avatarData);
}

function renderAvatar(src) {
  if (src) {
    App.els.profileAvatar.style.backgroundImage = `url("${src}")`;
    App.els.profileAvatar.textContent = "";
    return;
  }
  App.els.profileAvatar.style.backgroundImage = "";
  App.els.profileAvatar.textContent = (App.state.currentUser.name || "我").slice(0, 1);
}

function previewAvatar() {
  const file = App.els.avatarInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => renderAvatar(reader.result);
  reader.readAsDataURL(file);
}

async function saveProfile(event) {
  event.preventDefault();
  const password = App.els.profilePassword.value;
  if (password && password !== App.els.profilePasswordConfirm.value) {
    return showMessage("两次输入的新密码不一致");
  }
  const avatarFile = App.els.avatarInput.files[0];
  const payload = { username: App.els.profilePhone.value.trim() };
  if (password) payload.password = password;
  if (avatarFile) payload.avatarData = await readAvatar(avatarFile);
  const data = await api("/api/profile", { method: "POST", body: JSON.stringify(payload) });
  App.state.currentUser = data.user;
  App.els.userMeta.textContent = `${roleLabel(data.user.role)} / ${data.user.name}`;
  App.els.avatarInput.value = "";
  renderMinePage();
  showMessage("个人信息已保存");
}

function readAvatar(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function getValue(selector) {
  return document.querySelector(selector).value.trim();
}

function roleLabel(role) {
  return { admin: "系统管理员", manager: "经理", supervisor: "主管", branch: "支局长", member: "成员" }[role] || role;
}

function isAdmin() {
  return App.state.currentUser && App.state.currentUser.role === "admin";
}

function formatDate(value) {
  return value ? value.replace("T", " ") : "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[char]));
}

Object.assign(App, { api, showMessage, getValue, roleLabel, formatDate, escapeHtml, isAdmin, closeDetailDialog, openImagePreview });
document.addEventListener("DOMContentLoaded", () => init().catch((error) => alert(error.message)));
window.addEventListener("popstate", () => {
  closeTopDialog();
});
