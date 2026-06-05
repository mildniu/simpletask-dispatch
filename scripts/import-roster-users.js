const { openDatabase } = require("../src/db");
const { ROSTER_PATH } = require("../src/config");
const { getActiveEmployees } = require("../src/roster");
const { ACTIVE, ROLES, createUser, findUserByUsername } = require("../src/users");

const DEFAULT_PASSWORD = process.env.DEFAULT_USER_PASSWORD || "123456";
const FORCED_MANAGER_NAMES = readNameSet(process.env.FORCED_MANAGER_NAMES);
const FORCED_SUPERVISOR_NAMES = readNameSet(process.env.FORCED_SUPERVISOR_NAMES);

function readNameSet(value) {
  return new Set(String(value || "").split(",").map((name) => name.trim()).filter(Boolean));
}

function roleFor(employee) {
  if (FORCED_MANAGER_NAMES.has(employee.name)) return ROLES.MANAGER;
  if (FORCED_SUPERVISOR_NAMES.has(employee.name)) return ROLES.SUPERVISOR;
  if (employee.position.includes("主管")) return ROLES.SUPERVISOR;
  if (employee.position.includes("支局长") || employee.position.includes("店长")) return ROLES.BRANCH;
  return ROLES.MEMBER;
}

function importUsers() {
  const db = openDatabase();
  const employees = getActiveEmployees(ROSTER_PATH);
  const result = { created: 0, updated: 0, invalid: 0 };

  for (const employee of employees) {
    const username = String(employee.phone || "").trim();
    const input = {
      username,
      password: DEFAULT_PASSWORD,
      name: employee.name,
      role: roleFor(employee),
      status: ACTIVE,
      position: employee.position,
    };
    if (!username) {
      result.invalid += 1;
      continue;
    }
    const existing = findUserByUsername(db, username) || findUserByName(db, employee.name);
    if (existing) {
      db.prepare("UPDATE users SET username = ?, name = ?, role = ?, status = ?, position = ?, updated_at = ? WHERE id = ?")
        .run(username, input.name, input.role, input.status, input.position, new Date().toISOString(), existing.id);
      result.updated += 1;
      continue;
    }
    createUser(db, input);
    result.created += 1;
  }

  console.log(`created=${result.created}`);
  console.log(`updated=${result.updated}`);
  console.log(`invalid=${result.invalid}`);
}

function findUserByName(db, name) {
  return db.prepare("SELECT * FROM users WHERE name = ?").get(name);
}

importUsers();
