import { SystemWorkspace } from "@/components/SystemWorkspace";
import { getSongs } from "@/lib/data";
import { buildGarageBandHandoff, buildGarageBandWorkflow, getIntegrations } from "@/lib/integrations";
import { parseJsonValue, toIso } from "@/lib/music";
import { prisma } from "@/lib/prisma";
import { IntegrationsWorkspace } from "@/components/IntegrationsWorkspace";

export default async function IntegrationsPage() {
  const [integrations, songs, handoff, workflow, operationLogs] = await Promise.all([
    getIntegrations(),
    getSongs(),
    buildGarageBandHandoff(),
    buildGarageBandWorkflow(),
    prisma.garageBandOperationLog.findMany({
      include: { song: { select: { id: true, title: true } } },
      orderBy: { createdAt: "desc" },
      take: 30
    })
  ]);

  return (
    <SystemWorkspace area="devices" current="/integrations">
    <IntegrationsWorkspace
      initialIntegrations={integrations.map((integration) => ({
        id: integration.id,
        provider: integration.provider,
        displayName: integration.displayName,
        status: integration.status,
        connectionKind: integration.connectionKind,
        endpoint: integration.endpoint,
        apiKeyEnv: integration.apiKeyEnv,
        threadUrl: integration.threadUrl,
        threadId: integration.threadId,
        projectPath: integration.projectPath,
        commandPath: integration.commandPath,
        notes: integration.notes
      }))}
      songs={songs}
      initialHandoff={handoff}
      initialWorkflow={workflow}
      initialOperationLogs={operationLogs.map((log) => ({
        id: log.id,
        songId: log.songId,
        songTitle: log.song?.title ?? null,
        operation: log.operation,
        command: log.command,
        payload: parseJsonValue<Record<string, unknown> | null>(log.payloadJson, null),
        payloadJson: log.payloadJson,
        requiresConfirmation: log.requiresConfirmation,
        approvalStatus: log.approvalStatus,
        resultStatus: log.resultStatus,
        notes: log.notes,
        createdAt: toIso(log.createdAt),
        updatedAt: toIso(log.updatedAt)
      }))}
    />
    </SystemWorkspace>
  );
}
