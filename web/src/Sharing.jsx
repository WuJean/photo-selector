import React, { useEffect, useState } from "react";
import { api, json } from "./api";
import { photoBlob, processPhoto } from "./local-media";
import { Modal, Button } from "./LibraryParts";
export function ShareManager({ collection, onClose, notify }) {
  const [shares, setShares] = useState([]),
    [download, setDownload] = useState("display"),
    [days, setDays] = useState(7),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState("");
  const load = () =>
    api(`/collections/${collection.id}/shares`).then(setShares);
  useEffect(() => {
    load().catch((e) => notify(e.message));
  }, [collection.id]);
  const prepare = async (share) => {
    setBusy("准备分享");
    try {
      for (let i = 0; i < share.assetIds.length; i++) {
        const id = share.assetIds[i];
        setBusy(`准备照片 ${i + 1}/${share.assetIds.length}`);
        if (
          share.prepared[id]?.display &&
          (share.download !== "original" || share.prepared[id]?.original)
        )
          continue;
        const server = await fetch(
          `/api/shares/${share.id}/assets/${id}/server`,
          json("POST", {}),
        );
        if (server.ok) continue;
        if (server.status !== 409)
          throw new Error((await server.json()).error || "准备失败");
        const original = await photoBlob(id);
        for (const variant of share.download === "original"
          ? ["display", "original"]
          : ["display"]) {
          if (share.prepared[id]?.[variant]) continue;
          const file =
            variant === "original"
              ? original
              : await processPhoto(original, { mode: "preview", edge: 2560 });
          const form = new FormData();
          form.append("photo", file, "photo.jpg");
          await api(`/shares/${share.id}/assets/${id}/${variant}`, {
            method: "POST",
            body: form,
          });
        }
      }
      await api(`/shares/${share.id}/publish`, json("POST", {}));
      notify("分享已启用");
    } catch (e) {
      notify(e.message + "，可继续准备");
    } finally {
      setBusy("");
      await load();
    }
  };
  const create = async () => {
    if (busy) return;
    setBusy("创建分享");
    try {
      const share = await api(
        `/collections/${collection.id}/shares`,
        json("POST", { download, days, password }),
      );
      setPassword("");
      await prepare(share);
    } catch (e) {
      notify(e.message);
      setBusy("");
    }
  };
  return (
    <Modal title="分享作品集" onClose={onClose} wide>
      <div className="import-options">
        <label className="field">
          下载权限
          <select
            value={download}
            onChange={(e) => setDownload(e.target.value)}
          >
            <option value="none">仅查看</option>
            <option value="display">展示版下载</option>
            <option value="original">原片下载</option>
          </select>
        </label>
        <label className="field">
          有效天数
          <input
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
        </label>
        <label className="field">
          访问密码（可选）
          <input
            type="password"
            minLength={4}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <Button primary onClick={create} disabled={!!busy}>
          创建分享
        </Button>
        {busy && <p role="status">{busy}</p>}
        {shares.map((s) => (
          <div className="share-record" key={s.id}>
            <strong>
              {
                {
                  active: "已发布",
                  preparing: "待准备",
                  revoked: "已撤销",
                  expired: "已过期",
                }[s.state]
              }
            </strong>
            <span>{new Date(s.expiresAt).toLocaleString()}</span>
            {s.state === "active" && (
              <>
                <input
                  readOnly
                  aria-label="分享链接"
                  value={location.origin + "/s/" + s.token}
                />
                <Button
                  onClick={async () => {
                    await navigator.clipboard.writeText(
                      location.origin + "/s/" + s.token,
                    );
                    notify("链接已复制");
                  }}
                >
                  复制链接
                </Button>
              </>
            )}
            {s.state === "preparing" && (
              <Button disabled={!!busy} onClick={() => prepare(s)}>
                继续准备
              </Button>
            )}
            {["preparing", "active"].includes(s.state) && (
              <Button
                disabled={!!busy}
                onClick={async () => {
                  await api(`/shares/${s.id}`, { method: "DELETE" });
                  await load();
                }}
              >
                撤销分享
              </Button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
export function PublicShare({ token }) {
  const [share, setShare] = useState(null),
    [locked, setLocked] = useState(false),
    [error, setError] = useState(""),
    [password, setPassword] = useState(""),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(null),
    [zoom, setZoom] = useState(1);
  const base = "/api/public/shares/" + encodeURIComponent(token);
  const load = async () => {
    const r = await fetch(base);
    if (r.status === 401) {
      setLocked(true);
      return;
    }
    if (!r.ok) {
      setError("作品集链接不存在或已失效");
      return;
    }
    setShare(await r.json());
    setLocked(false);
  };
  useEffect(() => {
    load().catch(() => setError("连接失败，请刷新重试"));
  }, [token]);
  const photos =
    share?.photos.filter((p) =>
      [p.name, ...p.tags].join(" ").includes(query),
    ) || [];
  useEffect(() => {
    const key = (e) => {
      if (active === null) return;
      if (e.key === "Escape" || e.code === "Space") {
        e.preventDefault();
        setActive(null);
      }
      if (e.key === "ArrowRight") {
        setActive((i) => Math.min(photos.length - 1, i + 1));
        setZoom(1);
      }
      if (e.key === "ArrowLeft") {
        setActive((i) => Math.max(0, i - 1));
        setZoom(1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active, photos.length]);
  if (locked)
    return (
      <main className="login-page">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await fetch(base + "/unlock", json("POST", { password }));
            if (!r.ok) setError((await r.json()).error);
            else {
              setError("");
              await load();
            }
          }}
        >
          <h1>受保护的作品集</h1>
          <label className="field">
            访问密码
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <Button primary type="submit">
            查看作品集
          </Button>
          {error && <p role="alert">{error}</p>}
        </form>
      </main>
    );
  if (error)
    return (
      <div className="empty-state" role="alert">
        {error}
      </div>
    );
  if (!share) return <div className="empty-state">正在打开…</div>;
  const url = (id, variant = "display") => `${base}/photos/${id}/${variant}`;
  return (
    <div className="wall-app">
      <main className="wall-main">
        <div className="wall-title">
          <div>
            <h1>{share.name}</h1>
            <p>{share.description}</p>
          </div>
          {share.download !== "none" && (
            <a className="button" href={base + "/download"}>
              下载整组
            </a>
          )}
        </div>
        <div className="wall-toolbar">
          <input
            placeholder="搜索照片或标签"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span>{photos.length} 张</span>
        </div>
        <div className="wall-grid">
          {photos.map((p, i) => (
            <article className="wall-card" key={p.id}>
              <div
                className="wall-photo"
                onClick={() => {
                  setActive(i);
                  setZoom(1);
                }}
              >
                <img src={url(p.id)} loading="lazy" alt={p.name} />
              </div>
              <div className="wall-caption">
                <span>{p.name}</span>
                <div className="tag-chips">
                  {p.tags.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                {share.download !== "none" && (
                  <a
                    href={
                      url(
                        p.id,
                        share.download === "original" ? "original" : "display",
                      ) + "?download=1"
                    }
                  >
                    下载
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
        {!!share.creations.length && (
          <section className="creation-gallery">
            {share.creations.map((c) => (
              <article key={c.id} className="creation-card">
                <header>
                  <strong>{c.title}</strong>
                  <span>
                    {
                      { copy: "文案", cover: "AI 图片", collage: "拼图" }[
                        c.kind
                      ]
                    }
                  </span>
                </header>
                {c.hasImage ? (
                  <img src={url(c.id)} loading="lazy" alt={c.title} />
                ) : (
                  <p>{c.text}</p>
                )}
              </article>
            ))}
          </section>
        )}
        {active !== null && photos[active] && (
          <div className="wall-viewer" role="dialog" aria-label="查看照片">
            <header>
              <span>{photos[active].name}</span>
              <button onClick={() => setActive(null)}>关闭</button>
            </header>
            <div
              className="viewer-image"
              onWheel={(e) =>
                setZoom((z) =>
                  Math.max(1, Math.min(4, z + (e.deltaY < 0 ? 0.2 : -0.2))),
                )
              }
            >
              <img
                src={url(photos[active].id)}
                style={{ transform: `scale(${zoom})` }}
                onDoubleClick={() => setZoom((z) => (z === 1 ? 2 : 1))}
              />
            </div>
            <footer>
              <Button
                disabled={!active}
                onClick={() => {
                  setActive((i) => i - 1);
                  setZoom(1);
                }}
              >
                上一张
              </Button>
              <Button onClick={() => setZoom(1)}>适应画面</Button>
              <Button
                disabled={active === photos.length - 1}
                onClick={() => {
                  setActive((i) => i + 1);
                  setZoom(1);
                }}
              >
                下一张
              </Button>
            </footer>
          </div>
        )}
      </main>
    </div>
  );
}
