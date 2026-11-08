import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { hashPassword } from "../lib/auth/passwords";
import { pool, transaction } from "../lib/db";
import { seedWorkspace } from "../lib/services/seed";
async function secret(): Promise<string> {
  if (!stdin.isTTY)
    throw new Error("A local interactive terminal is required.");
  stdout.write("Password (hidden, at least 12 characters): ");
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      stdin.off("data", listen);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };
    const listen = (data: Buffer) => {
      const text = data.toString();
      if (text === "\u0003") {
        finish();
        reject(new Error("Cancelled"));
      } else if (text === "\r" || text === "\n") {
        finish();
        resolve(value);
      } else if (text === "\u007f") value = value.slice(0, -1);
      else value += text.replace(/[\x00-\x1f]/g, "");
    };
    stdin.on("data", listen);
  });
}
async function main() {
  const reader = createInterface({ input: stdin, output: stdout });
  const email = z
    .string()
    .email()
    .parse((await reader.question("Owner email: ")).trim().toLowerCase());
  const mode = (
    await reader.question("Workspace mode [SIMULATION / PAYPAL_SANDBOX]: ")
  ).trim();
  reader.close();
  if (mode !== "SIMULATION" && mode !== "PAYPAL_SANDBOX")
    throw new Error("Choose an explicit workspace mode.");
  const password = await secret();
  if (password.length < 12)
    throw new Error("Password must have at least 12 characters.");
  const hash = await hashPassword(password),
    userId = randomUUID();
  await transaction(async (db) => {
    await db.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)",
      [userId, email, hash],
    );
    await seedWorkspace(db, userId, mode, false);
  });
  console.log("Owner workspace created. Sign in at /login.");
}
main()
  .catch(() => {
    console.error(
      "Owner setup failed. Check email uniqueness, password length, and database connectivity.",
    );
    process.exitCode = 1;
  })
  .finally(() => pool.end());
