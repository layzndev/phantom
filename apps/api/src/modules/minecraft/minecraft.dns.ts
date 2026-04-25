import { env } from "../../config/env.js";

export type DnsSyncStatus = "pending" | "active" | "failed" | "disabled";

export interface DnsProvider {
  createRecord(hostname: string, target: string): Promise<void>;
  updateRecord(oldHostname: string, newHostname: string, target: string): Promise<void>;
  deleteRecord(hostname: string): Promise<void>;
}

class NoopDnsProvider implements DnsProvider {
  async createRecord(hostname: string, target: string) {
    console.info("[dns] noop create", { hostname, target });
  }

  async updateRecord(oldHostname: string, newHostname: string, target: string) {
    console.info("[dns] noop update", { oldHostname, newHostname, target });
  }

  async deleteRecord(hostname: string) {
    console.info("[dns] noop delete", { hostname });
  }
}

class CloudflareDnsProvider implements DnsProvider {
  private readonly apiBase = `https://api.cloudflare.com/client/v4/zones/${env.cloudflareZoneId}/dns_records`;

  private async request(path: string, init?: RequestInit) {
    const response = await fetch(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.cloudflareApiToken}`,
        "Content-Type": "application/json",
        ...init?.headers
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cloudflare DNS request failed (${response.status}): ${text}`);
    }

    return response.json() as Promise<{
      success: boolean;
      result: Array<{ id: string }> | { id: string };
    }>;
  }

  private async findRecordId(hostname: string) {
    const payload = await this.request(`?type=${env.dnsRecordType}&name=${encodeURIComponent(hostname)}`);
    return Array.isArray(payload.result) && payload.result[0] ? payload.result[0].id : null;
  }

  async createRecord(hostname: string, target: string) {
    const recordId = await this.findRecordId(hostname);
    if (recordId) {
      await this.request(`/${recordId}`, {
        method: "PATCH",
        body: JSON.stringify({
          type: env.dnsRecordType,
          name: hostname,
          content: target,
          proxied: false,
          ttl: 120
        })
      });
      return;
    }

    await this.request("", {
      method: "POST",
      body: JSON.stringify({
        type: env.dnsRecordType,
        name: hostname,
        content: target,
        proxied: false,
        ttl: 120
      })
    });
  }

  async updateRecord(oldHostname: string, newHostname: string, target: string) {
    const recordId = await this.findRecordId(oldHostname);
    if (!recordId) {
      await this.createRecord(newHostname, target);
      return;
    }

    await this.request(`/${recordId}`, {
      method: "PATCH",
      body: JSON.stringify({
        type: env.dnsRecordType,
        name: newHostname,
        content: target,
        proxied: false,
        ttl: 120
      })
    });
  }

  async deleteRecord(hostname: string) {
    const recordId = await this.findRecordId(hostname);
    if (!recordId) {
      return;
    }
    await this.request(`/${recordId}`, { method: "DELETE" });
  }
}

export function resolveDnsProvider(): DnsProvider {
  if (
    env.dnsProvider === "cloudflare" &&
    env.cloudflareApiToken &&
    env.cloudflareZoneId
  ) {
    return new CloudflareDnsProvider();
  }
  return new NoopDnsProvider();
}

export function isDnsProviderActive() {
  return (
    env.dnsProvider === "cloudflare" &&
    Boolean(env.cloudflareApiToken) &&
    Boolean(env.cloudflareZoneId)
  );
}
