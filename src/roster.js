const fs = require("node:fs");

const MANAGER_PATTERN = /经理|副经理|主管|支局长|店长/;

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;

  for (const char of line) {
    if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function readRoster(rosterPath) {
  const content = fs.readFileSync(rosterPath, "utf8").trim();
  const lines = content.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const employee = Object.fromEntries(headers.map((key, index) => [key, values[index] || ""]));
    return normalizeEmployee(employee);
  });
}

function normalizeEmployee(employee) {
  const name = employee["姓名"];
  const department = employee["部门"];
  const position = employee["职位"];
  const status = employee["状态"];
  const text = `${department} ${position}`;

  return {
    name,
    department,
    position,
    phone: employee["手机号"],
    status,
    isManager: MANAGER_PATTERN.test(text),
  };
}

function getActiveEmployees(rosterPath) {
  return readRoster(rosterPath).filter((employee) => employee.status === "在职");
}

module.exports = {
  getActiveEmployees,
};
