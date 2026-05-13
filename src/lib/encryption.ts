/**
 * 客户端 E2EE：AES-GCM-256 + PBKDF2-SHA256 派生密钥。
 * 主密码与解密后的明文仅驻内存；库中仅存密文与 iv、salt。
 */

/** 写入 user_crypto 的校验明文，用于验证主密码是否正确 */
export const VAULT_VERIFIER_PLAINTEXT = "SAFE_VAULT_V1";

const PBKDF2_ITERATIONS = 210_000;
const AES_KEY_BITS = 256;
const IV_LENGTH = 12;
const ROW_SALT_BYTES = 16;

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function randomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

/** 用户级 KDF salt（存 user_crypto.salt） */
export function generateUserSaltBase64(): string {
  return toBase64(randomBytes(ROW_SALT_BYTES));
}

/**
 * 从主密码与用户 salt 派生 AES-GCM 256 密钥（仅内存使用）。
 */
export async function deriveKeyFromPassword(
  masterPassword: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(masterPassword),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: AES_KEY_BITS },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function deriveKeyFromPasswordBase64Salt(
  masterPassword: string,
  saltBase64: string
): Promise<CryptoKey> {
  return deriveKeyFromPassword(masterPassword, fromBase64(saltBase64));
}

export interface EncryptedPayload {
  ciphertextB64: string;
  ivB64: string;
  saltB64: string;
}

/**
 * 加密 UTF-8 字符串。每行记录独立 iv 与行级 salt（满足库字段要求；行 salt 可预留扩展）。
 */
export async function encrypt(plaintext: string, key: CryptoKey): Promise<EncryptedPayload> {
  const iv = randomBytes(IV_LENGTH);
  const rowSalt = randomBytes(ROW_SALT_BYTES);
  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );
  return {
    ciphertextB64: toBase64(cipherBuf),
    ivB64: toBase64(iv),
    saltB64: toBase64(rowSalt),
  };
}

export async function decrypt(payload: EncryptedPayload, key: CryptoKey): Promise<string> {
  const iv = fromBase64(payload.ivB64);
  const cipher = fromBase64(payload.ciphertextB64);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plainBuf);
}

/** 日记明文打包为 JSON（标题 + 正文） */
export function packDiaryPlaintext(title: string, content: string): string {
  return JSON.stringify({ title: title.trim(), content });
}

export function unpackDiaryPlaintext(json: string): { title: string; content: string } {
  try {
    const o = JSON.parse(json) as { title?: string; content?: string };
    return {
      title: typeof o.title === "string" ? o.title : "",
      content: typeof o.content === "string" ? o.content : "",
    };
  } catch {
    return { title: "", content: json };
  }
}
