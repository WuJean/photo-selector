import PhotoImage from "./PhotoImage";
import React, {
  useMemo,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  X,
  Maximize,
  Minimize,
  Check,
  Minus,
  ZoomIn,
  RotateCcw,
  Layers,
  MousePointer2,
  Move,
  Undo2,
  Focus,
} from "lucide-react";
import { photoURL } from "./api";
import {
  STATUS_LABELS,
  decisionKeys,
  decisionField,
  isTyping,
} from "../../shared/domain.mjs";
import { immersiveGroups, zoomAround } from "../../shared/immersive.mjs";

export function Frame({
  photo,
  active,
  onActivate,
  onNavigate,
  round,
  dense = false,
}) {
  const [transform, setTransform] = useState({ zoom: 1, x: 0, y: 0 }),
    [natural, setNatural] = useState(false);
  const ref = useRef(),
    drag = useRef();
  useEffect(() => {
    setTransform({ zoom: 1, x: 0, y: 0 });
    setNatural(false);
  }, [photo.id]);
  useEffect(() => {
    const node = ref.current;
    const wheel = (e) => {
      e.preventDefault();
      if (
        Math.abs(e.deltaX) > Math.abs(e.deltaY) &&
        transform.zoom === 1 &&
        !natural
      ) {
        if (!drag.current?.wheelAt || Date.now() - drag.current.wheelAt > 350) {
          if (Math.abs(e.deltaX) > 12) {
            onNavigate(e.deltaX > 0 ? 1 : -1);
            drag.current = { wheelAt: Date.now() };
          }
        }
        return;
      }
      const box = node.getBoundingClientRect();
      setTransform((v) =>
        zoomAround(v, v.zoom * Math.exp(-e.deltaY * 0.002), {
          x: e.clientX - box.left - box.width / 2,
          y: e.clientY - box.top - box.height / 2,
        }),
      );
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [onActivate, onNavigate, transform.zoom, natural]);
  const reset = () => {
    setTransform({ zoom: 1, x: 0, y: 0 });
    setNatural(false);
  };
  const face = () => {
    const f = photo.faces?.[0];
    if (f) {
      setTransform({
        zoom: 3,
        x: (0.5 - f.x - f.width / 2) * ref.current.clientWidth * 3,
        y: (0.5 - f.y - f.height / 2) * ref.current.clientHeight * 3,
      });
    } else setTransform({ zoom: 2, x: 0, y: 0 });
  };
  return (
    <div
      className={`immersive-frame ${active ? "focused" : ""} ${dense ? "dense" : ""}`}
      ref={ref}
      onFocus={onActivate}
      tabIndex={0}
      data-photo-id={photo.id}
      data-zoom={transform.zoom.toFixed(2)}
      aria-label={`查看 ${photo.name}`}
      onDoubleClick={() =>
        setTransform((v) =>
          v.zoom > 1 ? { zoom: 1, x: 0, y: 0 } : { zoom: 2, x: 0, y: 0 },
        )
      }
      onPointerDown={(e) => {
        if (e.target.closest("button")) return;
        onActivate();
        drag.current = {
          x: e.clientX - transform.x,
          y: e.clientY - transform.y,
          startX: e.clientX,
          panning: transform.zoom > 1 || natural,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current?.panning)
          setTransform((v) => ({
            ...v,
            x: e.clientX - drag.current.x,
            y: e.clientY - drag.current.y,
          }));
      }}
      onPointerUp={(e) => {
        if (
          drag.current &&
          !drag.current.panning &&
          Math.abs(e.clientX - drag.current.startX) > 65
        )
          onNavigate(e.clientX < drag.current.startX ? 1 : -1);
        drag.current = null;
      }}
      onPointerCancel={() => (drag.current = null)}
    >
      <PhotoImage
        src={photoURL(photo.id, natural ? "original" : "preview")}
        draggable="false"
        alt={photo.name}
        style={{
          transform: `translate(${transform.x}px,${transform.y}px) scale(${transform.zoom})`,
          maxWidth: natural ? "none" : undefined,
          maxHeight: natural ? "none" : undefined,
          width: natural ? photo.width : undefined,
          height: natural ? photo.height : undefined,
        }}
      />
      <div className="immersive-photo-top">
        <span
          className={`decision-badge ${photo[decisionField(round)] || "unseen"}`}
        >
          <span />
          {STATUS_LABELS[photo[decisionField(round)] || "unseen"]}
        </span>
        {active && <span className="hover-indicator">当前照片</span>}
      </div>
      <div className="immersive-photo-bottom">
        <div>
          <strong>{photo.name}</strong>
          <small>
            {[
              photo.focal ? `${photo.focal}mm` : null,
              photo.aperture ? `ƒ/${photo.aperture}` : null,
              photo.iso ? `ISO ${photo.iso}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </div>
        {active && (
          <div className="image-tools">
            <button
              aria-label="放大当前照片"
              title="放大"
              onClick={(e) => {
                e.stopPropagation();
                setTransform((v) =>
                  zoomAround(v, v.zoom + 0.5, { x: 0, y: 0 }),
                );
              }}
            >
              <ZoomIn size={15} />
            </button>
            <button
              aria-label="原尺寸查看"
              title="100% 原尺寸"
              onClick={(e) => {
                e.stopPropagation();
                setNatural((v) => !v);
                setTransform({ zoom: 1, x: 0, y: 0 });
              }}
            >
              1:1
            </button>
            <button
              aria-label="定位人脸"
              title="人脸 / 中心细节"
              onClick={(e) => {
                e.stopPropagation();
                face();
              }}
            >
              <Focus size={15} />
            </button>
            <button
              aria-label="重置缩放"
              title="适应画面"
              onClick={(e) => {
                e.stopPropagation();
                reset();
              }}
            >
              <RotateCcw size={14} />
            </button>
            <span>{Math.round(transform.zoom * 100)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
export default function Immersive({
  photos,
  scopeIds,
  startId,
  round = "initial",
  onClose,
  onPatch,
  onUndo,
  onComplete,
}) {
  const sequence = useRef(
    immersiveGroups(
      scopeIds.map((id) => photos.find((p) => p.id === id)).filter(Boolean),
    ).flatMap((g) => g.photos.map((p) => p.id)),
  );
  const [index, setIndex] = useState(() =>
    Math.max(0, sequence.current.indexOf(startId)),
  );
  const [saving, setSaving] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const root = useRef();
  const busy = useRef(false);
  const history = useRef([]);
  const lookup = new Map(photos.map((p) => [p.id, p]));
  const list = sequence.current.map((id) => lookup.get(id)).filter(Boolean);
  const active = list[index];
  const complete = !active;
  const sameGroup = (p) =>
    active?.similarId && p?.similarId === active.similarId;
  const similar =
    !!active?.similarId && list.some((p) => p.id !== active.id && sameGroup(p));
  const group = list.filter(sameGroup);
  const groupIndex = group.findIndex((p) => p.id === active?.id);
  const visible = similar
    ? [group[groupIndex - 1], active, group[groupIndex + 1]]
    : [];
  const navigate = (delta) => {
    if (!busy.current)
      setIndex((i) => Math.max(0, Math.min(list.length - 1, i + delta)));
  };
  const activate = (id) => {
    if (!busy.current) setIndex(list.findIndex((p) => p.id === id));
  };
  const choose = async (status) => {
    if (!active || busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const saved = await onPatch([active.id], { status }, round);
      if (saved) {
        history.current.push(index);
        setIndex(index + 1);
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  const undo = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (await onUndo()) {
        const last = history.current.pop();
        if (last !== undefined) setIndex(last);
      }
    } finally {
      busy.current = false;
    }
  };
  const exit = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    onClose(active?.id || list.at(-1)?.id);
  };
  useEffect(() => {
    let wasFull = false;
    const change = () => {
      const full = !!document.fullscreenElement;
      setFullscreen(full);
      if (wasFull && !full) onClose();
      wasFull = full;
    };
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  useLayoutEffect(() => {
    const listener = (e) => {
      if (isTyping(e.target) || e.repeat) return;
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === "z") {
        e.preventDefault();
        e.stopImmediatePropagation();
        undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (
        ![
          " ",
          "escape",
          "arrowleft",
          "arrowright",
          ...Object.keys(decisionKeys),
        ].includes(key)
      )
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (key === " " || key === "escape") exit();
      else if (key === "arrowleft") navigate(-1);
      else if (key === "arrowright") navigate(1);
      else choose(decisionKeys[key]);
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  });
  return (
    <div
      className="immersive"
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={round === "final" ? "沉浸式精筛" : "沉浸选片"}
    >
      <header className="immersive-header">
        <button className="immersive-back" onClick={exit}>
          <ArrowLeft size={17} />
          返回
        </button>
        <span>
          {round === "final" ? "精筛" : "粗筛"}
          {similar ? ` · 相似照片 ${groupIndex + 1}/${group.length}` : ""}
        </span>
        <div className="immersive-header-actions">
          <button
            className="icon-button"
            aria-label="切换全屏"
            onClick={() =>
              document.fullscreenElement
                ? document.exitFullscreen()
                : root.current.requestFullscreen().catch(() => {})
            }
          >
            {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
          <button
            className="icon-button"
            aria-label="关闭沉浸选片"
            onClick={exit}
          >
            <X size={20} />
          </button>
        </div>
      </header>
      {complete ? (
        <div className="review-complete">
          <Check size={40} />
          <h2>本轮已完成</h2>
          <button className="primary" onClick={onComplete}>
            {round === "final" ? "查看最终作品" : "查看初筛结果"}
          </button>
          <button className="button" onClick={exit}>
            返回
          </button>
        </div>
      ) : (
        <div
          className={`immersive-stage ${similar ? "similar-stage carousel-stage" : "single-stage"}`}
        >
          {similar ? (
            visible.map((p, position) =>
              p ? (
                <div
                  className={`similar-slot ${p.id === active.id ? "active" : ""}`}
                  key={p.id}
                  style={{ flex: p.id === active.id ? 1.65 : 1 }}
                >
                  <Frame
                    photo={p}
                    active={p.id === active.id}
                    round={round}
                    onActivate={() => activate(p.id)}
                    onNavigate={navigate}
                  />
                </div>
              ) : (
                <div
                  className="carousel-spacer"
                  key={`empty-${position}`}
                  style={{ flex: 1 }}
                />
              ),
            )
          ) : (
            <>
              <button
                className={`neighbor previous ${list[index - 1] ? "" : "missing"}`}
                aria-label="上一张"
                disabled={!list[index - 1]}
                onClick={() => navigate(-1)}
              >
                {list[index - 1] && (
                  <PhotoImage
                    alt="前一张照片（虚化）"
                    src={photoURL(list[index - 1].id, "preview")}
                  />
                )}
                <ArrowLeft />
              </button>
              <div className="single-focus">
                <Frame
                  key={active.id}
                  photo={active}
                  active
                  round={round}
                  onActivate={() => {}}
                  onNavigate={navigate}
                />
              </div>
              <button
                className={`neighbor next ${list[index + 1] ? "" : "missing"}`}
                aria-label="下一张"
                disabled={!list[index + 1]}
                onClick={() => navigate(1)}
              >
                {list[index + 1] && (
                  <PhotoImage
                    alt="后一张照片（虚化）"
                    src={photoURL(list[index + 1].id, "preview")}
                  />
                )}
                <ArrowRight />
              </button>
            </>
          )}
        </div>
      )}
      <footer className="immersive-footer">
        <div className="immersive-navigation">
          <button
            className="round-button"
            aria-label="上一张照片"
            onClick={() => navigate(-1)}
            disabled={index === 0 || saving}
          >
            <ArrowLeft size={18} />
          </button>
          <span>
            {Math.min(index + 1, list.length)} / {list.length}
          </span>
          <button
            className="round-button"
            aria-label="下一张照片"
            onClick={() => navigate(1)}
            disabled={index >= list.length - 1 || saving}
          >
            <ArrowRight size={18} />
          </button>
        </div>
        <div className="decision-buttons">
          {[
            ["maybe", "待定", "Z", Minus],
            ["keep", "保留", "X", Check],
            ["reject", "不要", "C", X],
          ].map(([status, label, key, Icon]) => (
            <button
              key={status}
              className={`decision ${status} ${active?.[decisionField(round)] === status ? "chosen" : ""}`}
              onClick={() => choose(status)}
              disabled={saving || complete}
            >
              <Icon size={20} />
              <span>{label}</span>
              <kbd>{key}</kbd>
            </button>
          ))}
        </div>
        <button
          className="icon-button"
          aria-label="撤销决定"
          onClick={undo}
          disabled={saving}
        >
          <Undo2 size={20} />
        </button>
      </footer>
    </div>
  );
}
