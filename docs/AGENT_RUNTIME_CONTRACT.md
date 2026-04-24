# Agent Docker Runtime Contract V1

This document defines the V1 contract between a future Phantom Docker agent and the Phantom API runtime layer. It describes the HTTP interface, payloads, runtime rules, and safety constraints only. It does not describe the internal implementation of the agent.

## Scope

- Control plane source: Phantom API
- Runtime consumer: future Docker agent running on a Phantom node
- Authentication model: node Bearer token
- Stable desired state in V1: `running` or `stopped`
- Transient actions in V1: `restart` and `kill`

Important rule:

- `desiredStatus` in V1 is stable and only uses `running` or `stopped`
- `restart` and `kill` are not stable desired states
- `restart` and `kill` are transient lifecycle actions triggered by admin routes and then acknowledged through `ack-action`

## Environment Variables

- `PHANTOM_API_URL`
  Base URL of the Phantom API, for example `http://localhost:4200`
- `PHANTOM_NODE_TOKEN`
  Bearer token of the authenticated node
- `PHANTOM_POLL_INTERVAL_MS`
  Poll interval for `GET /runtime/workloads/assigned`
  Recommended range: `5000` to `15000`
- `PHANTOM_HEARTBEAT_INTERVAL_MS`
  Heartbeat interval for active workloads
  Recommended range: `5000` to `15000`
- `PHANTOM_AGENT_ID`
  Optional free-form identifier for logs and diagnostics
- `PHANTOM_AGENT_LOG_LEVEL`
  Optional log level such as `info`, `debug`, or `warn`

## Polling Flow

1. The agent starts with `PHANTOM_API_URL` and `PHANTOM_NODE_TOKEN`.
2. The agent periodically calls `GET /runtime/workloads/assigned`.
3. The agent only acts on workloads returned by this route.
4. For each assigned workload:
   - if `desiredStatus = running` and no runtime exists yet, create and start it
   - if `desiredStatus = running` and runtime already exists, reconcile and keep it running
   - if `desiredStatus = stopped` and runtime is running, stop it cleanly
5. After meaningful runtime transitions, the agent may call `POST /runtime/workloads/:id/events`.
6. At regular intervals, the agent calls `POST /runtime/workloads/:id/heartbeat`.
7. When a transient lifecycle action such as restart or kill has been handled, the agent calls `POST /runtime/workloads/:id/ack-action` so the control plane does not replay it indefinitely.

## Assigned Workloads

### Endpoint

- `GET /runtime/workloads/assigned`

### Authentication

- `Authorization: Bearer <PHANTOM_NODE_TOKEN>`

### Response Shape

```json
{
  "nodeId": "node-par-01",
  "workloads": [
    {
      "id": "uuid",
      "name": "mc-lobby",
      "type": "minecraft",
      "image": "itzg/minecraft-server:latest",
      "nodeId": "node-par-01",
      "status": "running",
      "desiredStatus": "running",
      "requestedCpu": 2,
      "requestedRamMb": 4096,
      "requestedDiskGb": 20,
      "config": {
        "eula": true,
        "version": "1.21.1"
      },
      "containerId": "abc123",
      "lastHeartbeatAt": "2026-04-24T10:00:00.000Z",
      "lastExitCode": null,
      "restartCount": 0,
      "ports": [
        {
          "internalPort": 25565,
          "externalPort": 30123,
          "protocol": "tcp"
        }
      ]
    }
  ]
}
```

### Fields the agent must consume

- `id`
- `name`
- `type`
- `image`
- `desiredStatus`
- `status`
- `requestedCpu`
- `requestedRamMb`
- `requestedDiskGb`
- `config`
- `ports[].internalPort`
- `ports[].externalPort`
- `ports[].protocol`

### Semantics

- The route only returns workloads assigned to the authenticated node.
- Deleted or deleting workloads are excluded from normal runtime consumption.
- The agent must treat this route as the authoritative list of manageable workloads for the current node.

## Heartbeat

### Endpoint

- `POST /runtime/workloads/:id/heartbeat`

### Request Shape

```json
{
  "status": "running",
  "containerId": "abc123",
  "exitCode": null,
  "restartCount": 1,
  "cpuPercent": 12.5,
  "memoryMb": 512,
  "startedAt": "2026-04-24T10:10:00.000Z",
  "finishedAt": null,
  "reason": "container healthy"
}
```

### Allowed fields

- `status`
  Required. One of:
  - `creating`
  - `running`
  - `stopped`
  - `crashed`
- `containerId`
  Optional string
- `exitCode`
  Optional `number | null`
- `restartCount`
  Optional integer
- `cpuPercent`
  Optional number
- `memoryMb`
  Optional number
- `startedAt`
  Optional ISO 8601 datetime string
- `finishedAt`
  Optional ISO 8601 datetime string or `null`
