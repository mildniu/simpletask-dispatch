const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const PORT = 3027;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "simpletask-click-"));

function request(pathname) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${pathname}`, (res) => {
      res.resume();
      res.on("end", resolve);
    }).on("error", reject);
  });
}

async function waitForServer(child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("服务启动失败");
    try {
      await request("/api/auth/status");
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

async function login(page, username, password) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.fill("#authUsername", username);
  await page.fill("#authPassword", password);
  await page.click("#authSubmit");
  await page.waitForSelector("#appView:not(.hidden)", { timeout: 8000 });
}

async function seed(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.fill("#authUsername", "admin");
  await page.fill("#authPassword", "AdminPass123");
  await page.fill("#authName", "系统管理员");
  await page.click("#authSubmit");
  await page.waitForSelector("#appView:not(.hidden)", { timeout: 8000 });

  await page.evaluate(async () => {
    const headers = { "Content-Type": "application/json" };
    await fetch("/api/users", {
      method: "POST",
      headers,
      body: JSON.stringify({ username: "worker", password: "123456", name: "测试成员", role: "member", position: "测试岗位" }),
    });
    await fetch("/api/tasks", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "点击测试任务",
        description: "用于按钮点击测试",
        priority: "普通",
        dueDate: "2026-12-31T18:00",
        assigneeName: "测试成员",
      }),
    }).then((res) => res.json()).then(async ({ task }) => {
      const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8uT9wAAAABJRU5ErkJggg==";
      await fetch("/api/logout", { method: "POST", headers, body: "{}" });
      await fetch("/api/login", {
        method: "POST",
        headers,
        body: JSON.stringify({ username: "worker", password: "123456" }),
      });
      await fetch(`/api/tasks/${task.id}/accept`, { method: "POST", headers, body: "{}" });
      await fetch(`/api/tasks/${task.id}/submit`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          resultText: "图片附件提交",
          fileName: "preview-test.png",
          fileData: tinyPng,
        }),
      });
    });
  });
}

async function clickAndExpect(locator, expectation) {
  await locator.click();
  await expectation();
}

async function testMobile(page) {
  await login(page, "admin", "AdminPass123");
  await clickAndExpect(page.locator("#navCreate"), async () => {
    await page.waitForSelector("#createView:not(.hidden)");
  });
  await assertActive(page, ".bottom-nav [data-page='create']");
  assert.equal(await page.locator("#appTopbar").evaluate((el) => el.classList.contains("hidden")), true);

  await clickAndExpect(page.locator("#openStats"), async () => {
    await page.waitForSelector("#statsView:not(.hidden)");
  });
  await assertActive(page, ".bottom-nav [data-page='stats']");
  await page.locator(".bottom-nav [data-page='tasks']").click();
  assert.equal(await page.locator("#appTopbar").evaluate((el) => el.classList.contains("hidden")), false);

  await page.locator(".tab[data-filter='mine']").click();
  await assertActive(page, ".tab[data-filter='mine']");
  await page.locator(".tab[data-filter='sent']").click();
  await assertActive(page, ".tab[data-filter='sent']");
  await page.locator(".tab[data-filter='all']").click();
  await assertActive(page, ".tab[data-filter='all']");

  await clickAndExpect(page.locator("[data-action='detail']").first(), async () => {
    await page.waitForSelector("#detailDialog[open]");
  });
  await page.waitForSelector(".attachment-preview img", { timeout: 5000 });
  await page.locator(".attachment-preview").first().click();
  await page.waitForSelector("#imagePreviewOverlay:not(.hidden)", { timeout: 5000 });
  assert.equal(await page.locator("#imagePreviewImg").getAttribute("src"), await page.locator(".attachment-preview img").first().getAttribute("src"));
  await page.click("#closeImagePreview");
  await page.waitForFunction(() => document.querySelector("#imagePreviewOverlay").classList.contains("hidden"));
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector("#detailDialog").open);

  await clickAndExpect(page.locator("#userManage"), async () => {
    await page.waitForSelector("#userDialog[open]");
  });
  await page.click("#showUserForm");
  await assert.equal(await page.locator("#userForm").evaluate((el) => el.classList.contains("collapsed")), false);
  await page.click("#closeUsers");

  await clickAndExpect(page.locator("#navMine"), async () => {
    await page.waitForSelector("#mineView:not(.hidden)");
  });
  await assert.equal(await page.locator("#profilePhone").inputValue(), "admin");
  await assertActive(page, ".bottom-nav [data-page='mine']");
}

async function assertActive(page, selector) {
  assert.equal(await page.locator(selector).evaluate((el) => el.classList.contains("active")), true);
}

async function testAdminPage(page) {
  await page.goto(`${BASE_URL}/admin.html`, { waitUntil: "domcontentloaded" });
  await page.fill("#adminUsername", "admin");
  await page.fill("#adminPassword", "AdminPass123");
  await page.click("button[type='submit']");
  await page.waitForSelector("#adminApp:not(.hidden)", { timeout: 8000 });

  await page.click("[data-admin-tab='tasks']");
  await page.waitForSelector("#tasksView:not(.hidden)");
  await page.fill("#taskSearch", "点击测试");
  assert.ok(await page.locator("#adminTaskRows tr").count() >= 1);

  await clickAndExpect(page.locator("[data-task-action='detail']").first(), async () => {
    await page.waitForSelector("#taskDrawer:not(.hidden)");
  });
  await page.click("#closeDrawer");

  page.once("dialog", (dialog) => dialog.accept("处理中"));
  await page.locator("[data-task-action='status']").first().click();
  await page.waitForTimeout(300);

  await page.click("[data-admin-tab='users']");
  await page.waitForSelector("#usersView:not(.hidden)");
  await page.fill("#adminUserSearch", "测试成员");
  assert.ok(await page.locator("#adminUserRows tr").count() >= 1);

  await page.click("#showCreateUser");
  await assert.equal(await page.locator("#createUserForm").evaluate((el) => el.classList.contains("hidden")), false);
}

async function main() {
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_DIR_OVERRIDE: tempDir, UPLOAD_DIR_OVERRIDE: tempDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let browser;
  try {
    await waitForServer(child);
    browser = await chromium.launch();
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await seed(mobile);
    await mobile.close();

    const mobileTest = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await testMobile(mobileTest);
    await mobileTest.close();

    const adminTest = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await testAdminPage(adminTest);
    await adminTest.close();
    console.log("click-test=passed");
  } finally {
    if (browser) await browser.close();
    await stopServer(child);
    removeTempDir(tempDir);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
