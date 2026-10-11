import { photoBlob } from "./local-media";
import { saveBlob } from "./downloads";
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
    [location, setLocation] = useState(""),
    [date, setDate] = useState(""),
    [poem, setPoem] = useState(""),
    [ratio, setRatio] = useState("3:4"),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setDescription(collection?.description || "");
    setLocation(collection?.location || "");
    setDate(collection?.date || "");
    setPoem(collection?.poem || "");
  }, [
    collection?.id,
    collection?.description,
    collection?.location,
    collection?.date,
    collection?.poem,
  ]);
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
              aria-label="创意图画幅"
              value={ratio}
              onChange={(e) => setRatio(e.target.value)}
            >
              {["1:1", "3:4", "4:3", "9:16"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            {[
              ["copy", "生成文案"],
              ["cover", "生成创意图"],
            ].map(([kind, label]) => (
              <button
                key={kind}
                className="button"
                disabled={busy}
                onClick={() =>
                  perform(async () => {
                    await api(
                      `/projects/${projectId}/collections/${collection.id}`,
                      json("PUT", { description, location, date, poem }),
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
        <details className="collection-details">
          <summary>编辑作品集信息</summary>
          <div className="collection-details-fields">
            <label>
              地点
              <input
                aria-label="作品集地点"
                value={location}
                maxLength={200}
                onChange={(e) => setLocation(e.target.value)}
              />
            </label>
            <label>
              时间（留空使用照片时间）
              <input
                type="date"
                aria-label="作品集时间"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="wide">
              一句诗
              <input
                aria-label="作品集一句诗"
                value={poem}
                maxLength={300}
                onChange={(e) => setPoem(e.target.value)}
              />
            </label>
            <label className="wide">
              描述
              <textarea
                aria-label="作品集描述"
                value={description}
                maxLength={4000}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          </div>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              perform(async () => {
                await api(
                  `/projects/${projectId}/collections/${collection.id}`,
                  json("PUT", { description, location, date, poem }),
                );
                notify("作品集信息已保存");
              })
            }
          >
            保存作品集信息
          </button>
        </details>
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
              {item.origin === "guest"
                ? "访客拼图"
                : { copy: "文案", cover: "AI 创意图", collage: "拼图" }[
                    item.kind
                  ]}
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
            {item.concept && (
              <details>
                <summary>核心概念</summary>
                <p>{item.concept}</p>
              </details>
            )}
            {item.sourceIds?.length > 0 && (
              <small>来源共 {item.sourceIds.length} 张照片</small>
            )}
            {(item.referenceIds?.length
              ? item.referenceIds
              : item.sourceIds?.slice(0, 4)
            )?.map((id) => (
              <a
                key={id}
                className="creation-reference"
                href="#"
                onClick={async (e) => {
                  e.preventDefault();
                  try {
                    saveBlob(
                      await photoBlob(id),
                      photos.find((p) => p.id === id)?.name || "photo.jpg",
                    );
                  } catch (error) {
                    notify(error.message);
                  }
                }}
                target="_blank"
                rel="noreferrer"
              >
                来源照片 {photos.find((p) => p.id === id)?.name || id}
              </a>
            ))}
            <p>{item.prompt}</p>
          </details>
        </article>
      ))}
    </div>
  );
}
