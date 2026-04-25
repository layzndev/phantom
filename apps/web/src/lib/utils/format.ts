export function formatRam(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

export function formatDisk(gb: number) {
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`;
  return `${gb} GB`;
}

export function formatCpu(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

export function percent(used: number, total: number) {
  if (!total) return 0;
  return Math.round((used / total) * 100);
}

export function formatDateTime(value: string | null) {
  if (!value) return "No heartbeat";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function formatUptime(value: number | null) {
  if (value === null || value < 0) return "Unknown";
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatWorkloadType(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
