import React, { useState, useEffect, useRef } from "react";
import { X, Check, Layers, Heart, Loader2, Lock } from "lucide-react";
import PhotoImage from "./PhotoImage";
import { photoURL } from "./api";
import { STATUS_LABELS, tagsOf } from "../../shared/domain.mjs";
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
export function InputDialog({ dialog, onClose }) {
  const [value, setValue] = useState(dialog.initial || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={dialog.title} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await dialog.submit(value);
            onClose();
          } catch (error) {
            setError(error.message);
          } finally {
            setSaving(false);
          }
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
        {error && <p role="alert">{error}</p>}
        <footer>
          <Button onClick={onClose} type="button" disabled={saving}>
            取消
          </Button>
          <Button primary type="submit" disabled={saving}>
            {saving ? "保存中…" : "确定"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
export function VirtualGrid({
  items,
  selected,
  onSelect,
  onOpen,
  onExpand,
  renderBadge,
  scrollKey,
  focusId,
  onReorder,
  lockedIds = [],
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
  }, [scrollKey]);
  const columns = Math.max(1, Math.floor(size.width / 235)),
    gap = 20,
    width = (size.width - gap * (columns - 1)) / columns,
    height =
      width * 0.72 +
      90 +
      Math.ceil(
        Math.max(
          0,
          ...items.map((item) => tagsOf(item.photo).join(" · ").length),
        ) / Math.max(12, Math.floor(width / 12)),
      ) *
        19,
    rowHeight = height + gap;
  useEffect(() => {
    const index = items.findIndex((item) => item.photo.id === focusId);
    if (index < 0 || !ref.current) return;
    const y = Math.floor(index / columns) * rowHeight;
    if (
      y < ref.current.scrollTop ||
      y + rowHeight > ref.current.scrollTop + size.height
    )
      ref.current.scrollTop = y;
  }, [focusId, columns, rowHeight, size.height]);
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
              draggable={!!onReorder}
              onDragStart={(e) => {
                if (onReorder) {
                  e.stopPropagation();
                  e.dataTransfer.setData("application/x-photo-id", p.id);
                }
              }}
              onDragOver={(e) => {
                if (
                  onReorder &&
                  e.dataTransfer.types.includes("application/x-photo-id")
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              onDrop={(e) => {
                if (onReorder) {
                  const source = e.dataTransfer.getData(
                    "application/x-photo-id",
                  );
                  if (
                    source &&
                    source !== p.id &&
                    items.some((item) => item.photo.id === source)
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    onReorder(source, p.id);
                  }
                }
              }}
              aria-label={p.name}
            >
              <div className="photo-image" style={{ height: width * 0.72 }}>
                <PhotoImage
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
                {(item.count > 1 || item.expanded) && (
                  <button
                    className="stack-badge"
                    onClick={(e) => {
                      e.stopPropagation();
                      onExpand(item.group);
                    }}
                    title={item.expanded ? "收起本组" : "展开相似组"}
                    aria-label={item.expanded ? "收起本组" : "展开相似组"}
                  >
                    <Layers size={12} />
                    {item.expanded ? "收起" : item.count}
                  </button>
                )}
                {lockedIds.includes(p.id) && (
                  <span className="processing" title="已锁定">
                    <Lock size={12} />
                  </span>
                )}
                {p.favorite && (
                  <Heart
                    className="photo-heart"
                    size={17}
                    fill="currentColor"
                  />
                )}
                {p.status !== "unseen" && (
                  <span className="keep-badge">
                    {renderBadge ? renderBadge(p) : STATUS_LABELS[p.status]}
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
                  {tagsOf(p).join(" · ")}
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
