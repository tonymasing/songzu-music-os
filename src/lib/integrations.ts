import { prisma } from "@/lib/prisma";
import { appPath } from "@/lib/paths";

export const garageBandOperatorRoot =
  process.env.SONGZU_GARAGEBAND_OPERATOR_ROOT?.trim() || appPath("integrations", "garageband-ai-operator");

export type GarageBandCommand = {
  name: string;
  implemented: boolean;
  requires_path?: boolean;
  requires_confirmation?: boolean;
  profile_required?: boolean;
  category?: string;
};

export async function getIntegrations() {
  return prisma.integration.findMany({
    orderBy: { createdAt: "asc" }
  });
}

export async function upsertIntegration(input: {
  provider: string;
  displayName: string;
  status: string;
  connectionKind: string;
  endpoint?: string | null;
  apiKeyEnv?: string | null;
  threadUrl?: string | null;
  threadId?: string | null;
  projectPath?: string | null;
  commandPath?: string | null;
  notes?: string | null;
}) {
  return prisma.integration.upsert({
    where: { provider: input.provider },
    create: input,
    update: input
  });
}

async function pathExists(path: string) {
  const { access } = await import("node:fs/promises");
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readGarageBandCommands(root = garageBandOperatorRoot): Promise<GarageBandCommand[]> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const commandFile = join(root, "commands.json");
  if (!(await pathExists(commandFile))) {
    return [];
  }

  const parsed = JSON.parse(await readFile(commandFile, "utf8")) as {
    commands?: GarageBandCommand[];
  };

  return parsed.commands ?? [];
}

export async function buildGarageBandHandoff(songId?: string) {
  const [integrations, song] = await Promise.all([
    getIntegrations(),
    songId
      ? prisma.song.findUnique({
          where: { id: songId },
          include: {
            lyricsVersions: { orderBy: { createdAt: "desc" } },
            audioFiles: { orderBy: { createdAt: "desc" } },
            tasks: { orderBy: { createdAt: "asc" } }
          }
        })
      : null
  ]);
  const garageBand = integrations.find((integration) => integration.provider === "GARAGEBAND_OPERATOR");
  const codex = integrations.find((integration) => integration.provider === "CODEX");
  const commandRoot = garageBand?.projectPath || garageBandOperatorRoot;
  const commands = await readGarageBandCommands(commandRoot);
  const implementedCommands = commands.filter((command) => command.implemented);
  const safeCommands = implementedCommands.filter((command) => !command.requires_confirmation);

  const prompt = [
    "你是 GarageBand AI Operator 的接手代理。",
    "你只能透過 commands.json 白名單中的 gbctl 命令操作 GarageBand。",
    "不得解析、修改或依賴 .band 專案內部格式；只能像人類一樣透過 macOS 自動化操作。",
    "錄音、儲存、匯出、音量、聲像與 profile 設定等會改變狀態的命令，必須先向使用者確認。",
    song ? `目前歌曲：${song.title}` : "目前未指定歌曲。",
    song?.bpm ? `BPM：${song.bpm}` : null,
    song?.musicalKey ? `調性：${song.musicalKey}` : null,
    song?.genre ? `曲風：${song.genre}` : null,
    song?.summary ? `摘要：${song.summary}` : null,
    `Operator 專案路徑：${commandRoot}`,
    `gbctl 路徑：${garageBand?.commandPath ?? `${commandRoot}/gbctl`}`,
    `可先執行：./gbctl doctor、./gbctl activate、./gbctl calibration-status、./gbctl help`
  ]
    .filter(Boolean)
    .join("\n");

  return {
    codexThreadUrl: codex?.threadUrl,
    codexThreadId: codex?.threadId,
    operatorRoot: commandRoot,
    commandPath: garageBand?.commandPath ?? `${commandRoot}/gbctl`,
    operatorExists: await pathExists(commandRoot),
    commandCount: commands.length,
    implementedCommands,
    safeCommands,
    song: song
      ? {
          id: song.id,
          title: song.title,
          status: song.status,
          bpm: song.bpm,
          musicalKey: song.musicalKey,
          genre: song.genre,
          summary: song.summary,
          primaryLyrics: song.lyricsVersions.find((version) => version.isPrimary)?.content ?? null,
          files: song.audioFiles.map((file) => ({
            fileName: file.fileName,
            fileType: file.fileType,
            filePath: file.filePath,
            isPrimary: file.isPrimary
          })),
          openTasks: song.tasks.filter((task) => task.status !== "DONE").map((task) => task.title)
        }
      : null,
    handoffPrompt: prompt
  };
}

export async function buildGarageBandWorkflow(songId?: string) {
  const handoff = await buildGarageBandHandoff(songId);
  const commandsByName = new Map(handoff.implementedCommands.map((command) => [command.name, command]));
  const stepSeeds = [
    {
      title: "確認 GarageBand 狀態",
      command: "doctor",
      intent: "先確認環境、權限與自動化可用性。",
      requiresConfirmation: false
    },
    {
      title: "啟用 GarageBand 視窗",
      command: "activate",
      intent: "把 GarageBand 帶到前景，準備操作。",
      requiresConfirmation: false
    },
    {
      title: "播放目前段落",
      command: "play",
      intent: "聽一次目前作品狀態，建立混音或編曲判斷。",
      requiresConfirmation: false
    },
    {
      title: "停止播放",
      command: "stop",
      intent: "停止播放，方便記錄下一步。",
      requiresConfirmation: false
    },
    {
      title: "建立錄音前確認",
      command: "record",
      intent: "錄音會改變專案狀態，必須先由你明確確認。",
      requiresConfirmation: true
    },
    {
      title: "儲存專案前確認",
      command: "save",
      intent: "儲存會改變專案檔，必須先由你明確確認。",
      requiresConfirmation: true
    },
    {
      title: "匯出檔案前確認",
      command: "export",
      intent: "匯出會產生檔案，必須先確認格式與目的。",
      requiresConfirmation: true
    }
  ];

  return {
    ...handoff,
    steps: stepSeeds.map((step, index) => {
      const command = commandsByName.get(step.command);
      return {
        ...step,
        order: index + 1,
        implemented: Boolean(command),
        category: command?.category ?? "workflow",
        shellCommand: `./gbctl ${step.command}`,
        payload: {
          command: step.command,
          confirmed: step.requiresConfirmation ? false : undefined,
          source: "頌祖音樂 OS"
        }
      };
    })
  };
}
