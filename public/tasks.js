const TaskApp = window.App;

TaskApp.loadAssignees = async function loadAssignees() {
  const data = await TaskApp.api("/api/users/assignees");
  TaskApp.state.users = data.users;
  TaskApp.els.assignee.innerHTML = data.users.map((user) => (
    `<option value="${TaskApp.escapeHtml(user.name)}">${TaskApp.escapeHtml(user.name)} - ${TaskApp.roleLabel(user.role)}</option>`
  )).join("");
};

TaskApp.loadTasks = async function loadTasks() {
  const data = await TaskApp.api("/api/tasks");
  TaskApp.state.tasks = data.tasks;
  TaskApp.renderTasks();
};

TaskApp.renderTasks = function renderTasks() {
  const tasks = filteredTasks();
  TaskApp.renderHomeStats();
  if (!tasks.length) {
    TaskApp.els.taskList.innerHTML = `<div class="task">暂无任务</div>`;
    return;
  }
  TaskApp.els.taskList.innerHTML = tasks.map(renderTask).join("");
  bindTaskActions();
};

TaskApp.elsReady = document.addEventListener("DOMContentLoaded", () => {
  TaskApp.els.taskForm.addEventListener("submit", createTask);
  TaskApp.els.submitForm.addEventListener("submit", submitResult);
  TaskApp.els.returnForm.addEventListener("submit", submitReturn);
  TaskApp.els.returnReason.addEventListener("input", updateReturnCount);
  document.querySelectorAll("[data-reason]").forEach((button) => {
    button.addEventListener("click", () => useReturnReason(button.dataset.reason));
  });
});

function filteredTasks() {
  const me = TaskApp.state.currentUser.name;
  if (TaskApp.state.filter === "mine") return TaskApp.state.tasks.filter((task) => task.assignee_name === me);
  if (TaskApp.state.filter === "sent") return TaskApp.state.tasks.filter((task) => task.creator_name === me);
  return TaskApp.state.tasks;
}

async function createTask(event) {
  event.preventDefault();
  const input = {
    title: TaskApp.getValue("#title"),
    description: TaskApp.getValue("#description"),
    priority: TaskApp.getValue("#priority"),
    dueDate: TaskApp.getValue("#dueDate"),
    assigneeName: TaskApp.getValue("#assignee"),
  };
  await TaskApp.api("/api/tasks", { method: "POST", body: JSON.stringify(input) });
  TaskApp.els.taskForm.reset();
  TaskApp.state.activePage = "tasks";
  document.querySelectorAll(".bottom-nav [data-page]").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === "tasks");
  });
  TaskApp.els.tasksView.classList.remove("hidden");
  TaskApp.els.createView.classList.add("hidden");
  TaskApp.showMessage("任务已创建");
  await TaskApp.loadTasks();
}

function renderTask(task) {
  return `
    <article class="task">
      <div class="task-head">
        <h3>${TaskApp.escapeHtml(task.title)}</h3>
        <span class="badge ${badgeClass(task.status)}">${TaskApp.escapeHtml(task.status)}</span>
      </div>
      <p>${TaskApp.escapeHtml(task.description)}</p>
      <div class="meta">
        派单人：${TaskApp.escapeHtml(task.creator_name)}　负责人：${TaskApp.escapeHtml(task.assignee_name)}
       　优先级：${TaskApp.escapeHtml(task.priority)}　截止：${TaskApp.formatDate(task.due_date)}
      </div>
      ${renderResult(task)}
      ${renderReturnReason(task)}
      <div class="task-actions">${renderActions(task)}</div>
    </article>
  `;
}

function renderResult(task) {
  if (!task.result_text) return "";
  const attachment = task.result_file_path ? renderInlineAttachment(task.result_file_path, task.result_file_name, "查看附件") : "";
  return `<div class="meta">最近进展：${TaskApp.escapeHtml(task.result_text)}${attachment}</div>`;
}

