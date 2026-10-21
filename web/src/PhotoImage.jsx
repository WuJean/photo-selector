import { resolveMedia } from "./local-media";
import React, { useEffect, useRef, useState } from "react";

export default function PhotoImage({
  src,
  quiet = false,
  unavailable = false,
  ...props
}) {
  const [fallback, setFallback] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loadedURL, setLoadedURL] = useState("");
  const [resolved, setResolved] = useState("");
  useEffect(() => {
    if (!src?.startsWith("local-photo://")) return;
    setResolved("");
    let active = true,
      release = () => {};
    const load = () =>
      resolveMedia(src)
        .then((result) => {
          if (active) {
            release();
            release = result.revoke;
            setResolved(result.url);
            setError("");
          } else result.revoke();
        })
        .catch((e) => active && setError(e.message));
    load();
    window.addEventListener("photo-files-reconnected", load);
    return () => {
      active = false;
      release();
      window.removeEventListener("photo-files-reconnected", load);
    };
  }, [src, attempt]);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setError("");
    setAttempt(0);
    setFallback(false);
    return () => {
      generation.current++;
    };
  }, [src]);
  const baseURL =
    fallback && src?.startsWith("/api/")
      ? `${src}${src.includes("?") ? "&" : "?"}local=1`
      : src;
  const url = src?.startsWith("local-photo://")
    ? resolved
    : attempt
      ? `${baseURL}${baseURL.includes("?") ? "&" : "?"}retry=${attempt}`
      : baseURL;
  async function diagnose() {
    if (src?.startsWith("local-photo://")) return;
    if (!fallback && src?.startsWith("/api/")) {
      setFallback(true);
      return;
    }
    const token = generation.current;
    let message = "图片加载失败";
    try {
      const response = await fetch(url, { cache: "reload" });
      message =
        response.status === 404
          ? "图片不存在"
          : response.ok
            ? "图片解码失败"
            : "图片请求失败";
    } catch {
      message = "图片请求失败";
    }
    if (token === generation.current) setError(message);
  }
  return (
    <>
      <img
        {...props}
        src={url || undefined}
        style={{
          ...props.style,
          visibility:
            quiet && (!url || loadedURL !== url)
              ? "hidden"
              : props.style?.visibility,
        }}
        onError={diagnose}
        onLoad={() => {
          setError("");
          setLoadedURL(url);
        }}
      />
      {error && quiet && unavailable && (
        <span className="gallery-unavailable">照片暂不可用</span>
      )}
      {error && !quiet && (
        <span
          className="image-error"
          role="status"
          onClick={(e) => e.stopPropagation()}
        >
          {error}
          <button
            type="button"
            onClick={() => {
              generation.current++;
              setError("");
              setAttempt((n) => n + 1);
            }}
          >
            重试
          </button>
        </span>
      )}
    </>
  );
}
