import React, { useLayoutEffect } from "react";
import { Frame } from "./Immersive";
import PhotoImage from "./PhotoImage";
import { photoURL } from "./api";
import { tagsOf } from "../../shared/domain.mjs";
export default function Refine({
  photos,
  selected,
  onSelect,
  onDecide,
  onUndo,
  onComplete,
}) {
  const current = photos.find((p) => p.id === selected.at(-1)) || photos[0];
  useLayoutEffect(() => {
    if (current && !selected.includes(current.id)) onSelect(current.id);
  }, [current?.id]);
  const move = (delta) => {
    const p = photos[photos.indexOf(current) + delta];
    if (p) onSelect(p.id);
  };
  if (!current)
    return (
      <div className="empty-stage">
        <h2>当前范围已精筛</h2>
        <button className="primary" onClick={onComplete}>
          查看作品集候选
        </button>
      </div>
    );
  return (
    <div className="refine-view" aria-label="精筛照片">
      <div className="refine-large">
        <Frame
          photo={current}
          active
          round="final"
          onActivate={() => {}}
          onNavigate={move}
        />
      </div>
      <div className="refine-tags">
        {tagsOf(current).map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <div className="refine-actions">
        <button className="button" onClick={() => move(-1)}>
          上一张
        </button>
        <button className="primary" onClick={() => onDecide("keep")}>
          保留 <kbd>X</kbd>
        </button>
        <button className="button" onClick={() => onDecide("reject")}>
          不要 <kbd>C</kbd>
        </button>
        <button className="button" onClick={() => move(1)}>
          下一张
        </button>
        <button className="button" onClick={onUndo}>
          撤销
        </button>
      </div>
      <div className="refine-strip">
        {photos
          .slice(
            Math.max(0, photos.indexOf(current) - 10),
            photos.indexOf(current) + 20,
          )
          .map((p) => (
            <button
              key={p.id}
              aria-label={`精筛 ${p.name}`}
              className={p.id === current.id ? "active" : ""}
              onClick={() => onSelect(p.id)}
            >
              <PhotoImage src={photoURL(p.id)} alt={p.name} />
            </button>
          ))}
      </div>
    </div>
  );
}
