const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { PUBLIC_DIR, UPLOAD_DIR, PORT } = require("./config");
const {
  STATUSES,
  openDatabase,
  createTask,
  listTasks,
  getTask,
  listEvents,
  listProgress,
  updateStatus,
  submitTask,
  returnTask,
  deleteTask,
} = require("./db");
const {
  ROLES,
  ACTIVE,
  countUsers,
  createUser,
  listUsers,
  listActiveUsers,
  findUserByUsername,
  verifyPassword,
  updateUser,
  updateProfile,
  createSession,
  getUserBySession,
  deleteSession,
} = require("./users");
const db = openDatabase();
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}
function notFound(res) {
  sendJson(res, 404, { error: "未找到资源" });
}
function getSessionToken(req) {
  const cookie = req.headers.cookie || "";
  const found = cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("sid="));
  return found ? found.slice(4) : "";
}
function requireAuth(req) {
  const user = getUserBySession(db, getSessionToken(req));
  if (!user) throw new Error("请先登录");
  return user;
}
function requireAdmin(user) {
  if (!isAdmin(user)) throw new Error("需要系统管理员权限");
}
function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 12 * 1024 * 1024) reject(new Error("请求内容过大"));
    });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}
function requireFields(input, fields) {
  const missing = fields.filter((field) => !String(input[field] || "").trim());
  if (missing.length) throw new Error(`缺少字段：${missing.join(", ")}`);
}
function ensureTaskUser(task, userName, role) {
  if (!task) throw new Error("任务不存在");
  if (role === "assignee" && task.assignee_name !== userName) throw new Error("只能处理分配给自己的任务");
  if (role === "creator" && task.creator_name !== userName) throw new Error("只能确认自己派出的任务");
}
function ensureCanViewTask(task, user) {
  if (!task) throw new Error("任务不存在");
  if (isAdmin(user)) return;
  if (task.creator_name === user.name || task.assignee_name === user.name) return;
  throw new Error("只能查看和自己相关的任务");
}
function getRoute(req) {
  const url = new URL(req.url, "http://localhost");
  return { url, parts: url.pathname.split("/").filter(Boolean) };
}

async function handleApi(req, res, route) {
  if (await handlePublicApi(req, res, route)) return;
  const user = requireAuth(req);

  if (await handleUserApi(req, res, route, user)) return;
  if (await handleTaskApi(req, res, route, user)) return;
  notFound(res);
}

async function handlePublicApi(req, res, route) {
  if (req.method === "GET" && route.url.pathname === "/api/auth/status") {
    sendJson(res, 200, { initialized: countUsers(db) > 0, user: getUserBySession(db, getSessionToken(req)) });
    return true;
  }
  if (req.method === "POST" && route.url.pathname === "/api/setup") {
    if (countUsers(db) > 0) throw new Error("系统已初始化");
    const input = await readJson(req);
    requireFields(input, ["username", "password", "name"]);
    const user = createUser(db, { ...input, role: ROLES.ADMIN, status: ACTIVE, position: "系统管理员" });
    setSessionCookie(res, createSession(db, user.id));
    sendJson(res, 201, { user });
    return true;
  }
  if (req.method === "POST" && route.url.pathname === "/api/login") {
    await login(req, res);
    return true;
  }
  if (req.method === "POST" && route.url.pathname === "/api/logout") {
    deleteSession(db, getSessionToken(req));
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return true;
  }
  return false;
}

async function login(req, res) {
  const input = await readJson(req);
  const user = findUserByUsername(db, input.username || "");
  const ok = user && user.status === ACTIVE && verifyPassword(input.password || "", user.password_hash);
  if (!ok) throw new Error("账号或密码不正确");
  setSessionCookie(res, createSession(db, user.id));
  sendJson(res, 200, { user: sanitizeUser(user) });
}

