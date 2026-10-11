import React, { useEffect, useRef, useState } from "react";

export default function PhotoImage({ src, ...props }) {
  const [attempt, setAttempt] = useState(0);
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
  const url = attempt
    ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}`
    : src;
  async function diagnose() {
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
        src={url}
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