function renderReturnReason(task) {
  if (!task.return_reason) return "";
  return `<div class="meta">退回原因：${TaskApp.escapeHtml(task.return_reason)}</div>`;
}

function renderActions(task) {
  const me = TaskApp.state.currentUser.name;
  const actions = [actionButton(task.id, "detail", "详情", "secondary")];
  if (TaskApp.isAdmin()) {
    actions.push(actionButton(task.id, "status", "改状态", "secondary"));
    actions.push(actionButton(task.id, "delete", "删除", "danger"));
  }
  if (task.assignee_name === me && ["待接单", "已退回"].includes(task.status)) {
    actions.push(actionButton(task.id, "accept", "接单", "secondary"));
  }
  if (task.assignee_name === me && ["处理中", "已退回", "待确认"].includes(task.status)) {
    actions.push(actionButton(task.id, "submit", "提交进展", ""));
  }
  if (task.creator_name === me && task.status === "待确认") {
    actions.push(actionButton(task.id, "confirm", "确认完成", ""));
    actions.push(actionButton(task.id, "return", "退回", "danger"));
  }
  return actions.join("") || `<span class="meta">暂无可操作项</span>`;
}

function actionButton(taskId, action, text, type) {
  return `<button class="${type}" data-id="${taskId}" data-action="${action}">${text}</button>`;
}

function bindTaskActions() {
  TaskApp.els.taskList.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => runTaskAction(button.dataset.action, Number(button.dataset.id)));
  });
  bindImagePreviewActions(TaskApp.els.taskList);
}

async function runTaskAction(action, taskId) {
  if (action === "detail") return showDetail(taskId);
  if (action === "submit") return openSubmit(taskId);
  if (action === "return") return returnTask(taskId);
  if (action === "status") return changeStatus(taskId);
  if (action === "delete") return deleteTask(taskId);
  await postAction(taskId, action, {});
}

async function showDetail(taskId) {
  const data = await TaskApp.api(`/api/tasks/${taskId}/events`);
  TaskApp.els.detailBody.innerHTML = renderDetail(data.task, data.events, data.progress || []);
  bindDetailActions();
  TaskApp.els.detailDialog.showModal();
  history.pushState({ dialog: "detail" }, "", location.href);
}

function renderDetail(task, events, progress) {
  return `
    <section class="detail-card detail-summary">
      <div class="detail-icon">▣</div>
      <div>
        <h3>${TaskApp.escapeHtml(task.title)}</h3>
        <span class="badge ${badgeClass(task.status)}">${TaskApp.escapeHtml(task.status)}</span>
      </div>
      <div class="info-grid">
        ${infoItem("派单人", task.creator_name)}
        ${infoItem("负责人", task.assignee_name)}
        ${infoItem("截止时间", TaskApp.formatDate(task.due_date))}
      </div>
    </section>
    <section class="detail-card">
      <h3>任务内容</h3>
      <p class="soft-box">${TaskApp.escapeHtml(task.description)}</p>
      ${renderAttachment(task)}
    </section>
    <section class="detail-card"><h3>阶段进展</h3>${renderProgress(task, progress)}</section>
    <section class="detail-card"><h3>流转记录</h3><ol class="timeline">${events.map(renderEvent).join("")}</ol></section>
    <div class="detail-actions">${renderDetailActions(task)}</div>
  `;
}

function infoItem(label, value) {
  return `<div><span>${label}</span><strong>${TaskApp.escapeHtml(value)}</strong></div>`;
}

function renderAttachment(task) {
  if (!task.result_file_path) return "";
  return renderAttachmentCard(task.result_file_path, task.result_file_name);
}

function renderProgress(task, progress) {
  if (!progress.length && !task.result_text) return "<p>暂无阶段进展</p>";
  const rows = progress.length ? progress : [{ actor_name: task.assignee_name, result_text: task.result_text, result_file_path: task.result_file_path, created_at: task.updated_at }];
  return `<ol class="timeline">${rows.map(renderProgressItem).join("")}</ol>`;
}

