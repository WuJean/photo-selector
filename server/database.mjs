import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class Store {
  constructor(root) {
    this.root = root;
    mkdirSync(root, { recursive: true });
    for (const name of ["originals", "thumbs", "previews", "temp", "assets"])
      mkdirSync(path.join(root, name), { recursive: true });
    this.db = new DatabaseSync(path.join(root, "library.sqlite"));
    this.db.exec(
      `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS documents (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE INDEX IF NOT EXISTS documents_project ON documents(kind,json_extract(data,'$.projectId'));`,
    );
  }
  get(kind, id) {
    const row = this.db
      .prepare("SELECT data FROM documents WHERE kind=? AND id=?")
      .get(kind, id);
    return row ? JSON.parse(row.data) : null;
  }
  all(kind) {
    return this.db
      .prepare("SELECT data FROM documents WHERE kind=? ORDER BY rowid")
      .all(kind)
      .map((r) => JSON.parse(r.data));
  }
  put(kind, value) {
    this.db
      .prepare(
        "INSERT INTO documents VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
      )
      .run(kind, value.id, JSON.stringify(value));
    return value;
  }
  remove(kind, id) {
    this.db
      .prepare("DELETE FROM documents WHERE kind=? AND id=?")
      .run(kind, id);
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  project(name) {
    return this.put("project", {
      id: randomUUID(),
      name: name.trim() || "未命名旅行",
      createdAt: new Date().toISOString(),
      cropFactor: null,
    });
  }
  photos(projectId) {
    return this.db
      .prepare(
        "SELECT data FROM documents WHERE kind='photo' AND json_extract(data,'$.projectId')=? ORDER BY rowid",
      )
      .all(projectId)
      .map((r) => JSON.parse(r.data));
  }
  publicPhotos(projectId) {
    return this.db
      .prepare(
        "SELECT json_remove(data,'$.embedding','$.hash','$.originalPath') AS data FROM documents WHERE kind='photo' AND json_extract(data,'$.projectId')=? ORDER BY rowid",
      )
      .all(projectId)
      .map((r) => JSON.parse(r.data));
  }
  photoCount(projectId) {
    return this.db
      .prepare(
        "SELECT count(*) AS count FROM documents WHERE kind='photo' AND json_extract(data,'$.projectId')=?",
      )
      .get(projectId).count;
  }
  publicPhoto(p) {
    const { embedding, hash, originalPath, ...photo } = p;
    return photo;
  }
  close() {
    this.db.close();
  }
}
