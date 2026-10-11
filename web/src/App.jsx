import React, {
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
} from "react";
import {
  Camera,
  Images,
  Layers,
  Heart,
  Check,
  Plus,
  ArrowUpRight,
  Settings2,
  Search,
  SlidersHorizontal,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  Upload,
  ImagePlus,
  X,
  Undo2,
  CheckCheck,
  Trash2,
  LayoutGrid,
  Columns2,
  Sparkles,
  PanelRightClose,
  PanelRightOpen,
  MoreHorizontal,
  Mountain,
  Folder,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Expand,
  Focus,
  Lock,
  Unlock,
  Download,
  GripVertical,
  ArrowLeft,
  ArrowRight,
  Info,
  CheckCircle2,
} from "lucide-react";
import { api, json, photoURL } from "./api";
import Settings from "./Settings";
import Immersive from "./Immersive";
import Studio from "./Studio";
import {
  filterPhotos,
  FOCAL_LABELS,
  tagsOf,
  STATUS_LABELS,
} from "../../shared/domain.mjs";

export function Button({
  children,
  icon: Icon,
  onClick,
  primary = false,
  className = "",
  ...props
}) {
  return (
    <button
      className={`${primary ? "primary" : "button"} ${className}`}
      onClick={onClick}
      {...props}
    >
      {Icon && <Icon size={16} />} {children}
    </button>
  );
}
export function Modal({ title, children, onClose, wide = false }) {
  return (
    <div
      className="modal-shade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function InputDialog({ dialog, onClose }) {
  const [value, setValue] = useState(dialog.initial || "");
  return (
    <Modal title={dialog.title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          dialog.submit(value);
          onClose();
        }}
      >
        <label className="field">
          {dialog.label || "名称"}
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={dialog.placeholder || ""}
          />
        </label>
        <footer>
          <Button onClick={onClose} type="button">
            取消
          </Button>
          <Button primary type="submit">
            确定
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
function VirtualGrid({
  items,
  selected,
  onSelect,
  onOpen,
  onExpand,
  renderBadge,
}) {
  const ref = useRef();
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [top, setTop] = useState(0);
  useEffect(() => {
    const o = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    if (ref.current) o.observe(ref.current);
    return () => o.disconnect();
  }, []);
  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = 0;
      setTop(0);
    }
  }, [items.length]);
  const columns = Math.max(1, Math.floor(size.width / 235)),
    gap = 20,
    width = (size.width - gap * (columns - 1)) / columns,
    height = width * 0.72 + 78,
    rowHeight = height + gap;
  const start = Math.max(0, Math.floor(top / rowHeight) - 1) * columns,
    end = Math.min(
      items.length,
      (Math.ceil((top + size.height) / rowHeight) + 2) * columns,
    );
  return (
    <div
      className="grid-scroll"
      ref={ref}
      onScroll={(e) => setTop(e.currentTarget.scrollTop)}
    >
      <div
        style={{
          height: Math.ceil(items.length / columns) * rowHeight,
          position: "relative",
        }}
      >
        {items.slice(start, end).map((item, i) => {
          const index = i + start,
            p = item.photo;
          return (
            <article
              key={p.id}
              className={`photo-card ${selected.includes(p.id) ? "selected" : ""} ${p.status === "reject" ? "rejected" : ""}`}
              style={{
                position: "absolute",
                width,
                height,
                left: (index % columns) * (width + gap),
                top: Math.floor(index / columns) * rowHeight,
              }}
              onClick={(e) => onSelect(p.id, e)}
              onDoubleClick={() => onOpen(p.id)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelect(p.id, e);
              }}
              aria-label={p.name}
            >
              <div className="photo-image" style={{ height: width * 0.72 }}>
                <img
                  loading="lazy"
                  draggable="false"
                  src={photoURL(p.id)}
                  alt={p.name}
                />
                <span
                  className={`select-circle ${selected.includes(p.id) ? "on" : ""}`}
                >
                  {selected.includes(p.id) && <Check size={12} />}
                </span>
                {item.count > 1 && (
                  <button
                    className="stack-badge"
                    onClick={(e) => {
                      e.stopPropagation();
                      onExpand(item.group);
                    }}
                    title="展开相似组"
                  >
                    <Layers size={12} />
                    {item.count}
                  </button>
                )}
                {p.favorite && (
                  <Heart
                    className="photo-heart"
                    size={17}
                    fill="currentColor"
                  />
                )}
                {p.status === "keep" && (
                  <span className="keep-badge">
                    <Check size={11} /> 已保留
                  </span>
                )}
                {p.analysisStatus === "running" && (
                  <span className="processing">
                    <Loader2 size={12} /> 分析中
                  </span>
                )}
              </div>
              <div className="photo-caption">
                <strong title={p.name}>{p.name}</strong>
                <span>
                  {p.focal ? `${p.focal}mm` : "—"}
                  {p.aperture ? ` · ƒ/${p.aperture}` : ""}
                </span>
                <span className="photo-tags">
                  {p.ai?.scene ||
                    p.ai?.tags?.slice(0, 2).join(" · ") ||
                    (p.analysisStatus === "done"
                      ? "本地分析完成"
                      : "等待本地分析")}
                  {p.issues?.length > 0 && (
                    <i title={p.issues.join("；")}>待检查</i>
                  )}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
function Compare({ photos, onClose, onPatch }) {
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const [oneToOne, setOneToOne] = useState(false);
  const focus = () => {
    const f = photos[0]?.faces?.[0];
    if (f) {
      setZoom(3);
      setPan({
        x: (0.5 - f.x - f.width / 2) * 500,
        y: (0.5 - f.y - f.height / 2) * 500,
      });
    } else {
      setZoom(2);
      setPan({ x: 0, y: 0 });
    }
  };
  return (
    <Modal
      title={photos.length > 1 ? "同步对比 · 找到最值得的一张" : "照片预览"}
      onClose={onClose}
      wide
    >
      <div className="compare-toolbar">
        <span>{photos.length} 张照片 · 拖动同步平移</span>
        <Button icon={Focus} onClick={focus}>
          面部 / 中心
        </Button>
        <Button
          onClick={() => {
            setOneToOne((v) => !v);
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          100% {oneToOne ? "✓" : ""}
        </Button>
        <input
          aria-label="同步缩放"
          type="range"
          min="1"
          max="5"
          step=".1"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        />
        <Button
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
            setOneToOne(false);
          }}
        >
          适应
        </Button>
      </div>
      <div
        className="compare-grid"
        style={{
          gridTemplateColumns: `repeat(${Math.min(photos.length, 4)},1fr)`,
        }}
      >
        {photos.slice(0, 4).map((p) => (
          <div key={p.id}>
            <div
              className="compare-image"
              onPointerDown={(e) => {
                drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (drag.current)
                  setPan({
                    x: e.clientX - drag.current.x,
                    y: e.clientY - drag.current.y,
                  });
              }}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
            >
              <img
                draggable="false"
                src={photoURL(p.id, oneToOne ? "original" : "preview")}
                alt={p.name}
                style={{
                  maxWidth: oneToOne ? "none" : "100%",
                  maxHeight: oneToOne ? "none" : "100%",
                  width: oneToOne ? p.width : undefined,
                  transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
                }}
              />
            </div>
            <div className="compare-name">
              <span>{p.name}</span>
              <span>
                {p.sharpness != null ? `清晰度参考 ${p.sharpness}` : ""}
              </span>
            </div>
            <div className="compare-actions">
              <Button
                icon={Check}
                primary={p.status === "keep"}
                onClick={() => onPatch([p.id], { status: "keep" })}
              >
                保留
              </Button>
              <Button
                icon={Heart}
                onClick={() => onPatch([p.id], { favorite: !p.favorite })}
              >
                {p.favorite ? "已喜欢" : "喜欢"}
              </Button>
              <Button
                icon={X}
                onClick={() => onPatch([p.id], { status: "reject" })}
              >
                不要
              </Button>
            </div>
            <small className="muted">{p.issues?.join(" · ")}</small>
          </div>
        ))}
      </div>
    </Modal>
  );
}
export default function App() {
  const [projects, setProjects] = useState([]),
    [projectId, setProjectId] = useState(
      localStorage.getItem("photo-project") || "",
    ),
    [photos, setPhotos] = useState([]),
    [groups, setGroups] = useState([]),
    [collections, setCollections] = useState([]),
    [jobs, setJobs] = useState(null);
  const [nav, setNav] = useState("all"),
    [selected, setSelected] = useState([]),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState({}),
    [fold, setFold] = useState(true),
    [expanded, setExpanded] = useState(new Set()),
    [showFilters, setShowFilters] = useState(false),
    [inspector, setInspector] = useState(true);
  const [dialog, setDialog] = useState(null),
    [compare, setCompare] = useState(null),
    [toast, setToast] = useState(""),
    [uploading, setUploading] = useState(null),
    [dragging, setDragging] = useState(false),
    [settings, setSettings] = useState(false),
    [studio, setStudio] = useState(false),
    [immersive, setImmersive] = useState(null);
  const fileRef = useRef(),
    folderRef = useRef(),
    uploadPaused = useRef(false),
    projectRef = useRef(projectId);
  const notify = useCallback((message) => {
    setToast(message);
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const refreshProjects = useCallback(async () => {
    const p = await api("/projects");
    setProjects(p);
    if (!projectRef.current && p.length) setProjectId(p[0].id);
  }, []);
  const refresh = useCallback(async () => {
    if (!projectId) return;
    const result = await Promise.all([
      api(`/projects/${projectId}/photos`),
      api(`/projects/${projectId}/groups`),
      api(`/projects/${projectId}/collections`),
      api("/jobs"),
    ]);
    if (projectRef.current !== projectId) return;
    setPhotos(result[0]);
    setGroups(result[1]);
    setCollections(result[2]);
    setJobs(result[3]);
  }, [projectId]);
  useEffect(() => {
    projectRef.current = projectId;
    localStorage.setItem("photo-project", projectId);
    setSelected([]);
    setNav("all");
    setPhotos([]);
    refresh().catch((e) => notify(e.message));
  }, [projectId, refresh, notify]);
  useEffect(() => {
    refreshProjects().catch((e) => notify(e.message));
  }, [refreshProjects, notify]);
  useEffect(() => {
    const t = setInterval(() => refresh().catch(() => {}), 2500);
    return () => clearInterval(t);
  }, [refresh]);
  const run = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      notify(e.message);
    }
  };
  const project = projects.find((p) => p.id === projectId),
    active = photos.find((p) => p.id === selected.at(-1)),
    collection = collections.find((c) => c.id === nav);
  const createProject = () =>
    setDialog({
      title: "开启一段新的旅行",
      placeholder: "例如：川西 · 秋日雪山",
      submit: (name) =>
        run(async () => {
          const p = await api("/projects", json("POST", { name }));
          setProjectId(p.id);
          await refreshProjects();
        }),
    });
  async function importFiles(files) {
    if (!files?.length) return;
    let id = projectId;
    if (!id) {
      const p = await api(
        "/projects",
        json("POST", { name: "我的第一次选片" }),
      );
      id = p.id;
      setProjectId(id);
      await refreshProjects();
    }
    const list = Array.from(files).filter((f) => /\.jpe?g$/i.test(f.name));
    if (!list.length) {
      notify("请选择 JPEG 格式照片");
      return;
    }
    let failures = 0;
    uploadPaused.current = false;
    for (let i = 0; i < list.length; i += 8) {
      while (uploadPaused.current) await new Promise((r) => setTimeout(r, 200));
      setUploading({ done: i, total: list.length, paused: false });
      const batch = list.slice(i, i + 8),
        body = new FormData();
      batch.forEach((f) => body.append("photos", f));
      body.append("names", JSON.stringify(batch.map((f) => f.name)));
      body.append("modified", JSON.stringify(batch.map((f) => f.lastModified)));
      try {
        const result = await api(`/projects/${id}/import`, {
          method: "POST",
          body,
        });
        failures += result.results.filter((r) => r.error).length;
        if (result.results.some((r) => r.error))
          notify(result.results.find((r) => r.error).error);
      } catch (e) {
        failures += batch.length;
        notify(e.message);
      }
      if (projectRef.current === id) {
        const p = await api(`/projects/${id}/photos`);
        setPhotos(p);
      }
    }
    setUploading(null);
    await refreshProjects();
    notify(
      `已导入 ${list.length - failures} 张照片${failures ? `，${failures} 张失败` : ""}`,
    );
  }
  const patch = async (ids, values) =>
    run(async () => {
      await api(
        `/projects/${projectId}/photos`,
        json("PATCH", { ids, patch: values }),
      );
      await refresh();
      return true;
    });
  const undo = () =>
    run(async () => {
      const result = await api(`/projects/${projectId}/undo`, json("POST", {}));
      notify(result.ok ? `已撤销：${result.label}` : "没有可撤销的操作");
      await refresh();
    });
  const similarCount = useMemo(() => {
    const counts = new Map();
    for (const p of photos)
      if (p.similarId)
        counts.set(p.similarId, (counts.get(p.similarId) || 0) + 1);
    return [...counts.values()].filter((n) => n > 1).length;
  }, [photos]);
  const activeIssues = [
    ...new Set([...(active?.issues || []), ...(active?.ai?.issues || [])]),
  ];
  const sceneOptions = useMemo(() => {
    const ids = [...new Set(photos.map((p) => p.sceneId).filter(Boolean))];
    return ids.map((id, i) => ({
      id,
      name:
        groups.find((g) => g.id === id)?.name ||
        photos.find((p) => p.sceneId === id && p.ai?.scene)?.ai.scene ||
        `场景 ${String(i + 1).padStart(2, "0")}`,
      count: photos.filter((p) => p.sceneId === id).length,
    }));
  }, [photos, groups]);
  const filtered = useMemo(() => {
    let list = filterPhotos(photos, {
      ...filter,
      query,
      status: ["keep", "reject", "unseen"].includes(nav) ? nav : filter.status,
      favorite: nav === "favorites",
      scene: nav.startsWith("scene-") ? nav : null,
    });
    if (collection)
      list = collection.photoIds
        .map((id) => list.find((p) => p.id === id))
        .filter(Boolean);
    if (nav === "similar") {
      const counts = new Map();
      photos.forEach((p) => {
        if (p.similarId)
          counts.set(p.similarId, (counts.get(p.similarId) || 0) + 1);
      });
      list = list.filter((p) => counts.get(p.similarId) > 1);
    }
    return list;
  }, [photos, filter, query, nav, collection]);
  const items = useMemo(() => {
    if (!fold || collection)
      return filtered.map((p) => ({ photo: p, count: 1 }));
    const memberMap = new Map();
    for (const p of filtered) {
      if (!memberMap.has(p.similarId)) memberMap.set(p.similarId, []);
      memberMap.get(p.similarId).push(p);
    }
    const seen = new Set(),
      items = [];
    for (const p of filtered) {
      if (!p.similarId || expanded.has(p.similarId)) {
        items.push({ photo: p, count: 1 });
        continue;
      }
      if (seen.has(p.similarId)) continue;
      seen.add(p.similarId);
      const members = memberMap.get(p.similarId),
        representative = groups.find(
          (g) => g.id === p.similarId,
        )?.representative;
      items.push({
        photo:
          members.find((x) => x.id === representative) ||
          members.find((x) => x.status === "keep") ||
          p,
        count: members.length,
        group: p.similarId,
      });
    }
    return items;
  }, [filtered, fold, expanded, collection, groups]);
  const choose = (id, event) => {
    if (event?.metaKey || event?.ctrlKey)
      setSelected((v) =>
        v.includes(id) ? v.filter((x) => x !== id) : [...v, id],
      );
    else if (event?.shiftKey && selected.length) {
      const a = filtered.findIndex((p) => p.id === selected[0]),
        b = filtered.findIndex((p) => p.id === id);
      setSelected(
        filtered.slice(Math.min(a, b), Math.max(a, b) + 1).map((p) => p.id),
      );
    } else setSelected([id]);
  };
  const addCollection = () =>
    setDialog({
      title: "新建作品集",
      placeholder: "例如：雪山朋友圈",
      submit: (name) =>
        run(async () => {
          const c = await api(
            `/projects/${projectId}/collections`,
            json("POST", { name, photoIds: selected }),
          );
          await refresh();
          setNav(c.id);
          notify("作品集已创建");
        }),
    });
  const groupAction = (type, action) =>
    run(async () => {
      await api(
        `/projects/${projectId}/groups`,
        json("POST", {
          ids: selected,
          type,
          action,
          name: type === "scene" ? "我的场景" : "我的相似组",
        }),
      );
      setSelected([]);
      await refresh();
    });
  useEffect(() => {
    const handle = (e) => {
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) ||
        dialog ||
        settings ||
        studio ||
        immersive
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (!selected.length) return;
      const key = e.key.toLowerCase();
      if (["p", "x", "u", "f", " ", "arrowright", "arrowleft"].includes(key))
        e.preventDefault();
      if (key === "p") patch(selected, { status: "keep" });
      if (key === "x") patch(selected, { status: "reject" });
      if (key === "u") patch(selected, { status: "unseen" });
      if (key === "f") patch(selected, { favorite: !active?.favorite });
      if (key === " ") setImmersive(selected[0]);
      if (key === "arrowright" || key === "arrowleft") {
        const idx = filtered.findIndex((p) => p.id === selected.at(-1)),
          next = filtered[idx + (key === "arrowright" ? 1 : -1)];
        if (next) setSelected([next.id]);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [
    selected,
    active,
    filtered,
    dialog,
    settings,
    studio,
    immersive,
    projectId,
  ]);
  const selectionPhotos = photos.filter((p) => selected.includes(p.id));
  const pageTitle =
    collection?.name ||
    sceneOptions.find((s) => s.id === nav)?.name ||
    {
      all: "旅途中的每一个瞬间",
      similar: "相似的瞬间，选一张心动的",
      keep: "留下来的，都是值得的",
      favorites: "偏爱的每一张",
      reject: "暂时放下的照片",
      unseen: "慢慢看，总有惊喜",
    }[nav] ||
    "照片库";
  return (
    <div
      className="app-shell"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        run(() => importFiles(e.dataTransfer.files));
      }}
    >
      <input
        type="file"
        accept="image/jpeg"
        multiple
        ref={fileRef}
        hidden
        onChange={(e) => {
          run(() => importFiles(e.target.files));
          e.target.value = "";
        }}
      />
      <input
        type="file"
        webkitdirectory=""
        multiple
        ref={folderRef}
        hidden
        onChange={(e) => {
          run(() => importFiles(e.target.files));
          e.target.value = "";
        }}
      />
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Camera size={23} />
          </div>
          <div>
            <strong>
              选片助手<span className="beta">BETA</span>
            </strong>
            <small>让好照片，走到一起</small>
          </div>
        </div>
        <div className="project-select">
          <span className="eyebrow">当前旅行</span>
          <div>
            <select
              aria-label="当前旅行"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="" disabled>
                选择旅行项目
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              title="新建旅行"
              aria-label="新建旅行"
              onClick={createProject}
            >
              <Plus size={17} />
            </button>
          </div>
        </div>
        <nav>
          <span className="nav-label">照片库</span>
          {[
            [Images, "all", "全部照片", photos.length],
            [Layers, "similar", "相似分组", similarCount],
            [
              CheckCheck,
              "keep",
              "初筛保留",
              photos.filter((p) => p.status === "keep").length,
            ],
            [
              Heart,
              "favorites",
              "我的喜欢",
              photos.filter((p) => p.favorite).length,
            ],
          ].map(([Icon, id, label, count]) => (
            <button
              key={id}
              className={`nav-item ${nav === id ? "active" : ""}`}
              onClick={() => {
                setNav(id);
                setSelected([]);
              }}
            >
              <Icon size={17} />
              <span>{label}</span>
              <em>{count}</em>
            </button>
          ))}
          <div className="nav-section">
            <span className="nav-label">场景探索</span>
            <span className="tiny">{sceneOptions.length}</span>
          </div>
          {sceneOptions.slice(0, 8).map((s) => (
            <button
              key={s.id}
              className={`nav-item scene ${nav === s.id ? "active" : ""}`}
              onClick={() => setNav(s.id)}
            >
              <span className="scene-dot" />
              <span>{s.name}</span>
              <em>{s.count}</em>
            </button>
          ))}
          {!sceneOptions.length && (
            <p className="nav-hint">导入后自动发现场景</p>
          )}
          <div className="nav-section">
            <span className="nav-label">我的作品集</span>
            <button
              className="icon-button"
              aria-label="新建作品集"
              onClick={addCollection}
              disabled={!projectId}
            >
              <Plus size={15} />
            </button>
          </div>
          {collections.map((c) => (
            <button
              key={c.id}
              className={`nav-item ${nav === c.id ? "active" : ""}`}
              onClick={() => setNav(c.id)}
            >
              <Folder size={16} />
              <span>{c.name}</span>
              <em>{c.photoIds.length}</em>
            </button>
          ))}
          {!collections.length && (
            <p className="nav-hint">把喜欢的，编成一个故事</p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-label">
            <span className="online-dot" /> 本地工作空间 <Lock size={11} />
          </div>
          <button className="nav-item" onClick={() => setSettings(true)}>
            <Settings2 size={17} />
            <span>模型与服务设置</span>
          </button>
          <div className="sidebar-footer">
            PHOTO SELECTOR<span>v0.1</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            我的工作空间
            <ChevronRight size={13} />
            <span>{project?.name || "新的旅程"}</span>
          </div>
          <div className="topbar-right">
            <span className="model-status">
              <span className="online-dot" />
              {jobs?.local?.model || "照片留在本机"}
            </span>
            <button
              className={`icon-button ${inspector ? "active" : ""}`}
              aria-label="显示或隐藏照片信息"
              onClick={() => setInspector((v) => !v)}
            >
              {inspector ? (
                <PanelRightClose size={18} />
              ) : (
                <PanelRightOpen size={18} />
              )}
            </button>
          </div>
        </header>
        <div className="workspace-content">
          <section className="library">
            <div className="page-heading">
              <div>
                <div className="eyebrow">YOUR MOMENTS, WELL CURATED</div>
                <h1>{pageTitle}</h1>
                <p>
                  {photos.length
                    ? `${photos.length} 张照片 · ${photos.filter((p) => p.status === "keep").length} 张已保留`
                    : "从一整个相册，到真正想分享的那几张。"}
                  <span className="heading-dot">·</span>每一个选择，都可以重来
                </p>
              </div>
              <div className="heading-actions">
                {photos.length > 0 && (
                  <Button
                    icon={Expand}
                    onClick={() =>
                      setImmersive(
                        selected[0] || filtered[0]?.id || photos[0].id,
                      )
                    }
                  >
                    沉浸选片
                  </Button>
                )}
                {photos.length > 0 && (
                  <Button
                    icon={Sparkles}
                    onClick={() =>
                      run(async () => {
                        const ids = selected.length
                          ? selected
                          : photos
                              .filter((p) => p.status !== "reject")
                              .map((p) => p.id);
                        const job = await api(
                          `/projects/${projectId}/analyze`,
                          json("POST", { ids }),
                        );
                        notify(
                          job.total
                            ? `开始分析 ${job.total} 张照片`
                            : "所选照片已有分析结果",
                        );
                        await refresh();
                      })
                    }
                    disabled={
                      jobs?.ai?.running || jobs?.ai?.photoIds?.length > 0
                    }
                  >
                    {selected.length ? "分析所选" : "AI 标签"}
                  </Button>
                )}
                <Button
                  icon={Upload}
                  primary
                  onClick={() => fileRef.current.click()}
                  disabled={!!uploading}
                >
                  导入照片
                </Button>
                <button
                  className="icon-button outlined"
                  aria-label="导入文件夹"
                  title="导入整个文件夹"
                  onClick={() => folderRef.current.click()}
                  disabled={!!uploading}
                >
                  <FolderPlus size={18} />
                </button>
              </div>
            </div>
            <div className="workflow">
              <div className="current">
                <span>01</span>整理与初筛
              </div>
              <ChevronRight size={12} />
              <button onClick={() => setNav("keep")}>
                <span>02</span>精筛与搭配
              </button>
              <ChevronRight size={12} />
              <button onClick={() => setStudio(true)}>
                <span>03</span>拼图与导出
                <ArrowUpRight size={13} />
              </button>
            </div>
            <div className="filterbar">
              <div className="search">
                <Search size={17} />
                <input
                  aria-label="搜索照片"
                  placeholder="搜索场景、标签、照片名称…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    className="icon-button"
                    onClick={() => setQuery("")}
                    aria-label="清空搜索"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <button
                className={`button ${showFilters ? "toggled" : ""}`}
                onClick={() => setShowFilters((v) => !v)}
              >
                <SlidersHorizontal size={15} />
                筛选
              </button>
              <div className="toolbar-divider" />
              <button
                className={`view-toggle ${fold ? "on" : ""}`}
                onClick={() => setFold((v) => !v)}
                title="相似照片折叠"
              >
                <Layers size={16} />
              </button>
              <button
                className={`view-toggle ${!fold ? "on" : ""}`}
                onClick={() => setFold(false)}
                title="显示全部照片"
              >
                <LayoutGrid size={16} />
              </button>
            </div>
            {showFilters && (
              <div className="filter-panel">
                <select
                  aria-label="焦段筛选"
                  value={filter.focal || "all"}
                  onChange={(e) =>
                    setFilter({ ...filter, focal: e.target.value })
                  }
                >
                  <option value="all">全部焦段</option>
                  {FOCAL_LABELS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
                <select
                  aria-label="方向筛选"
                  value={filter.orientation || "all"}
                  onChange={(e) =>
                    setFilter({ ...filter, orientation: e.target.value })
                  }
                >
                  <option value="all">横图 + 竖图</option>
                  <option value="landscape">横图</option>
                  <option value="portrait">竖图</option>
                </select>
                <select
                  aria-label="状态筛选"
                  value={filter.status || "all"}
                  onChange={(e) =>
                    setFilter({ ...filter, status: e.target.value })
                  }
                >
                  <option value="all">全部状态</option>
                  {Object.entries(STATUS_LABELS).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="开始日期"
                  type="date"
                  value={filter.from || ""}
                  onChange={(e) =>
                    setFilter({ ...filter, from: e.target.value })
                  }
                />
                <input
                  aria-label="结束日期"
                  type="date"
                  value={filter.to || ""}
                  onChange={(e) => setFilter({ ...filter, to: e.target.value })}
                />
                <button className="text-button" onClick={() => setFilter({})}>
                  重置
                </button>
              </div>
            )}
            <div className="library-meta">
              <div className="pills">
                <button
                  className={!query ? "active" : ""}
                  onClick={() => setQuery("")}
                >
                  全部瞬间
                </button>
                {[...new Set(photos.flatMap((p) => p.ai?.tags || []))]
                  .slice(0, 4)
                  .map((tag) => (
                    <button
                      key={tag}
                      className={query === tag ? "active" : ""}
                      onClick={() => setQuery(query === tag ? "" : tag)}
                    >
                      {tag}
                    </button>
                  ))}
              </div>
              <span>
                {filtered.length} 张照片
                {fold && items.length < filtered.length
                  ? ` / ${items.length} 组`
                  : ""}
              </span>
              <select
                aria-label="相似度"
                className="small-select"
                value={project?.similarity || "standard"}
                onChange={(e) =>
                  run(async () => {
                    await api(
                      `/projects/${projectId}/regroup`,
                      json("POST", { level: e.target.value }),
                    );
                    await refresh();
                    await refreshProjects();
                  })
                }
              >
                <option value="strict">严格相似</option>
                <option value="standard">标准相似</option>
                <option value="loose">宽松相似</option>
              </select>
            </div>
            {uploading && (
              <div className="progress-banner">
                <Loader2 size={15} className="spin" />
                <span>
                  正在导入 {uploading.done} / {uploading.total} 张
                </span>
                <progress value={uploading.done} max={uploading.total} />
                <button
                  className="text-button"
                  onClick={() => {
                    uploadPaused.current = !uploadPaused.current;
                    setUploading({
                      ...uploading,
                      paused: uploadPaused.current,
                    });
                  }}
                >
                  {uploading.paused ? "继续" : "暂停"}
                </button>
              </div>
            )}
            {jobs?.local && (jobs.local.running || jobs.local.pending > 0) && (
              <div className="progress-banner">
                <Sparkles size={14} />
                <span>
                  {jobs.local.paused
                    ? "本地分析已暂停"
                    : `本地模型正在整理 · 剩余 ${jobs.local.pending} 张`}
                </span>
                <button
                  className="text-button"
                  onClick={() =>
                    run(async () => {
                      await api(
                        `/local/${jobs.local.paused ? "resume" : "pause"}`,
                        json("POST", {}),
                      );
                      await refresh();
                    })
                  }
                >
                  {jobs.local.paused ? "继续" : "暂停"}
                </button>
              </div>
            )}
            {jobs?.ai?.total > 0 && (
              <div className="progress-banner ai-progress">
                <Sparkles size={14} />
                <span>
                  AI 标签 · 完成 {jobs.ai.done}/{jobs.ai.total}
                  {jobs.ai.errors ? ` · ${jobs.ai.errors} 张失败` : ""}
                  {jobs.ai.paused && jobs.ai.photoIds?.length
                    ? " · 已暂停"
                    : ""}
                </span>
                {jobs.ai.photoIds?.length > 0 ? (
                  <>
                    <button
                      className="text-button"
                      onClick={() =>
                        run(async () => {
                          await api(
                            `/ai/${jobs.ai.paused ? "resume" : "pause"}`,
                            json("POST", {}),
                          );
                          await refresh();
                        })
                      }
                    >
                      {jobs.ai.paused ? "继续" : "暂停"}
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        run(async () => {
                          await api("/ai/cancel", json("POST", {}));
                          await refresh();
                        })
                      }
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <small>
                    用量 {jobs.ai.usage?.prompt_tokens || 0} /{" "}
                    {jobs.ai.usage?.completion_tokens || 0} tokens
                  </small>
                )}
              </div>
            )}
            {!photos.length ? (
              <div className="empty-library">
                <div className="empty-art">
                  <div className="art-card back" />
                  <div className="art-card front">
                    <Mountain size={61} strokeWidth={1} />
                    <span />
                  </div>
                  <div className="art-spark">✧</div>
                </div>
                <h2>把旅途带进来</h2>
                <p>
                  拖入照片，或选择一个旅行文件夹。
                  <br />
                  让相似的归组，让喜欢的留下。
                </p>
                <Button
                  primary
                  icon={ImagePlus}
                  onClick={() => fileRef.current.click()}
                >
                  选择照片，开始选片
                </Button>
                <span className="empty-footnote">
                  <Lock size={12} /> JPEG · 本地分析 · 原片保持不变
                </span>
              </div>
            ) : !items.length ? (
              <div className="empty-library compact">
                <Search size={32} />
                <h2>没有符合条件的照片</h2>
                <p>试试其他标签，或清除筛选条件。</p>
                <Button
                  onClick={() => {
                    setFilter({});
                    setQuery("");
                    setNav("all");
                  }}
                >
                  查看全部照片
                </Button>
              </div>
            ) : (
              <VirtualGrid
                items={items}
                selected={selected}
                onSelect={choose}
                onOpen={(id) => setImmersive(id)}
                onExpand={(id) => setExpanded((v) => new Set([...v, id]))}
              />
            )}
            <footer className="selection-bar">
              <div>
                <span className="selected-count">
                  {selected.length
                    ? `已选 ${selected.length} 张`
                    : "选择照片开始"}
                </span>
                <button
                  className="text-button"
                  disabled={!photos.length}
                  onClick={() => setSelected(filtered.map((p) => p.id))}
                >
                  全选
                </button>
                <button
                  className="icon-button"
                  title="撤销 ⌘Z"
                  onClick={undo}
                  disabled={!projectId}
                >
                  <Undo2 size={16} />
                </button>
              </div>
              <div>
                <Button
                  disabled={!selected.length}
                  onClick={() => patch(selected, { status: "unseen" })}
                >
                  待定
                </Button>
                <Button
                  icon={X}
                  disabled={!selected.length}
                  onClick={() => patch(selected, { status: "reject" })}
                >
                  不要
                </Button>
                <Button
                  icon={Columns2}
                  disabled={!selected.length || selected.length > 4}
                  onClick={() => setImmersive(selected[0])}
                >
                  沉浸对比
                </Button>
                <Button
                  icon={Check}
                  primary
                  disabled={!selected.length}
                  onClick={() => patch(selected, { status: "keep" })}
                >
                  保留
                </Button>
              </div>
            </footer>
          </section>
          {inspector && (
            <aside className="inspector">
              <div className="inspector-heading">
                <span>照片详情</span>
                <Info size={15} />
              </div>
              {active ? (
                <>
                  <div className="inspector-preview">
                    <img src={photoURL(active.id)} alt={active.name} />
                  </div>
                  <h3>{active.name}</h3>
                  <div className="subtle">
                    {active.width} × {active.height} ·{" "}
                    {STATUS_LABELS[active.status]}
                  </div>
                  <div className="metadata-grid">
                    {[
                      ["相机", active.camera],
                      ["镜头", active.lens],
                      ["焦距", active.focal ? `${active.focal}mm` : null],
                      ["焦段", active.focalCategory],
                      ["光圈", active.aperture ? `ƒ/${active.aperture}` : null],
                      ["ISO", active.iso],
                      [
                        "快门",
                        active.shutter
                          ? `${active.shutter >= 1 ? active.shutter : "1/" + Math.round(1 / active.shutter)} s`
                          : null,
                      ],
                      [
                        "拍摄时间",
                        active.takenAt
                          ? new Date(active.takenAt).toLocaleString("zh-CN")
                          : null,
                      ],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <span>{label}</span>
                        <strong>{value || "—"}</strong>
                      </div>
                    ))}
                  </div>
                  {activeIssues.length > 0 && (
                    <div className="notice">
                      {activeIssues.map((v) => (
                        <p key={v}>{v}</p>
                      ))}
                      <small>仅作参考，不会自动不要</small>
                    </div>
                  )}
                  <div className="section-heading">
                    内容标签
                    <button
                      className="text-button"
                      onClick={() =>
                        setDialog({
                          title: "编辑人工标签",
                          label: "用逗号分隔",
                          initial: active.manualTags.join("，"),
                          submit: (value) =>
                            patch([active.id], {
                              manualTags: value.split(/[,，]/),
                            }),
                        })
                      }
                    >
                      编辑
                    </button>
                  </div>
                  <div className="tag-list">
                    {tagsOf(active).map((t) => (
                      <button key={t} onClick={() => setQuery(t)}>
                        {t}
                      </button>
                    ))}
                    {!tagsOf(active).length && (
                      <small>启动 AI 分析后自动生成</small>
                    )}
                  </div>
                  {active.ai?.description && (
                    <p className="ai-description">{active.ai.description}</p>
                  )}
                  <div className="inspector-actions">
                    <Button
                      icon={Heart}
                      onClick={() =>
                        patch(selected, { favorite: !active?.favorite })
                      }
                    >
                      {active.favorite ? "已喜欢" : "标为喜欢"}
                    </Button>
                    {active.aiError && (
                      <div className="notice">{active.aiError}</div>
                    )}
                    {active.analysisError && (
                      <div className="notice">
                        {active.analysisError}
                        <button
                          className="text-button"
                          onClick={() =>
                            run(async () => {
                              await api("/local/retry", json("POST", {}));
                              await refresh();
                            })
                          }
                        >
                          重试本地分析
                        </button>
                      </div>
                    )}
                    <Button
                      icon={Sparkles}
                      onClick={() =>
                        run(async () => {
                          await api(
                            `/projects/${projectId}/analyze`,
                            json("POST", { ids: selected, force: true }),
                          );
                          await refresh();
                        })
                      }
                      disabled={
                        jobs?.ai?.running || jobs?.ai?.photoIds?.length > 0
                      }
                    >
                      {active.ai ? "重新分析所选照片" : "AI 分析所选照片"}
                    </Button>
                    <Button icon={FolderPlus} onClick={addCollection}>
                      加入新作品集
                    </Button>
                    {collections.length > 0 && (
                      <select
                        aria-label="加入已有作品集"
                        value=""
                        onChange={(e) => {
                          const c = collections.find(
                            (c) => c.id === e.target.value,
                          );
                          run(async () => {
                            await api(
                              `/projects/${projectId}/collections/${c.id}`,
                              json("PUT", {
                                photoIds: [
                                  ...new Set([...c.photoIds, ...selected]),
                                ],
                              }),
                            );
                            await refresh();
                            notify("已加入作品集");
                          });
                        }}
                      >
                        <option value="">加入已有作品集…</option>
                        {collections.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <details>
                      <summary>分组与管理</summary>
                      <Button
                        onClick={() => groupAction("similar", "merge")}
                        disabled={selected.length < 2}
                      >
                        合并为相似组
                      </Button>
                      <Button onClick={() => groupAction("similar", "split")}>
                        拆分相似组
                      </Button>
                      <Button onClick={() => groupAction("scene", "merge")}>
                        设为同一场景
                      </Button>
                      <Button onClick={() => groupAction("scene", "split")}>
                        拆分场景
                      </Button>
                      {active.similarId && (
                        <Button
                          onClick={() =>
                            run(async () => {
                              await api(
                                `/projects/${projectId}/groups/${active.similarId}`,
                                json("PUT", { representative: active.id }),
                              );
                              await refresh();
                              notify("已设为代表图");
                            })
                          }
                        >
                          设为相似组代表图
                        </Button>
                      )}
                      {active.sceneId && (
                        <Button
                          onClick={() =>
                            setDialog({
                              title: "为场景命名",
                              submit: (name) =>
                                run(async () => {
                                  await api(
                                    `/projects/${projectId}/groups/${active.sceneId}`,
                                    json("PUT", { name }),
                                  );
                                  await refresh();
                                }),
                            })
                          }
                        >
                          重命名场景
                        </Button>
                      )}
                      <Button
                        onClick={() =>
                          setDialog({
                            title: "设置画幅换算系数",
                            label: "例如全画幅 1、APS-C 1.5",
                            initial: String(project?.cropFactor || ""),
                            submit: (value) =>
                              run(async () => {
                                await api(
                                  `/projects/${projectId}`,
                                  json("PATCH", {
                                    cropFactor: value ? Number(value) : null,
                                  }),
                                );
                                await refresh();
                                await refreshProjects();
                              }),
                          })
                        }
                      >
                        画幅换算系数
                      </Button>
                    </details>
                  </div>
                </>
              ) : (
                <div className="inspector-empty">
                  <div className="mini-frame">
                    <Focus size={24} />
                  </div>
                  <p>每一张，都有它的故事</p>
                  <small>
                    选择照片，查看拍摄参数
                    <br />与 AI 整理的内容标签
                  </small>
                </div>
              )}
              <div className="ai-card">
                <div>
                  <Sparkles size={18} />
                  <strong>你的 AI 选片搭档</strong>
                  <span>AI</span>
                </div>
                <p>
                  “雪山、人像、远景…
                  <br />
                  帮我搭一组有故事感的照片。”
                </p>
                <Button onClick={() => setStudio(true)}>
                  打开拼图工作室
                  <ArrowUpRight size={14} />
                </Button>
                <small>多模态服务可在设置中配置</small>
              </div>
            </aside>
          )}
        </div>
        <div className="statusbar">
          <span>
            <span className="online-dot" /> 所有更改保存在本机
          </span>
          <span>
            P 保留
            <span className="status-divider" />X 不要
            <span className="status-divider" />F 喜欢
            <span className="status-divider" />
            空格 沉浸选片
          </span>
        </div>
      </div>
      {collection && (
        <CollectionBar
          collection={collection}
          photos={photos}
          onSave={(value) =>
            run(async () => {
              await api(
                `/projects/${projectId}/collections/${collection.id}`,
                json("PUT", value),
              );
              await refresh();
            })
          }
        />
      )}
      {immersive && (
        <Immersive
          photos={photos}
          scopeIds={(filtered.length ? filtered : photos).map((p) => p.id)}
          startId={immersive}
          onClose={() => setImmersive(null)}
          onPatch={patch}
          onUndo={undo}
        />
      )}
      {dialog && (
        <InputDialog dialog={dialog} onClose={() => setDialog(null)} />
      )}
      {compare && (
        <Compare
          photos={compare
            .map((id) => photos.find((p) => p.id === id))
            .filter(Boolean)}
          onClose={() => setCompare(null)}
          onPatch={patch}
        />
      )}
      {settings && (
        <Modal title="模型与服务设置" onClose={() => setSettings(false)}>
          <Settings onClose={() => setSettings(false)} notify={notify} />
        </Modal>
      )}
      {studio && projectId && (
        <Studio
          projectId={projectId}
          photos={photos}
          selected={selected}
          collection={collection}
          onClose={() => {
            setStudio(false);
            refresh();
          }}
          notify={notify}
          onSettings={() => setSettings(true)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <Upload size={44} />
          <h2>把照片放在这里</h2>
          <p>它们会被导入当前旅行，本地分析随即开始</p>
        </div>
      )}
    </div>
  );
}
function CollectionBar({ collection, photos, onSave }) {
  const dragged = useRef();
  return (
    <div className="collection-tray">
      <div>
        <strong>{collection.name}</strong>
        <small>拖动排序 · 点击锁定必选照片</small>
      </div>
      <div className="collection-photos">
        {collection.photoIds.map((id) => {
          const p = photos.find((p) => p.id === id);
          if (!p) return null;
          return (
            <div
              key={id}
              draggable
              onDragStart={(e) => {
                dragged.current = id;
                e.dataTransfer.setData("text/plain", id);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const ids = collection.photoIds.filter(
                  (x) => x !== dragged.current,
                );
                ids.splice(ids.indexOf(id), 0, dragged.current);
                onSave({ photoIds: ids });
              }}
            >
              <img src={photoURL(id)} alt={p.name} />
              <button
                aria-label={`锁定 ${p.name}`}
                className={collection.lockedIds.includes(id) ? "locked" : ""}
                onClick={() =>
                  onSave({
                    lockedIds: collection.lockedIds.includes(id)
                      ? collection.lockedIds.filter((x) => x !== id)
                      : [...collection.lockedIds, id],
                  })
                }
              >
                {collection.lockedIds.includes(id) ? (
                  <Lock size={12} />
                ) : (
                  <Unlock size={12} />
                )}
              </button>
              <button
                className="remove"
                aria-label={`移出 ${p.name}`}
                onClick={() =>
                  onSave({
                    photoIds: collection.photoIds.filter((x) => x !== id),
                  })
                }
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
