import { acquireLocalOperationLock } from "@/lib/local-operation-lock";

export class DawEngineerBusyError extends Error {
  constructor() {
    super("這個專案已有錄音師請求在處理，請等候或取消原請求，沒有新增模型呼叫。");
  }
}

// One in-flight inference per project across tabs and local server processes.
export async function withDawEngineerRequest<T>(projectId: string, signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const release = acquireLocalOperationLock(`daw-engineer:${projectId}`);
  if (!release) throw new DawEngineerBusyError();
  try {
    signal.throwIfAborted();
    return await run();
  } finally {
    release();
  }
}
