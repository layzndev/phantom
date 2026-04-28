"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Box,
  ChevronRight,
  FileArchive,
  FileText,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  MoreVertical,
  Pencil,
  RotateCcw,
  Settings,
  Trash2,
  Upload,
  Wrench
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { adminApi } from "@/lib/api/admin-api";
import type {
  MinecraftFileEntry,
  MinecraftFileReadResult,
  MinecraftServerWithWorkload
} from "@/types/admin";

type SortColumn = "name" | "size" | "date";
type SortDirection = "asc" | "desc";

type EditorMode = "builder" | "text";

const BUILDER_FILES = new Set([
  "server.properties",
  "bukkit.yml",
  "spigot.yml",
  "whitelist.json",
  "ops.json",
  "banned-players.json",
  "banned-ips.json"
]);

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
  const [sortColumn, setSortColumn] = useState<SortColumn>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openMenuPath, setOpenMenuPath] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("builder");

  const refresh = async (nextPath = path) => {
    setLoading(true);
    try {
      const result = await adminApi.minecraftFiles(entry.server.id, nextPath);
      setEntries(result.entries);
      setPath(result.path);
      setError(null);
      setSelected(new Set());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to list files.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh("/");
  }, [entry.server.id]);

  const sortedEntries = useMemo(() => {
    const list = [...entries];
    list.sort((a, b) => {
      // Folders always group above files for natural navigation.
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      const dir = sortDirection === "asc" ? 1 : -1;
      switch (sortColumn) {
        case "size": {
          const av = a.type === "directory" ? -1 : a.sizeBytes;
          const bv = b.type === "directory" ? -1 : b.sizeBytes;
          return (av - bv) * dir;
        }
        case "date": {
          const av = new Date(a.modifiedAt).getTime();
          const bv = new Date(b.modifiedAt).getTime();
          return (av - bv) * dir;
        }
        default:
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) * dir;
      }
    });
    return list;
  }, [entries, sortColumn, sortDirection]);

  const toggleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const openFile = async (filePath: string) => {
    setBusy(filePath);
    try {
      const result = await adminApi.readMinecraftFile(entry.server.id, filePath);
      setSelectedFile(result);
      setContent(result.content);
      setEditorMode(BUILDER_FILES.has(basename(filePath)) ? "builder" : "text");
      setError(null);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Unable to read file.");
    } finally {
      setBusy(null);
    }
  };

  const saveFile = async (override?: string) => {
    if (!selectedFile || selectedFile.readOnly) return;
    const payload = override ?? content;
    setBusy("save");
    try {
      await adminApi.writeMinecraftFile(entry.server.id, selectedFile.path, payload);
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

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} item(s)?`)) return;
    setBusy("bulk-delete");
    try {
      for (const targetPath of selected) {
        await adminApi.deleteMinecraftFile(entry.server.id, targetPath);
        if (selectedFile?.path === targetPath) {
          setSelectedFile(null);
          setContent("");
        }
      }
      await refresh(path);
      setError(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete selection.");
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

  const toggleSelect = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === sortedEntries.length && sortedEntries.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sortedEntries.map((entryItem) => entryItem.path)));
    }
  };

  const allSelected = sortedEntries.length > 0 && selected.size === sortedEntries.length;
  const partiallySelected = selected.size > 0 && !allSelected;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.05] px-4 py-3 text-xs text-amber-200">
        File changes only take effect after the next server restart. Stop &amp; start the server (or use Restart) once your edits are done.
      </div>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-line bg-panel/78 p-5 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white">Files</h3>
              <PathBreadcrumb path={path} onNavigate={(next) => void refresh(next)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void refresh(path)}
                className={toolbarClass}
                disabled={loading}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Refresh
              </button>
              <label className={toolbarClass}>
                <Upload className="h-3.5 w-3.5" /> Upload
                <input type="file" className="hidden" onChange={(event) => void handleUpload(event)} />
              </label>
              <button type="button" onClick={() => void createFolder()} className={toolbarClass}>
                <FolderPlus className="h-3.5 w-3.5" /> New folder
              </button>
              {selected.size > 0 ? (
                <button
                  type="button"
                  onClick={() => void deleteSelected()}
                  className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/[0.08] px-3 py-2 text-xs text-red-200 transition hover:bg-red-500/[0.14]"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete ({selected.size})
                </button>
              ) : null}
            </div>
          </div>

          {entry.server.runtimeState === "running" ? (
            <p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2 text-xs text-amber-200">
              Sensitive config edits while the server is running may require a restart to take effect.
            </p>
          ) : null}

          {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}

          <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-obsidian/60">
            <div className="hidden grid-cols-[36px_minmax(0,1fr)_140px_180px_36px] items-center gap-3 border-b border-white/[0.06] px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:grid">
              <div className="flex items-center justify-center">
                <Checkbox
                  checked={allSelected}
                  indeterminate={partiallySelected}
                  onChange={toggleSelectAll}
                />
              </div>
              <SortHeader
                label="Name"
                column="name"
                activeColumn={sortColumn}
                direction={sortDirection}
                onClick={() => toggleSort("name")}
              />
              <SortHeader
                label="Size"
                column="size"
                activeColumn={sortColumn}
                direction={sortDirection}
                onClick={() => toggleSort("size")}
              />
              <SortHeader
                label="Date"
                column="date"
                activeColumn={sortColumn}
                direction={sortDirection}
                onClick={() => toggleSort("date")}
              />
              <div />
            </div>

            {loading ? (
              <p className="px-4 py-6 text-sm text-slate-500">Loading files…</p>
            ) : sortedEntries.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500">Folder is empty.</p>
            ) : (
              <ul className="divide-y divide-white/[0.04]">
                {sortedEntries.map((item) => {
                  const baseName = basename(item.path);
                  const isBuilderFile = item.type === "file" && BUILDER_FILES.has(baseName);
                  const isSelectedRow = selected.has(item.path);
                  return (
                    <li
                      key={item.path}
                      className={`grid grid-cols-[36px_minmax(0,1fr)_140px_180px_36px] items-center gap-3 px-4 py-3 transition hover:bg-white/[0.025] ${
                        isSelectedRow ? "bg-white/[0.04]" : ""
                      }`}
                    >
                      <div className="flex items-center justify-center">
                        <Checkbox
                          checked={isSelectedRow}
                          onChange={() => toggleSelect(item.path)}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          item.type === "directory"
                            ? void refresh(item.path)
                            : void openFile(item.path)
                        }
                        className="flex min-w-0 items-center gap-3 text-left"
                      >
                        <FileTypeIcon type={item.type} name={baseName} />
                        <span className="truncate text-sm text-white">{item.name}</span>
                        {isBuilderFile ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-400/30 bg-emerald-400/[0.08] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
                            <Wrench className="h-3 w-3" /> Builder
                          </span>
                        ) : null}
                      </button>
                      <span className="text-xs text-slate-400">
                        {item.type === "directory" ? "—" : formatFrenchBytes(item.sizeBytes)}
                      </span>
                      <span className="text-xs text-slate-400">
                        {formatShortDateTime(item.modifiedAt)}
                      </span>
                      <RowMenu
                        open={openMenuPath === item.path}
                        onOpenChange={(open) => setOpenMenuPath(open ? item.path : null)}
                        onRename={() => {
                          setOpenMenuPath(null);
                          void renamePath(item.path);
                        }}
                        onDelete={() => {
                          setOpenMenuPath(null);
                          void deletePath(item.path);
                        }}
                        onOpenEditor={
                          item.type === "file"
                            ? () => {
                                setOpenMenuPath(null);
                                void openFile(item.path);
                              }
                            : undefined
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-panel/78 p-5 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white">Editor</h3>
              <p className="mt-1 break-all text-xs text-slate-500">
                {selectedFile ? selectedFile.path : "Select a text file to open it here."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {selectedFile && BUILDER_FILES.has(basename(selectedFile.path)) ? (
                <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.04] p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setEditorMode("builder")}
                    className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                      editorMode === "builder" ? "bg-white/[0.1] text-white" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Builder
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorMode("text")}
                    className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                      editorMode === "text" ? "bg-white/[0.1] text-white" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Text
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => void saveFile()}
                disabled={!selectedFile || selectedFile.readOnly || busy === "save"}
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.08] px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/[0.14] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "save" ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          {selectedFile?.redacted ? (
            <p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2 text-xs text-amber-200">
              Sensitive secrets were redacted from this file. Editing is disabled for safety.
            </p>
          ) : null}

          {selectedFile && editorMode === "builder" ? (
            <BuilderEditor
              file={selectedFile}
              content={content}
              onChange={setContent}
              disabled={selectedFile.readOnly === true}
            />
          ) : (
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              disabled={!selectedFile || selectedFile.readOnly}
              className="mt-4 h-[520px] w-full rounded-2xl border border-white/10 bg-obsidian p-4 font-mono text-xs text-slate-200 outline-none focus:border-accent/40 disabled:opacity-50"
              placeholder="Open a text file to edit it here."
            />
          )}
        </div>
      </section>
    </div>
  );
}

function PathBreadcrumb({
  path,
  onNavigate
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  const segments = path.split("/").filter(Boolean);
  return (
    <nav className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-400">
      <button
        type="button"
        onClick={() => onNavigate("/")}
        className={`rounded-md px-2 py-0.5 transition ${
          path === "/" ? "bg-white/[0.08] text-white" : "hover:bg-white/[0.04] hover:text-white"
        }`}
      >
        /
      </button>
      {segments.map((segment, index) => {
        const target = segments.slice(0, index + 1).join("/");
        const isLast = index === segments.length - 1;
        return (
          <span key={target} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-slate-600" />
            <button
              type="button"
              onClick={() => onNavigate(target)}
              className={`rounded-md px-2 py-0.5 transition ${
                isLast ? "bg-white/[0.08] text-white" : "hover:bg-white/[0.04] hover:text-white"
              }`}
            >
              {segment}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

function SortHeader({
  label,
  column,
  activeColumn,
  direction,
  onClick
}: {
  label: string;
  column: SortColumn;
  activeColumn: SortColumn;
  direction: SortDirection;
  onClick: () => void;
}) {
  const isActive = activeColumn === column;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 transition ${
        isActive ? "text-emerald-300" : "text-slate-500 hover:text-slate-200"
      }`}
    >
      {label}
      {isActive ? (
        direction === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3" />
      )}
    </button>
  );
}

