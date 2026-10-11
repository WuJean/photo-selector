import { flushSync } from "react-dom";
import React, {
  useState,
  useLayoutEffect,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import {
  Camera,
  Plus,
  Upload,
  FolderPlus,
  SlidersHorizontal,
  Layers,
  Settings2,
  ArrowLeft,
  ArrowRight,
  Check,
  X,
  Minus,
  Undo2,
  Info,
  Heart,
  Lock,
  Unlock,
  GripVertical,
  MoreHorizontal,
  Expand,
  ImagePlus,
} from "lucide-react";
import { api, json, photoURL } from "./api";
import { Button, Modal, InputDialog, VirtualGrid } from "./LibraryParts";
import PhotoImage from "./PhotoImage";
import Immersive from "./Immersive";
import Studio from "./Studio";
import Settings from "./Settings";
import TagsPanel from "./TagsPanel";
import AIWizard from "./AIWizard";
import TaskBar from "./TaskBar";
import Refine from "./Refine";
import { PortfolioTools, CreationGallery } from "./Portfolio";
import TagFilters from "./TagFilters";
import {
  filterPhotos,
  FOCAL_LABELS,
  STATUS_LABELS,
  tagsOf,
  inInitial,
  inFinal,
  decisionKeys,
  isTyping,
} from "../../shared/domain.mjs";

export default function App() {
  const [projects, setProjects] = useState([]),
    [projectId, setProjectId] = useState(
      localStorage.getItem("photo-project") || "",
    ),
    [photos, setPhotos] = useState([]),
    [groups, setGroups] = useState([]),
    [collections, setCollections] = useState([]),
    [jobs, setJobs] = useState(null);
  const [space, setSpace] = useState("pending"),
    [tab, setTab] = useState("final"),
    [collectionId, setCollectionId] = useState(""),
    [selected, setSelected] = useState([]),
    [filters, setFilters] = useState({}),
    [query, setQuery] = useState(""),
    [showFilters, setShowFilters] = useState(false),
    [fold, setFold] = useState(true),
    [expanded, setExpanded] = useState(new Set()),
    [inspector, setInspector] = useState(false),
    [more, setMore] = useState(false);
  const [collectionMode, setCollectionMode] = useState("photos");
  const [tagPanel, setTagPanel] = useState(false);
  const [aiWizard, setAIWizard] = useState(null);
  const [dialog, setDialog] = useState(null),
    [settings, setSettings] = useState(false),
    [immersive, setImmersive] = useState(null),
    [studio, setStudio] = useState(false),
    [toast, setToast] = useState(""),
    [uploading, setUploading] = useState(null),
    [dragging, setDragging] = useState(false);
  const fileRef = useRef(),
    folderRef = useRef(),
    currentProject = useRef(projectId),
    uploadPaused = useRef(false),
    decisionBusy = useRef(false),
    decisionPromise = useRef(Promise.resolve()),
    focusHistory = useRef([]),
    refreshVersion = useRef(0);
  const notify = useCallback((message) => setToast(message), []);
  const run = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      notify(e.message);
      return false;
    }
  };
  const refreshProjects = useCallback(async () => {
    const list = await api("/projects");
    setProjects(list);
    if (!list.some((p) => p.id === currentProject.current))
      setProjectId(list[0]?.id || "");
  }, []);
  const refresh = useCallback(async () => {
    if (!projectId) return;
    const version = ++refreshVersion.current;
    const [p, g, c, j] = await Promise.all([
      api(`/projects/${projectId}/photos`),
      api(`/projects/${projectId}/groups`),
      api(`/projects/${projectId}/collections`),
      api("/jobs"),
    ]);
    if (
      currentProject.current !== projectId ||
      version !== refreshVersion.current
    )
      return;
    setPhotos(p);
    setGroups(g);
    setCollections(c);
    setJobs(j);
  }, [projectId]);
  useEffect(() => {
    refreshProjects().catch((e) => notify(e.message));
  }, []);
  useEffect(() => {
    currentProject.current = projectId;
    localStorage.setItem("photo-project", projectId);
    setPhotos([]);
    setSelected([]);
    setFilters({});
    setQuery("");
    setSpace("pending");
    setTab("final");
    setCollectionId("");
    setExpanded(new Set());
    focusHistory.current = [];
    refresh().catch((e) => notify(e.message));
  }, [projectId, refresh]);
  useEffect(() => {
    const id = setInterval(() => refresh().catch(() => {}), 2500);
    return () => clearInterval(id);
  }, [refresh]);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(id);
    }
  }, [toast]);
  const project = projects.find((p) => p.id === projectId),
    active = photos.find((p) => p.id === selected.at(-1)),
    collection = collections.find((c) => c.id === collectionId);
  const initial = photos.filter(inInitial),
    final = photos.filter(inFinal),
    pending = photos.filter((p) => p.status === "unseen");
  const portfolio = space === "portfolio",
    refining = space === "refine";
  const [reviewed, setReviewed] = useState(false),
    [candidateMode, setCandidateMode] = useState("unassigned");
  const filtered = useMemo(() => {
    let list =
      space === "pending"
        ? photos.filter((p) => p.status === "unseen")
        : space === "history"
          ? photos.filter((p) => p.status !== "unseen")
          : space === "refine"
            ? photos.filter(
                (p) =>
                  inInitial(p) &&
                  (reviewed
                    ? p.finalStatus !== "unseen"
                    : p.finalStatus === "unseen"),
              )
            : photos.filter(inFinal);
    if (space === "portfolio" && !collection && candidateMode === "unassigned")
      list = list.filter(
        (p) => !collections.some((c) => c.photoIds.includes(p.id)),
      );
    if (collection)
      list = collection.photoIds
        .map((id) => list.find((p) => p.id === id))
        .filter(Boolean);
    // Final tab filters show the second-round decision; initial filters show the first.
    const status = filters.status;
    list = filterPhotos(list, { ...filters, status: null, query });
    if (status && status !== "all")
      list = list.filter(
        (p) => (portfolio || refining ? p.finalStatus : p.status) === status,
      );
    return list;
  }, [
    photos,
    space,
    tab,
    collection,
    filters,
    query,
    reviewed,
    candidateMode,
    collections,
  ]);
  const items = useMemo(() => {
    const memberMap = new Map();
    for (const p of filtered) {
      if (!p.similarId) continue;
      if (!memberMap.has(p.similarId)) memberMap.set(p.similarId, []);
      memberMap.get(p.similarId).push(p);
    }
    const seen = new Set(),
      result = [];
    for (const p of filtered) {
      const members = memberMap.get(p.similarId) || [p];
      const open = !fold || expanded.has(p.similarId);
      if (!p.similarId || members.length === 1) {
        result.push({ photo: p, count: 1 });
        continue;
      }
      if (open) {
        result.push({ photo: p, count: 1, group: p.similarId, expanded: true });
        continue;
      }
      if (seen.has(p.similarId)) continue;
      seen.add(p.similarId);
      const representative = groups.find(
        (g) => g.id === p.similarId,
      )?.representative;
      result.push({
        photo: members.find((p) => p.id === representative) || members[0],
        count: members.length,
        group: p.similarId,
      });
    }
    return result;
  }, [filtered, fold, expanded, groups]);
  const changeSpace = (value) => {
    setSpace(value);
    setSelected([]);
    setFilters({});
    setQuery("");
    setCollectionId("");
    setCollectionMode("photos");
    setMore(false);
    setReviewed(false);
    setTagPanel(value === "refine");
    if (value === "portfolio") setTab("final");
  };
  const createProject = () =>
    setDialog({
      title: "创建项目",
      placeholder: "项目名称",
      submit: async (name) => {
        const p = await api("/projects", json("POST", { name }));
        currentProject.current = p.id;
        setProjectId(p.id);
        await refreshProjects();
      },
    });
  const importFiles = async (files) => {
    const list = Array.from(files || []).filter((f) =>
      /\.jpe?g$/i.test(f.name),
    );
    if (!projectId) {
      notify("请先创建项目");
      return;
    }
    if (!list.length) {
      notify("请选择 JPEG 照片");
      return;
    }
    if (uploading) return;
    const id = projectId;
    uploadPaused.current = false;
    let failed = 0;
    setSpace("pending");
    try {
      for (let i = 0; i < list.length; i += 8) {
        while (uploadPaused.current)
          await new Promise((r) => setTimeout(r, 150));
        setUploading({ done: i, total: list.length, paused: false });
        const batch = list.slice(i, i + 8),
          form = new FormData();
        batch.forEach((f) => form.append("photos", f));
        form.append("names", JSON.stringify(batch.map((f) => f.name)));
        form.append(
          "modified",
          JSON.stringify(batch.map((f) => f.lastModified)),
        );
        const result = await api(`/projects/${id}/import`, {
          method: "POST",
          body: form,
        });
        failed += result.results.filter((r) => r.error).length;
        await refresh();
      }
      await refreshProjects();
      notify(
        `已导入 ${list.length - failed} 张${failed ? `，失败 ${failed} 张` : ""}`,
      );
    } finally {
      setUploading(null);
    }
  };
  const patch = async (ids, patch, round = "initial") =>
    run(async () => {
      await api(
        `/projects/${projectId}/photos`,
        json("PATCH", { ids, patch, round }),
      );
      await refresh();
      return true;
    });
  const undo = async () =>
    run(async () => {
      await decisionPromise.current;
      const result = await api(`/projects/${projectId}/undo`, json("POST", {}));
      await refresh();
      if (result.ok) {
        const id = focusHistory.current.pop();
        if (id) setSelected([id]);
      } else notify("没有可撤销的操作");
      return result.ok;
    });
  const decide = async (status) => {
    if (!selected.length || decisionBusy.current) return;
    decisionBusy.current = true;
    const ids = [...selected],
      index = Math.max(
        ...ids.map((id) => filtered.findIndex((p) => p.id === id)),
      ),
      next = filtered.slice(index + 1).find((p) => !ids.includes(p.id));
    const work = async () => {
      try {
        await api(
          `/projects/${projectId}/photos`,
          json("PATCH", {
            ids,
            patch: { status },
            round: refining ? "final" : "initial",
          }),
        );
        focusHistory.current.push(ids[0]);
        ++refreshVersion.current;
        flushSync(() => {
          setPhotos((list) =>
            list.map((p) =>
              ids.includes(p.id)
                ? { ...p, [refining ? "finalStatus" : "status"]: status }
                : p,
            ),
          );
          setSelected(next ? [next.id] : []);
        });
      } catch (e) {
        notify(e.message);
      } finally {
        decisionBusy.current = false;
      }
    };
    decisionPromise.current = work();
    await decisionPromise.current;
  };
  const select = (id, event) => {
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
  const openReview = (id, explicit = false) => {
    if (portfolio || refining) {
      changeSpace("refine");
      setReviewed(true);
      if (id) setSelected([id]);
      return;
    }
    const round = "initial",
      list = filtered;
    if (!list.length) return;
    setImmersive({
      round,
      scopeIds: list.map((p) => p.id),
      startId: id || list[0].id,
    });
  };
  const expand = (id) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id) || !fold) {
        next.delete(id);
        setFold(true);
      } else next.add(id);
      return next;
    });
  const groupAction = (action) =>
    run(async () => {
      await api(
        `/projects/${projectId}/groups`,
        json("POST", { ids: selected, type: "similar", action }),
      );
      await refresh();
    });
  const addCollection = () =>
    setDialog({
      title: "新建作品集",
      submit: async (name) => {
        const c = await api(
          `/projects/${projectId}/collections`,
          json("POST", { name, photoIds: selected }),
        );
        await refresh();
        setCollectionId(c.id);
      },
    });
  const editCollection = (changes) =>
    run(async () => {
      await api(
        `/projects/${projectId}/collections/${collection.id}`,
        json("PUT", changes),
      );
      await refresh();
    });
  useLayoutEffect(() => {
    const handle = (e) => {
      if (
        isTyping(e.target) ||
        dialog ||
        settings ||
        immersive ||
        studio ||
        (tagPanel && !refining) ||
        aiWizard ||
        e.repeat
      )
        return;
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!selected.length) return;
      if (key === " " && !refining) {
        e.preventDefault();
        openReview(selected[0], true);
        return;
      }
      if (key === "arrowright" || key === "arrowleft") {
        e.preventDefault();
        const at = filtered.findIndex((p) => p.id === selected.at(-1));
        const next = filtered[at + (key === "arrowright" ? 1 : -1)];
        if (next) setSelected([next.id]);
      }
      if (decisionKeys[key] && !portfolio && (!refining || key !== "z")) {
        e.preventDefault();
        decide(decisionKeys[key]);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });
  return (
    <div
      className="simple-app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          if (projectId) setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(false);
        run(() => importFiles(e.dataTransfer.files));
      }}
    >
      <input
        hidden
        multiple
        type="file"
        accept="image/jpeg"
        ref={fileRef}
        onChange={(e) => {
          run(() => importFiles(e.target.files));
          e.target.value = "";
        }}
      />
      <input
        hidden
        multiple
        type="file"
        webkitdirectory=""
        ref={folderRef}
        onChange={(e) => {
          run(() => importFiles(e.target.files));
          e.target.value = "";
        }}
      />
      <header className="simple-header">
        <div className="simple-brand">
          <Camera size={21} />
          <strong>选片助手</strong>
        </div>
        {projectId && (
          <>
            <select
              aria-label="当前项目"
              value={projectId}
              disabled={!!uploading}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              aria-label="创建项目"
              onClick={createProject}
              disabled={!!uploading}
            >
              <Plus size={18} />
            </button>
          </>
        )}
        <div className="header-spacer" />
        {projectId && (
          <nav className="space-nav">
            <button
              className={!portfolio && !refining ? "active" : ""}
              onClick={() => changeSpace("pending")}
            >
              粗筛 <small>{pending.length}</small>
            </button>
            <button
              className={refining ? "active" : ""}
              onClick={() => changeSpace("refine")}
            >
              精筛{" "}
              <small>
                {initial.filter((p) => p.finalStatus === "unseen").length}
              </small>
            </button>
            <button
              className={portfolio ? "active" : ""}
              onClick={() => changeSpace("portfolio")}
            >
              作品集 <small>{final.length}</small>
            </button>
          </nav>
        )}
        <button
          className="icon-button"
          aria-label="模型与服务设置"
          onClick={() => setSettings(true)}
        >
          <Settings2 size={19} />
        </button>
      </header>
      <TaskBar
        jobs={jobs}
        projectId={projectId}
        refresh={refresh}
        notify={notify}
      />
      {!projectId ? (
        <main className="start-screen">
          <Camera size={40} />
          <h1>项目</h1>
          <Button primary icon={Plus} onClick={createProject}>
            创建项目
          </Button>
        </main>
      ) : (
        <main className="simple-workspace">
          <div className="simple-toolbar">
            <div className="view-heading">
              <h1>
                {portfolio
                  ? collection?.name || "作品集候选"
                  : refining
                    ? "精筛"
                    : space === "history"
                      ? "已粗筛"
                      : "粗筛"}
              </h1>
              {portfolio && collection && collectionMode === "creations" ? (
                <CreationGallery
                  projectId={projectId}
                  collectionId={collection.id}
                  photos={photos}
                  notify={notify}
                />
              ) : refining ? (
                <button
                  className="text-button"
                  onClick={() => {
                    setReviewed(!reviewed);
                    setSelected([]);
                  }}
                >
                  {reviewed ? "返回待精筛" : "已精筛"}
                </button>
              ) : portfolio ? (
                <select
                  aria-label="候选范围"
                  value={candidateMode}
                  onChange={(e) => setCandidateMode(e.target.value)}
                >
                  <option value="unassigned">未归入作品集</option>
                  <option value="all">全部</option>
                </select>
              ) : (
                <button
                  className="text-button"
                  onClick={() =>
                    changeSpace(space === "history" ? "pending" : "history")
                  }
                >
                  {space === "history"
                    ? "返回未筛选"
                    : `已筛选 ${photos.length - pending.length}`}
                </button>
              )}
            </div>
            <div className="toolbar-actions">
              {(portfolio || refining) && (
                <Button
                  disabled={!filtered.length}
                  onClick={() =>
                    run(async () => {
                      await api(
                        `/projects/${projectId}/analyze`,
                        json("POST", {
                          ids: (selected.length
                            ? filtered.filter((p) => selected.includes(p.id))
                            : filtered
                          ).map((p) => p.id),
                        }),
                      );
                      await refresh();
                    })
                  }
                >
                  AI 分类
                </Button>
              )}
              {(portfolio || refining) && (
                <Button
                  disabled={!filtered.length}
                  onClick={() =>
                    setAIWizard(
                      (selected.length
                        ? initial.filter((p) => selected.includes(p.id))
                        : filtered
                      ).map((p) => p.id),
                    )
                  }
                >
                  细化分类
                </Button>
              )}
              {(portfolio || refining) && (
                <Button
                  onClick={() => {
                    setTagPanel((v) => !v);
                    setInspector(false);
                  }}
                >
                  人工标签
                </Button>
              )}
              {portfolio ? (
                <>
                  <Button onClick={addCollection}>新建作品集</Button>
                  <Button
                    icon={ImagePlus}
                    onClick={() => setStudio(true)}
                    disabled={!final.length}
                  >
                    拼图与导出
                  </Button>
                </>
              ) : refining ? null : (
                <>
                  <Button
                    primary
                    icon={Expand}
                    onClick={() => openReview(selected[0])}
                    disabled={!filtered.length}
                  >
                    开始粗筛
                  </Button>
                  <Button
                    icon={Upload}
                    onClick={() => fileRef.current.click()}
                    disabled={!!uploading}
                  >
                    导入照片
                  </Button>
                  <button
                    className="icon-button"
                    aria-label="导入文件夹"
                    onClick={() => folderRef.current.click()}
                    disabled={!!uploading}
                  >
                    <FolderPlus size={19} />
                  </button>
                </>
              )}
            </div>
          </div>
          {portfolio && (
            <PortfolioTools
              projectId={projectId}
              collections={collections}
              collection={collection}
              selected={selected}
              onChoose={(id) => {
                setCollectionId(id);
                setSelected([]);
                setCollectionMode("photos");
              }}
              refresh={refresh}
              notify={notify}
              mode={collectionMode}
              setMode={setCollectionMode}
            />
          )}
          {!!photos.length && (
            <div className="compact-tools">
              <input
                className="search-input"
                aria-label="搜索照片"
                placeholder="搜索"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button
                icon={SlidersHorizontal}
                onClick={() => setShowFilters((v) => !v)}
              >
                筛选
              </Button>
              <Button
                icon={Layers}
                onClick={() => {
                  setFold((v) => !v);
                  setExpanded(new Set());
                }}
              >
                {fold ? "全部展开" : "全部叠放"}
              </Button>
              {expanded.size > 0 && fold && (
                <button
                  className="text-button"
                  onClick={() => setExpanded(new Set())}
                >
                  全部叠放
                </button>
              )}
              <span className="count">{filtered.length} 张</span>
              <button
                className="icon-button"
                aria-label="照片信息"
                onClick={() => setInspector((v) => !v)}
              >
                <Info size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="更多操作"
                onClick={() => setMore((v) => !v)}
              >
                <MoreHorizontal size={20} />
              </button>
            </div>
          )}
          {(portfolio || refining) && (
            <TagFilters
              projectId={projectId}
              photos={refining ? initial : final}
              filters={filters}
              setFilters={setFilters}
            />
          )}
          {showFilters && (
            <div className="filter-panel">
              <select
                aria-label="焦段筛选"
                value={filters.focal || "all"}
                onChange={(e) =>
                  setFilters({ ...filters, focal: e.target.value })
                }
              >
                <option value="all">全部焦段</option>
                {FOCAL_LABELS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
              <select
                aria-label="方向筛选"
                value={filters.orientation || "all"}
                onChange={(e) =>
                  setFilters({ ...filters, orientation: e.target.value })
                }
              >
                <option value="all">全部方向</option>
                <option value="landscape">横图</option>
                <option value="portrait">竖图</option>
              </select>
              {space !== "pending" && (
                <select
                  aria-label="状态筛选"
                  value={filters.status || "all"}
                  onChange={(e) =>
                    setFilters({ ...filters, status: e.target.value })
                  }
                >
                  <option value="all">全部状态</option>
                  {Object.entries(STATUS_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
              <input
                type="date"
                aria-label="开始日期"
                value={filters.from || ""}
                onChange={(e) =>
                  setFilters({ ...filters, from: e.target.value })
                }
              />
              <input
                type="date"
                aria-label="结束日期"
                value={filters.to || ""}
                onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              />
              <button className="text-button" onClick={() => setFilters({})}>
                重置
              </button>
            </div>
          )}
          {more && (
            <div className="more-panel">
              <Button onClick={() => setSelected(filtered.map((p) => p.id))}>
                全选
              </Button>
              <Button onClick={() => setSelected([])}>取消选择</Button>
              <Button onClick={undo}>撤销</Button>
              <select
                aria-label="相似度"
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
              <Button
                disabled={!selected.length}
                onClick={() => groupAction("split")}
              >
                拆出相似组
              </Button>
              <Button
                disabled={selected.length < 2}
                onClick={() => groupAction("merge")}
              >
                合为相似组
              </Button>
              {active?.similarId && (
                <Button
                  onClick={() =>
                    run(async () => {
                      await api(
                        `/projects/${projectId}/groups/${active.similarId}`,
                        json("PUT", { representative: active.id }),
                      );
                      await refresh();
                    })
                  }
                >
                  设为代表图
                </Button>
              )}
              {portfolio && (
                <>
                  <select
                    aria-label="加入作品集"
                    value=""
                    disabled={!selected.length}
                    onChange={(e) => {
                      const target = collections.find(
                        (c) => c.id === e.target.value,
                      );
                      if (target)
                        run(async () => {
                          await api(
                            `/projects/${projectId}/collections/${target.id}`,
                            json("PUT", {
                              photoIds: [
                                ...new Set([...target.photoIds, ...selected]),
                              ],
                            }),
                          );
                          await refresh();
                          notify("已加入作品集");
                        });
                    }}
                  >
                    <option value="">加入作品集…</option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="选择作品集"
                    value={collectionId}
                    onChange={(e) => {
                      setCollectionId(e.target.value);
                      setSelected([]);
                    }}
                  >
                    <option value="">本次作品集</option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {collection && (
                    <>
                      <Button
                        disabled={!selected.length}
                        onClick={() =>
                          editCollection({
                            photoIds: [
                              ...new Set([...collection.photoIds, ...selected]),
                            ],
                          })
                        }
                      >
                        加入当前作品集
                      </Button>
                      <Button
                        disabled={!selected.length}
                        onClick={() =>
                          editCollection({
                            lockedIds: [
                              ...new Set([
                                ...collection.lockedIds,
                                ...selected,
                              ]),
                            ],
                          })
                        }
                      >
                        锁定所选
                      </Button>
                      <Button
                        disabled={!selected.length}
                        onClick={() =>
                          editCollection({
                            lockedIds: collection.lockedIds.filter(
                              (id) => !selected.includes(id),
                            ),
                          })
                        }
                      >
                        取消锁定
                      </Button>
                      <Button
                        disabled={!selected.length}
                        onClick={() =>
                          editCollection({
                            photoIds: collection.photoIds.filter(
                              (id) => !selected.includes(id),
                            ),
                          })
                        }
                      >
                        移出当前作品集
                      </Button>
                      <Button
                        disabled={selected.length !== 1}
                        onClick={() => {
                          const ids = [...collection.photoIds],
                            i = ids.indexOf(selected[0]);
                          if (i > 0) {
                            [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                            editCollection({ photoIds: ids });
                          }
                        }}
                      >
                        前移
                      </Button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          {uploading && (
            <div className="compact-progress">
              <span>
                导入 {uploading.done} / {uploading.total}
              </span>
              <progress value={uploading.done} max={uploading.total} />
              <button
                className="text-button"
                onClick={() => {
                  uploadPaused.current = !uploadPaused.current;
                  setUploading({ ...uploading, paused: uploadPaused.current });
                }}
              >
                {uploading.paused ? "继续" : "暂停"}
              </button>
            </div>
          )}
          {jobs?.local?.pending > 0 && (
            <div className="compact-progress">
              <span>本地分析 {jobs.local.pending}</span>
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
          <div className="photo-workspace">
            <section className="photo-main">
              {refining ? (
                <Refine
                  photos={filtered}
                  selected={selected}
                  onSelect={(id) => setSelected([id])}
                  onDecide={decide}
                  onUndo={undo}
                  onComplete={() => changeSpace("portfolio")}
                />
              ) : filtered.length ? (
                <VirtualGrid
                  items={items}
                  selected={selected}
                  onSelect={select}
                  onOpen={(id) => openReview(id, true)}
                  onExpand={expand}
                  onReorder={
                    collection
                      ? (from, to) => {
                          const ids = collection.photoIds.filter(
                            (id) => id !== from,
                          );
                          ids.splice(ids.indexOf(to), 0, from);
                          editCollection({ photoIds: ids });
                        }
                      : undefined
                  }
                  lockedIds={collection?.lockedIds || []}
                  focusId={selected.at(-1)}
                  scrollKey={`${projectId}/${space}/${tab}/${collectionId}`}
                  renderBadge={(p) =>
                    STATUS_LABELS[
                      portfolio && tab === "final" ? p.finalStatus : p.status
                    ]
                  }
                />
              ) : (
                <div className="empty-stage">
                  <ImagePlus size={36} />
                  <h2>
                    {!photos.length
                      ? "导入照片"
                      : portfolio
                        ? tab === "final"
                          ? "暂无作品集候选"
                          : "暂无精筛照片"
                        : space === "pending"
                          ? pending.length
                            ? "没有匹配的照片"
                            : "粗筛已完成"
                          : "没有匹配的照片"}
                  </h2>
                  {!photos.length ? (
                    <Button primary onClick={() => fileRef.current.click()}>
                      选择照片
                    </Button>
                  ) : portfolio && tab === "final" ? (
                    <Button
                      primary
                      onClick={() => changeSpace("refine")}
                      disabled={
                        !initial.some((p) => p.finalStatus === "unseen")
                      }
                    >
                      开始精筛
                    </Button>
                  ) : space === "pending" && !pending.length ? (
                    <Button primary onClick={() => changeSpace("refine")}>
                      开始精筛
                    </Button>
                  ) : (
                    <Button
                      onClick={() => {
                        setFilters({});
                        setQuery("");
                      }}
                    >
                      清除筛选
                    </Button>
                  )}
                </div>
              )}
            </section>
            {(portfolio || refining) && tagPanel && (
              <TagsPanel
                key={projectId}
                projectId={projectId}
                photos={initial}
                ids={selected}
                onClose={() => setTagPanel(false)}
                onChanged={refresh}
                notify={notify}
              />
            )}
            {inspector && (
              <aside className="simple-inspector">
                {active ? (
                  <>
                    <PhotoImage src={photoURL(active.id)} alt={active.name} />
                    <h3>{active.name}</h3>
                    <dl>
                      {[
                        ["相机", active.camera],
                        ["镜头", active.lens],
                        ["拍摄时间", active.takenAt],
                        ["焦距", active.focal && `${active.focal}mm`],
                        [
                          "等效焦距",
                          active.equivalent && `${active.equivalent}mm`,
                        ],
                        ["光圈", active.aperture],
                        ["快门", active.shutter],
                        ["ISO", active.iso],
                        ["尺寸", `${active.width} × ${active.height}`],
                        ["初筛", STATUS_LABELS[active.status]],
                        ["精筛", STATUS_LABELS[active.finalStatus || "unseen"]],
                      ].map(([key, value]) => (
                        <React.Fragment key={key}>
                          <dt>{key}</dt>
                          <dd>{value || "—"}</dd>
                        </React.Fragment>
                      ))}
                    </dl>
                    <Button
                      icon={Heart}
                      onClick={() =>
                        patch([active.id], { favorite: !active.favorite })
                      }
                    >
                      {active.favorite ? "取消喜欢" : "喜欢"}
                    </Button>
                    {active.issues?.length > 0 && (
                      <p>{active.issues.join(" · ")}</p>
                    )}
                    <Button
                      onClick={() =>
                        setDialog({
                          title: "画幅系数",
                          initial: String(project.cropFactor || ""),
                          submit: async (value) => {
                            await api(
                              `/projects/${projectId}`,
                              json("PATCH", {
                                cropFactor: value ? Number(value) : null,
                              }),
                            );
                            await refresh();
                            await refreshProjects();
                          },
                        })
                      }
                    >
                      设置画幅系数
                    </Button>
                  </>
                ) : (
                  <span>未选择照片</span>
                )}
              </aside>
            )}
          </div>
          {!!selected.length && !refining && (
            <footer className="selection-bar">
              <span>已选 {selected.length}</span>
              {!portfolio || tab === "initial" ? (
                <div className="inline-decisions">
                  {[
                    ["maybe", "待定", "Z"],
                    ["keep", "保留", "X"],
                    ["reject", "不要", "C"],
                  ].map(([status, label, key]) => (
                    <button
                      key={status}
                      className="button"
                      onClick={() => decide(status)}
                    >
                      {label}
                      <kbd>{key}</kbd>
                    </button>
                  ))}
                </div>
              ) : (
                <Button onClick={() => openReview(selected[0], true)}>
                  重新精筛
                </Button>
              )}
              <button
                className="icon-button"
                aria-label="撤销决定"
                onClick={undo}
              >
                <Undo2 size={18} />
              </button>
            </footer>
          )}
        </main>
      )}
      {dialog && (
        <InputDialog dialog={dialog} onClose={() => setDialog(null)} />
      )}
      {aiWizard && (
        <AIWizard
          projectId={projectId}
          ids={aiWizard}
          onClose={() => setAIWizard(null)}
          onChanged={refresh}
          notify={notify}
          onSettings={() => setSettings(true)}
        />
      )}
      {settings && (
        <Modal title="模型与服务设置" onClose={() => setSettings(false)}>
          <Settings onClose={() => setSettings(false)} notify={notify} />
        </Modal>
      )}
      {immersive && (
        <Immersive
          {...immersive}
          photos={photos}
          onPatch={patch}
          onUndo={undo}
          onClose={(id) => {
            setImmersive(null);
            setSelected(id && filtered.some((p) => p.id === id) ? [id] : []);
          }}
          onComplete={() => {
            changeSpace("refine");
            setFilters({});
            setQuery("");
            setSelected([]);
            setImmersive(null);
          }}
        />
      )}
      {studio && (
        <Studio
          projectId={projectId}
          photos={final}
          selected={selected.filter((id) => final.some((p) => p.id === id))}
          collection={
            collection
              ? {
                  ...collection,
                  photoIds: collection.photoIds.filter((id) =>
                    final.some((p) => p.id === id),
                  ),
                  lockedIds: collection.lockedIds.filter((id) =>
                    final.some((p) => p.id === id),
                  ),
                }
              : undefined
          }
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
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <Upload size={40} />
          <h2>导入照片</h2>
        </div>
      )}
    </div>
  );
}
