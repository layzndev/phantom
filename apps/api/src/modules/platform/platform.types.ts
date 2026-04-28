export interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  planTier: string;
  suspended: boolean;
  quota: PlatformTenantQuota;
  usage?: PlatformTenantUsage;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformTenantQuota {
  maxServers: number;
  maxRamMb: number;
  maxCpu: number;
  maxDiskGb: number;
}

export interface PlatformTenantUsage {
  workloadCount: number;
  ramMb: number;
  cpu: number;
  diskGb: number;
}

export interface PlatformTokenSummary {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface PlatformTokenIssued extends PlatformTokenSummary {
  /** Plain-text token, only returned at creation. */
  token: string;
}
