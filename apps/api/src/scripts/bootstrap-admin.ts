import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { disconnectDb } from "../db/client.js";
import { createAdmin, ensureAdminRole, findAdminByEmailRecord } from "../modules/admins/admins.repository.js";

const MIN_PASSWORD_LENGTH = 12;
const apiEnvPath = resolve(process.cwd(), ".env");

if (existsSync(apiEnvPath)) {
  dotenv.config({ path: apiEnvPath });
} else {
  dotenv.config();
}

async function promptHidden(question: string) {
  const mutableOutput = output as NodeJS.WriteStream & { muted?: boolean };
  const rl = createInterface({
    input,
    output: mutableOutput,
    terminal: true
  });

  const originalWrite = mutableOutput.write.bind(mutableOutput);
  mutableOutput.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding, callback?: (error?: Error | null) => void) => {
    if (mutableOutput.muted) {
      const text = typeof chunk === "string" ? chunk : chunk.toString();
      if (text.includes(question)) {
        return originalWrite(chunk, encoding, callback);
      }
      return originalWrite("*", encoding, callback);
    }
    return originalWrite(chunk, encoding, callback);
  }) as typeof mutableOutput.write;

  mutableOutput.muted = true;
  const answer = await rl.question(question);
  mutableOutput.muted = false;
  mutableOutput.write = originalWrite as typeof mutableOutput.write;
  rl.close();
  output.write("\n");
  return answer;
}

async function askForBootstrapInput() {
  const rl = createInterface({ input, output });
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL ?? (await rl.question("Admin email: "));
  rl.close();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? (await promptHidden("Admin password: "));

  return {
    email: email.trim().toLowerCase(),
    password
  };
}

function validateInput(email: string, password: string) {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      [
        "DATABASE_URL is required to bootstrap the first Phantom account.",
        "Create apps/api/.env from apps/api/.env.example or pass DATABASE_URL inline.",
        "Example:",
        "DATABASE_URL='postgresql://phantom:password@localhost:5432/phantom?schema=public' npm run admin:bootstrap --workspace @phantom/api"
      ].join("\n")
    );
  }

  if (!email || !email.includes("@")) {
    throw new Error("A valid ADMIN_BOOTSTRAP_EMAIL is required.");
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_BOOTSTRAP_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

async function main() {
  const { email, password } = await askForBootstrapInput();
  validateInput(email, password);

  const existingAdmin = await findAdminByEmailRecord(email);
  if (existingAdmin) {
    console.error(`Refused: admin already exists for ${email}.`);
    process.exitCode = 1;
    return;
  }

  const superadminRole = await ensureAdminRole("superadmin", "Full access to the Phantom control plane.");
  await ensureAdminRole("ops", "Operational access to node supervision and safe node actions.");

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await createAdmin({
    email,
    displayName: "Company Superadmin",
    passwordHash,
    roleId: superadminRole.id,
    twoFactorEnabled: false
  });

  console.log(`Created superadmin ${admin.email} (${admin.id}).`);
  console.log("2FA is not enabled yet; enable it before production exposure.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb();
  });
