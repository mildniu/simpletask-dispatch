const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR_OVERRIDE || path.join(ROOT_DIR, "data");
const UPLOAD_DIR = process.env.UPLOAD_DIR_OVERRIDE || path.join(ROOT_DIR, "uploads");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const ROSTER_PATH = path.join(ROOT_DIR, "员工花名册.csv");
const DB_PATH = path.join(DATA_DIR, "tasks.db");
const PORT = Number(process.env.PORT || 3000);

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  UPLOAD_DIR,
  PUBLIC_DIR,
  ROSTER_PATH,
  DB_PATH,
  PORT,
};
