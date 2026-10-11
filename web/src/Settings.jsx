import React, { useEffect, useState } from "react";
import {
  KeyRound,
  Server,
  Sparkles,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Trash2,
  Eye,
  EyeOff,
} from "lucide-react";
import { api, json } from "./api";
export default function Settings({ onClose, notify }) {
  const [config, setConfig] = useState({
      baseURL: "",
      model: "",
      jsonMode: true,
      hasKey: false,
    }),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(""),
    [status, setStatus] = useState(""),
    [show, setShow] = useState(false),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    api("/settings")
      .then(setConfig)
      .catch((e) => notify(e.message))
      .finally(() => setLoading(false));
  }, []);
  const perform = async (type) => {
    setBusy(type);
    setStatus("");
    try {
      if (type === "delete") {
        await api("/settings/key", { method: "DELETE" });
        setKey("");
        setConfig({ ...config, hasKey: false });
        setStatus("已清除保存的密钥");
      } else if (type === "test") {
        const result = await api(
          "/settings/test",
          json("POST", { ...config, apiKey: key }),
        );
        setStatus(
          `图片理解测试通过 · 输入 ${result.usage.prompt_tokens} / 输出 ${result.usage.completion_tokens} tokens`,
        );
      } else {
        setConfig(
          await api("/settings", json("PUT", { ...config, apiKey: key })),
        );
        setKey("");
        setStatus("配置已保存");
        notify("多模态服务配置已保存");
      }
    } catch (e) {
      setStatus(e.message);
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="settings-body">
      <label className="field">
        <span>
          <Server size={13} /> API Base URL
        </span>
        <input
          disabled={loading}
          autoComplete="off"
          placeholder="https://你的服务地址/v1"
          value={config.baseURL}
          onChange={(e) => setConfig({ ...config, baseURL: e.target.value })}
        />
      </label>
      <label className="field">
        <span>
          <Sparkles size={13} /> 模型名称
        </span>
        <input
          disabled={loading}
          placeholder="填写服务商提供的多模态模型名"
          value={config.model}
          onChange={(e) => setConfig({ ...config, model: e.target.value })}
        />
      </label>
      <label className="field">
        <span>
          <KeyRound size={13} /> API Key{" "}
          <em>{config.hasKey ? "已有密钥" : "尚未保存密钥"}</em>
        </span>
        <div className="key-input">
          <input
            disabled={loading}
            type={show ? "text" : "password"}
            autoComplete="new-password"
            placeholder={
              config.hasKey ? "留空保留已存密钥" : "本地无鉴权服务可留空"
            }
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button
            className="icon-button"
            aria-label="显示或隐藏密钥"
            onClick={() => setShow((v) => !v)}
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <small>保存位置：{config.keyStorage || "本机"}</small>
      </label>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={config.jsonMode}
          onChange={(e) => setConfig({ ...config, jsonMode: e.target.checked })}
        />
        启用 JSON 模式
      </label>
      <div className="concurrency-settings">
        {[
          ["sampleConcurrency", "抽样并发", 4],
          ["analysisConcurrency", "打标并发", 8],
          ["serviceConcurrency", "服务总并发", 8],
        ].map(([key, label, fallback]) => (
          <label className="field" key={key}>
            <span>{label}</span>
            <input
              type="number"
              min="1"
              max="16"
              value={config[key] || fallback}
              onChange={(e) =>
                setConfig({ ...config, [key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
      </div>
      {status && (
        <div className="settings-result" role="status">
          {status}
        </div>
      )}
      <footer>
        <button
          className="text-button danger"
          onClick={() => perform("delete")}
          disabled={!config.hasKey || !!busy}
        >
          <Trash2 size={13} />
          清除密钥
        </button>
        <span className="flex-spacer" />
        <button
          className="button"
          onClick={() => perform("test")}
          disabled={loading || !!busy || !config.baseURL || !config.model}
        >
          {busy === "test" ? (
            <Loader2 size={14} className="spin" />
          ) : (
            <CheckCircle2 size={14} />
          )}
          测试图片理解
        </button>
        <button
          className="primary"
          onClick={() => perform("save")}
          disabled={loading || !!busy || !config.baseURL || !config.model}
        >
          {busy === "save" && <Loader2 size={14} className="spin" />}保存配置
        </button>
      </footer>
    </div>
  );
}
