import React, { useEffect, useState } from "react";
import { api, json, photoURL } from "./api";
import PhotoImage from "./PhotoImage";
export function PortfolioTools({
  projectId,
  collections,
  collection,
  selected,
  onChoose,
  refresh,
  notify,
  mode,
  setMode,
}) {
  const [description, setDescription] = useState(""),
    [ratio, setRatio] = useState("3:4"),
    [busy, setBusy] = useState(false);
  useEffect(
    () => setDescription(collection?.description || ""),
    [collection?.id, collection?.description],
  );
  const perform = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="portfolio-tools">
      <div className="portfolio-row">
        <select
          aria-label="浏览作品集"
          value={collection?.id || ""}
          onChange={(e) => onChoose(e.target.value)}
        >
          <option value="">作品集候选</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {!!selected.length && (
          <select
            aria-label="归入作品集"
            value=""
            onChange={(e) => {
              const c = collections.find((c) => c.id === e.target.value);
              if (c)
                perform(() =>
                  api(
                    `/projects/${projectId}/collections/${c.id}`,
                    json("PUT", {
                      photoIds: [...new Set([...c.photoIds, ...selected])],
                    }),
                  ),
                );
            }}
          >
            <option value="">归入作品集…</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {collection && (
          <>
            <div className="tabs" role="tablist">
              {[
                ["photos", "照片"],
                ["creations", "创作"],
              ].map(([v, label]) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={mode === v}
                  onClick={() => setMode(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              aria-label="封面画幅"
              value={ratio}
              onChange={(e) => setRatio(e.target.value)}
            >
              {["1:1", "3:4", "4:3", "9:16"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            {[
              ["copy", "生成文案"],
              ["cover", "生成封面"],
            ].map(([kind, label]) => (
              <button
                key={kind}
                className="button"
                disabled={busy}
                onClick={() =>
                  perform(async () => {
                    await api(
                      `/projects/${projectId}/collections/${collection.id}`,
                      json("PUT", { description }),
                    );
                    await api(
                      `/projects/${projectId}/collections/${collection.id}/create`,
                      json("POST", { kind, ratio }),
                    );
                    setMode("creations");
                    notify("创作已开始");
                  })
                }
              >
                {label}
              </button>
            ))}
          </>
        )}
      </div>
      {collection && (
        <textarea
          aria-label="作品集描述"
          placeholder="作品集描述"
          value={description}
          maxLength={4000}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            if (description !== (collection.description || ""))
              perform(() =>
                api(
                  `/projects/${projectId}/collections/${collection.id}`,
                  json("PUT", { description }),
                ),
              );
          }}
        />
      )}
    </section>
  );
}
export function CreationGallery({ projectId, collectionId, photos, notify }) {
  const [items, setItems] = useState([]);
  const reload = () =>
    api(`/projects/${projectId}/creations?collectionId=${collectionId}`).then(
      setItems,
    );
  useEffect(() => {
    reload().catch((e) => notify(e.message));
    const timer = setInterval(() => reload().catch(() => {}), 2500);
    return () => clearInterval(timer);
  }, [projectId, collectionId]);
  return (
    <div className="creation-gallery">
      {!items.length && <div className="empty-stage">暂无创作</div>}
      {items.map((item) => (
        <article className="creation-card" key={item.id}>
          <header>
            <span>
              {{ copy: "文案", cover: "AI 生成", collage: "拼图" }[item.kind]}
            </span>
            <small>{new Date(item.createdAt).toLocaleString()}</small>
          </header>
          {item.file && (
            <a
              href={`/api/creations/${item.id}/image`}
              target="_blank"
              rel="noreferrer"
            >
              <PhotoImage
                src={`/api/creations/${item.id}/image`}
                alt={item.title}
              />
            </a>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              try {
                await api(
                  `/creations/${item.id}`,
                  json("PUT", {
                    title: data.get("title"),
                    text: data.get("text"),
                  }),
                );
                notify("作品已保存");
                await reload();
              } catch (e) {
                notify(e.message);
              }
            }}
          >
            <input
              name="title"
              aria-label="创作标题"
              defaultValue={item.title}
            />
            <textarea
              name="text"
              aria-label="创作文案"
              defaultValue={item.text || ""}
            />
            <button className="button">保存文字</button>
            {item.file && (
              <a
                className="button"
                href={`/api/creations/${item.id}/image?download=1`}
              >
                下载图片
              </a>
            )}
          </form>
          <details>
            <summary>来源与生成信息</summary>
            <p>
              {item.model || "本地拼图"} · {item.sourceIds.length} 张来源照片
            </p>
            {item.referenceIds?.map((id) => (
              <a
                key={id}
                className="creation-reference"
                href={photoURL(id, "preview")}
                target="_blank"
                rel="noreferrer"
              >
                参考照片 {photos.find((p) => p.id === id)?.name || id}
              </a>
            ))}
            <p>{item.prompt}</p>
          </details>
        </article>
      ))}
    </div>
  );
}
