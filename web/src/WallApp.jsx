import usePhotoGesture from "./usePhotoGesture";
import { selectPhoto, nextAfterDecision } from "../../shared/selection.mjs";
import { pendingAI, cancelPending, resumePending } from "./ai-media";
import { ShareManager, PublicShare } from "./Sharing";
import { downloadPhotos } from "./downloads";
import {
  registerAssets,
  chooseFolder,
  importFolder,
  photoBlob,
  saveNetworkPhotos,
} from "./local-media";
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
import Gallery from "./Gallery";
import Browse from "./Browse";
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
            onLogin(await api("/auth/session"));
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Camera size={32} />
        <h1>我的作品集</h1>
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
          <p>初始密码：passwd。首次登录后请设置自己的密码。</p>
        </details>
      </form>
    </main>
  );
}
export function Viewer({ photos, index: initial, onClose, onDownload }) {
  const [index, setIndex] = useState(initial),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef();
  const move = (n) => {
    setIndex((i) => Math.max(0, Math.min(photos.length - 1, i + n)));
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  const gesture = usePhotoGesture({ transform: { zoom, ...pan }, setTransform: t => { setZoom(t.zoom); setPan({x:t.x,y:t.y}); }, onNavigate: move });
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
        {...gesture}
        onWheel={(e) =>
          setZoom((z) =>
            Math.max(1, Math.min(4, z + (e.deltaY < 0 ? 0.2 : -0.2))),
          )
        }
      >
        <PhotoImage
          src={photoURL(p.id, p.originalExtension && p.originalExtension !== "jpg" ? "render" : "original")}
          draggable={false}
          style={{
            transform: `translate(${zoom === 1 ? 0 : pan.x}px,${zoom === 1 ? 0 : pan.y}px) scale(${zoom})`,
          }}
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
function FirstPassword({ onChanged }) {
  const [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login-page">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (password !== confirm) return setError("两次密码不一致");
          setBusy(true);
          try {
            await api("/auth/password", json("PUT", { password }));
            await api("/auth/login", json("POST", { password }));
            onChanged(await api("/auth/session"));
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>设置新密码</h1>
        <p>首次登录，请先设置至少 12 位的新密码。</p>
        <label className="field">
          新密码
          <input
            required
            type="password"
            minLength={12}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="field">
          确认新密码
          <input
            required
            type="password"
            minLength={12}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <Button primary type="submit" disabled={busy}>
          保存并进入作品集
        </Button>
      </form>
    </main>
  );
}
export default function WallApp() {
  if (location.pathname.startsWith("/s/"))
    return <PublicShare token={location.pathname.split("/")[2]} />;
  const [session, setSession] = useState(null);
  const [route, setRoute] = useState(location.hash);
  useEffect(() => { const changed = () => setRoute(location.hash); window.addEventListener("hashchange", changed); return () => window.removeEventListener("hashchange", changed); }, []);
  useEffect(() => {
    api("/auth/session")
      .then(setSession)
      .catch(() => setSession({ authenticated: false }));
  }, []);
  if (session === null) return <div className="empty-state">正在连接…</div>;
  if (!session.authenticated) return <Login onLogin={setSession} />;
  if (session.mustChangePassword)
    return <FirstPassword onChanged={setSession} />;
  if (!route || route === "#wall" || route.startsWith("#album/")) return <Browse key={route} albumId={route.startsWith("#album/") ? decodeURIComponent(route.slice(7)) : null} />;
  return <Workspace onLogout={() => setSession({ authenticated: false })} />;
}
function Workspace({ onLogout }) {
  const [waitingAI, setWaitingAI] = useState(pendingAI),
    [mediaProgress, setMediaProgress] = useState(null);
  useEffect(() => {
    const update = () => setWaitingAI(pendingAI()),
      progress = (e) => setMediaProgress(e.detail),
      error = (e) => setToast(e.detail);
    window.addEventListener("photo-ai-pending", update);
    window.addEventListener("photo-media-progress", progress);
    window.addEventListener("photo-ai-error", error);
    window.addEventListener("photo-files-reconnected", resumePending);
    return () => {
      window.removeEventListener("photo-ai-pending", update);
      window.removeEventListener("photo-media-progress", progress);
      window.removeEventListener("photo-ai-error", error);
      window.removeEventListener("photo-files-reconnected", resumePending);
    };
  }, []);

  const [page, updatePage] = useState(location.hash === "#work" ? "work" : "collections"),
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
  const setPage = (value) => { updatePage(value); if (location.hash !== "#" + value) location.hash = value; };
  const [mobileSelect, setMobileSelect] = useState(false);
  useEffect(() => { const update = () => updatePage(location.hash === "#work" ? "work" : "collections"); window.addEventListener("hashchange", update); return () => window.removeEventListener("hashchange", update); }, []);
  const [sharing, setSharing] = useState(false);
  const [networkDialog, setNetworkDialog] = useState(false),
    [networkURLs, setNetworkURLs] = useState(""),
    [networkJobs, setNetworkJobs] = useState([]),
    [cleanupJobs, setCleanupJobs] = useState([]);
  const [importMenu, setImportMenu] = useState(false),
    [direct, setDirect] = useState(false);
  const [uploadItems,setUploadItems] = useState([]);
  const uploading = useRef(false);
  const input = useRef(),
    guard = useRef(false),
    alive = useRef(true),
    undoFocus = useRef([]),
    selectionAnchor = useRef(null);
  useEffect(() => {
    undoFocus.current = [];
  }, [batchId]);
  const notify = setToast;
  const refresh = async () => {
    const [p, c, b, j, networks, cleanups] = await Promise.all([
      api("/assets"),
      api("/collections"),
      api("/batches"),
      api("/jobs"),
      api("/network-jobs"),
      api("/cleanup-jobs"),
    ]);
    if (!alive.current) return;
    registerAssets(p);
    setPhotos(p);
    setCollections(c);
    setBatches(b);
    setJobs(j);
    setNetworkJobs(networks);
    setCleanupJobs(cleanups);
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
  useEffect(() => {
    setSelected([]);
    selectionAnchor.current = null;
  }, [
    page,
    batchId,
    round,
    collectionId,
    processed,
    JSON.stringify(filters),
    collection?.photoIds.join("|"),
    fold,
    JSON.stringify([...expanded]),
  ]);
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
    page === "work" && round === "initial" && fold
      ? [...grouped].flatMap(([id, list]) =>
          expanded.has(id) ? list : [list[0]],
        )
      : filtered;
  const [limit, setLimit] = useState(100);
  useEffect(
    () => setLimit(100),
    [page, batchId, collectionId, JSON.stringify(filters), round],
  );
  const choosePhoto = (event, id, checkbox = false) => {
    event.stopPropagation();
    const next = selectPhoto(
      { selected, anchor: selectionAnchor.current },
      id,
      visible.slice(0, limit).map((p) => p.id),
      {
        toggle: checkbox || event.metaKey || event.ctrlKey,
        shift: event.shiftKey,
        append: event.metaKey || event.ctrlKey,
      },
    );
    setSelected(next.selected);
    selectionAnchor.current = next.anchor;
    setCursor(id);
  };
  const decide = async (ids, patch, r = round) =>
    run(async () => {
      await api(
        `/batches/${batchId}/decisions`,
        json("PATCH", { ids, round: r, status: patch.status }),
      );
      undoFocus.current.push({
        cursor,
        selected: [...selected],
        anchor: selectionAnchor.current,
      });
      setCursor(
        nextAfterDecision(
          filtered.map((p) => p.id),
          ids,
        ),
      );
      selectionAnchor.current = null;
      setSelected([]);
    });
  const undo = async () =>
    run(async () => {
      const result = await api(`/batches/${batchId}/undo`, json("POST", {}));
      if (result.ok) {
        const snapshot = undoFocus.current.pop();
        setCursor(snapshot?.cursor || result.ids[0]);
        setSelected(
          snapshot?.selected?.length ? snapshot.selected : result.ids,
        );
        selectionAnchor.current = snapshot?.anchor || result.ids[0];
      } else throw new Error("没有可撤销的决定");
    });
  const openScreen = (id = cursor || filtered[0]?.id) => {
    if (id) setImmersive({ startId: id, scopeIds: filtered.map((p) => p.id) });
  };
  useEffect(() => {
    const key = (e) => {
      if (
        page === "wall" ||
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
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
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
          void decide(selected.length ? selected : [id], {
            status: decisionKeys[e.key.toLowerCase()],
          });
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
  const processUploads = async (items, id, isDirect) => {
    if(uploading.current) return;
    uploading.current=true;
    let next=0;
    const change=(item,patch)=>{Object.assign(item,patch);setUploadItems(items.map(v=>({...v})));};
    try {
      await Promise.all([0,1].map(async()=>{while(next<items.length){
        const item=items[next++]; if(item.state==="done")continue;
        change(item,{state:"uploading",error:null});
        try {
          const form=new FormData(); form.append("uploadId",item.id);form.append("lastModified",String(item.file.lastModified));form.append("photos",item.file);
          const result=await api(`/batches/${id}/import`,{method:"POST",body:form});
          if(result.results[0]?.error)throw new Error(result.results[0].error);
          change(item,{state:"done"}); await refresh();setBatchPhotos(await api(`/batches/${id}/photos`));
        }catch(e){change(item,{state:"error",error:e.message});}
      }}));
      if(isDirect && items.every(v=>v.state==="done")) {
        await api(`/batches/${id}/finish`,json("POST",{round:"initial"}));
        await api(`/batches/${id}/finish`,json("POST",{round:"final"}));
        setCollectionId("");setPage("collections");await refresh();
      }
    }catch(e){notify(e.message);}finally{uploading.current=false;}
  };
  const uploadFiles = async files => {
    if(uploading.current || !files.length)return;
    try {
      let id=batchId;
      if(!batch || batch.state!=="initial" || batch.source!=="upload" || direct) {
        const b=await api("/batches",json("POST",{name:new Date().toLocaleDateString()+" 导入",source:"upload",direct}));id=b.id;setBatchId(id);
      }
      const items=files.map(file=>({id:Array.from(crypto.getRandomValues(new Uint8Array(16)), n=>n.toString(16).padStart(2,"0")).join(""),file,state:"pending",batchId:id,direct}));
      setUploadItems(items);setPage("work");setRound("initial");await processUploads(items,id,direct);
    }catch(e){notify(e.message);}
  };
  const download = async (list) => run(() => downloadPhotos(list, setBusy));
  const classify = () =>
    run(async () => {
      const ids = selected.length ? selected : filtered.map((p) => p.id);
      await api("/projects/library/analyze", json("POST", { ids }));
    });
  if (page === "wall")
    return (
      <>
        <Gallery
          photos={photos}
          collections={collections}
          navigate={setPage}
          onOpen={(id) => {
            setCollectionId(id);
            setFilters({});
            setMode("photos");
            setPage("collections");
          }}
        />
        {viewer && (
          <Viewer
            {...viewer}
            onClose={() => setViewer(null)}
            onDownload={download}
          />
        )}
      </>
    );
  return (
    <div className={`wall-app ${mobileSelect ? "selection-mode" : ""}`}>
      <header className="wall-header">
        <a className="wall-brand" href="/">
          <Camera size={22} />
          我的作品集
        </a>
        <nav>
          {[
            ["wall", "时间线"],
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
        {!!uploadItems.length && <section className="upload-progress" aria-label="上传进度">
          <span>上传 {uploadItems.filter(v=>v.state==="done").length}/{uploadItems.length}</span>
          <progress value={uploadItems.filter(v=>v.state==="done").length} max={uploadItems.length}/>
          {uploadItems.some(v=>v.state==="error") && <><Button disabled={uploadItems.some(v=>v.state==="uploading")} onClick={()=>processUploads(uploadItems,uploadItems[0].batchId,uploadItems[0].direct)}>重试失败照片</Button><details><summary>查看失败照片</summary>{uploadItems.filter(v=>v.state==="error").map(v=><p key={v.id}>{v.file.name} · {v.error}</p>)}</details></>}
          {uploadItems.every(v=>v.state==="done") && <Button onClick={()=>setUploadItems([])}>关闭</Button>}
        </section>}
        <TaskBar
          jobs={jobs}
          projectId="library"
          refresh={refresh}
          notify={notify}
        />
        {waitingAI.map((j) => (
          <div className="task-row" key={j.id}>
            <span>AI 任务待发送 · 等待连接电脑文件夹</span>
            <button onClick={resumePending}>继续</button>
            <button onClick={() => cancelPending(j.id)}>取消</button>
          </div>
        ))}
        {mediaProgress && (
          <div className="task-row">
            <span>准备 AI 预览</span>
            <progress value={mediaProgress.done} max={mediaProgress.total} />
            <span>
              {mediaProgress.done}/{mediaProgress.total}
            </span>
          </div>
        )}
        {networkJobs
          .filter((j) => !["done", "cancelled"].includes(j.state))
          .map((j) => (
            <div className="task-row" key={j.id}>
              <strong>网络导入</strong>
              <progress
                value={j.items.filter((i) => i.state === "done").length}
                max={j.items.length}
              />
              <span>
                {j.items.filter((i) => i.state === "done").length}/
                {j.items.length} · 失败{" "}
                {j.items.filter((i) => i.state === "error").length}
              </span>
              {["pause", "resume", "retry", "cancel"].map((a) => (
                <button
                  key={a}
                  onClick={() =>
                    run(() =>
                      api(`/network-jobs/${j.id}/${a}`, json("POST", {})),
                    )
                  }
                >
                  {
                    {
                      pause: "暂停",
                      resume: "继续",
                      retry: "重试失败",
                      cancel: "取消",
                    }[a]
                  }
                </button>
              ))}
            </div>
          ))}
        {cleanupJobs.some((j) => j.state === "error") && (
          <div className="task-row">
            <span>
              清理待重试 {cleanupJobs.filter((j) => j.state === "error").length} 项
            </span>
            <button
              onClick={() =>
                run(() => api("/cleanup-jobs/retry", json("POST", {})))
              }
            >
              重试
            </button>
          </div>
        )}
        <div className="wall-title">
          <div>
            <h1>
              {page === "wall"
                ? "照片墙"
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
            <Button primary icon={Upload} onClick={() => setImportMenu(true)}>
              导入照片
            </Button>
          </div>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
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
                <Button
                  disabled={
                    !!busy ||
                    batch.state === "completed" ||
                    (round === "initial" && batch.state !== "initial")
                  }
                  onClick={() =>
                    run(async () => {
                      await api(
                        `/batches/${batchId}/finish`,
                        json("POST", { round }),
                      );
                      setProcessed(false);
                      if (round === "initial") setRound("final");
                      else {
                        setPage("collections");
                        setBatchId("");
                      }
                    })
                  }
                >
                  {round === "initial"
                    ? "完成初筛"
                    : "完成精筛"}
                </Button>
                {batch.source === "network" &&
                  batchPhotos.some(
                    (p) => inInitial(p) && p.storage !== "local",
                  ) && (
                    <Button
                      onClick={async () => {
                        try {
                          const directory = await chooseFolder("readwrite");
                          await run(() =>
                            saveNetworkPhotos(
                              directory,
                              batchPhotos.filter(
                                (p) =>
                                  inInitial(p) &&
                                  p.storage !== "local" &&
                                  !p.cleaned,
                              ),
                              setBusy,
                            ),
                          );
                        } catch (e) {
                          if (e.name !== "AbortError") notify(e.message);
                        }
                      }}
                    >
                      入选照片保存到电脑
                    </Button>
                  )}
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
                {(c.coverId || c.photoIds[0]) && (
                  <PhotoImage
                    quiet
                    className="collection-cover"
                    src={photoURL(c.coverId || c.photoIds[0])}
                    alt=""
                  />
                )}
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
          <Button className="mobile-select-toggle" onClick={() => { setMobileSelect(v => !v); setSelected([]); }}> {mobileSelect ? "完成选择" : "选择"} </Button>
          <span>{filtered.length} 张</span>
          {window.showDirectoryPicker && photos.some((p) => p.storage === "local") && (
            <Button
              onClick={async () => {
                try {
                  const directory = await chooseFolder();
                  await run(async () => {
                    const result = await importFolder(directory, {
                      reconnect: true,
                      onProgress: setBusy,
                    });
                    notify(`已重新连接 ${result.matched} 张`);
                  });
                } catch (e) {
                  if (e.name !== "AbortError") notify(e.message);
                }
              }}
            >
              重新连接文件夹
            </Button>
          )}
          {page === "work" && round === "initial" && (
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
          <section className="wall-filter" role="dialog" aria-label="筛选照片">
            <Button className="filter-close" onClick={() => setShowFilters(false)}>完成筛选</Button>
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
        {collection && page !== "work" && (
          <div className="wall-actions">
            <Button onClick={() => setSharing(true)}>分享作品集</Button>
            <Button
              onClick={() =>
                setDialog({
                  title: "作品集名称",
                  submit: async (name) => {
                    await api(
                      `/collections/${collection.id}`,
                      json("PUT", { name }),
                    );
                    await refresh();
                  },
                })
              }
            >
              改名
            </Button>
            <Button
              onClick={() =>
                download(
                  collection.photoIds
                    .map((id) => photos.find((p) => p.id === id))
                    .filter(Boolean),
                )
              }
            >
              下载作品集
            </Button>
          </div>
        )}
        {!!selected.length && (
          <div className="selection-toolbar">
            <span>已选 {selected.length} 张</span>
            {page === "work" && (
              <>
                {round === "initial" && (
                  <Button
                    disabled={!!busy}
                    onClick={() => decide(selected, { status: "maybe" })}
                  >
                    待定所选 Z
                  </Button>
                )}
                <Button
                  disabled={!!busy}
                  onClick={() => decide(selected, { status: "keep" })}
                >
                  保留所选 X
                </Button>
                <Button
                  disabled={!!busy}
                  onClick={() => decide(selected, { status: "reject" })}
                >
                  不要所选 C
                </Button>
              </>
            )}
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
                        json("PUT", {
                          photoIds: [
                            ...collection.photoIds.filter((id) =>
                              selected.includes(id),
                            ),
                            ...collection.photoIds.filter(
                              (id) => !selected.includes(id),
                            ),
                          ],
                        }),
                      ),
                    )
                  }
                >
                  置顶
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
                  draggable={!!collection && page !== "work"}
                  onDragStart={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.setData("application/x-photo-id", p.id);
                  }}
                  onDragOver={(e) => {
                    if (collection && page !== "work") e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("application/x-photo-id");
                    if (!collection?.photoIds.includes(id) || id === p.id)
                      return;
                    const ids = collection.photoIds.filter((v) => v !== id);
                    ids.splice(ids.indexOf(p.id), 0, id);
                    void run(() =>
                      api(
                        `/collections/${collection.id}`,
                        json("PUT", { photoIds: ids }),
                      ),
                    );
                  }}
                  className={`wall-card ${cursor === p.id ? "focused" : ""} ${selected.includes(p.id) ? "selected" : ""}`}
                  onMouseDown={(e) => {
                    if (
                      e.shiftKey &&
                      !e.target.closest("button,input,a,details")
                    )
                      e.preventDefault();
                  }}
                  onClick={(e) => {
                    if (e.target.closest("button,input,a,details,label"))
                      return;
                    if (matchMedia("(pointer: coarse)").matches && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
                      if (mobileSelect) choosePhoto(e, p.id, true);
                      else if (page === "work") openScreen(p.id);
                      else setViewer({ photos: filtered, index: filtered.findIndex(v => v.id === p.id) });
                    } else choosePhoto(e, p.id);
                  }}
                  onDoubleClick={(e) => {
                    if (
                      e.metaKey ||
                      e.ctrlKey ||
                      e.shiftKey ||
                      e.target.closest("button,input,a,details,label")
                    )
                      return;
                    page === "work"
                      ? openScreen(p.id)
                      : setViewer({
                          photos: filtered,
                          index: filtered.findIndex((v) => v.id === p.id),
                        });
                  }}
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
                        onChange={() => {}}
                        onClick={(e) => choosePhoto(e, p.id, true)}
                      />
                    </label>
                    {page === "work" &&
                      round === "initial" &&
                      group.length > 1 && (
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
                    {p.description && (
                      <details
                        className="photo-description"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <summary>照片描述</summary>
                        <p>{p.description}</p>
                      </details>
                    )}
                    {page === "work" && p.status === "reject" && <small>{p.cleaned ? "已清理" : `自动清理：${p.cleanupAt ? new Date(p.cleanupAt).toLocaleString() : "三小时后"}`}</small>}
                    {page === "work" && !p.cleaned && (
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
      {sharing && collection && (
        <ShareManager
          collection={collection}
          onClose={() => setSharing(false)}
          notify={notify}
        />
      )}
      {networkDialog && (
        <Modal title="网络导入" onClose={() => setNetworkDialog(false)}>
          <form
            className="import-options"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const b = await api(
                  "/batches",
                  json("POST", {
                    source: "network",
                    name: "网络导入 " + new Date().toLocaleDateString(),
                    direct,
                  }),
                );
                await api(
                  `/batches/${b.id}/network`,
                  json("POST", {
                    urls: networkURLs.split(/\s+/).filter(Boolean),
                  }),
                );
                setBatchId(b.id);
                setPage("work");
                setRound("initial");
                setNetworkDialog(false);
                setNetworkURLs("");
              });
            }}
          >
            <label className="field">
              图片地址，一行一个
              <textarea
                aria-label="网络图片地址"
                rows={8}
                value={networkURLs}
                onChange={(e) => setNetworkURLs(e.target.value)}
                required
              />
            </label>
            <Button primary type="submit" disabled={!!busy}>
              开始导入
            </Button>
          </form>
        </Modal>
      )}
      {importMenu && (
        <Modal title="导入照片" onClose={() => setImportMenu(false)}>
          <div className="import-options">
            <label>
              <input
                type="checkbox"
                checked={direct}
                onChange={(e) => setDirect(e.target.checked)}
              />
              已经选好，直接进入待归集
            </label>
            {window.showDirectoryPicker && <Button
              primary
              onClick={async () => {
                try {
                  const directory = await chooseFolder();
                  setImportMenu(false);
                  await run(async () => {
                    const result = await importFolder(directory, {
                      direct,
                      onProgress: setBusy,
                    });
                    setBatchId(result.batch.id);
                    setPage(direct ? "collections" : "work");
                    setRound("initial");
                    notify(
                      `已读取 ${result.done} 张，失败 ${result.failed} 张`,
                    );
                  });
                } catch (e) {
                  if (e.name !== "AbortError") notify(e.message);
                }
              }}
            >
              连接电脑文件夹
            </Button>}
            <Button
              onClick={() => {
                setImportMenu(false);
                input.current.click();
              }}
            >
              {matchMedia("(pointer: coarse)").matches ? "从相册选择" : "普通上传到服务器"}
            </Button>
            <Button
              onClick={() => {
                setImportMenu(false);
                setNetworkDialog(true);
              }}
            >
              网络图片链接
            </Button>
          </div>
        </Modal>
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
