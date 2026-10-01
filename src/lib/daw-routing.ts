import { prisma } from "@/lib/prisma";

type RouteKind = "output" | "send" | "cue" | "sidechain";

export async function validateDawRoute(input: {
  projectId: string;
  sourceTrackId: string | null;
  destinationTrackId: string | null;
  routeType: RouteKind;
  ignoreRouteId?: string;
}) {
  const [tracks, routes] = await Promise.all([
    prisma.dawTrack.findMany({ where: { projectId: input.projectId }, select: { id: true, name: true, trackType: true } }),
    prisma.dawRoute.findMany({ where: { projectId: input.projectId, ...(input.ignoreRouteId ? { id: { not: input.ignoreRouteId } } : {}) } })
  ]);
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  if (input.sourceTrackId && !trackById.has(input.sourceTrackId)) throw new Error("路由來源不屬於這個 DAW 專案。");
  if (input.destinationTrackId && !trackById.has(input.destinationTrackId)) throw new Error("路由目的不屬於這個 DAW 專案。");
  if (input.sourceTrackId && input.sourceTrackId === input.destinationTrackId) throw new Error("音軌不能路由回自己。");

  const destination = input.destinationTrackId ? trackById.get(input.destinationTrackId) : null;
  if (["send", "cue"].includes(input.routeType) && (!destination || destination.trackType !== "bus")) {
    throw new Error(`${input.routeType.toUpperCase()} 必須送到 Bus 音軌。`);
  }
  if (input.routeType === "output" && destination && destination.trackType !== "bus") {
    throw new Error("Output 只能送到 Master 或 Bus 音軌。");
  }
  const duplicate = routes.some((route) =>
    route.sourceTrackId === input.sourceTrackId &&
    route.destinationTrackId === input.destinationTrackId &&
    route.routeType === input.routeType
  );
  if (duplicate) throw new Error("相同的路由已經存在。");

  if (!input.sourceTrackId || !input.destinationTrackId || input.routeType === "sidechain") return;
  const graph = new Map<string, Set<string>>();
  for (const route of routes) {
    if (!route.sourceTrackId || !route.destinationTrackId || route.routeType === "sidechain") continue;
    const destinations = graph.get(route.sourceTrackId) ?? new Set<string>();
    destinations.add(route.destinationTrackId);
    graph.set(route.sourceTrackId, destinations);
  }
  const proposed = graph.get(input.sourceTrackId) ?? new Set<string>();
  proposed.add(input.destinationTrackId);
  graph.set(input.sourceTrackId, proposed);

  const visited = new Set<string>();
  const stack = [input.destinationTrackId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === input.sourceTrackId) throw new Error("這條路由會形成回授循環，已拒絕建立以保護耳機與喇叭。");
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of graph.get(current) ?? []) stack.push(next);
  }
}
