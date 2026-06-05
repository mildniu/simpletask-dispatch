const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PORT = 3017;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "simpletask-smoke-"));

function request(method, pathname, body, cookie = "") {
  const payload = body ? JSON.stringify(body) : "";
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE_URL}${pathname}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        Cookie: cookie,
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        const parsed = data ? JSON.parse(data) : {};
        if (res.statusCode >= 400) {
          reject(new Error(`${method} ${pathname} ${res.statusCode}: ${parsed.error || data}`));
          return;
        }
        resolve({ data: parsed, headers: res.headers });
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}

function requestRaw(pathname, cookie = "", headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE_URL}${pathname}`, {
      method: "GET",
      headers: { Cookie: cookie, ...headers },
    }, (res) => {
      let length = 0;
      res.on("data", (chunk) => { length += chunk.length; });
      res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, length }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForServer(child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("服务启动失败");
    try {
      await request("GET", "/api/auth/status");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error("等待服务启动超时");
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    child.kill();
    setTimeout(resolve, 2000);
  });
}

function removeTempDir(dir) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

function cookieFrom(headers) {
  const cookie = headers["set-cookie"] && headers["set-cookie"][0];
  assert.ok(cookie, "响应中应包含登录 Cookie");
  return cookie.split(";")[0];
}

async function main() {
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_DIR_OVERRIDE: tempDir },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(child);
    const setup = await request("POST", "/api/setup", {
      username: "admin",
      password: "SmokePass123",
      name: "验收管理员",
    });
    const adminCookie = cookieFrom(setup.headers);

    await request("POST", "/api/users", {
      username: "worker",
      password: "SmokePass123",
      name: "验收负责人",
      role: "member",
      position: "验收成员",
    }, adminCookie);
    await request("POST", "/api/users", {
      username: "other",
      password: "SmokePass123",
      name: "无关人员",
      role: "member",
      position: "验收成员",
    }, adminCookie);

    const assignees = await request("GET", "/api/users/assignees", null, adminCookie);
    assert.equal(assignees.data.users.some((user) => user.name === "验收负责人"), true);

    const created = await request("POST", "/api/tasks", {
      title: "验收任务",
      description: "验证创建、接单、提交、退回、再次提交和确认流程",
      dueDate: "2026-12-31T18:00",
      priority: "普通",
      assigneeName: "验收负责人",
    }, adminCookie);
    assert.equal(created.data.task.status, "待接单");

    const login = await request("POST", "/api/login", {
      username: "worker",
      password: "SmokePass123",
    });
    const workerCookie = cookieFrom(login.headers);
    const otherLogin = await request("POST", "/api/login", {
      username: "other",
      password: "SmokePass123",
    });
    const otherCookie = cookieFrom(otherLogin.headers);
    const otherTasks = await request("GET", "/api/tasks", null, otherCookie);
    assert.equal(otherTasks.data.tasks.length, 0);

    const accepted = await request("POST", `/api/tasks/${created.data.task.id}/accept`, {}, workerCookie);
    assert.equal(accepted.data.task.status, "处理中");

    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8uT9wAAAABJRU5ErkJggg==";
    const submitted = await request("POST", `/api/tasks/${created.data.task.id}/submit`, {
      resultText: "第一轮提交",
      fileName: "smoke-preview.png",
      fileData: tinyPng,
    }, workerCookie);
    assert.equal(submitted.data.task.status, "待确认");
    assert.match(submitted.data.task.result_file_path, /^\/uploads\//);

    const uploaded = await requestRaw(submitted.data.task.result_file_path, workerCookie);
    assert.equal(uploaded.statusCode, 200);
    assert.equal(uploaded.headers["content-type"], "image/png");
    assert.match(uploaded.headers["cache-control"], /max-age=31536000/);
    assert.ok(uploaded.headers.etag);
    const cached = await requestRaw(submitted.data.task.result_file_path, workerCookie, { "If-None-Match": uploaded.headers.etag });
    assert.equal(cached.statusCode, 304);

    const returned = await request("POST", `/api/tasks/${created.data.task.id}/return`, {
      reason: "需要补充说明",
    }, adminCookie);
    assert.equal(returned.data.task.status, "已退回");

    const resubmitted = await request("POST", `/api/tasks/${created.data.task.id}/submit`, {
      resultText: "补充后再次提交",
    }, workerCookie);
    assert.equal(resubmitted.data.task.status, "待确认");

    const confirmed = await request("POST", `/api/tasks/${created.data.task.id}/confirm`, {}, adminCookie);
    assert.equal(confirmed.data.task.status, "已完成");
    const reopened = await request("POST", `/api/tasks/${created.data.task.id}/status`, {
      status: "处理中",
      note: "验收改状态",
    }, adminCookie);
    assert.equal(reopened.data.task.status, "处理中");

    const detail = await request("GET", `/api/tasks/${created.data.task.id}/events`, null, adminCookie);
    assert.equal(detail.data.events.length >= 6, true);
    assert.equal(detail.data.progress.length, 2);
    await request("POST", `/api/tasks/${created.data.task.id}/delete`, {}, adminCookie);
    console.log("smoke-flow=passed");
  } finally {
    await stopServer(child);
    removeTempDir(tempDir);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
