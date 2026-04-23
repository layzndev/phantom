export function formatRam(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

export function percent(used: number, total: number) {
  if (!total) return 0;
  return Math.round((used / total) * 100);
}

export function formatDateTime(value: string | null) {
  if (!value) return "No heartbeat";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