function renderProgressItem(item) {
  const file = item.result_file_path ? renderProgressAttachment(item.result_file_path, item.result_file_name) : "";
  return `<li><strong>${TaskApp.escapeHtml(item.actor_name)}</strong><span>${TaskApp.formatDate(item.created_at)}</span><p>${TaskApp.escapeHtml(item.result_text)}</p>${file}</li>`;
}

function renderEvent(event) {
  return `<li><strong>${TaskApp.escapeHtml(event.action)}</strong><span>${TaskApp.formatDate(event.created_at)} · ${TaskApp.escapeHtml(event.actor_name)}</span>${event.note ? `<p>${TaskApp.escapeHtml(event.note)}</p>` : ""}</li>`;
}

function openSubmit(taskId) {
  const task = TaskApp.state.tasks.find((item) => item.id === taskId);
  TaskApp.state.submitTaskId = taskId;
  TaskApp.els.resultText.value = "";
  TaskApp.els.resultFile.value = "";
  TaskApp.els.submitSummary.innerHTML = renderSubmitSummary(task);
  TaskApp.els.submitDialog.showModal();
}

function renderSubmitSummary(task) {
  if (!task || !task.result_text) {
    return `<h3>最近一次进展摘要</h3><p class="muted">当前还没有提交过阶段进展。</p>`;
  }
  const file = task.result_file_name || "无";
  return `
    <h3>最近一次进展摘要</h3>
    <div class="summary-row"><span>处理说明</span><strong>${TaskApp.escapeHtml(task.result_text)}</strong></div>
    <div class="summary-row"><span>附件</span><strong>${TaskApp.escapeHtml(file)}</strong></div>
  `;
}

function renderDetailActions(task) {
  const me = TaskApp.state.currentUser.name;
  const actions = [`<button class="secondary" data-action="close" type="button">返回</button>`];
  if (TaskApp.isAdmin()) {
    actions.push(actionButton(task.id, "status", "改状态", "secondary"));
    actions.push(actionButton(task.id, "delete", "删除", "danger"));
  }
  if (task.assignee_name === me && ["待接单", "已退回"].includes(task.status)) {
    actions.push(actionButton(task.id, "accept", "接单", ""));
  } else if (task.assignee_name === me && ["处理中", "已退回", "待确认"].includes(task.status)) {
    actions.push(actionButton(task.id, "submit", "提交进展", ""));
  } else if (task.creator_name === me && task.status === "待确认") {
    actions.push(actionButton(task.id, "confirm", "确认完成", ""));
    actions.push(actionButton(task.id, "return", "退回", "danger"));
  }
  return actions.join("");
}

function bindDetailActions() {
  TaskApp.els.detailBody.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      TaskApp.closeDetailDialog();
      if (button.dataset.action !== "close") runTaskAction(button.dataset.action, Number(button.dataset.id));
    });
  });
  bindImagePreviewActions(TaskApp.els.detailBody);
}

function isImageAttachment(pathOrName) {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(pathOrName || "");
}

function imagePreviewButton(src, name, className) {
  const safeSrc = TaskApp.escapeHtml(src);
  const safeName = TaskApp.escapeHtml(name || "图片附件");
  return `
    <button class="${className}" type="button" data-preview-src="${safeSrc}" data-preview-name="${safeName}">
      <img src="${safeSrc}" alt="${safeName}" loading="lazy" decoding="async" fetchpriority="low" />
      <span>${safeName}</span>
    </button>
  `;
}

function renderInlineAttachment(src, name, text) {
  if (isImageAttachment(src) || isImageAttachment(name)) {
    return `　<button class="attachment-link" type="button" data-preview-src="${TaskApp.escapeHtml(src)}" data-preview-name="${TaskApp.escapeHtml(name || "图片附件")}">${text}</button>`;
  }
  return `　<a href="${TaskApp.escapeHtml(src)}" target="_blank" rel="noopener">${text}</a>`;
}

