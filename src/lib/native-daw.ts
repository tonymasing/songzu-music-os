const nativePort = () => process.env.SONGZU_DAW_CORE_PORT ?? "39241";

export async function nativeDawRequest<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? 2_500);
  try {
    const response = await fetch(`http://127.0.0.1:${nativePort()}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers
      },
      signal: controller.signal,
      cache: "no-store"
    });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(data.error || `Native DAW service ${response.status}`);
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("原生 DAW 服務逾時，請確認桌面 App 的音訊引擎已啟動。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
