"use client";

import { Folder, FileText, FileArchive, Pencil, Trash2, Upload, FolderPlus, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api/admin-api";
import { formatBytes, formatDateTime } from "@/lib/utils/format";
import type {
  MinecraftFileEntry,
  MinecraftFileReadResult,
  MinecraftServerWithWorkload
} from "@/types/admin";

export function MinecraftFilesManager({
  entry
}: {
  entry: MinecraftServerWithWorkload;
}) {
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<MinecraftFileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<MinecraftFileReadResult | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (nextPath = path) => {
    setLoading(true);
    try {
      const result = await adminApi.minecraftFiles(entry.server.id, nextPath);
      setEntries(result.entries);
      setPath(result.path);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to list files.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh("/");
  }, [entry.server.id]);

  const openFile = async (filePath: string) => {
    setBusy(filePath);
    try {
      const result = await adminApi.readMinecraftFile(entry.server.id, filePath);
      setSelectedFile(result);
      setContent(result.content);
      setError(null);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Unable to read file.");
    } finally {
      setBusy(null);
    }
  };

  const saveFile = async () => {
    if (!selectedFile || selectedFile.readOnly) return;
    setBusy("save");
    try {
      await adminApi.writeMinecraftFile(entry.server.id, selectedFile.path, content);
      const reread = await adminApi.readMinecraftFile(entry.server.id, selectedFile.path);
      setSelectedFile(reread);
      setContent(reread.content);
      await refresh(path);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save file.");
    } finally {
      setBusy(null);
    }
  };

  const deletePath = async (targetPath: string) => {
    if (!window.confirm(`Delete ${targetPath}?`)) return;
    setBusy(targetPath);
    try {
      await adminApi.deleteMinecraftFile(entry.server.id, targetPath);
      if (selectedFile?.path === targetPath) {
        setSelectedFile(null);
        setContent("");
      }
      await refresh(path);
      setError(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete path.");
    } finally {
      setBusy(null);
    }
  };

  const createFolder = async () => {
    const name = window.prompt("Folder name");
    if (!name) return;
    setBusy("mkdir");
    try {
      await adminApi.mkdirMinecraftFile(entry.server.id, joinPath(path, name));
      await refresh(path);
      setError(null);
    } catch (mkdirError) {
      setError(mkdirError instanceof Error ? mkdirError.message : "Unable to create folder.");
    } finally {
      setBusy(null);
    }
  };

  const renamePath = async (fromPath: string) => {
    const currentName = fromPath.split("/").filter(Boolean).at(-1) ?? fromPath;
    const nextName = window.prompt("Rename path", currentName);
    if (!nextName || nextName === currentName) return;
    setBusy(fromPath);
    try {
      await adminApi.renameMinecraftFile(
        entry.server.id,
        fromPath,
        joinPath(parentPath(fromPath), nextName)
      );
      await refresh(path);
      if (selectedFile?.path === fromPath) {
        setSelectedFile(null);
        setContent("");
      }
      setError(null);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Unable to rename path.");
    } finally {
      setBusy(null);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy("upload");
    try {
      await adminApi.uploadMinecraftFile(entry.server.id, joinPath(path, file.name), file);
      await refresh(path);
      setError(null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload file.");
    } finally {
      event.target.value = "";
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.05] px-4 py-3 text-xs text-amber-200">
        File changes only take effect after the next server restart. Stop &amp; start the server (or use Restart) once your edits are done.
      </div>
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="rounded-2xl border border-line bg-panel/78 p-5 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Files</h3>
            <p className="mt-1 text-xs text-slate-500">{path}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void refresh(path)} className={toolbarClass}>
              <RotateCcw className="h-3.5 w-3.5" /> Refresh
            </button>
            <label className={toolbarClass}>
              <Upload className="h-3.5 w-3.5" /> Upload
              <input type="file" className="hidden" onChange={(event) => void handleUpload(event)} />
            </label>
            <button type="button" onClick={() => void createFolder()} className={toolbarClass}>
              <FolderPlus className="h-3.5 w-3.5" /> New folder
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400">
          <Crumb label="/" active={path === "/"} onClick={() => void refresh("/")} />
          {path
            .split("/")
            .filter(Boolean)
            .map((segment, index, array) => {
              const crumbPath = array.slice(0, index + 1).join("/");
              return (
                <Crumb
                  key={crumbPath}
                  label={segment}
                  active={crumbPath === path}
                  onClick={() => void refresh(crumbPath)}
                />
              );
            })}
        </div>

        {entry.server.runtimeState === "running" ? (
          <p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2 text-xs text-amber-200">
            Sensitive config edits while the server is running may require a restart to take effect.
          </p>
        ) : null}

        {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}

        <div className="mt-4 overflow-hidden rounded-2xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.18em] text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Modified</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading ? (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={4}>
                    Loading files...
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={4}>
                    Folder is empty.
                  </td>
                </tr>
              ) : (
                entries.map((item) => (
                  <tr key={item.path} className="hover:bg-white/[0.03]">
                    <td className="px-4 py-4">
                      <button
                        type="button"
                        onClick={() =>
                          item.type === "directory"
                            ? void refresh(item.path)
                            : void openFile(item.path)
                        }
                        className="flex items-center gap-2 text-left text-white"
                      >
                        {item.type === "directory" ? (
                          <Folder className="h-4 w-4 text-amber-300" />
                        ) : item.path.endsWith(".zip") ? (
                          <FileArchive className="h-4 w-4 text-slate-300" />
                        ) : (
                          <FileText className="h-4 w-4 text-slate-300" />
                        )}
                        <span className="break-all">{item.name}</span>
                      </button>
                    </td>
                    <td className="px-4 py-4 text-slate-400">
                      {item.type === "directory" ? "—" : formatBytes(item.sizeBytes)}
                    </td>
                    <td className="px-4 py-4 text-slate-400">{formatDateTime(item.modifiedAt)}</td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        {item.type === "file" ? (
                          <button type="button" className={iconButtonClass} onClick={() => void openFile(item.path)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        <button type="button" className={iconButtonClass} onClick={() => void renamePath(item.path)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" className={iconButtonClass} onClick={() => void deletePath(item.path)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-panel/78 p-5 shadow-soft">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Editor</h3>
            <p className="mt-1 text-xs text-slate-500">
              {selectedFile ? selectedFile.path : "Select a text file to open it here."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void saveFile()}
            disabled={!selectedFile || selectedFile.readOnly || busy === "save"}
            className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "save" ? "Saving..." : "Save"}
          </button>
        </div>
        {selectedFile?.redacted ? (
          <p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2 text-xs text-amber-200">
            Sensitive secrets were redacted from this file. Editing is disabled for safety.
          </p>
        ) : null}
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          disabled={!selectedFile || selectedFile.readOnly}
          className="mt-4 h-[520px] w-full rounded-2xl border border-white/10 bg-obsidian p-4 font-mono text-xs text-slate-200 outline-none focus:border-accent/40 disabled:opacity-50"
          placeholder="Open server.properties, whitelist.json, ops.json or another text config file."
        />
      </div>
    </section>
    </div>
  );
}

function Crumb({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 ${active ? "bg-white/[0.08] text-white" : "bg-white/[0.03] text-slate-400 hover:text-white"}`}
    >
      {label}
    </button>
  );
}

function parentPath(path: string) {
  if (path === "/") return "/";
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return parts.slice(0, -1).join("/");
}

function joinPath(base: string, name: string) {
  const safeName = name.replace(/^\/+/, "");
  if (base === "/" || base === "") {
    return safeName;
  }
  return `${base.replace(/\/$/, "")}/${safeName}`.replace(/\/+/g, "/");
}

const toolbarClass =
  "inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-white transition hover:bg-white/[0.08]";
const iconButtonClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-slate-300 transition hover:bg-white/[0.08] hover:text-white";