- `reason`
  Optional short operational string

### Expected control plane behavior

- verify that the workload belongs to the authenticated node
- update real runtime `status`
- update `containerId` when provided
- update `lastHeartbeatAt`
- update `lastExitCode` when provided
- update `restartCount` when provided
- create a `WorkloadStatusEvent` only if the status changed
- do not spam duplicate status events for identical heartbeats

## Runtime Events

### Endpoint

- `POST /runtime/workloads/:id/events`

### Request Shape

```json
{
  "type": "started",
  "status": "running",
  "reason": "docker start completed"
}
```

### Allowed event types

- `pulled`
- `created`
- `started`
- `stopped`
- `killed`
- `crashed`

### Optional status override

- `creating`
- `running`
- `stopped`
- `crashed`

### Default V1 mapping when `status` is omitted

- `pulled` -> `creating`
- `created` -> `creating`
- `started` -> `running`
- `stopped` -> `stopped`
- `killed` -> `stopped`
- `crashed` -> `crashed`

### Usage rules

- Use this route for meaningful runtime milestones only.
- Keep `reason` operational and concise.
- Do not emit noisy low-value events for every internal Docker step.

## Ack Action

### Endpoint

- `POST /runtime/workloads/:id/ack-action`

### Request Shape

```json
{
  "handledDesiredStatus": "restart",
  "status": "running",
  "containerId": "abc123",
  "reason": "restart completed"
}
```

### Allowed values

- `handledDesiredStatus`
  Required. One of:
  - `restart`
  - `kill`

### Semantics

- `restart` means the agent handled a transient restart action
- `kill` means the agent handled a transient forced-stop action
- this endpoint is used to clear transient lifecycle intent after it has been executed

### Expected control plane behavior

- if `handledDesiredStatus = restart`, normalize stable `desiredStatus -> running`
- if `handledDesiredStatus = kill`, normalize stable `desiredStatus -> stopped`
- update `status` when provided
- update `containerId` when provided
- create a clean event
- avoid replaying the same transient action forever on the next poll

## Desired Status vs Runtime Status

### Stable `desiredStatus` values in V1

- `running`
- `stopped`

### Runtime `status` values

- `pending`
- `creating`
- `running`
- `stopped`
- `crashed`
- `deleting`
- `deleted`

### Rules

- `desiredStatus` expresses control-plane intent
- `status` expresses real runtime state observed by the agent
- the agent acts based on `desiredStatus`, then reports observed `status`
- `desiredStatus` must not be treated as proof that the workload is actually running
- `restart` and `kill` are transient lifecycle actions, not stable V1 desired states
- transient lifecycle actions are triggered by admin lifecycle routes, then acknowledged through `ack-action`
- a workload may temporarily report `creating` before becoming `running`
- a clean stop should report `stopped`
- a runtime failure should report `crashed`

## Docker Label Mapping

Each managed container should carry enough Phantom metadata for reconciliation and ownership checks.

### Recommended labels

- `phantom.managed=true`
- `phantom.workload.id=<workload_id>`
- `phantom.workload.name=<workload_name>`
- `phantom.workload.type=<workload_type>`
- `phantom.node.id=<node_id>`

### Example

```json
{
  "phantom.managed": "true",
  "phantom.workload.id": "uuid",
  "phantom.workload.name": "mc-lobby",
  "phantom.workload.type": "minecraft",
  "phantom.node.id": "node-par-01"
}
```

### Why these labels matter

- reliably find Phantom-managed containers
- prevent accidental operations on unmanaged containers
- enable reconciliation after agent restart
- tie runtime artifacts to the assigned Phantom node

## Security Rules

- Always authenticate with `Authorization: Bearer <PHANTOM_NODE_TOKEN>`.
- Never log the node token in clear text.
- The agent must only act on workloads returned by `GET /runtime/workloads/assigned`.
- The agent must never manage a workload absent from the current assigned list.
- The agent must never stop, delete, or mutate a container that is not clearly marked as Phantom-managed.
- The agent must require `phantom.managed=true`.
- The agent must require `phantom.node.id=<current node id>` before destructive runtime actions.
- The agent must validate image names, port values, and protocol values before execution.
- The agent must avoid sending secrets in heartbeat `reason` fields or runtime events.
- The agent must avoid reflecting sensitive environment values back to the API.
- If ownership or identity is ambiguous, the agent should do nothing and log locally instead.

## Operational Summary

- Source of scheduling truth: `GET /runtime/workloads/assigned`
- Source of real runtime truth: workload heartbeats from the agent
- Runtime milestone journal: `POST /runtime/workloads/:id/events`
- Transient lifecycle acknowledgment: `POST /runtime/workloads/:id/ack-action`

This contract is intentionally minimal for V1 so the Docker agent can remain simple while staying aligned with the existing Phantom control plane.
