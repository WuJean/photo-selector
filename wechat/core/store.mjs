import { randomUUID } from "node:crypto";
export const COLLECTION = "photo_selector";
export const uid = () => randomUUID().replaceAll("-", "");
export class CloudStore {
  constructor(db, owner, transactional = false) {
    this.db = db;
    this.owner = owner;
    this.transactional = transactional;
  }
  async get(kind, id) {
    try {
      const { data } = await this.db
        .collection(COLLECTION)
        .doc(`${kind}:${id}`)
        .get();
      return data?.owner === this.owner ? data : null;
    } catch (e) {
      if (/not exist|not found|不存在|-502005/i.test(e.message)) return null;
      throw e;
    }
  }
  async list(kind, where = {}, { after = "", limit = 100 } = {}) {
    let query = this.db.collection(COLLECTION).where({
      ...where,
      kind,
      owner: this.owner,
      ...(after ? { _id: this.db.command.gt(after) } : {}),
    });
    return (await query.orderBy("_id", "asc").limit(Math.min(100, limit)).get())
      .data;
  }
  async all(kind, where = {}) {
    const out = [];
    let after = "";
    for (;;) {
      const page = await this.list(kind, where, { after });
      out.push(...page);
      if (page.length < 100) return out;
      after = page.at(-1)._id;
    }
  }
  async put(kind, value) {
    const data = { ...value, kind, owner: this.owner, updatedAt: Date.now() };
    delete data._id;
    delete data._openid;
    await this.db
      .collection(COLLECTION)
      .doc(`${kind}:${value.id}`)
      .set({ data: JSON.parse(JSON.stringify(data)) });
    return { ...data, _id: `${kind}:${value.id}` };
  }
  async remove(kind, id) {
    if (await this.get(kind, id))
      await this.db.collection(COLLECTION).doc(`${kind}:${id}`).remove();
  }
  async transaction(fn) {
    if (this.transactional) return fn(this);
    return this.db.runTransaction((tx) =>
      fn(
        new CloudStore(
          Object.assign(tx, { command: this.db.command }),
          this.owner,
          true,
        ),
      ),
    );
  }
}
export class MemoryStore {
  constructor(owner = "tester", data = new Map()) {
    this.owner = owner;
    this.data = data;
    this.tail = Promise.resolve();
  }
  async get(kind, id) {
    const v = this.data.get(`${kind}:${id}`);
    return v?.owner === this.owner ? structuredClone(v) : null;
  }
  async all(kind, where = {}) {
    return [...this.data.values()]
      .filter(
        (v) =>
          v.owner === this.owner &&
          v.kind === kind &&
          Object.entries(where).every(([k, x]) => v[k] === x),
      )
      .sort((a, b) => a._id.localeCompare(b._id))
      .map((v) => structuredClone(v));
  }
  async list(kind, where = {}, { after = "", limit = 100 } = {}) {
    return (await this.all(kind, where))
      .filter((v) => v._id > after)
      .slice(0, limit);
  }
  async put(kind, v) {
    const value = {
      ...structuredClone(v),
      owner: this.owner,
      kind,
      _id: `${kind}:${v.id}`,
      updatedAt: Date.now(),
    };
    this.data.set(value._id, value);
    return structuredClone(value);
  }
  async remove(kind, id) {
    if (await this.get(kind, id)) this.data.delete(`${kind}:${id}`);
  }
  async transaction(fn) {
    const prev = this.tail;
    let done;
    this.tail = new Promise((r) => (done = r));
    await prev;
    const before = structuredClone(this.data);
    try {
      return await fn(this);
    } catch (e) {
      this.data.clear();
      for (const [k, v] of before) this.data.set(k, v);
      throw e;
    } finally {
      done();
    }
  }
}
