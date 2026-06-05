const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const { DATA_DIR, DB_PATH } = require("./config");

const STATUSES = {
  PENDING: "待接单",
  DOING: "处理中",
  REVIEW: "待确认",
  DONE: "已完成",
  RETURNED: "已退回",
};

function openDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON");
  initialize(db);
  return db;
}

function initialize(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL,
      due_date TEXT NOT NULL,
      creator_name TEXT NOT NULL,
      assignee_name TEXT NOT NULL,
      status TEXT NOT NULL,
      result_text TEXT,
      result_file_name TEXT,
      result_file_path TEXT,
      return_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      actor_name TEXT NOT NULL,
      result_text TEXT NOT NULL,
      result_file_name TEXT,
      result_file_path TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      position TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  migrate(db);
}

function migrate(db) {
  const columns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
  if (!columns.includes("position")) {
    db.exec("ALTER TABLE users ADD COLUMN position TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.includes("avatar_data")) {
    db.exec("ALTER TABLE users ADD COLUMN avatar_data TEXT NOT NULL DEFAULT ''");
  }
}

function createTask(db, input) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO tasks
      (title, description, priority, due_date, creator_name, assignee_name, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    input.title,
    input.description,
    input.priority,
    input.dueDate,
    input.creatorName,
    input.assigneeName,
    STATUSES.PENDING,
    now,
    now,
  );
  addEvent(db, result.lastInsertRowid, input.creatorName, "创建任务", input.title);
  return getTask(db, result.lastInsertRowid);
}

function listTasks(db, userName, canViewAll) {
  if (canViewAll) {
    return db.prepare("SELECT * FROM tasks ORDER BY updated_at DESC, id DESC").all();
  }

  return db.prepare(`
    SELECT * FROM tasks
    WHERE creator_name = ? OR assignee_name = ?
    ORDER BY updated_at DESC, id DESC
  `).all(userName, userName);
}

function getTask(db, taskId) {
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
}

function listEvents(db, taskId) {
  return db.prepare(`
    SELECT actor_name, action, note, created_at
    FROM task_events
    WHERE task_id = ?
    ORDER BY id ASC
  `).all(taskId);
}

function listProgress(db, taskId) {
  return db.prepare(`
    SELECT actor_name, result_text, result_file_name, result_file_path, created_at
    FROM task_progress
    WHERE task_id = ?
    ORDER BY id ASC
  `).all(taskId);
}

function updateStatus(db, taskId, actorName, status, note) {
  const now = new Date().toISOString();
  db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(status, now, taskId);
  addEvent(db, taskId, actorName, status, note || "");
  return getTask(db, taskId);
}

function submitTask(db, taskId, actorName, input) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO task_progress
      (task_id, actor_name, result_text, result_file_name, result_file_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(taskId, actorName, input.resultText, input.fileName, input.filePath, now);
  db.prepare(`
    UPDATE tasks
    SET status = ?, result_text = ?, result_file_name = ?, result_file_path = ?,
        return_reason = NULL, updated_at = ?
    WHERE id = ?
  `).run(STATUSES.REVIEW, input.resultText, input.fileName, input.filePath, now, taskId);
  addEvent(db, taskId, actorName, "提交结果", input.resultText);
  return getTask(db, taskId);
}

function returnTask(db, taskId, actorName, reason) {
  const now = new Date().toISOString();
  db.prepare("UPDATE tasks SET status = ?, return_reason = ?, updated_at = ? WHERE id = ?")
    .run(STATUSES.RETURNED, reason, now, taskId);
  addEvent(db, taskId, actorName, "退回任务", reason);
  return getTask(db, taskId);
}

function deleteTask(db, taskId, actorName) {
  addEvent(db, taskId, actorName, "删除任务", "");
  db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
}

function addEvent(db, taskId, actorName, action, note) {
  db.prepare(`
    INSERT INTO task_events (task_id, actor_name, action, note, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(taskId, actorName, action, note, new Date().toISOString());
}

module.exports = {
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
};
