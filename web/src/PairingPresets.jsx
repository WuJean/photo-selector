import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, json } from "./api";
import {
  QUICK_PAIRINGS,
  PAIRING_SUBJECTS,
  PAIRING_SHOTS,
} from "../../shared/pairing.mjs";
import { TEMPLATES } from "../../shared/layout.mjs";

const blankRole = () => ({ subject: [], shot: [] });
const fallback = "portrait_triptych";
export default function PairingPresets({ onChange, onShuffle, disabled }) {
  const [presets, setPresets] = useState([]),
    [selected, setSelected] = useState(fallback),
    [ready, setReady] = useState(false),
    [editing, setEditing] = useState(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const choose = (id, values = presets) => {
    const custom = values.find((p) => p.id === id);
    const next = custom || (Object.hasOwn(QUICK_PAIRINGS, id) ? id : fallback);
    setSelected(custom?.id || next);
    localStorage.setItem("photo-pairing-preset", custom?.id || next);
    onChange(next);
  };
  const load = async () => {
    try {
      setError("");
      const values = await api("/pairing-presets");
      setPresets(values);
      choose(localStorage.getItem("photo-pairing-preset") || fallback, values);
      setReady(true);
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const custom = presets.find((p) => p.id === selected);
  const close = () => {
    if (!saving) {
      setEditing(null);
      setError("");
    }
  };
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const value = await api(
        `/pairing-presets${editing.id ? "/" + editing.id : ""}`,
        json(editing.id ? "PUT" : "POST", editing),
      );
      const values = [...presets.filter((p) => p.id !== value.id), value];
      setPresets(values);
      choose(value.id, values);
      setEditing(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    setSaving(true);
    setError("");
    try {
      await api(
        `/pairing-presets/${editing.id}`,
        json("DELETE", { revision: editing.revision }),
      );
      const values = presets.filter((p) => p.id !== editing.id);
      setPresets(values);
      choose(fallback, values);
      setEditing(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="pairing-presets">
      <div className="quick-pairing">
        <select
          aria-label="快捷搭配模板"
          value={selected}
          disabled={!ready || !!editing}
          onChange={(e) => choose(e.target.value)}
        >
          <optgroup label="内置模板">
            {Object.entries(QUICK_PAIRINGS).map(([id, p]) => (
              <option key={id} value={id}>
                {p.name}
              </option>
            ))}
          </optgroup>
          {presets.length > 0 && (
            <optgroup label="我的模板">
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          className="button"
          disabled={disabled || !ready || !!editing}
          onClick={onShuffle}
        >
          <RefreshCw size={15} />
          随机组合
        </button>
        <button
          className="button"
          disabled={!ready || !!editing}
          onClick={() => {
            setError("");
            setEditing({
              name: "",
              template: "rows",
              roles: Array.from({ length: 3 }, blankRole),
            });
          }}
        >
          新建模板
        </button>
        {custom && (
          <button
            className="button"
            disabled={!!editing}
            onClick={() => {
              setError("");
              setEditing(structuredClone(custom));
            }}
          >
            编辑模板
          </button>
        )}
      </div>
      {editing && (
        <form
          className="pairing-editor"
          aria-label="自定义快捷模板"
          onSubmit={save}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          <fieldset disabled={saving}>
            <label>
              模板名称
              <input
                autoFocus
                aria-label="模板名称"
                required
                maxLength={60}
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <label>
              布局
              <select
                aria-label="快捷模板布局"
                value={editing.template}
                onChange={(e) => {
                  const template = e.target.value;
                  setEditing({
                    ...editing,
                    template,
                    roles: Array.from(
                      { length: TEMPLATES[template].count },
                      (_, i) => editing.roles[i] || blankRole(),
                    ),
                  });
                }}
              >
                {Object.entries(TEMPLATES)
                  .filter(([, t]) => t.count >= 3)
                  .map(([id, t]) => (
                    <option key={id} value={id}>
                      {t.label}
                    </option>
                  ))}
              </select>
            </label>
            <div className="pairing-roles">
              {editing.roles.map((r, i) => (
                <div className="pairing-role" key={i}>
                  <strong>第 {i + 1} 格</strong>
                  {[
                    ["subject", "主体", PAIRING_SUBJECTS],
                    ["shot", "景别", PAIRING_SHOTS],
                  ].map(([key, label, choices]) => (
                    <label key={key}>
                      {label}
                      <select
                        aria-label={`第 ${i + 1} 格${label}`}
                        value={r[key][0] || ""}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            roles: editing.roles.map((v, n) =>
                              n === i
                                ? {
                                    ...v,
                                    [key]: e.target.value
                                      ? [e.target.value]
                                      : [],
                                  }
                                : v,
                            ),
                          })
                        }
                      >
                        <option value="">不限</option>
                        {choices.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div className="pairing-actions">
              {editing.id && (
                <button type="button" className="button" onClick={remove}>
                  删除模板
                </button>
              )}
              <button type="button" className="button" onClick={close}>
                取消
              </button>
              <button className="primary" type="submit">
                {saving ? "保存中…" : "保存模板"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {error && (
        <div className="pairing-error" role="alert">
          {error}
          {!ready && (
            <button className="button" onClick={load}>
              重试
            </button>
          )}
          {ready && !saving && (
            <button
              className="button"
              onClick={() => {
                setEditing(null);
                void load();
              }}
            >
              重新加载模板
            </button>
          )}
        </div>
      )}
    </div>
  );
}
