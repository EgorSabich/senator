#!/usr/bin/env node
/**
 * Creates the first owner account (Właściciel). Prints SQL + a temporary password shown ONCE;
 * the owner must change it at first login.
 *
 *   AUTH_SECRET=<same secret as the worker> node scripts/create-owner.mjs "Imię" "Nazwisko" [login] > owner.sql
 *   npx wrangler d1 execute DB --remote --file owner.sql
 *
 * Optional OWNER_TEMP_PASSWORD fixes the temporary password (used by automated tests only).
 */
import { webcrypto as crypto } from 'node:crypto';

const [firstName, lastName, loginArg] = process.argv.slice(2);
const secret = process.env.AUTH_SECRET;
if (!firstName || !lastName || !secret) {
  console.error('Usage: AUTH_SECRET=... node scripts/create-owner.mjs "Imię" "Nazwisko" [login]');
  process.exit(1);
}

const enc = new TextEncoder();
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fold = (s) => s.replace(/[łŁ]/g, 'l').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
const login = loginArg || fold(`${firstName}.${lastName}`).replace(/[^a-z0-9._-]/g, '');

const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const temp =
  process.env.OWNER_TEMP_PASSWORD ||
  Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => alphabet[b % alphabet.length]).join('');

const hmacKey = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const peppered = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(temp));
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256);

const id = `usr_${crypto.randomUUID().replaceAll('-', '')}`;
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
console.log(
  `INSERT INTO users (id, first_name, last_name, login, role, status, secret_hash, secret_salt, secret_kind, must_change_secret) ` +
    `VALUES (${q(id)}, ${q(firstName)}, ${q(lastName)}, ${q(login)}, 'owner', 'active', ${q(b64url(bits))}, ${q(b64url(salt))}, 'password', 1);`,
);
console.error(`Owner login: ${login}\nTemporary password (shown once, must be changed at first login): ${temp}`);