async function handleUserApi(req, res, route, user) {
  if (req.method === "POST" && route.url.pathname === "/api/profile") {
    const input = await readJson(req);
    sendJson(res, 200, { user: sanitizeUser(updateOwnProfile(user, input)) });
    return true;
  }
  if (req.method === "GET" && route.url.pathname === "/api/users/assignees") {
    sendJson(res, 200, { users: listActiveUsers(db) });
    return true;
  }
  if (req.method === "GET" && route.url.pathname === "/api/users") {
    requireAdmin(user);
    sendJson(res, 200, { users: listUsers(db) });
    return true;
  }
  if (req.method === "POST" && route.url.pathname === "/api/users") {
    requireAdmin(user);
    const input = await readJson(req);
    requireFields(input, ["username", "password", "name", "role"]);
    sendJson(res, 201, { user: createUser(db, normalizeUserInput(input)) });
    return true;
  }
  if (req.method === "POST" && isUserUpdateRoute(route)) {
    requireAdmin(user);
    const input = await readJson(req);
    sendJson(res, 200, { user: updateUser(db, Number(route.parts[2]), normalizeUserInput(input, true)) });
    return true;
  }
  return false;
}

async function handleTaskApi(req, res, route, user) {
  if (req.method === "GET" && route.url.pathname === "/api/tasks") {
    sendJson(res, 200, { tasks: listTasks(db, user.name, canViewAllTasks(user)) });
    return true;
  }
  if (req.method === "GET" && isTaskEventsRoute(route)) {
    const taskId = Number(route.parts[2]);
    const task = getTask(db, taskId);
    ensureCanViewTask(task, user);
    sendJson(res, 200, { task, events: listEvents(db, taskId), progress: listProgress(db, taskId) });
    return true;
  }
  if (req.method === "POST" && route.url.pathname === "/api/tasks") {
    const input = await readJson(req);
    requireFields(input, ["title", "description", "dueDate"]);
    const assigneeNames = normalizeAssigneeNames(input);
    if (assigneeNames.length > 1 && !canCreateMultiAssigneeTasks(user)) {
      throw new Error("当前角色只能选择一名负责人");
    }
    const tasks = assigneeNames.map((assigneeName) => createTask(db, normalizeTaskInput({ ...input, assigneeName }, user)));
    sendJson(res, 201, { task: tasks[0], tasks });
    return true;
  }
  return await handleTaskAction(req, res, route, user);
}
async function handleTaskAction(req, res, route, user) {
  const match = route.parts.length === 4 && route.parts[0] === "api" && route.parts[1] === "tasks";
  if (!match || req.method !== "POST") return false;

  const taskId = Number(route.parts[2]);
  const action = route.parts[3];
  const input = await readJson(req);
  const task = getTask(db, taskId);

  if (action === "accept") handleAccept(res, task, taskId, user.name);
  else if (action === "submit") handleSubmit(res, task, taskId, user.name, input);
  else if (action === "confirm") handleConfirm(res, task, taskId, user);
  else if (action === "return") handleReturn(res, task, taskId, user, input);
  else if (action === "status") handleAdminStatus(res, task, taskId, user, input);
  else if (action === "delete") handleAdminDelete(res, task, taskId, user);
  else return false;
  return true;
}

function handleAccept(res, task, taskId, userName) {
  ensureTaskUser(task, userName, "assignee");
  if (![STATUSES.PENDING, STATUSES.RETURNED].includes(task.status)) throw new Error("当前状态不能接单");
  sendJson(res, 200, { task: updateStatus(db, taskId, userName, STATUSES.DOING, "接单") });
}

function handleSubmit(res, task, taskId, userName, input) {
  requireFields(input, ["resultText"]);
  ensureTaskUser(task, userName, "assignee");
  if (![STATUSES.DOING, STATUSES.RETURNED, STATUSES.REVIEW].includes(task.status)) throw new Error("当前状态不能提交");
  const file = saveResultFile(taskId, input.fileName, input.fileData);
  sendJson(res, 200, { task: submitTask(db, taskId, userName, { resultText: input.resultText, ...file }) });
}

function handleConfirm(res, task, taskId, user) {
  if (!isAdmin(user)) ensureTaskUser(task, user.name, "creator");
  if (task.status !== STATUSES.REVIEW) throw new Error("只有待确认任务可以完成");
  sendJson(res, 200, { task: updateStatus(db, taskId, user.name, STATUSES.DONE, "确认完成") });
}

function handleReturn(res, task, taskId, user, input) {
  requireFields(input, ["reason"]);
  if (!isAdmin(user)) ensureTaskUser(task, user.name, "creator");
  if (task.status !== STATUSES.REVIEW) throw new Error("只有待确认任务可以退回");
  sendJson(res, 200, { task: returnTask(db, taskId, user.name, input.reason) });
}

