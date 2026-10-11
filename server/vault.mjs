import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  chmodSync,
} from "node:fs";
import path from "node:path";

// One server owns a data directory. Atomic synchronous writes serialize updates.
export class Vault {
  constructor(native, { root } = {}) {
    this.native = native;
    this.memory = new Map();
    // Installing Vision must not hide keys saved by an earlier fallback deployment.
    this.useNative =
      native.available &&
      !(root && existsSync(path.join(root, "secrets/credentials.enc")));
    if (!this.useNative && root) {
      const directory = path.join(root, "secrets");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      chmodSync(directory, 0o700);
      this.file = path.join(directory, "credentials.enc");
      const keyFile = path.join(directory, "master.key");
      if (!existsSync(keyFile)) {
        if (existsSync(this.file))
          throw new Error("密钥文件缺失，请恢复完整数据备份");
        writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: "wx" });
      }
      chmodSync(keyFile, 0o600);
      this.key = readFileSync(keyFile);
      if (this.key.length !== 32)
        throw new Error("密钥文件无效，请恢复完整数据备份");
      if (existsSync(this.file)) {
        try {
          const data = JSON.parse(readFileSync(this.file, "utf8"));
          if (data.version !== 1) throw new Error("version");
          const decipher = createDecipheriv(
            "aes-256-gcm",
            this.key,
            Buffer.from(data.iv, "base64"),
          );
          decipher.setAuthTag(Buffer.from(data.tag, "base64"));
          const plain = Buffer.concat([
            decipher.update(Buffer.from(data.content, "base64")),
            decipher.final(),
          ]);
          this.memory = new Map(JSON.parse(plain.toString("utf8")));
          chmodSync(this.file, 0o600);
        } catch {
          throw new Error("无法读取加密凭据，请恢复完整数据备份");
        }
      }
    }
  }
  get storage() {
    return this.useNative
      ? "macOS 钥匙串"
      : this.file
        ? "本地加密凭据"
        : "仅当前服务内存";
  }
  account(config) {
    return createHash("sha256").update(config.baseURL).digest("hex");
  }
  persist(next) {
    if (this.file) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.key, iv);
      const content = Buffer.concat([
        cipher.update(JSON.stringify([...next])),
        cipher.final(),
      ]);
      const temporary = this.file + ".tmp";
      writeFileSync(
        temporary,
        JSON.stringify({
          version: 1,
          iv: iv.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
          content: content.toString("base64"),
        }),
        { mode: 0o600 },
      );
      chmodSync(temporary, 0o600);
      renameSync(temporary, this.file);
    }
    this.memory = next;
  }
  async get(config) {
    const account = this.account(config);
    if (this.useNative)
      return (await this.native.request({ op: "key-get", account })).key;
    return this.memory.get(account) || null;
  }
  async set(config, key) {
    const account = this.account(config);
    if (this.useNative)
      await this.native.request({ op: "key-set", account, key });
    else this.persist(new Map(this.memory).set(account, key));
  }
  async remove(config) {
    const account = this.account(config);
    if (this.useNative)
      await this.native.request({ op: "key-delete", account });
    else {
      const next = new Map(this.memory);
      next.delete(account);
      this.persist(next);
    }
  }
}
