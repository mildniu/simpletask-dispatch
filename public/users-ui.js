const UserApp = window.App;

document.addEventListener("DOMContentLoaded", () => {
  UserApp.els.userManage.addEventListener("click", openUsers);
  UserApp.els.closeUsers.addEventListener("click", () => UserApp.els.userDialog.close());
  UserApp.els.userForm.addEventListener("submit", createManagedUser);
  UserApp.els.showUserForm.addEventListener("click", toggleUserForm);
  UserApp.els.userSearch.addEventListener("input", renderManagedUsers);
  document.querySelectorAll(".user-chips .chip").forEach((button) => {
    button.addEventListener("click", () => setRoleFilter(button));
  });
});

async function openUsers() {
  await loadUsers();
  UserApp.els.userForm.classList.add("collapsed");
  UserApp.els.userDialog.showModal();
}

async function loadUsers() {
  const data = await UserApp.api("/api/users");
  UserApp.state.managedUsers = data.users;
  renderManagedUsers();
}

function renderManagedUsers() {
  const users = filterUsers();
  UserApp.els.userList.innerHTML = users.map(renderUser).join("") || `<div class="user-card">暂无匹配用户</div>`;
  bindUserCards();
}

function renderUser(user) {
  return `
    <article class="user-card" data-id="${user.id}" data-role="${user.role}" data-status="${user.status}">
      <div class="avatar">●</div>
      <div class="user-main">
        <strong>${UserApp.escapeHtml(user.name)}</strong>
        <span>${UserApp.escapeHtml(user.username)}</span>
        <em>${UserApp.roleLabel(user.role)}${user.position ? " · " + UserApp.escapeHtml(user.position) : ""}</em>
      </div>
      <span class="user-status ${user.status}">${user.status === "active" ? "启用" : "已停用"}</span>
      <div class="user-actions">
        <button data-action="edit" type="button">编辑</button>
        <button class="danger" data-action="toggle" type="button">${user.status === "active" ? "停用" : "启用"}</button>
      </div>
      <div class="user-edit collapsed">
        <select data-field="role">
          ${roleOption("member", "成员", user.role)}
          ${roleOption("branch", "支局长", user.role)}
          ${roleOption("supervisor", "主管", user.role)}
          ${roleOption("manager", "经理", user.role)}
          ${roleOption("admin", "系统管理员", user.role)}
        </select>
        <select data-field="status">
          ${statusOption("active", "启用", user.status)}
          ${statusOption("disabled", "停用", user.status)}
        </select>
        <input data-field="password" type="password" placeholder="新密码，不改可留空" />
        <button data-action="save" type="button">保存</button>
      </div>
    </article>
  `;
}

function filterUsers() {
  const keyword = UserApp.els.userSearch.value.trim().toLowerCase();
  return UserApp.state.managedUsers.filter((user) => {
    const matchRole = UserApp.state.roleFilter === "all" || user.role === UserApp.state.roleFilter;
    const text = `${user.name} ${user.username}`.toLowerCase();
    return matchRole && (!keyword || text.includes(keyword));
  });
}

function setRoleFilter(button) {
  UserApp.state.roleFilter = button.dataset.role;
  document.querySelectorAll(".user-chips .chip").forEach((chip) => {
    chip.classList.toggle("active", chip === button);
  });
  renderManagedUsers();
}

function toggleUserForm() {
  UserApp.els.userForm.classList.toggle("collapsed");
}

function roleOption(value, label, current) {
  return `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`;
}

function statusOption(value, label, current) {
  return `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`;
}

function bindUserCards() {
  UserApp.els.userList.querySelectorAll("[data-action]").forEach((button) => {
    const card = button.closest(".user-card");
    if (button.dataset.action === "edit") button.addEventListener("click", () => toggleEdit(card));
    if (button.dataset.action === "save") button.addEventListener("click", () => saveUser(card));
    if (button.dataset.action === "toggle") button.addEventListener("click", () => toggleStatus(card));
  });
}

function toggleEdit(card) {
  card.querySelector(".user-edit").classList.toggle("collapsed");
}

async function createManagedUser(event) {
  event.preventDefault();
  const input = {
    username: UserApp.els.newUsername.value.trim(),
    name: UserApp.els.newName.value.trim(),
    password: UserApp.els.newPassword.value,
    role: UserApp.els.newRole.value,
    position: "",
  };
  await UserApp.api("/api/users", { method: "POST", body: JSON.stringify(input) });
  UserApp.els.userForm.reset();
  UserApp.els.userForm.classList.add("collapsed");
  await loadUsers();
  await UserApp.loadAssignees();
}

async function saveUser(card) {
  const payload = {
    role: card.querySelector("[data-field='role']").value,
    status: card.querySelector("[data-field='status']").value,
  };
  const password = card.querySelector("[data-field='password']").value;
  if (password) payload.password = password;
  await UserApp.api(`/api/users/${card.dataset.id}/update`, { method: "POST", body: JSON.stringify(payload) });
  await loadUsers();
  await UserApp.loadAssignees();
}

async function toggleStatus(card) {
  const payload = {
    role: card.dataset.role,
    status: card.dataset.status === "active" ? "disabled" : "active",
  };
  await UserApp.api(`/api/users/${card.dataset.id}/update`, { method: "POST", body: JSON.stringify(payload) });
  await loadUsers();
  await UserApp.loadAssignees();
}
