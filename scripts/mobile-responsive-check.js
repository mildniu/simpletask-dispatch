const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 3028);
const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const TEST_USERNAME = process.env.TEST_USERNAME || "admin";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "AdminPass123";
const OUT_DIR = path.resolve(__dirname, "..", "screenshots", "responsive");
const VIEWPORTS = [
  { name: "w360", width: 360, height: 800 },
  { name: "w390", width: 390, height: 844 },
  { name: "w430", width: 430, height: 932 },
  { name: "tablet768", width: 768, height: 1024 },
];

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
    if (!child || child.exitCode !== null) return resolve();
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

async function seed(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.fill("#authUsername", TEST_USERNAME);
  await page.fill("#authPassword", TEST_PASSWORD);
  await page.fill("#authName", "验收管理员");
  await page.click("#authSubmit");
  await page.waitForSelector("#appView:not(.hidden)", { timeout: 8000 });
  await page.evaluate(async () => {
    const headers = { "Content-Type": "application/json" };
    await fetch("/api/users", {
      method: "POST",
      headers,
      body: JSON.stringify({ username: "worker", password: "123456", name: "验收成员", role: "member", position: "测试岗位" }),
    });
    await fetch("/api/tasks", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "移动端验收任务",
        description: "用于检查 Vant 风格移动端界面、任务详情和底部导航。",
        priority: "普通",
        dueDate: "2026-12-31T18:00",
        assigneeName: "验收成员",
      }),
    });
  });
}

async function login(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.fill("#authUsername", TEST_USERNAME);
  await page.fill("#authPassword", TEST_PASSWORD);
  await Promise.all([
    page.waitForSelector("#appView:not(.hidden)", { timeout: 8000 }),
    page.click("#authSubmit"),
  ]);
}

async function checkOverflow(page) {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const docOverflow = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - viewport;
    const elements = Array.from(document.querySelectorAll("body *"))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id,
          className: String(el.className || ""),
          text: (el.innerText || "").trim().slice(0, 40),
          right: Math.round(rect.right),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
        };
      })
      .filter((item) => item.width > 0 && (item.right > viewport + 1 || item.left < -1))
      .slice(0, 12);
    return { viewport, docOverflow, elements };
  });
}

async function captureViewport(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    isMobile: viewport.width < 768,
    hasTouch: viewport.width < 768,
  });
  const page = await context.newPage();
  const result = { viewport: viewport.name, width: viewport.width, checks: [] };

  await login(page);
  await page.screenshot({ path: path.join(OUT_DIR, `${viewport.name}-home.png`), fullPage: true });
  result.checks.push({ page: "home", ...(await checkOverflow(page)) });

  await page.click("[data-page='stats']");
  await page.waitForSelector("#statsView:not(.hidden)", { timeout: 5000 });
  await page.screenshot({ path: path.join(OUT_DIR, `${viewport.name}-stats.png`), fullPage: true });
  result.checks.push({ page: "stats", ...(await checkOverflow(page)) });

  await page.click("[data-page='create']");
  await page.waitForSelector("#createView:not(.hidden)", { timeout: 5000 });
  await page.screenshot({ path: path.join(OUT_DIR, `${viewport.name}-create.png`), fullPage: true });
  result.checks.push({ page: "create", ...(await checkOverflow(page)) });
  await page.click("[data-page='tasks']");

  const detailButton = page.locator("[data-action='detail']").first();
  if (await detailButton.count()) {
    await detailButton.click();
    await page.waitForSelector("#detailDialog[open]", { timeout: 5000 });
    await page.screenshot({ path: path.join(OUT_DIR, `${viewport.name}-detail.png`), fullPage: true });
    result.checks.push({ page: "detail", ...(await checkOverflow(page)) });
    await page.click("#closeDetail");
  }

  await page.click("#navMine");
  await page.waitForSelector("#mineView:not(.hidden)", { timeout: 5000 });
  await page.screenshot({ path: path.join(OUT_DIR, `${viewport.name}-mine.png`), fullPage: true });
  result.checks.push({ page: "mine", ...(await checkOverflow(page)) });

  await context.close();
  return result;
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "simpletask-mobile-"));
  let child;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  try {
    if (!process.env.BASE_URL) {
      child = spawn(process.execPath, ["src/server.js"], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(PORT), DATA_DIR_OVERRIDE: tempDir, UPLOAD_DIR_OVERRIDE: tempDir },
        stdio: ["ignore", "pipe", "pipe"],
      });
      await waitForServer(child);
      const setupPage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await seed(setupPage);
      await setupPage.close();
    }
    for (const viewport of VIEWPORTS) {
      results.push(await captureViewport(browser, viewport));
    }
  } finally {
    await browser.close();
    await stopServer(child);
    removeTempDir(tempDir);
  }
  const reportPath = path.join(OUT_DIR, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  const failures = results.flatMap((result) => result.checks
    .filter((check) => check.docOverflow > 1 || check.elements.length)
    .map((check) => `${result.viewport}/${check.page}: overflow=${check.docOverflow}, elements=${check.elements.length}`));
  console.log(`report=${reportPath}`);
  if (failures.length) {
    console.log(failures.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("mobile-responsive=passed");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
