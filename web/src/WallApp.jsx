import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Plus,
  Settings2,
  Upload,
  FolderOpen,
  Download,
  X,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { api, json, photoURL } from "./api";
import { Modal, Button, InputDialog } from "./LibraryParts";
import PhotoImage from "./PhotoImage";
import Immersive from "./Immersive";
import Settings from "./Settings";
import TagFilters from "./TagFilters";
import TaskBar from "./TaskBar";
import AIWizard from "./AIWizard";
import Studio from "./Studio";
import { CreationGallery, PortfolioTools } from "./Portfolio";
import {
  filterPhotos,
  tagsOf,
  inInitial,
  inFinal,
  isTyping,
  decisionKeys,
  FOCAL_LABELS,
} from "../../shared/domain.mjs";

function Login({ onLogin }) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login-page">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/auth/login", json("POST", { password }));
            onLogin();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Camera size={32} />
        <h1>我的照片墙</h1>
        <label className="field">
          管理员密码
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <Button primary type="submit" disabled={busy}>
          登录
        </Button>
        <details>
          <summary>首次登录</summary>
          <p>初始密码保存在部署数据目录的 admin-initial-password 文件中。</p>
        </details>
      </form>
    </main>
  );
}
function Viewer({ photos, index: initial, onClose, onDownload }) {
  const [index, setIndex] = useState(initial),
    [zoom, setZoom] = useState(1);
  const move = (n) => {
    setIndex((i) => Math.max(0, Math.min(photos.length - 1, i + n)));
    setZoom(1);
  };
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape" || e.code === "Space") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "ArrowLeft") move(-1);
      if (e.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [photos.length]);
  const p = photos[index];
  if (!p) return null;
  return (
    <div className="wall-viewer" role="dialog" aria-label="查看照片">
      <header>
        <span>
          {p.name} · {index + 1}/{photos.length}
        </span>
        <Button onClick={() => onDownload([p])} icon={Download}>
          下载
        </Button>
        <button aria-label="关闭" onClick={onClose}>
          <X />
        </button>
      </header>
      <div
        className="viewer-image"
        onWheel={(e) =>
          setZoom((z) =>
            Math.max(1, Math.min(4, z + (e.deltaY < 0 ? 0.2 : -0.2))),
          )
        }
      >
        <PhotoImage
          src={photoURL(p.id, "original")}
          style={{ transform: `scale(${zoom})` }}
          onDoubleClick={() => setZoom((z) => (z === 1 ? 2 : 1))}
        />
      </div>
      <footer>
        <Button onClick={() => move(-1)} disabled={!index} icon={ArrowLeft}>
          上一张
        </Button>
        <Button onClick={() => setZoom(1)}>适应画面</Button>
        <Button
          onClick={() => move(1)}
          disabled={index === photos.length - 1}
          icon={ArrowRight}
        >
          下一张
        </Button>
      </footer>
    </div>
  );
}
export default function WallApp() {
  const [authenticated, setAuthenticated] = useState(null);
  useEffect(() => {
    api("/auth/session")
      .then((r) => setAuthenticated(r.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);
  if (authenticated === null)
    return <div className="empty-state">正在连接…</div>;
  return authenticated ? (
    <Workspace onLogout={() => setAuthenticated(false)} />
  ) : (
    <Login onLogin={() => setAuthenticated(true)} />
  );
}
function Workspace({ onLogout }) {
  const [page, setPage] = useState("wall"),
    [photos, setPhotos] = useState([]),
    [collections, setCollections] = useState([]),
    [batches, setBatches] = useState([]),
    [batchId, setBatchId] = useState(""),
    [batchPhotos, setBatchPhotos] = useState([]),
    [collectionId, setCollectionId] = useState(""),
    [round, setRound] = useState("initial"),
    [processed, setProcessed] = useState(false),
    [history, setHistory] = useState(false),
    [selected, setSelected] = useState([]),
    [cursor, setCursor] = useState(""),
    [filters, setFilters] = useState({}),
    [showFilters, setShowFilters] = useState(false),
    [dialog, setDialog] = useState(null),
    [settings, setSettings] = useState(false),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(""),
    [viewer, setViewer] = useState(null),
    [immersive, setImmersive] = useState(null),
    [jobs, setJobs] = useState(null),
    [ai, setAI] = useState(null),
    [studio, setStudio] = useState(false),
    [mode, setMode] = useState("photos"),
    [expanded, setExpanded] = useState(new Set()),
    [fold, setFold] = useState(true);
  const input = useRef(),
    guard = useRef(false),
    alive = useRef(true),
    undoFocus = useRef([]);
  const notify = setToast;
  const refresh = async () => {
    const [p, c, b, j] = await Promise.all([
      api("/assets"),
      api("/collections"),
      api("/batches"),
      api("/jobs"),
    ]);
    if (!alive.current) return;
    setPhotos(p);
    setCollections(c);
    setBatches(b);
    setJobs(j);
    if (batchId) setBatchPhotos(await api(`/batches/${batchId}/photos`));
  };
  useEffect(() => {
    alive.current = true;
    refresh().catch((e) => notify(e.message));
    const t = setInterval(() => refresh().catch(() => {}), 2500);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [batchId]);
  useEffect(() => {
    setSelected([]);
    setCursor("");
    setFilters({});
    setMode("photos");
  }, [page, batchId, round, collectionId, processed]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 6000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const run = async (fn) => {
    if (guard.current) return false;
    guard.current = true;
    setBusy("处理中");
    try {
      await fn();
      await refresh();
      return true;
    } catch (e) {
      notify(e.message);
      return false;
    } finally {
      guard.current = false;
      setBusy("");
    }
  };
  const batch = batches.find((b) => b.id === batchId),
    collection = collections.find((c) => c.id === collectionId);
  const memberIds = new Set(collections.flatMap((c) => c.photoIds));
  const source =
    page === "work"
      ? batchPhotos.filter(
          (p) =>
            !p.cleaned &&
            (round === "initial"
              ? processed
                ? p.status !== "unseen"
                : p.status === "unseen"
              : inInitial(p) &&
                (processed
                  ? p.finalStatus !== "unseen"
                  : p.finalStatus === "unseen")),
        )
      : collection
        ? collection.photoIds
            .map((id) => photos.find((p) => p.id === id))
            .filter(Boolean)
        : page === "wall"
          ? photos.filter((p) => memberIds.has(p.id))
          : photos.filter((p) => inFinal(p) && !memberIds.has(p.id));
  const filtered = filterPhotos(source, filters);
  const grouped = new Map();
  for (const p of filtered) {
    const id = p.similarId || p.id;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(p);
  }
  const visible =
    page === "work" && fold
      ? [...grouped].flatMap(([id, list]) =>
          expanded.has(id) ? list : [list[0]],
        )
      : filtered;
  const [limit, setLimit] = useState(100);
  useEffect(
    () => setLimit(100),
    [page, batchId, collectionId, JSON.stringify(filters), round],
  );
  const decide = async (ids, patch, r = round) =>
    run(async () => {
      await api(
        `/batches/${batchId}/decisions`,
        json("PATCH", { ids, round: r, status: patch.status }),
      );
      undoFocus.current.push(ids[0]);
      const i = filtered.findIndex((p) => p.id === ids[0]);
      setCursor(filtered[i + 1]?.id || filtered[i - 1]?.id || "");
      setSelected([]);
    });
  const undo = async () =>
    run(async () => {
      const result = await api(`/batches/${batchId}/undo`, json("POST", {}));
      if (result.ok) setCursor(undoFocus.current.pop() || result.ids[0]);
      else throw new Error("没有可撤销的决定");
    });
  const openScreen = (id = cursor || filtered[0]?.id) => {
    if (id) setImmersive({ startId: id, scopeIds: filtered.map((p) => p.id) });
  };
  useEffect(() => {
    const key = (e) => {
      if (
        e.repeat ||
        isTyping(e.target) ||
        document.querySelector("[role=dialog]") ||
        immersive ||
        studio
      )
        return;
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "z" &&
        page === "work"
      ) {
        e.preventDefault();
        void undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (page === "work") openScreen();
        else if (filtered.length)
          setViewer({
            photos: filtered,
            index: Math.max(
              0,
              filtered.findIndex((p) => p.id === cursor),
            ),
          });
      }
      if (
        page === "work" &&
        decisionKeys[e.key.toLowerCase()] &&
        (round === "initial" || e.key.toLowerCase() !== "z")
      ) {
        e.preventDefault();
        const id = cursor || filtered[0]?.id;
        if (id)
          void decide([id], { status: decisionKeys[e.key.toLowerCase()] });
      }
      if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const i = Math.max(
          0,
          filtered.findIndex((p) => p.id === cursor),
        );
        setCursor(
          filtered[
            Math.max(
              0,
              Math.min(
                filtered.length - 1,
                i + (e.key === "ArrowRight" ? 1 : -1),
              ),
            )
          ]?.id || "",
        );
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const createCollection = () =>
    setDialog({
      title: "新建作品集",
      submit: async (name) => {
        const c = await api("/collections", json("POST", { name }));
        setCollectionId(c.id);
        setPage("collections");
        await refresh();
      },
    });
  const uploadFiles = async (files) =>
    run(async () => {
      let id = batchId;
      if (!batch || batch.state !== "initial") {
        const b = await api(
          "/batches",
          json("POST", {
            name: new Date().toLocaleDateString() + " 导入",
            source: "upload",
          }),
        );
        id = b.id;
        setBatchId(id);
      }
      setPage("work");
      for (let offset = 0; offset < files.length; offset += 10) {
        setBusy(`上传 ${offset}/${files.length}`);
        const form = new FormData();
        for (const f of files.slice(offset, offset + 10))
          form.append("photos", f);
        const r = await api(`/batches/${id}/import`, {
          method: "POST",
          body: form,
        });
        const failed = r.results.filter((v) => v.error);
        if (failed.length) notify(failed[0].error);
      }
      setBatchPhotos(await api(`/batches/${id}/photos`));
    });
  const download = async (list) =>
    run(async () => {
      for (const p of list) {
        const r = await fetch(photoURL(p.id, "original"));
        if (!r.ok) throw new Error("下载失败");
        const url = URL.createObjectURL(await r.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = p.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    });
  const classify = () =>
    run(async () => {
      const ids = selected.length ? selected : filtered.map((p) => p.id);
      await api("/projects/library/analyze", json("POST", { ids }));
    });
  return (
    <div className="wall-app">
      <header className="wall-header">
        <a className="wall-brand" href="/">
          <Camera size={22} />
          我的照片墙
        </a>
        <nav>
          {[
            ["wall", "照片墙"],
            ["collections", "作品集"],
            ["work", "导入与筛选"],
          ].map(([id, title]) => (
            <button
              className={page === id ? "active" : ""}
              onClick={() => {
                setPage(id);
                setCollectionId("");
              }}
              key={id}
            >
              {title}
            </button>
          ))}
        </nav>
        <button
          className="icon-button"
          aria-label="设置"
          onClick={() => setSettings(true)}
        >
          <Settings2 size={21} />
        </button>
      </header>
      <main className="wall-main">
        <TaskBar
          jobs={jobs}
          projectId="library"
          refresh={refresh}
          notify={notify}
        />
        <div className="wall-title">
          <div>
            <h1>
              {page === "wall"
                ? "每一张，值得留下"
                : page === "collections"
                  ? collection?.name || "作品集"
                  : batch?.name || "导入与筛选"}
            </h1>
            {page === "wall" && (
              <span>
                {memberIds.size} 张照片 · {collections.length} 个作品集
              </span>
            )}
          </div>
          <div className="wall-actions">
            {page !== "work" && (
              <Button icon={Plus} onClick={createCollection}>
                新建作品集
              </Button>
            )}
            <Button primary icon={Upload} onClick={() => input.current.click()}>
              上传照片
            </Button>
          </div>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/jpeg"
          multiple
          hidden
          onChange={(e) => {
            const files = [...e.target.files];
            e.target.value = "";
            void uploadFiles(files);
          }}
        />
        {page === "work" && (
          <div className="work-controls">
            <select
              aria-label="导入批次"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
            >
              <option value="">选择批次</option>
              {batches
                .filter((b) => history || b.state !== "completed")
                .map((b) => (
                  <option value={b.id} key={b.id}>
                    {b.name} · {b.count}
                  </option>
                ))}
            </select>
            <Button
              onClick={() =>
                setDialog({
                  title: "新建导入批次",
                  submit: async (name) => {
                    const b = await api(
                      "/batches",
                      json("POST", { name, source: "upload" }),
                    );
                    setBatchId(b.id);
                    await refresh();
                  },
                })
              }
            >
              新建批次
            </Button>
            <label>
              <input
                type="checkbox"
                checked={history}
                onChange={(e) => setHistory(e.target.checked)}
              />
              历史批次
            </label>
            {batch && (
              <>
                <div className="tabs">
                  <button
                    className={round === "initial" ? "active" : ""}
                    onClick={() => setRound("initial")}
                  >
                    初筛
                  </button>
                  <button
                    className={round === "final" ? "active" : ""}
                    onClick={() => setRound("final")}
                  >
                    精筛
                  </button>
                </div>
                <Button onClick={() => setProcessed((v) => !v)}>
                  {processed ? "待处理" : "已处理"}
                </Button>
                <Button
                  onClick={() => openScreen()}
                  disabled={!filtered.length}
                >
                  沉浸选片
                </Button>
                <Button onClick={undo}>撤销</Button>
              </>
            )}
          </div>
        )}
        {page !== "work" && (
          <div className="collection-strip">
            <button
              className={!collectionId ? "active" : ""}
              onClick={() => setCollectionId("")}
            >
              {page === "wall" ? "全部照片" : "待归集"}
            </button>
            {collections.map((c) => (
              <button
                key={c.id}
                className={collectionId === c.id ? "active" : ""}
                onClick={() => setCollectionId(c.id)}
              >
                {c.name} <small>{c.photoIds.length}</small>
              </button>
            ))}
          </div>
        )}
        {collection && page !== "work" && (
          <PortfolioTools
            projectId="library"
            collections={collections}
            collection={collection}
            selected={selected}
            onChoose={setCollectionId}
            refresh={refresh}
            notify={notify}
            mode={mode}
            setMode={setMode}
          />
        )}
        <div className="wall-toolbar">
          <input
            type="search"
            placeholder="搜索照片或标签"
            aria-label="搜索照片"
            value={filters.query || ""}
            onChange={(e) => setFilters({ ...filters, query: e.target.value })}
          />
          <Button onClick={() => setShowFilters((v) => !v)}>筛选</Button>
          <span>{filtered.length} 张</span>
          {page === "work" && (
            <Button
              onClick={() => {
                setFold((v) => !v);
                setExpanded(new Set());
              }}
            >
              {fold ? "全部展开" : "全部叠放"}
            </Button>
          )}
          {(page !== "work" || round === "final") && filtered.length > 0 && (
            <>
              <Button onClick={classify}>AI 分类</Button>
              <Button
                onClick={() =>
                  setAI(selected.length ? selected : filtered.map((p) => p.id))
                }
              >
                细化分类
              </Button>
            </>
          )}
          {page !== "work" && filtered.length > 0 && (
            <Button onClick={() => setStudio(true)}>拼图与创作</Button>
          )}
        </div>
        {showFilters && (
          <section className="wall-filter">
            <select
              aria-label="焦段筛选"
              value={filters.focal || ""}
              onChange={(e) =>
                setFilters({ ...filters, focal: e.target.value })
              }
            >
              <option value="">全部焦段</option>
              {FOCAL_LABELS.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <select
              aria-label="方向筛选"
              value={filters.orientation || ""}
              onChange={(e) =>
                setFilters({ ...filters, orientation: e.target.value })
              }
            >
              <option value="">全部方向</option>
              <option value="landscape">横图</option>
              <option value="portrait">竖图</option>
            </select>
            <input
              type="date"
              aria-label="开始日期"
              value={filters.from || ""}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
            <input
              type="date"
              aria-label="结束日期"
              value={filters.to || ""}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
            <TagFilters
              projectId="library"
              photos={source}
              filters={filters}
              setFilters={setFilters}
            />
          </section>
        )}
        {!!selected.length && (
          <div className="selection-toolbar">
            <span>已选 {selected.length} 张</span>
            <Button onClick={() => setSelected([])}>取消选择</Button>
            <Button
              onClick={() =>
                download(photos.filter((p) => selected.includes(p.id)))
              }
            >
              下载
            </Button>
            {(page !== "work" || round === "final") && (
              <select
                aria-label="加入作品集"
                value=""
                onChange={(e) => {
                  const c = collections.find((c) => c.id === e.target.value);
                  if (c)
                    void run(() =>
                      api(
                        `/collections/${c.id}`,
                        json("PUT", {
                          photoIds: [...new Set([...c.photoIds, ...selected])],
                        }),
                      ),
                    );
                }}
              >
                <option value="">加入作品集…</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            {collection && (
              <>
                <Button
                  onClick={() =>
                    run(() =>
                      api(
                        `/collections/${collection.id}`,
                        json("PUT", {
                          photoIds: collection.photoIds.filter(
                            (id) => !selected.includes(id),
                          ),
                        }),
                      ),
                    )
                  }
                >
                  移出
                </Button>
                <Button
                  onClick={() =>
                    run(() =>
                      api(
                        `/collections/${collection.id}`,
                        json("PUT", { coverId: selected[0] }),
                      ),
                    )
                  }
                >
                  设为封面
                </Button>
              </>
            )}
          </div>
        )}
        {mode === "creations" && collection ? (
          <CreationGallery
            projectId="library"
            collectionId={collection.id}
            photos={photos}
            notify={notify}
            refresh={refresh}
          />
        ) : (
          <div className="wall-grid">
            {visible.slice(0, limit).map((p) => {
              const group = grouped.get(p.similarId || p.id) || [p];
              return (
                <article
                  key={p.id}
                  className={`wall-card ${cursor === p.id ? "focused" : ""} ${selected.includes(p.id) ? "selected" : ""}`}
                  onClick={() => setCursor(p.id)}
                  onDoubleClick={() =>
                    page === "work"
                      ? openScreen(p.id)
                      : setViewer({
                          photos: filtered,
                          index: filtered.findIndex((v) => v.id === p.id),
                        })
                  }
                >
                  <div className="wall-photo">
                    <PhotoImage
                      src={photoURL(p.id, "thumb")}
                      loading="lazy"
                      alt={p.name}
                    />
                    <label className="photo-select">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${p.name}`}
                        checked={selected.includes(p.id)}
                        onChange={(e) =>
                          setSelected((ids) =>
                            e.target.checked
                              ? [...ids, p.id]
                              : ids.filter((id) => id !== p.id),
                          )
                        }
                      />
                    </label>
                    {page === "work" && group.length > 1 && (
                      <button
                        className="group-toggle"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpanded((old) => {
                            const n = new Set(old);
                            n.has(p.similarId)
                              ? n.delete(p.similarId)
                              : n.add(p.similarId);
                            return n;
                          });
                          setFold(true);
                        }}
                      >
                        {expanded.has(p.similarId)
                          ? "收起本组"
                          : `${group.length} 张相似`}
                      </button>
                    )}
                  </div>
                  <div className="wall-caption">
                    <span>{p.name}</span>
                    <div className="tag-chips">
                      {tagsOf(p).map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                    {page === "work" && (
                      <div className="decision-buttons">
                        {round === "initial" && (
                          <button
                            disabled={!!busy}
                            onClick={() => decide([p.id], { status: "maybe" })}
                          >
                            待定 Z
                          </button>
                        )}
                        <button
                          disabled={!!busy}
                          onClick={() => decide([p.id], { status: "keep" })}
                        >
                          保留 X
                        </button>
                        <button
                          disabled={!!busy}
                          onClick={() => decide([p.id], { status: "reject" })}
                        >
                          不要 C
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {!filtered.length && mode === "photos" && (
          <div className="empty-state">
            <Camera size={42} />
            <h2>
              {page === "wall"
                ? "留住你喜欢的照片"
                : page === "work"
                  ? "当前范围已处理"
                  : "还没有照片"}
            </h2>
            {page === "wall" && (
              <Button primary onClick={() => setPage("work")}>
                导入并筛选
              </Button>
            )}
          </div>
        )}
        {visible.length > limit && (
          <Button onClick={() => setLimit((n) => n + 100)}>加载更多</Button>
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {busy && (
        <div className="work-progress" role="status">
          {busy}
        </div>
      )}
      {dialog && (
        <InputDialog dialog={dialog} onClose={() => setDialog(null)} />
      )}{" "}
      {settings && (
        <Modal title="设置" onClose={() => setSettings(false)} wide>
          <Settings notify={notify} />
          <Account onLogout={onLogout} notify={notify} />
        </Modal>
      )}
      {viewer && (
        <Viewer
          {...viewer}
          onClose={() => setViewer(null)}
          onDownload={download}
        />
      )}{" "}
      {immersive && (
        <Immersive
          photos={batchPhotos}
          {...immersive}
          round={round}
          onClose={() => setImmersive(null)}
          onPatch={decide}
          onUndo={undo}
          onComplete={() => {
            setImmersive(null);
            setProcessed(false);
            setRound("final");
          }}
        />
      )}
      {ai && (
        <AIWizard
          projectId="library"
          ids={ai}
          onClose={() => setAI(null)}
          onChanged={refresh}
          onSettings={() => setSettings(true)}
          notify={notify}
        />
      )}{" "}
      {studio && (
        <Studio
          projectId="library"
          photos={photos}
          selected={selected}
          collection={collection}
          onClose={() => {
            setStudio(false);
            void refresh();
          }}
          notify={notify}
          onSettings={() => setSettings(true)}
        />
      )}
    </div>
  );
}
function Account({ onLogout, notify }) {
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState("");
  return (
    <details className="account-settings">
      <summary>账户</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/auth/password", json("PUT", { current, password }));
            onLogout();
          } catch (e) {
            notify(e.message);
          }
        }}
      >
        <label className="field">
          当前密码
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="field">
          新密码
          <input
            type="password"
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <Button type="submit">修改密码</Button>
        <Button
          type="button"
          onClick={async () => {
            await api("/auth/logout", json("POST", {}));
            onLogout();
          }}
        >
          退出登录
        </Button>
      </form>
    </details>
  );
}
