// Sets (or changes) the single PennyTrail sign-in for the Vercel deployment.
//
//   npm run auth:setup            # prompts, then stores the settings on Vercel
//   npm run auth:setup -- --print # prompts, then prints them for .env.local instead
//
// The password is typed with echo off, hashed here, and only the hash leaves
// this machine. The settings land on the Production and Preview environments
// of the linked Vercel project; redeploy for them to take effect. Changing the
// password signs out every existing session.
import { randomBytes, scrypt } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";

const MIN_PASSWORD_LENGTH = 12;

// Must produce the format src/lib/auth.ts verifies (tests/lib/auth.test.ts
// checks the two agree): scrypt:<N>:<r>:<p>:<salt>:<key>, base64url.
export function hashPassword(password, { N = 32768, r = 8, p = 1 } = {}) {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, 32, { N, r, p, maxmem: 256 * N * r }, (err, key) => {
      if (err) reject(err);
      else resolve(["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join(":"));
    });
  });
}

function ask(prompt, { hidden = false } = {}) {
  return new Promise((resolve) => {
    let muted = false;
    const output = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) process.stdout.write(chunk, encoding);
        callback();
      },
    });
    const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
    rl.question(prompt, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
    muted = hidden;
  });
}

function setVercelEnv(name, value, { sensitive }) {
  return new Promise((resolve, reject) => {
    const args = ["--yes", "vercel@latest", "env", "add", name, "production,preview", "--force", sensitive ? "--sensitive" : "--no-sensitive"];
    // shell: Windows can only spawn npx's .cmd shim through a shell. No
    // argument here contains user input; the value goes over stdin.
    const child = spawn("npx", args, { stdio: ["pipe", "ignore", "pipe"], shell: process.platform === "win32" });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`vercel env add ${name} failed:\n${stderr.trim()}`))));
    child.stdin.end(value);
  });
}

async function main() {
  const print = process.argv.includes("--print");

  const username = (await ask("Username: ")).trim();
  if (!username) throw new Error("A username is required");
  const password = await ask(`Password (at least ${MIN_PASSWORD_LENGTH} characters): `, { hidden: true });
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  if ((await ask("Confirm password: ", { hidden: true })) !== password) throw new Error("The passwords don't match");

  const passwordHash = await hashPassword(password);

  if (print) {
    console.log("\nAdd these to .env.local (a new random session secret is included):\n");
    console.log(`PENNYTRAIL_USERNAME=${username}`);
    console.log(`PENNYTRAIL_PASSWORD_HASH=${passwordHash}`);
    console.log(`PENNYTRAIL_SESSION_SECRET=${randomBytes(32).toString("base64url")}`);
    return;
  }

  console.log("\nSaving to the linked Vercel project (Production and Preview)…");
  await setVercelEnv("PENNYTRAIL_USERNAME", username, { sensitive: false });
  await setVercelEnv("PENNYTRAIL_PASSWORD_HASH", passwordHash, { sensitive: true });
  console.log("Done. Redeploy for the new sign-in to take effect.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
