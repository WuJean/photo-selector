import { resolveMedia } from "./local-media";
import React, { useEffect, useRef, useState } from "react";

export default function PhotoImage({ src, ...props }) {
  const [attempt, setAttempt] = useState(0);
  const [resolved, setResolved] = useState("");
  useEffect(() => {
    if (!src?.startsWith("local-photo://")) return;
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
    return () => {
      generation.current++;
    };
  }, [src]);
  const url = src?.startsWith("local-photo://")
    ? resolved
    : attempt
      ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}`
      : src;
  async function diagnose() {
    if (src?.startsWith("local-photo://")) return;
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
        onError={diagnose}
        onLoad={() => setError("")}
      />
      {error && (
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
