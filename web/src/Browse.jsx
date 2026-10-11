import React, { useEffect, useRef, useState } from "react";
import { api, photoURL } from "./api";
import { registerAssets } from "./local-media";
import { downloadPhotos } from "./downloads";
import Gallery from "./Gallery";
import PhotoImage from "./PhotoImage";
import { Viewer } from "./WallApp";
const positions = new Map();
const albums = new Map();
window.addEventListener("photo-collections-changed", () => albums.clear());
export default function Browse({ albumId }) {
  const cached = albums.get(albumId);
  const initialScroll = useRef(positions.get(albumId || "timeline") || 0),
    restored = useRef(false);
  const [entries, setEntries] = useState([]),
    [data, setData] = useState(cached || { items: [], nextCursor: undefined }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [viewer, setViewer] = useState(null);
  const sentinel = useRef(),
    loading = useRef(false),
    alive = useRef(true),
    latest = useRef(data);
  latest.current = data;
  const load = async () => {
    if (loading.current || latest.current.nextCursor === null) return false;
    loading.current = true;
    setBusy(true);
    setError("");
    try {
      const page = await api(
        `/collections/${encodeURIComponent(albumId)}/photos?limit=40&cursor=${encodeURIComponent(latest.current.nextCursor || "")}`,
      );
      if (!alive.current) return;
      registerAssets(page.items);
      const value = {
        ...page,
        items: [...latest.current.items, ...page.items].filter(
          (p, i, a) => a.findIndex((v) => v.id === p.id) === i,
        ),
      };
      latest.current = value;
      setData(value);
      albums.set(albumId, value);
      return true;
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      loading.current = false;
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    if (albumId) {
      if (cached) registerAssets(cached.items);
      else void load();
    } else
      api("/timeline")
        .then((rows) => {
          if (alive.current) {
            setEntries(rows);
            registerAssets(rows.map((r) => r.cover).filter(Boolean));
          }
        })
        .catch((e) => setError(e.message));
    return () => {
      alive.current = false;
    };
  }, [albumId]);
  useEffect(() => {
    if (restored.current || (albumId ? !data.collection : !entries.length))
      return;
    const id = requestAnimationFrame(() => {
      window.scrollTo(0, initialScroll.current);
      restored.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [albumId, data.collection, entries.length]);
  useEffect(() => {
    const save = () =>
      restored.current && positions.set(albumId || "timeline", window.scrollY);
    window.addEventListener("scroll", save);
    return () => window.removeEventListener("scroll", save);
  }, [albumId]);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || error || busy || data.nextCursor === null) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) void load();
      },
      { rootMargin: "500px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [data, error, busy]);
  const download = async (photos) => {
    try {
      await downloadPhotos(photos, () => {});
    } catch (e) {
      setError(e.message);
    }
  };
  const downloadAll = async () => {
    if (data.collection?.hasLocal === false) {
      const link = document.createElement("a");
      link.href = `/api/collections/${encodeURIComponent(albumId)}/download`;
      link.download = data.collection.name + ".zip";
      link.click();
      return;
    }
    while (latest.current.nextCursor !== null) {
      if (!(await load())) return;
    }
    await download(latest.current.items);
  };
  if (!albumId)
    return (
      <>
        <Gallery
          entries={entries}
          navigate={(id) => {
            location.hash = id;
          }}
          onOpen={(id) => {
            location.hash = `album/${encodeURIComponent(id)}`;
          }}
        />
        {error && <p role="alert">{error}</p>}
      </>
    );
  return (
    <main className="album-view">
      <header className="album-view-header">
        <a href="#wall">← 时间线</a>
        <button className="button" onClick={downloadAll} disabled={busy}>
          下载作品集
        </button>
      </header>
      <section className="album-intro">
        <h1>{data.collection?.name}</h1>
        <p>
          {[data.collection?.date, data.collection?.location]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <blockquote>{data.collection?.poem}</blockquote>
        <p>{data.collection?.description}</p>
      </section>
      <div className="album-photos">
        {data.items.map((p, index) => (
          <button
            key={p.id}
            className="album-photo"
            aria-label={`查看 ${p.name}`}
            onClick={() => setViewer({ photos: data.items, index })}
          >
            <PhotoImage
              src={photoURL(p.id, "thumb")}
              loading="lazy"
              alt={p.name}
              style={{ aspectRatio: `${p.width || 4}/${p.height || 3}` }}
            />
          </button>
        ))}
      </div>
      {error && (
        <div role="alert">
          {error}
          <button onClick={load}>重试</button>
        </div>
      )}
      {busy && <p role="status">正在加载…</p>}
      {data.nextCursor !== null && (
        <div ref={sentinel} className="gallery-sentinel" />
      )}
      {viewer && (
        <Viewer
          {...viewer}
          onClose={() => setViewer(null)}
          onDownload={download}
        />
      )}
    </main>
  );
}
