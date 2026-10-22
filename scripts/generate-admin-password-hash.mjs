#!/usr/bin/env node
// Run locally in a trusted terminal: node scripts/generate-admin-password-hash.mjs
// Password input is not echoed and is never written to disk.
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { stdin, stdout } from "node:process";

if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
  console.error("Jalankan langsung di terminal interaktif; jangan lewat pipe atau CI.");
  process.exit(1);
}
stdout.write("Masukkan kata sandi admin (input disembunyikan): ");
stdin.setEncoding("utf8");
stdin.setRawMode(true);
stdin.resume();
let password = "";
function finish(cancelled = false) {
  stdin.setRawMode(false);
  stdin.pause();
  stdin.removeListener("data", onData);
  stdout.write("\n");
  if (cancelled) {
    password = "";
    console.error("Dibatalkan.");
    process.exitCode = 1;
    return;
  }
  if (password.length < 12) {
    password = "";
    console.error("Gunakan kata sandi minimal 12 karakter, lebih panjang lebih baik.");
    process.exitCode = 1;
    return;
  }
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, 310000, 32, "sha256");
  password = "";
  console.log("ADMIN_PASSWORD_HASH=" + salt.toString("base64url") + "." + derived.toString("base64url"));
  console.log("Simpan nilai ini sebagai Worker secret ADMIN_PASSWORD_HASH. Jangan commit nilai ini ke Git.");
}
function onData(chunk) {
  for (const char of chunk) {
    if (char === "\u0003") return finish(true);
    if (char === "\r" || char === "\n") return finish(false);
    if (char === "\u007f" || char === "\b") password = password.slice(0, -1);
    else if (char >= " " && char !== "\u007f") password += char;
  }
}
stdin.on("data", onData);
