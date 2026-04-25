# Delete Runtime Validation

This checklist validates the workload and Minecraft delete lifecycle end to end.

## Preconditions

- Phantom API, web panel and agent are running from the same branch.
- The target node is registered, healthy and connected.
- Docker is available on the node host.
- Prisma migration `0010_workload_delete_lifecycle` is applied.

## Minecraft Playground Validation

1. Open `/admin/playground`.
2. Create a Minecraft server with default `hard delete data` unchecked.
3. Wait until the server status becomes `running`.
4. On the node host, verify the runtime exists:

   ```bash
   docker ps --format '{{.ID}} {{.Names}} {{.Status}}' | grep phantom-
   ```

5. In the playground, click `Delete`.
6. Confirm the workload transitions to `deleting` before disappearing from the list.
7. On the node host, verify the runtime is removed:

   ```bash
   docker ps -a --format '{{.ID}} {{.Names}} {{.Status}}' | grep phantom-
   ```

8. Verify the data directory still exists for the workload under `${PHANTOM_DATA_DIR:-/srv/phantom}/workloads/<workload-id>`.
9. Recreate a server with the same visible name and verify:
   - the new workload is created successfully
   - no Docker name conflict occurs
   - no port conflict occurs

## Hard Delete Data Validation

1. In `/admin/playground`, enable `hard delete data`.
2. Create and start a Minecraft server.
3. Delete it.
4. Verify:
   - the workload transitions to `deleting`
   - the container disappears from Docker
   - `${PHANTOM_DATA_DIR:-/srv/phantom}/workloads/<workload-id>` is removed

## Generic Workload Validation

1. Create a standard workload from `/workloads`.
2. Wait until the workload is `running` or `crashed`.
3. Delete it from the workload detail page or table.
4. Verify:
   - the panel shows `deleting` instead of removing the row immediately
   - the runtime disappears from Docker
   - the workload disappears from the active workload list only after delete completion

## Node Offline Fallback Validation

1. Create a workload on a healthy node.
2. Stop the agent or disconnect the node until the node becomes `offline`.
3. Delete the workload with `hardDeleteData=false`.
4. Wait longer than `WORKLOAD_DELETE_TIMEOUT_MS`.
5. Verify:
   - the workload leaves the active panel list
   - workload ports are available for a new workload allocation
   - when the node reconnects, orphan cleanup removes the leftover container

## Expected Audit / Logs

- Agent logs should include:
  - `[delete] requested`
  - `[delete] runtime removed`
  - `[delete] completed`
- API timeout fallback should log:
  - `[workload-delete-monitor] timeout fallback finalized ...`

## Notes

- For `hardDeleteData=true`, timeout fallback intentionally does not finalize deletion while the node is offline. This avoids claiming data was removed when the agent never acknowledged the cleanup.
