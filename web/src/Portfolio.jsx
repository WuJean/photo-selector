import { Modal } from "./LibraryParts";
import { photoBlob } from "./local-media";
import { saveBlob } from "./downloads";
import React, { useEffect, useState } from "react";
import { api, json, photoURL } from "./api";
import PhotoImage from "./PhotoImage";
export function PortfolioTools({
  projectId,
  collection,
  photos = [],
  jobs,
  refresh,
  notify,
  mode,
  setMode,
  onCollage,
}) {
  const [modal, setModal] = useState(null),
    [form, setForm] = useState({}),
    [ratio, setRatio] = useState("3:4"),
    [busy, setBusy] = useState(false),
    [discard, setDiscard] = useState(false);
  const original = () => ({
    name: collection.name,
    coverId: collection.coverId || collection.photoIds[0] || null,
    description: collection.description || "",
    location: collection.location || "",
    date: collection.date || "",
    poem: collection.poem || "",
  });
  const openEdit = () => {
    setForm(original());
    setDiscard(false);
    setModal("edit");
  };
  const close = () => {
    if (modal === "edit" && JSON.stringify(form) !== JSON.stringify(original()))
      setDiscard(true);
    else setModal(null);
  };
  const run = async (fn) => {
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
  const running = (jobs?.creations || []).filter(
    (j) =>
      j.collectionId === collection.id &&
      j.kind === (modal === "copy" ? "copy" : "cover") &&
      ["running", "paused", "error"].includes(j.state),
  );
  const generate = () =>
    run(async () => {
      await api(
        `/projects/${projectId}/collections/${collection.id}/create`,
        json("POST", { kind: modal === "copy" ? "copy" : "cover", ratio }),
      );
      notify("创作已开始，关闭窗口后会继续");
    });
  return (
    <section className="portfolio-tools">
      <div className="portfolio-row">
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
        <button className="button" onClick={openEdit}>
          编辑作品集
        </button>
        <button className="button" onClick={() => setModal("copy")}>
          生成文案
        </button>
      </div>
      <div className="creative-launchers">
        <button aria-label="拼图" onClick={onCollage}>
          <strong>拼图</strong>
          <span>模板排版 · 随机组合 · AI 搭配</span>
        </button>
        {jobs?.imageGenerationEnabled !== false && (
          <button aria-label="生成创意图" onClick={() => setModal("cover")}>
            <strong>生成创意图</strong>
            <span>用独立的抽象画面，表达这段旅程</span>
          </button>
        )}
      </div>
      {modal === "edit" && (
        <Modal title="编辑作品集" onClose={close}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api(`/collections/${collection.id}`, json("PUT", form));
                setModal(null);
                notify("作品集信息已保存");
              });
            }}
          >
            {[
              ["name", "作品集名称", "text"],
              ["location", "作品集地点", "text"],
              ["date", "作品集时间", "date"],
              ["poem", "作品集一句诗", "text"],
            ].map(([key, label, type]) => (
              <label className="field" key={key}>
                {label}
                <input
                  type={type}
                  aria-label={label}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
            <label className="field">
              作品集描述
              <textarea
                aria-label="作品集描述"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>
            <label className="field">
              封面
              <select
                aria-label="作品集封面"
                value={form.coverId || ""}
                onChange={(e) =>
                  setForm({ ...form, coverId: e.target.value || null })
                }
              >
                <option value="">默认封面</option>
                {collection.photoIds.map((id) => {
                  const p = photos.find((p) => p.id === id);
                  return p ? (
                    <option key={id} value={id}>
                      {p.name}
                    </option>
                  ) : null;
                })}
              </select>
            </label>
            {discard && (
              <div role="alert">
                <p>有未保存的修改</p>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setModal(null);
                    setDiscard(false);
                  }}
                >
                  放弃修改
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => setDiscard(false)}
                >
                  继续编辑
                </button>
              </div>
            )}
            <footer className="modal-actions">
              <button className="primary" disabled={busy}>
                保存作品集信息
              </button>
              <button type="button" className="button" onClick={close}>
                取消
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {["cover", "copy"].includes(modal) && (
        <Modal
          title={modal === "cover" ? "生成创意图" : "生成文案"}
          onClose={() => setModal(null)}
          wide
        >
          <p className="creative-summary">
            {collection.name} · {collection.photoIds.length} 张照片
          </p>
          <p>{collection.description || "结合图集已有描述与标签进行创作"}</p>
          {modal === "cover" && (
            <label className="field">
              画幅
              <select
                aria-label="创意图画幅"
                value={ratio}
                onChange={(e) => setRatio(e.target.value)}
              >
                {["1:1", "3:4", "4:3", "9:16"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          )}
          <button
            className="primary"
            disabled={
              busy ||
              running.some((j) => j.state === "running") ||
              !collection.photoIds.length
            }
            onClick={generate}
          >
            {modal === "cover" ? "生成一张创意图" : "开始生成文案"}
          </button>
          <p className="creative-note">
            使用已配置的 AI 服务，可能产生费用。结果自动保存到本作品集。
          </p>
          {running.map((j) => (
            <div className="task-row" key={j.id}>
              <span>
                {j.state === "running"
                  ? "正在创作"
                  : j.state === "paused"
                    ? "已暂停"
                    : j.error}
              </span>
              <progress value={j.done || 0} max={j.total || 1} />
              {j.state !== "running" && (
                <button
                  onClick={() =>
                    run(() =>
                      api(
                        `/creation-jobs/${j.id}/${j.state === "error" ? "retry" : "resume"}`,
                        json("POST", {}),
                      ),
                    )
                  }
                >
                  继续
                </button>
              )}
            </div>
          ))}
          <CreationGallery
            key={modal}
            projectId={projectId}
            collectionId={collection.id}
            photos={photos}
            notify={notify}
            kind={modal === "copy" ? "copy" : "cover"}
          />
        </Modal>
      )}
    </section>
  );
}
export function CreationGallery({
  projectId,
  collectionId,
  photos,
  notify,
  kind,
}) {
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
      {items
        .filter((item) => !kind || item.kind === kind)
        .map((item) => (
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
