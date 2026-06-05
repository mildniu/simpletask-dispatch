# 内部派单系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个本地运行的内部点对点派单系统。

**Architecture:** Node.js 提供本地 HTTP 服务和 API，`node:sqlite` 保存任务、用户、会话和流转数据，前端使用原生 HTML、CSS、JavaScript。当前版本使用账号密码和用户管理，`员工花名册.csv` 用于批量导入用户；任务附件保存到 `uploads`。

**Tech Stack:** Node.js, `node:sqlite`, HTML, CSS, JavaScript.

---

### Task 1: 项目骨架

**Files:**
- Create: `package.json`
- Create: `src/config.js`

- [x] 创建运行脚本和路径配置。
- [x] 确认 `node src/server.js` 是启动入口。

### Task 2: 员工花名册读取

**Files:**
- Create: `src/roster.js`

- [x] 读取 `员工花名册.csv`。
- [x] 解析姓名、部门、职位、手机号、状态。
- [x] 只返回在职员工。
- [x] 标记管理类岗位。
- [x] 当前主流程改为内建账号体系，花名册读取模块保留但服务端未接入登录流程。

### Task 3: 数据库

**Files:**
- Create: `src/db.js`

- [x] 初始化 `data/tasks.db`。
- [x] 创建任务表、流转记录表、进展表、用户表和会话表。
- [x] 实现创建任务、查询任务、更新状态、记录流转。

### Task 4: HTTP 服务与 API

**Files:**
- Create: `src/server.js`

- [x] 提供静态页面。
- [x] 提供登录、初始化系统管理员、用户管理和负责人列表 API。
- [x] 提供任务创建、查询、接单、提交、确认、退回 API。
- [x] 保存结果附件到 `uploads`。

### Task 5: 前端界面

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`

- [x] 做账号登录和首次初始化界面。
- [x] 做任务创建表单。
- [x] 做“我的任务”和“我派出的任务”列表。
- [x] 支持接单、提交结果、确认完成、退回。
- [x] 增加任务详情、阶段进展、统计页和用户管理界面。

### Task 6: 验证

**Commands:**
- `node --check src/server.js`
- `node --check src/db.js`
- `node --check src/roster.js`
- `node --check public/app.js`
- `node scripts/smoke-flow.js`
- 启动服务后调用关键 API。

- [x] 验证语法。
- [x] 验证负责人列表。
- [x] 验证创建、接单、提交、退回、再次提交和确认流程。
- [x] 说明当前不是 `git` 仓库，跳过提交。

### 当前下一步

- [ ] 做一次浏览器端移动端冒烟，确认主要弹窗、按钮和统计页在真页面上可用。
- [ ] 决定是否彻底移除花名册登录设想，或增加“从花名册导入用户”功能。
- [ ] 视实际使用需要补充任务筛选、搜索、附件大小校验和错误提示优化。
