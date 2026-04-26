"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api/admin-api";
import type {
  MinecraftGlobalSettings,
  MinecraftDifficulty,
  MinecraftGameMode,
  MinecraftServerWithWorkload
} from "@/types/admin";

type SettingsState = {
  autoSleepUseGlobalDefaults: boolean;
  autoSleepEnabled: boolean;
  autoSleepIdleMinutes: number;
  autoSleepAction: "stop";
  maxPlayers: number;
  onlineMode: boolean;
  difficulty: MinecraftDifficulty;
  gameMode: MinecraftGameMode;
  motd: string;
  whitelistEnabled: boolean;
};

export function MinecraftSettingsForm({
  entry,
  globalSettings,
  onSaved
}: {
  entry: MinecraftServerWithWorkload;
  globalSettings: MinecraftGlobalSettings | null;
  onSaved: (next: MinecraftServerWithWorkload) => void;
}) {
  const [form, setForm] = useState<SettingsState>(() => toFormState(entry));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    setForm(toFormState(entry));
    setError(null);
    setSaved(null);
  }, [entry]);

  const requiresRestart =
    form.motd.trim() !== (entry.server.motd ?? "") ||
    form.maxPlayers !== entry.server.maxPlayers ||
    form.onlineMode !== entry.server.onlineMode ||
    form.difficulty !== entry.server.difficulty ||
    form.gameMode !== entry.server.gameMode ||
    form.whitelistEnabled !== entry.server.whitelistEnabled;

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const next = await adminApi.updateMinecraftServerSettings(entry.server.id, {
        autoSleepUseGlobalDefaults: form.autoSleepUseGlobalDefaults,
        autoSleepEnabled: form.autoSleepEnabled,
        autoSleepIdleMinutes: form.autoSleepIdleMinutes,
        autoSleepAction: form.autoSleepAction,
        maxPlayers: form.maxPlayers,
        onlineMode: form.onlineMode,
        difficulty: form.difficulty,
        gameMode: form.gameMode,
        motd: form.motd.trim(),
        whitelistEnabled: form.whitelistEnabled
      });
      onSaved(next);
      setSaved("Settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save settings.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="rounded-2xl border border-line bg-panel/78 p-5 shadow-soft">
        <h3 className="text-sm font-semibold text-white">AutoSleep</h3>
        <div className="mt-4 grid gap-4">
          <ToggleRow
            label="Use global defaults"
            description="Applies the Free Tier defaults from /services/minecraft to this server."
            checked={form.autoSleepUseGlobalDefaults}
            onChange={(checked) =>
              setForm((current) => ({ ...current, autoSleepUseGlobalDefaults: checked }))
            }
          />
          {form.autoSleepUseGlobalDefaults && globalSettings ? (
            <div className="rounded-2xl bg-white/[0.04] px-4 py-3 text-xs text-slate-400">
              Global defaults: {globalSettings.freeAutoSleepEnabled ? "Enabled" : "Disabled"} ·{" "}
              {globalSettings.freeAutoSleepIdleMinutes} min ·{" "}
              {globalSettings.freeAutoSleepAction === "sleep" ? "stop" : globalSettings.freeAutoSleepAction}
            </div>
          ) : null}
          <ToggleRow
            label="AutoSleep enabled"
            description="Disable this to keep the server running until an admin stops it."
            checked={form.autoSleepEnabled}
            onChange={(checked) => setForm((current) => ({ ...current, autoSleepEnabled: checked }))}
            disabled={form.autoSleepUseGlobalDefaults}
          />
          <Field label="Idle delay (minutes)" hint="Used only when AutoSleep is enabled.">
            <input
              type="number"
              min={1}
              max={240}
              value={form.autoSleepIdleMinutes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  autoSleepIdleMinutes: Number(event.target.value || 1)
                }))
              }
              disabled={form.autoSleepUseGlobalDefaults}
              className={inputClass}
            />
          </Field>
          <Field label="Action" hint="AutoSleep now performs a real Minecraft stop. Starting again is manual.">
            <select
              value={form.autoSleepAction}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  autoSleepAction: event.target.value as "stop"
                }))
              }
              disabled={form.autoSleepUseGlobalDefaults}
              className={inputClass}
            >
              <option value="stop">Stop</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-panel/78 p-5 shadow-soft">
        <h3 className="text-sm font-semibold text-white">Server Properties</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="MOTD" hint="Requires restart">
            <input
              type="text"
              value={form.motd}
              onChange={(event) => setForm((current) => ({ ...current, motd: event.target.value }))}
              className={inputClass}
            />
          </Field>
          <Field label="Max players" hint="Requires restart">
            <input
              type="number"
              min={1}
              max={500}
              value={form.maxPlayers}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  maxPlayers: Number(event.target.value || 1)
                }))
              }
              className={inputClass}
            />
          </Field>
          <Field label="Online mode" hint="Requires restart">
            <select
              value={String(form.onlineMode)}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  onlineMode: event.target.value === "true"
                }))
              }
              className={inputClass}
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </Field>
          <Field label="Whitelist" hint="Requires restart">
            <select
              value={String(form.whitelistEnabled)}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  whitelistEnabled: event.target.value === "true"
                }))
              }
              className={inputClass}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </select>
          </Field>
          <Field label="Difficulty" hint="Requires restart">
            <select
              value={form.difficulty}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  difficulty: event.target.value as MinecraftDifficulty
                }))
              }
              className={inputClass}
            >
              <option value="peaceful">Peaceful</option>
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
            </select>
          </Field>
          <Field label="Game mode" hint="Requires restart">
            <select
              value={form.gameMode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  gameMode: event.target.value as MinecraftGameMode
                }))
              }
              className={inputClass}
            >
              <option value="survival">Survival</option>
              <option value="creative">Creative</option>
              <option value="adventure">Adventure</option>
              <option value="spectator">Spectator</option>
            </select>
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Saving..." : "Save settings"}
          </button>
          {requiresRestart ? (
            <span className="rounded-full border border-amber-500/25 bg-amber-500/[0.08] px-3 py-1 text-xs text-amber-200">
              Requires restart
            </span>
          ) : null}
          {saved ? <span className="text-sm text-emerald-300">{saved}</span> : null}
          {error ? <span className="text-sm text-red-300">{error}</span> : null}
        </div>
      </section>
    </div>
  );
}

function toFormState(entry: MinecraftServerWithWorkload): SettingsState {
  return {
    autoSleepUseGlobalDefaults: entry.server.autoSleepUseGlobalDefaults,
    autoSleepEnabled: entry.server.autoSleepEnabled,
    autoSleepIdleMinutes: entry.server.autoSleepIdleMinutes,
    autoSleepAction: "stop",
    maxPlayers: entry.server.maxPlayers,
    onlineMode: entry.server.onlineMode,
    difficulty: entry.server.difficulty,
    gameMode: entry.server.gameMode,
    motd: entry.server.motd ?? "",
    whitelistEnabled: entry.server.whitelistEnabled
  };
}

function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm text-white">{label}</span>
      {children}
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-2xl bg-white/[0.04] px-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm text-white">{label}</span>
        <span className="mt-1 block text-xs text-slate-500">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent disabled:opacity-40"
      />
    </label>
  );
}

const inputClass =
  "h-11 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm text-white outline-none focus:border-accent/40";
