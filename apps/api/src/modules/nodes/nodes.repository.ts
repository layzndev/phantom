import { hostingApiClient } from "../integrations/hosting-api/hosting-api.client.js";
import type { CompanyNode } from "./nodes.types.js";

export function listNodeRecords() {
  return hostingApiClient.listNodes();
}

export function getNodeRecord(id: string) {
  return hostingApiClient.getNode(id);
}

export function postNodeActionRecord<T = CompanyNode>(id: string, action: string, body?: Record<string, unknown>) {
  return hostingApiClient.postNodeAction<T>(id, action, body);
}
