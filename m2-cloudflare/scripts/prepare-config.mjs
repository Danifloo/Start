// Generates wrangler.toml from a real Cloudflare D1 database ID.
// Runs only in a GitHub Actions deployment with explicit account/token credentials.
// Never prints or stores Meta/admin passwords.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  throw new Error("Cloudflare account ID and API token are required.");
}
function wrangler(args) {
  return execFileSync(process.platform === "win32" ? "node_modules/.bin/wrangler.cmd" : "./node_modules/.bin/wrangler", args, {
    encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"], timeout: 90000
  });
}
function findDatabase() {
  const databases = JSON.parse(wrangler(["d1", "list", "--json"]));
  if (!Array.isArray(databases)) throw new Error("Cloudflare D1 did not return a database list.");
  const match = databases.find(db => db.name === "m2-publisher-db");
  return match?.uuid || match?.id || null;
}
let databaseId = findDatabase();
if (!databaseId) {
  console.log("Provisioning Cloudflare D1 database m2-publisher-db.");
  wrangler(["d1", "create", "m2-publisher-db"]);
  databaseId = findDatabase();
}
if (!/^[0-9a-f-]{36}$/i.test(databaseId || "")) throw new Error("D1 database ID missing or invalid.");
const template = readFileSync("wrangler.toml.example", "utf8");
if (!template.includes("REPLACE_WITH_YOUR_D1_DATABASE_ID")) throw new Error("Invalid template.");
writeFileSync("wrangler.toml", template.replace("REPLACE_WITH_YOUR_D1_DATABASE_ID", databaseId));
console.log("D1 database binding configured. Instagram publishing remains disabled.");
