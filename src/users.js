const crypto = require("node:crypto");

const ROLES = {
  ADMIN: "admin",
  MANAGER: "manager",
  SUPERVISOR: "supervisor",
  BRANCH: "branch",
  MEMBER: "member",
};

const ACTIVE = "active";
const DISABLED = "disabled";
const ITERATIONS = 120000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";
const SESSION_DAYS = 7;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");
  return `${ITERATIONS}:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [iterations, salt, hash] = stored.split(":");
  const candidate = crypto.pbkdf2Sync(password, salt, Number(iterations), KEY_LENGTH, DIGEST).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

function countUsers(db) {
  return db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
}

function createUser(db, input) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO users (username, password_hash, name, role, status, position, avatar_data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    input.username,
    hashPassword(input.password),
    input.name,
    input.role,
    input.status || ACTIVE,
    input.position || "",
    input.avatarData || "",
    now,
    now,
  );
  return getUser(db, result.lastInsertRowid);
}

function listUsers(db) {
  return db.prepare(`
    SELECT id, username, name, role, status, created_at, updated_at
         , position, avatar_data
    FROM users
    ORDER BY status ASC, id ASC
  `).all();
}

function listActiveUsers(db) {
  return db.prepare(`
    SELECT id, username, name, role, status
         , position, avatar_data
    FROM users
    WHERE status = ?
    ORDER BY role ASC, name ASC
  `).all(ACTIVE);
}

function getUser(db, id) {
  return db.prepare(`
    SELECT id, username, name, role, status, created_at, updated_at
         , position, avatar_data
    FROM users WHERE id = ?
  `).get(id);
}

function findUserByUsername(db, username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
}

function updateUser(db, id, input) {
  const current = getUser(db, id);
  if (!current) throw new Error("用户不存在");
  const next = { ...current, ...input, updated_at: new Date().toISOString() };
  db.prepare("UPDATE users SET name = ?, role = ?, status = ?, position = ?, avatar_data = ?, updated_at = ? WHERE id = ?")
    .run(next.name, next.role, next.status, next.position || "", next.avatar_data || next.avatarData || "", next.updated_at, id);
  if (input.password) updatePassword(db, id, input.password);
  return getUser(db, id);
}

function updatePassword(db, id, password) {
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .run(hashPassword(password), new Date().toISOString(), id);
}

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
  db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(token, userId, now.toISOString(), expires.toISOString());
  return token;
}

function getUserBySession(db, token) {
  if (!token) return null;
  return db.prepare(`
    SELECT users.id, users.username, users.name, users.role, users.status, users.position, users.avatar_data
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ? AND sessions.expires_at > ? AND users.status = ?
  `).get(token, new Date().toISOString(), ACTIVE) || null;
}

function deleteSession(db, token) {
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

function updateProfile(db, id, input) {
  const current = getUser(db, id);
  if (!current) throw new Error("用户不存在");
  const username = input.username || current.username;
  db.prepare("UPDATE users SET username = ?, avatar_data = ?, updated_at = ? WHERE id = ?")
    .run(username, input.avatarData ?? current.avatar_data ?? "", new Date().toISOString(), id);
  if (input.password) updatePassword(db, id, input.password);
  return getUser(db, id);
}

module.exports = {
  ROLES,
  ACTIVE,
  DISABLED,
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
};
