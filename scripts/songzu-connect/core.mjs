import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

export const connectProtocolVersion = 1;
export const connectCipher = "ECDH-P256+HKDF-SHA256+AES-256-GCM";
export const connectInfo = "songzu-connect-v1";

export function base64urlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

export function base64urlDecode(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("無效的 base64url 資料。");
  }
  return Buffer.from(value, "base64url");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function safeHashMatch(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(left || "") || !/^[a-f0-9]{64}$/i.test(right || "")) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function cleanPublicKeyJwk(value) {
  if (
    !value ||
    value.kty !== "EC" ||
    value.crv !== "P-256" ||
    typeof value.x !== "string" ||
    typeof value.y !== "string" ||
    !/^[A-Za-z0-9_-]{40,50}$/.test(value.x) ||
    !/^[A-Za-z0-9_-]{40,50}$/.test(value.y)
  ) {
    throw new Error("頌祖 Connect 公開金鑰格式不正確。");
  }
  return { kty: "EC", crv: "P-256", x: value.x, y: value.y, ext: true };
}

export function cleanPrivateKeyJwk(value) {
  const publicKey = cleanPublicKeyJwk(value);
  if (typeof value.d !== "string" || !/^[A-Za-z0-9_-]{40,50}$/.test(value.d)) {
    throw new Error("頌祖 Connect 私密金鑰格式不正確。");
  }
  return { ...publicKey, d: value.d };
}

export function publicKeyFingerprint(publicKeyJwk) {
  const key = cleanPublicKeyJwk(publicKeyJwk);
  return sha256(`${key.crv}:${key.x}:${key.y}`).match(/.{1,4}/g).slice(0, 4).join("-").toUpperCase();
}

export function generateConnectIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyJwk = cleanPublicKeyJwk(publicKey.export({ format: "jwk" }));
  const privateKeyJwk = cleanPrivateKeyJwk(privateKey.export({ format: "jwk" }));
  return {
    hostId: `sz_${randomBytes(16).toString("base64url")}`,
    hostSecret: randomBytes(32).toString("base64url"),
    publicKeyJwk,
    privateKeyJwk,
    fingerprint: publicKeyFingerprint(publicKeyJwk)
  };
}

export function generateClientKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    publicKeyJwk: cleanPublicKeyJwk(publicKey.export({ format: "jwk" })),
    privateKeyJwk: cleanPrivateKeyJwk(privateKey.export({ format: "jwk" }))
  };
}

export function deriveConnectKey({ hostId, privateKeyJwk, publicKeyJwk }) {
  if (!/^sz_[A-Za-z0-9_-]{20,30}$/.test(hostId || "")) throw new Error("主機識別碼不正確。");
  const privateKey = createPrivateKey({ key: cleanPrivateKeyJwk(privateKeyJwk), format: "jwk" });
  const publicKey = createPublicKey({ key: cleanPublicKeyJwk(publicKeyJwk), format: "jwk" });
  const sharedSecret = diffieHellman({ privateKey, publicKey });
  return Buffer.from(hkdfSync("sha256", sharedSecret, Buffer.from(hostId), Buffer.from(connectInfo), 32));
}

function additionalData(requestId, direction) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(requestId || "")) throw new Error("請求識別碼不正確。");
  if (direction !== "request" && direction !== "response") throw new Error("加密方向不正確。");
  return Buffer.from(`songzu-connect:${connectProtocolVersion}:${direction}:${requestId}`);
}

export function encryptConnectEnvelope({ key, requestId, direction, value }) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(additionalData(requestId, direction));
  const plaintext = Buffer.from(JSON.stringify(value));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { nonce: base64urlEncode(nonce), ciphertext: base64urlEncode(encrypted) };
}

export function decryptConnectEnvelope({ key, requestId, direction, nonce, ciphertext }) {
  const nonceBytes = base64urlDecode(nonce);
  const encrypted = base64urlDecode(ciphertext);
  if (nonceBytes.length !== 12 || encrypted.length < 17) throw new Error("加密封包不完整。");
  const tag = encrypted.subarray(encrypted.length - 16);
  const body = encrypted.subarray(0, encrypted.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonceBytes);
  decipher.setAAD(additionalData(requestId, direction));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"));
}

export function normalizeRelayUrl(value, { allowLocalHttp = true } = {}) {
  const url = new URL(String(value || "").trim());
  if (url.username || url.password || url.search || url.hash) throw new Error("中繼網址不能包含帳密、查詢或片段。");
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(allowLocalHttp && loopback && url.protocol === "http:")) {
    throw new Error("外出中繼站必須使用 HTTPS；HTTP 只允許本機測試。");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function bearerToken(headers) {
  const value = String(headers.authorization || headers.Authorization || "").trim();
  return /^Bearer\s+/i.test(value) ? value.replace(/^Bearer\s+/i, "").trim() : "";
}
