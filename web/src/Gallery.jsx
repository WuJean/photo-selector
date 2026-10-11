import React, { useEffect, useRef, useState } from "react";
import PhotoImage from "./PhotoImage";
import { photoURL } from "./api";
export default function Gallery({ photos, collections, navigate, onOpen }) {
  const members = new Set(collections.flatMap((c) => c.photoIds));
  const ordered = photos
    .filter((p) => members.has(p.id) && !p.deleted)
    .sort(
      (a, b) =>
        String(b.takenAt || b.createdAt || "").localeCompare(
          String(a.takenAt || a.createdAt || ""),
        ) || a.id.localeCompare(b.id),
    );
  const [limit, setLimit] = useState(80);
  const more = useRef();
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting))
          setLimit((n) => Math.min(ordered.length, n + 80));
      },
      { rootMargin: "600px" },
    );
    if (more.current) observer.observe(more.current);
    return () => observer.disconnect();
  }, [ordered.length, limit]);
  const link = (id, label) => (
    <a
      href={"#" + id}
      onClick={(e) => {
        e.preventDefault();
        navigate(id);
      }}
    >
      {label}
    </a>
  );
  return (
    <div className="gallery-page">
      <header className="wall-header gallery-header">
        <a className="gallery-brand" href="/">
          我的照片墙
        </a>
        <nav>
          {link("collections", "作品集")}
          {link("work", "导入与筛选")}
        </nav>
      </header>
      <main className="gallery-body">
        <div className="gallery-masonry">
          {ordered.slice(0, limit).map((p, i) => (
            <button
              className="gallery-photo"
              key={p.id}
              aria-label={"查看 " + p.name}
              style={{ aspectRatio: `${p.width || 4}/${p.height || 3}` }}
              onClick={() => onOpen({ photos: ordered, index: i })}
            >
              <PhotoImage
                quiet
                src={photoURL(p.id, "preview")}
                alt={p.name}
                loading="lazy"
              />
              <span className="gallery-unavailable">照片暂不可用</span>
            </button>
          ))}
        </div>
        {!ordered.length && (
          <div className="gallery-empty">{link("work", "前往导入与筛选")}</div>
        )}
        {limit < ordered.length && (
          <div ref={more} className="gallery-sentinel" />
        )}
      </main>
    </div>
  );
}
