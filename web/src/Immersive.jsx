import PhotoImage from "./PhotoImage";
import React, { useMemo, useState, useRef, useEffect } from "react";
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
import { STATUS_LABELS } from "../../shared/domain.mjs";
import { immersiveGroups, zoomAround } from "../../shared/immersive.mjs";

function Frame({ photo, active, onActivate, dense = false }) {
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
      onActivate();
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
  }, [onActivate]);
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
      onMouseEnter={onActivate}
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
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current)
          setTransform((v) => ({
            ...v,
            x: e.clientX - drag.current.x,
            y: e.clientY - drag.current.y,
          }));
      }}
      onPointerUp={() => (drag.current = null)}
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
        <span className={`decision-badge ${photo.status}`}>
          <span />
          {STATUS_LABELS[photo.status]}
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
  onClose,
  onPatch,
  onUndo,
}) {
  // Freeze the browsing scope, but keep each photo's live state. A decision must
  // not remove the current image just because the library was filtered by status.
  const sequenceIds = useRef(scopeIds || photos.map((p) => p.id));
  const units = useMemo(() => {
    const lookup = new Map(photos.map((p) => [p.id, p]));
    return immersiveGroups(
      sequenceIds.current.map((id) => lookup.get(id)).filter(Boolean),
    );
  }, [photos]);
  const [hovered, setHovered] = useState(startId),
    [fullscreen, setFullscreen] = useState(false),
    [saving, setSaving] = useState(false),
    [autoNext, setAutoNext] = useState(false);
  const root = useRef();
  // Anchor to a photo rather than a group index while background grouping runs.
  const index = Math.max(
    0,
    units.findIndex((unit) => unit.photos.some((p) => p.id === hovered)),
  );
  const group = units[Math.min(index, Math.max(0, units.length - 1))],
    active = group?.photos.find((p) => p.id === hovered) || group?.photos[0];
  const navigate = (delta) => {
    const next = Math.min(units.length - 1, Math.max(0, index + delta));
    setHovered(units[next]?.photos[0]?.id);
  };
  const choose = async (status) => {
    if (!active || saving) return;
    setSaving(true);
    try {
      const saved = await onPatch([active.id], { status });
      if (saved && autoNext && group.kind === "single") navigate(1);
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    const listener = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }, []);
  useEffect(() => {
    const listener = (e) => {
      if (e.target.tagName === "INPUT") return;
      const key = e.key.toLowerCase();
      if (
        [
          "arrowleft",
          "arrowright",
          "1",
          "2",
          "3",
          "p",
          "u",
          "x",
          "escape",
          "z",
        ].includes(key)
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      if (key === "arrowleft") navigate(-1);
      if (key === "arrowright") navigate(1);
      if (key === "1" || key === "p") choose("keep");
      if (key === "2" || key === "u") choose("unseen");
      if (key === "3" || key === "x") choose("reject");
      if (key === "escape" && !document.fullscreenElement) onClose();
      if ((e.metaKey || e.ctrlKey) && key === "z") onUndo();
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [index, group, active, saving, autoNext]);
  const exit = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    onClose();
  };
  if (!group) return null;
  const previous = units[index - 1]?.photos[0],
    next = units[index + 1]?.photos[0];
  return (
    <div
      className="immersive"
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="沉浸选片"
    >
      <header className="immersive-header">
        <button className="immersive-back" onClick={exit}>
          <ArrowLeft size={17} />
          返回照片库
        </button>
        <div className="immersive-title">
          <span className="eyebrow">FOCUS ON THE MOMENT</span>
          <span>
            {group.kind === "similar" ? (
              <>
                <Layers size={14} />
                {group.photos.length} 张相似照片 · 移入即放大
              </>
            ) : (
              "一张一张，留下心动"
            )}
          </span>
        </div>
        <div className="immersive-header-right">
          <label>
            <input
              type="checkbox"
              checked={autoNext}
              onChange={(e) => setAutoNext(e.target.checked)}
            />
            选择后自动下一张
          </label>
          <button
            className="icon-button"
            aria-label="切换全屏"
            onClick={() =>
              document.fullscreenElement
                ? document.exitFullscreen()
                : root.current.requestFullscreen().catch(() => {})
            }
          >
            {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
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
      <div
        className={`immersive-stage ${group.kind === "similar" ? "similar-stage" : "single-stage"} ${group.photos.length > 5 ? "many-frames" : ""}`}
      >
        {group.kind === "similar" ? (
          group.photos.map((p) => (
            <div
              className={`similar-slot ${active.id === p.id ? "active" : ""}`}
              key={p.id}
              style={{ flex: active.id === p.id ? 1.65 : 1 }}
            >
              <Frame
                photo={p}
                active={active.id === p.id}
                onActivate={() => setHovered(p.id)}
                dense={group.photos.length > 5}
              />
            </div>
          ))
        ) : (
          <>
            <button
              className={`neighbor previous ${previous ? "" : "missing"}`}
              onClick={() => navigate(-1)}
              aria-label="查看前一组"
              disabled={!previous}
            >
              {previous && (
                <>
                  <PhotoImage
                    alt="前一张照片（虚化）"
                    src={photoURL(previous.id, "preview")}
                  />
                  <span>
                    <ArrowLeft size={19} />
                    上一张
                  </span>
                </>
              )}
            </button>
            <div className="single-focus">
              <Frame
                key={active.id}
                photo={active}
                active
                onActivate={() => setHovered(active.id)}
              />
            </div>
            <button
              className={`neighbor next ${next ? "" : "missing"}`}
              onClick={() => navigate(1)}
              aria-label="查看后一组"
              disabled={!next}
            >
              {next && (
                <>
                  <PhotoImage
                    alt="后一张照片（虚化）"
                    src={photoURL(next.id, "preview")}
                  />
                  <span>
                    下一张
                    <ArrowRight size={19} />
                  </span>
                </>
              )}
            </button>
          </>
        )}
      </div>
      <footer className="immersive-footer">
        <div className="immersive-navigation">
          <button
            className="round-button"
            aria-label="上一组"
            onClick={() => navigate(-1)}
            disabled={index === 0}
          >
            <ArrowLeft size={18} />
          </button>
          <span>
            <strong>{String(index + 1).padStart(2, "0")}</strong> /{" "}
            {String(units.length).padStart(2, "0")}
            <small>{group.kind === "similar" ? "相似组" : "照片"}</small>
          </span>
          <button
            className="round-button"
            aria-label="下一组"
            onClick={() => navigate(1)}
            disabled={index >= units.length - 1}
          >
            <ArrowRight size={18} />
          </button>
        </div>
        <div className="decision-buttons">
          <button
            className={`decision keep ${active.status === "keep" ? "chosen" : ""}`}
            onClick={() => choose("keep")}
            disabled={saving}
          >
            <Check size={21} />
            <span>保留</span>
            <kbd>1</kbd>
          </button>
          <button
            className={`decision undecided ${active.status === "unseen" ? "chosen" : ""}`}
            onClick={() => choose("unseen")}
            disabled={saving}
          >
            <Minus size={21} />
            <span>待定</span>
            <kbd>2</kbd>
          </button>
          <button
            className={`decision reject ${active.status === "reject" ? "chosen" : ""}`}
            onClick={() => choose("reject")}
            disabled={saving}
          >
            <X size={21} />
            <span>不要</span>
            <kbd>3</kbd>
          </button>
        </div>
        <div className="immersive-hints">
          <button
            className="icon-button"
            title="撤销选择 ⌘Z"
            aria-label="撤销选择"
            onClick={onUndo}
          >
            <Undo2 size={18} />
          </button>
          <span>
            <MousePointer2 size={11} />
            滚轮缩放 · 双击放大
            <br />
            <Move size={11} />
            拖动看细节 · ← → 切换
          </span>
        </div>
      </footer>
    </div>
  );
}