function renderAttachmentCard(src, name) {
  if (isImageAttachment(src) || isImageAttachment(name)) {
    return imagePreviewButton(src, name, "attachment-preview");
  }
  return `<a class="attachment-row" href="${TaskApp.escapeHtml(src)}" target="_blank" rel="noopener">附件：${TaskApp.escapeHtml(name || "查看附件")} ›</a>`;
}

function renderProgressAttachment(src, name) {
  if (isImageAttachment(src) || isImageAttachment(name)) {
    return imagePreviewButton(src, name || "阶段图片", "progress-preview");
  }
  return `<a class="attachment-row compact" href="${TaskApp.escapeHtml(src)}" target="_blank" rel="noopener">附件：${TaskApp.escapeHtml(name || "查看附件")} ›</a>`;
}

function bindImagePreviewActions(scope) {
  scope.querySelectorAll("[data-preview-src]").forEach((button) => {
    button.addEventListener("click", () => {
      TaskApp.openImagePreview(button.dataset.previewSrc, button.dataset.previewName);
    });
  });
}

async function returnTask(taskId) {
  const task = TaskApp.state.tasks.find((item) => item.id === taskId);
  TaskApp.state.returnTaskId = taskId;
  TaskApp.els.returnReason.value = "";
  TaskApp.els.returnSummary.innerHTML = renderReturnSummary(task);
  updateReturnCount();
  TaskApp.els.returnDialog.showModal();
}

function renderReturnSummary(task) {
  if (!task) return "<h3>任务摘要</h3><p>未找到任务信息</p>";
  return `
    <h3>任务摘要</h3>
    <div class="return-row"><span>任务名</span><strong>${TaskApp.escapeHtml(task.title)}</strong></div>
    <div class="return-row"><span>负责人</span><strong>${TaskApp.escapeHtml(task.assignee_name)}</strong></div>
    <div class="return-row"><span>当前状态</span><strong class="return-status">${TaskApp.escapeHtml(task.status)}</strong></div>
  `;
}

function useReturnReason(reason) {
  const current = TaskApp.els.returnReason.value.trim();
  TaskApp.els.returnReason.value = current ? `${current}；${reason}` : reason;
  updateReturnCount();
  TaskApp.els.returnReason.focus();
}

function updateReturnCount() {
  TaskApp.els.returnCount.textContent = `${TaskApp.els.returnReason.value.length}/300`;
}

async function submitReturn(event) {
  event.preventDefault();
  const reason = TaskApp.els.returnReason.value.trim();
  if (!reason) return TaskApp.showMessage("请填写退回原因");
  await postAction(TaskApp.state.returnTaskId, "return", { reason });
  TaskApp.els.returnDialog.close();
}

async function submitResult(event) {
  event.preventDefault();
  const file = TaskApp.els.resultFile.files[0];
  const payload = { resultText: TaskApp.els.resultText.value.trim() };
  if (file) Object.assign(payload, await readFilePayload(file));
  await postAction(TaskApp.state.submitTaskId, "submit", payload);
  TaskApp.els.submitDialog.close();
}

async function postAction(taskId, action, payload) {
  await TaskApp.api(`/api/tasks/${taskId}/${action}`, { method: "POST", body: JSON.stringify(payload) });
  TaskApp.showMessage("操作已保存");
  await TaskApp.loadTasks();
}

async function changeStatus(taskId) {
  const options = ["待接单", "处理中", "待确认", "已完成", "已退回"];
  const status = prompt(`请输入新状态：${options.join(" / ")}`);
  if (!status) return;
  if (!options.includes(status)) return TaskApp.showMessage("状态不正确");
  await postAction(taskId, "status", { status, note: "管理员变更状态" });
}

async function deleteTask(taskId) {
  if (!confirm("确认删除这个任务？删除后不可恢复。")) return;
  await postAction(taskId, "delete", {});
}

function readFilePayload(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ fileName: file.name, fileData: reader.result });
    reader.readAsDataURL(file);
  });
}

function badgeClass(status) {
  if (status === "已完成") return "done";
  if (status === "已退回") return "returned";
  return "";
}