function FileTypeIcon({ type, name }: { type: "file" | "directory"; name: string }) {
  if (type === "directory") {
    return <Folder className="h-4 w-4 shrink-0 text-amber-300" />;
  }
  const lower = name.toLowerCase();
  if (lower === "server.properties") {
    return <Wrench className="h-4 w-4 shrink-0 text-violet-300" />;
  }
  if (/\.(json|yml|yaml)$/.test(lower)) {
    return <Settings className="h-4 w-4 shrink-0 text-slate-300" />;
  }
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(lower)) {
    return <ImageIcon className="h-4 w-4 shrink-0 text-emerald-300" />;
  }
  if (/\.(jar|class)$/.test(lower)) {
    return <Box className="h-4 w-4 shrink-0 text-amber-200" />;
  }
  if (/\.(zip|gz|tar|tgz|7z|rar)$/.test(lower)) {
    return <FileArchive className="h-4 w-4 shrink-0 text-slate-300" />;
  }
  return <FileText className="h-4 w-4 shrink-0 text-sky-300" />;
}

function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  disabled = false
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate && !checked;
    }
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      className="h-3.5 w-3.5 cursor-pointer rounded border-white/20 bg-transparent accent-emerald-400"
    />
  );
}

function RowMenu({
  open,
  onOpenChange,
  onRename,
  onDelete,
  onOpenEditor
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: () => void;
  onDelete: () => void;
  onOpenEditor?: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className="relative flex justify-end">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/[0.06] hover:text-white"
        aria-label="Row actions"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open ? (
        <div className="absolute right-0 top-9 z-20 w-44 rounded-xl border border-white/10 bg-obsidian p-1 shadow-2xl">
          {onOpenEditor ? (
            <MenuItem onClick={onOpenEditor} icon={<Pencil className="h-3.5 w-3.5" />}>
              Open in editor
            </MenuItem>
          ) : null}
          <MenuItem onClick={onRename} icon={<Pencil className="h-3.5 w-3.5" />}>
            Rename
          </MenuItem>
          <MenuItem onClick={onDelete} icon={<Trash2 className="h-3.5 w-3.5" />} destructive>
            Delete
          </MenuItem>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  children,
  icon,
  onClick,
  destructive = false
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition ${
        destructive
          ? "text-red-300 hover:bg-red-500/[0.1]"
          : "text-slate-200 hover:bg-white/[0.06]"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function BuilderEditor({
  file,
  content,
  onChange,
  disabled
}: {
  file: MinecraftFileReadResult;
  content: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  const name = basename(file.path);
  if (name === "server.properties") {
    return <PropertiesBuilder content={content} onChange={onChange} disabled={disabled} />;
  }
  if (
    name === "whitelist.json" ||
    name === "ops.json" ||
    name === "banned-players.json" ||
    name === "banned-ips.json"
  ) {
    return <JsonListBuilder content={content} onChange={onChange} disabled={disabled} kind={name} />;
  }
  return (
    <textarea
      value={content}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className="mt-4 h-[520px] w-full rounded-2xl border border-white/10 bg-obsidian p-4 font-mono text-xs text-slate-200 outline-none focus:border-accent/40 disabled:opacity-50"
    />
  );
}

function PropertiesBuilder({
  content,
  onChange,
  disabled
}: {
  content: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  const lines = content.split(/\r?\n/);
  const [filter, setFilter] = useState("");

  // Parse content into key/value entries, preserving order, comments and blank lines.
  const updateLineForKey = (key: string, nextValue: string) => {
    const updated = lines.map((line) => {
      if (line.startsWith("#") || !line.includes("=")) return line;
      const eq = line.indexOf("=");
      const k = line.slice(0, eq).trim();
      if (k === key) {
        return `${k}=${nextValue}`;
      }
      return line;
    });
    onChange(updated.join("\n"));
  };

  const rows = lines
    .map((line, index) => {
      if (line.startsWith("#") || !line.includes("=")) return null;
      const eq = line.indexOf("=");
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1);
      return { key, value, index };
    })
    .filter((row): row is { key: string; value: string; index: number } => row !== null)
    .filter((row) => (filter ? row.key.toLowerCase().includes(filter.toLowerCase()) : true));

  return (
    <div className="mt-4 space-y-3">
      <input
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filter properties…"
        className="w-full rounded-xl border border-white/10 bg-obsidian px-3 py-2 text-xs text-slate-200 outline-none focus:border-accent/40"
      />
      <div className="max-h-[480px] overflow-y-auto rounded-2xl border border-white/10 bg-obsidian/60">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">No matching properties.</p>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {rows.map((row) => (
              <li key={`${row.key}-${row.index}`} className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                <label className="font-mono text-xs text-slate-400" htmlFor={`prop-${row.key}`}>
                  {row.key}
                </label>
                <PropertyValueField
                  id={`prop-${row.key}`}
                  value={row.value}
                  disabled={disabled}
                  onChange={(next) => updateLineForKey(row.key, next)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PropertyValueField({
  id,
  value,
  disabled,
  onChange
}: {
  id: string;
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const lower = value.trim().toLowerCase();
  if (lower === "true" || lower === "false") {
    return (
      <select
        id={id}
        value={lower}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-lg border border-white/10 bg-obsidian px-2 text-xs text-slate-200 outline-none focus:border-accent/40 disabled:opacity-50"
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (/^-?\d+(\.\d+)?$/.test(value.trim())) {
    return (
      <input
        id={id}
        type="number"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-lg border border-white/10 bg-obsidian px-2 text-xs text-slate-200 outline-none focus:border-accent/40 disabled:opacity-50"
      />
    );
  }
  return (
    <input
      id={id}
      type="text"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 rounded-lg border border-white/10 bg-obsidian px-2 text-xs text-slate-200 outline-none focus:border-accent/40 disabled:opacity-50"
    />
  );
}

type JsonListKind = "whitelist.json" | "ops.json" | "banned-players.json" | "banned-ips.json";

function JsonListBuilder({
  content,
  onChange,
  disabled,
  kind
}: {
  content: string;
  onChange: (next: string) => void;
  disabled: boolean;
  kind: JsonListKind;
}) {
  const [draft, setDraft] = useState("");
  let parsed: Array<Record<string, unknown>> = [];
  try {
    const value = JSON.parse(content || "[]");
    if (Array.isArray(value)) {
      parsed = value as Array<Record<string, unknown>>;
    }
  } catch {
    return (
      <div className="mt-4 rounded-2xl border border-red-400/25 bg-red-400/[0.08] p-4 text-xs text-red-200">
        Could not parse JSON. Switch to Text mode to fix it manually.
      </div>
    );
  }

  const fieldName = kind === "banned-ips.json" ? "ip" : "name";
  const placeholder =
    kind === "banned-ips.json" ? "203.0.113.5" : "PlayerName or UUID";

  const addEntry = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const exists = parsed.some((entry) =>
      typeof entry[fieldName] === "string" && (entry[fieldName] as string).toLowerCase() === trimmed.toLowerCase()
    );
    if (exists) return;
    const next = [
      ...parsed,
      kind === "banned-ips.json"
        ? { ip: trimmed, created: new Date().toISOString(), source: "phantom", expires: "forever", reason: "Banned via Phantom" }
        : kind === "banned-players.json"
        ? { uuid: "", name: trimmed, created: new Date().toISOString(), source: "phantom", expires: "forever", reason: "Banned via Phantom" }
        : kind === "ops.json"
        ? { uuid: "", name: trimmed, level: 4, bypassesPlayerLimit: false }
        : { uuid: "", name: trimmed }
    ];
    onChange(JSON.stringify(next, null, 2));
    setDraft("");
  };

  const removeEntry = (index: number) => {
    const next = parsed.filter((_, idx) => idx !== index);
    onChange(JSON.stringify(next, null, 2));
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addEntry();
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="h-9 flex-1 rounded-lg border border-white/10 bg-obsidian px-3 text-xs text-slate-200 outline-none focus:border-accent/40 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={addEntry}
          disabled={disabled || draft.trim().length === 0}
          className="h-9 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] px-3 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/[0.14] disabled:opacity-40"
        >
          Add
        </button>
      </div>

      <div className="max-h-[440px] overflow-y-auto rounded-2xl border border-white/10 bg-obsidian/60">
        {parsed.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">No entries yet.</p>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {parsed.map((row, index) => (
              <li key={`${index}-${String(row[fieldName] ?? "?")}`} className="flex items-center justify-between gap-3 px-4 py-3 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-mono text-slate-100">{String(row[fieldName] ?? "?")}</p>
                  {row.reason ? (
                    <p className="truncate text-slate-500">{String(row.reason)}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => removeEntry(index)}
                  disabled={disabled}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-500/[0.1] hover:text-red-300 disabled:opacity-40"
                  aria-label="Remove entry"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function basename(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
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

function formatFrenchBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 o";
  if (bytes < 1024) return `${bytes.toFixed(2)} o`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(2)} Ko`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} Mo`;
  return `${(bytes / 1024 ** 3).toFixed(2)} Go`;
}

function formatShortDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

const toolbarClass =
  "inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50";