function handleAdminStatus(res, task, taskId, user, input) {
  requireAdmin(user);
  if (!Object.values(STATUSES).includes(input.status)) throw new Error("状态不正确");
  ensureCanViewTask(task, user);
  sendJson(res, 200, { task: updateStatus(db, taskId, user.name, input.status, input.note || "管理员变更状态") });
}

function handleAdminDelete(res, task, taskId, user) {
  requireAdmin(user);
  ensureCanViewTask(task, user);
  deleteTask(db, taskId, user.name);
  sendJson(res, 200, { ok: true });
}

function saveResultFile(taskId, fileName, fileData) {
  if (!fileName || !fileData) return { fileName: "", filePath: "" };
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, "_");
  const storedName = `${taskId}-${Date.now()}-${safeName}`;
  const targetPath = path.join(UPLOAD_DIR, storedName);
  const base64 = fileData.includes(",") ? fileData.split(",").pop() : fileData;
  fs.writeFileSync(targetPath, Buffer.from(base64, "base64"));
  return { fileName, filePath: `/uploads/${storedName}` };
}

function normalizeTaskInput(input, user) {
  return {
    title: input.title.trim(),
    description: input.description.trim(),
    priority: input.priority || "普通",
    dueDate: input.dueDate,
    creatorName: user.name,
    assigneeName: input.assigneeName,
  };
}

function normalizeAssigneeNames(input) {
  const names = Array.isArray(input.assigneeNames) ? input.assigneeNames : [input.assigneeName];
  const unique = [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
  if (!unique.length) throw new Error("请选择负责人");
  return unique;
}

function normalizeUserInput(input, partial = false) {
  const output = {};
  for (const key of ["username", "password", "name", "role", "status", "position"]) {
    if (!partial || input[key]) output[key] = String(input[key] || "").trim();
  }
  if (!partial && !output.status) output.status = ACTIVE;
  return output;
}

function updateOwnProfile(user, input) {
  const nextUsername = String(input.username || user.username).trim();
  if (!nextUsername) throw new Error("手机号不能为空");
  if (nextUsername !== user.username && findUserByUsername(db, nextUsername)) {
    throw new Error("手机号已被占用");
  }
  const payload = { username: nextUsername };
  if (input.password) payload.password = String(input.password);
  if (input.avatarData !== undefined) payload.avatarData = String(input.avatarData || "");
  return updateProfile(db, user.id, payload);
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    status: user.status,
    position: user.position || "",
    avatarData: user.avatar_data || "",
  };
}

function canViewAllTasks(user) {
  return isAdmin(user);
}

function isAdmin(user) {
  return user.role === ROLES.ADMIN;
}

function canCreateMultiAssigneeTasks(user) {
  return [ROLES.ADMIN, ROLES.MANAGER, ROLES.SUPERVISOR].includes(user.role);
}

function isUserUpdateRoute(route) {
  return route.parts.length === 4 && route.parts[0] === "api" && route.parts[1] === "users" && route.parts[3] === "update";
}

function isTaskEventsRoute(route) {
  return route.parts.length === 4 && route.parts[0] === "api" && route.parts[1] === "tasks" && route.parts[3] === "events";
}

function serveStatic(req, res, route) {
  const requestPath = route.url.pathname === "/" ? "/index.html" : decodeURIComponent(route.url.pathname);
  const baseDir = requestPath.startsWith("/uploads/") ? UPLOAD_DIR : PUBLIC_DIR;
  const relativePath = requestPath.replace(/^\/uploads\//, "").replace(/^\//, "");
  const filePath = path.resolve(baseDir, relativePath);
  if (!filePath.startsWith(baseDir) || !fs.existsSync(filePath)) return notFound(res);
  const stat = fs.statSync(filePath);
  const etag = `"${stat.size}-${Number(stat.mtimeMs)}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304);
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": getContentType(filePath),
    "Content-Length": stat.size,
    "ETag": etag,
    "Cache-Control": requestPath.startsWith("/uploads/")
      ? "public, max-age=31536000, immutable"
      : "no-store, no-cache, must-revalidate",
  });
  fs.createReadStream(filePath).pipe(res);
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
  };
  return types[ext] || "application/octet-stream";
}

async function handleRequest(req, res) {
  const route = getRoute(req);
  try {
    if (route.url.pathname.startsWith("/api/")) await handleApi(req, res, route);
    else serveStatic(req, res, route);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

http.createServer(handleRequest).listen(PORT, () => {
  console.log(`派单系统已启动：http://127.0.0.1:${PORT}`);
});
