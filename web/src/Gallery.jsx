import React, { useEffect, useRef, useState } from "react";
import PhotoImage from "./PhotoImage";
import { photoURL } from "./api";
import { collectionTimeline } from "../../shared/collections.mjs";
export default function Gallery({ photos = [], collections = [], entries: summaries, navigate, onOpen }) {
  const entries = summaries || collectionTimeline(collections, photos);
  const [limit, setLimit] = useState(20);
  const more = useRef();
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + 20);
      },
      { rootMargin: "600px" },
    );
    if (more.current) observer.observe(more.current);
    return () => observer.disconnect();
  }, [entries.length, limit]);
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
          我的作品集
        </a>
        <nav>
          {link("collections", "作品集")}
          {link("work", "导入与筛选")}
        </nav>
      </header>
      <main className="album-timeline">
        {entries.slice(0, limit).map(({ collection: c, cover, date }) => (
          <article className="timeline-entry" key={c.id}>
            <div className="timeline-date">
              <span className="timeline-dot" />
              <time dateTime={date || undefined}>
                {date ? date.replaceAll("-", ".") : "未设时间"}
              </time>
            </div>
            <a
              className="timeline-album"
              href={"#collection-" + c.id}
              aria-label={"查看作品集 " + c.name}
              onClick={(e) => {
                e.preventDefault();
                onOpen(c.id);
              }}
            >
              <div
                className="timeline-cover"
                style={
                  cover
                    ? {
                        aspectRatio: `${cover.width || 4}/${cover.height || 3}`,
                      }
                    : undefined
                }
              >
                {cover ? (
                  <PhotoImage
                    quiet
                    unavailable
                    src={photoURL(cover.id, "preview")}
                    alt={c.name + "封面"}
                    loading="lazy"
                  />
                ) : (
                  <span className="timeline-empty-cover">尚无照片</span>
                )}
              </div>
              <div className="timeline-caption">
                <h2>{c.name}</h2>
                {c.location && (
                  <span className="timeline-location">{c.location}</span>
                )}
                {c.poem && <blockquote>{c.poem}</blockquote>}
                {c.description && <p>{c.description}</p>}
              </div>
            </a>
          </article>
        ))}
        {!entries.length && (
          <div className="gallery-empty">{link("work", "前往导入与筛选")}</div>
        )}
        {limit < entries.length && (
          <div ref={more} className="gallery-sentinel" />
        )}
      </main>
    </div>
  );
}
