import { prisma } from "@/lib/prisma";

type NodeInput = {
  entityKey: string;
  songId?: string | null;
  nodeType: string;
  label: string;
  summary?: string | null;
  tags?: string[];
  attributes?: Record<string, unknown>;
  source?: string;
  confidence?: number;
};

type EdgeInput = {
  sourceKey: string;
  targetKey: string;
  relationType: string;
  weight?: number;
  evidence?: Record<string, unknown>;
};

function parseArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
  }
}

function compact(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-TW").replace(/\s+/g, " ").trim();
}

function searchTokens(value: string) {
  const normalized = normalize(value);
  const words = normalized.split(/[\s,，、/|]+/).filter(Boolean);
  const cjk = [...normalized.replace(/[\s\p{P}\p{S}]/gu, "")];
  const grams = cjk.length > 1 ? cjk.slice(0, -1).map((char, index) => `${char}${cjk[index + 1]}`) : cjk;
  return [...new Set([normalized, ...words, ...grams].filter(Boolean))];
}

function nodeSearchText(input: NodeInput) {
  const values = compact([
    input.label,
    input.summary,
    ...(input.tags ?? []),
    ...Object.values(input.attributes ?? {}).flatMap((value) =>
      Array.isArray(value) ? value.map(String) : typeof value === "string" || typeof value === "number" ? [String(value)] : []
    )
  ]);
  return [...new Set(values.flatMap(searchTokens))].join(" ");
}

function addNode(map: Map<string, NodeInput>, input: NodeInput) {
  const current = map.get(input.entityKey);
  if (!current) {
    map.set(input.entityKey, input);
    return;
  }
  map.set(input.entityKey, {
    ...current,
    ...input,
    tags: compact([...(current.tags ?? []), ...(input.tags ?? [])]),
    attributes: { ...(current.attributes ?? {}), ...(input.attributes ?? {}) }
  });
}

function addEdge(edges: Map<string, EdgeInput>, edge: EdgeInput) {
  if (edge.sourceKey === edge.targetKey) return;
  const key = `${edge.sourceKey}|${edge.targetKey}|${edge.relationType}`;
  const current = edges.get(key);
  edges.set(key, current ? { ...current, weight: Math.max(current.weight ?? 1, edge.weight ?? 1) } : edge);
}

export async function rebuildKnowledgeGraph() {
  const [songs, materials, sounds, rules, releases] = await Promise.all([
    prisma.song.findMany({
      include: {
        lyricsVersions: { orderBy: { updatedAt: "desc" }, take: 3 },
        credits: { include: { contributor: true } },
        soundUsages: { include: { soundLibraryItem: true } },
        audioFiles: { where: { archivedAt: null }, select: { id: true, fileType: true, versionName: true, qualityStatus: true } },
        promoAssets: { select: { assetType: true, status: true } },
        rightsProfile: true,
        releaseTracks: { include: { release: true } }
      }
    }),
    prisma.musicMaterial.findMany({ include: { relatedSong: true, relatedSound: true } }),
    prisma.soundLibraryItem.findMany(),
    prisma.personalTheoryRule.findMany({ where: { isActive: true } }),
    prisma.release.findMany({ include: { tracks: { include: { song: true } } } })
  ]);

  const nodes = new Map<string, NodeInput>();
  const edges = new Map<string, EdgeInput>();

  for (const song of songs) {
    const songKey = `song:${song.id}`;
    const moods = parseArray(song.moodJson);
    const lyrics = song.lyricsVersions.map((item) => item.content).join("\n").slice(0, 12000);
    addNode(nodes, {
      entityKey: songKey,
      songId: song.id,
      nodeType: "song",
      label: song.title,
      summary: song.summary || song.notes || null,
      tags: compact([song.status, song.genre, song.subgenre, song.musicalKey, ...moods]),
      attributes: {
        status: song.status,
        bpm: song.bpm,
        key: song.musicalKey,
        genre: song.genre,
        lyrics,
        audioTypes: song.audioFiles.map((file) => file.fileType),
        releaseReady: song.audioFiles.some((file) => file.fileType === "master" && file.qualityStatus === "pass")
      }
    });

    for (const [type, value, relation] of [
      ["genre", song.genre, "HAS_GENRE"],
      ["subgenre", song.subgenre, "HAS_SUBGENRE"],
      ["key", song.musicalKey, "IN_KEY"]
    ] as const) {
      if (!value) continue;
      const entityKey = `${type}:${normalize(value)}`;
      addNode(nodes, { entityKey, nodeType: type, label: value, tags: [type] });
      addEdge(edges, { sourceKey: songKey, targetKey: entityKey, relationType: relation, weight: 0.9 });
    }

    for (const mood of moods) {
      const moodKey = `mood:${normalize(mood)}`;
      addNode(nodes, { entityKey: moodKey, nodeType: "mood", label: mood });
      addEdge(edges, { sourceKey: songKey, targetKey: moodKey, relationType: "HAS_MOOD", weight: 0.8 });
    }

    for (const credit of song.credits) {
      const contributorKey = `contributor:${credit.contributorId}`;
      addNode(nodes, {
        entityKey: contributorKey,
        nodeType: "contributor",
        label: credit.contributor.name,
        summary: credit.contributor.notes,
        tags: compact([credit.role, credit.creditCategory, credit.contributor.proAffiliation]),
        attributes: { role: credit.role, ipi: credit.contributor.ipi, isni: credit.contributor.isni }
      });
      addEdge(edges, {
        sourceKey: contributorKey,
        targetKey: songKey,
        relationType: "CONTRIBUTED_TO",
        weight: 1,
        evidence: { role: credit.role, split: credit.splitPercentage }
      });
    }

    for (const usage of song.soundUsages) {
      const soundKey = `sound:${usage.soundLibraryItemId}`;
      addNode(nodes, {
        entityKey: soundKey,
        nodeType: "sound",
        label: usage.soundLibraryItem.name,
        summary: usage.soundLibraryItem.description,
        tags: compact([
          usage.soundLibraryItem.itemType,
          usage.soundLibraryItem.family,
          usage.soundLibraryItem.era,
          ...parseArray(usage.soundLibraryItem.tagsJson)
        ])
      });
      addEdge(edges, {
        sourceKey: songKey,
        targetKey: soundKey,
        relationType: "USES_SOUND",
        weight: usage.status === "ACTIVE" ? 1 : 0.65,
        evidence: { role: usage.role, section: usage.section }
      });
    }

    for (const track of song.releaseTracks) {
      const releaseKey = `release:${track.releaseId}`;
      addNode(nodes, {
        entityKey: releaseKey,
        nodeType: "release",
        label: track.release.title,
        tags: [track.release.status, track.release.releaseType]
      });
      addEdge(edges, { sourceKey: songKey, targetKey: releaseKey, relationType: "PART_OF_RELEASE", weight: 1 });
    }
  }

  for (const sound of sounds) {
    addNode(nodes, {
      entityKey: `sound:${sound.id}`,
      nodeType: "sound",
      label: sound.name,
      summary: sound.description,
      tags: compact([sound.itemType, sound.family, sound.era, ...parseArray(sound.tagsJson)]),
      attributes: { source: sound.source, license: sound.licenseName, status: sound.status }
    });
  }

  for (const material of materials) {
    const materialKey = `material:${material.id}`;
    addNode(nodes, {
      entityKey: materialKey,
      songId: material.relatedSongId,
      nodeType: "material",
      label: material.title,
      summary: material.summary || material.content.slice(0, 600),
      tags: compact([material.materialType, material.genre, material.musicalKey, ...parseArray(material.tagsJson), ...parseArray(material.moodJson)]),
      attributes: { content: material.content.slice(0, 6000), bpm: material.bpm, section: material.sectionRole, source: material.source }
    });
    if (material.relatedSongId) {
      addEdge(edges, { sourceKey: materialKey, targetKey: `song:${material.relatedSongId}`, relationType: "MATERIAL_FOR", weight: 1 });
    }
    if (material.relatedSoundId) {
      addEdge(edges, { sourceKey: materialKey, targetKey: `sound:${material.relatedSoundId}`, relationType: "REFERENCES_SOUND", weight: 0.8 });
    }
  }

  for (const rule of rules) {
    const ruleKey = `theory:${rule.id}`;
    addNode(nodes, {
      entityKey: ruleKey,
      nodeType: "theory_rule",
      label: rule.title,
      summary: rule.statement,
      tags: compact([rule.ruleType, rule.scope, ...parseArray(rule.tagsJson)]),
      attributes: { priority: rule.priority, examples: parseArray(rule.examplesJson), avoid: parseArray(rule.avoidJson) }
    });
    for (const song of songs) {
      const searchable = normalize([song.title, song.genre, song.subgenre, song.summary, song.notes, ...parseArray(song.moodJson)].filter(Boolean).join(" "));
      const overlap = searchTokens(`${rule.title} ${rule.statement} ${rule.tagsJson || ""}`).filter((token) => token.length > 1 && searchable.includes(token));
      if (overlap.length) {
        addEdge(edges, {
          sourceKey: ruleKey,
          targetKey: `song:${song.id}`,
          relationType: "INFORMS_SONG",
          weight: Math.min(1, 0.45 + overlap.length * 0.08),
          evidence: { overlap: overlap.slice(0, 8) }
        });
      }
    }
  }

  for (const release of releases) {
    addNode(nodes, {
      entityKey: `release:${release.id}`,
      nodeType: "release",
      label: release.title,
      tags: compact([release.status, release.releaseType, release.upc]),
      attributes: { releaseDate: release.releaseDate?.toISOString() ?? null, trackCount: release.tracks.length }
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.knowledgeEdge.deleteMany({ where: { sourceNode: { source: "derived" } } });
    await tx.knowledgeNode.deleteMany({ where: { source: "derived" } });

    const ids = new Map<string, string>();
    for (const input of nodes.values()) {
      const node = await tx.knowledgeNode.upsert({
        where: { entityKey: input.entityKey },
        create: {
          entityKey: input.entityKey,
          songId: input.songId ?? null,
          nodeType: input.nodeType,
          label: input.label,
          summary: input.summary ?? null,
          searchText: nodeSearchText(input),
          tagsJson: JSON.stringify(input.tags ?? []),
          attributesJson: JSON.stringify(input.attributes ?? {}),
          source: input.source ?? "derived",
          confidence: input.confidence ?? 1
        },
        update: {
          songId: input.songId ?? null,
          nodeType: input.nodeType,
          label: input.label,
          summary: input.summary ?? null,
          searchText: nodeSearchText(input),
          tagsJson: JSON.stringify(input.tags ?? []),
          attributesJson: JSON.stringify(input.attributes ?? {}),
          confidence: input.confidence ?? 1
        }
      });
      ids.set(input.entityKey, node.id);
    }

    for (const edge of edges.values()) {
      const sourceNodeId = ids.get(edge.sourceKey);
      const targetNodeId = ids.get(edge.targetKey);
      if (!sourceNodeId || !targetNodeId) continue;
      await tx.knowledgeEdge.upsert({
        where: { sourceNodeId_targetNodeId_relationType: { sourceNodeId, targetNodeId, relationType: edge.relationType } },
        create: {
          sourceNodeId,
          targetNodeId,
          relationType: edge.relationType,
          weight: edge.weight ?? 1,
          evidenceJson: JSON.stringify(edge.evidence ?? {})
        },
        update: { weight: edge.weight ?? 1, evidenceJson: JSON.stringify(edge.evidence ?? {}) }
      });
    }
  });

  return { nodes: nodes.size, edges: edges.size, rebuiltAt: new Date().toISOString() };
}

export async function searchKnowledgeGraph(query: string, limit = 24) {
  const tokens = searchTokens(query).filter((token) => token.length > 1 || /[a-z0-9]/i.test(token));
  if (!tokens.length) return [];
  const candidates = await prisma.knowledgeNode.findMany({
    where: { OR: tokens.slice(0, 10).map((token) => ({ searchText: { contains: token } })) },
    include: {
      song: { select: { id: true, title: true, status: true, bpm: true, musicalKey: true, genre: true } },
      outgoingEdges: { include: { targetNode: { select: { id: true, nodeType: true, label: true, songId: true } } }, take: 10 },
      incomingEdges: { include: { sourceNode: { select: { id: true, nodeType: true, label: true, songId: true } } }, take: 10 }
    },
    take: Math.max(limit * 4, 40)
  });

  return candidates
    .map((node) => {
      const normalized = normalize(`${node.label} ${node.summary || ""} ${node.searchText}`);
      const exactLabel = normalize(node.label) === normalize(query);
      const matched = tokens.filter((token) => normalized.includes(token));
      const connectionCount = node.outgoingEdges.length + node.incomingEdges.length;
      const score = Math.round(Math.min(100, (exactLabel ? 45 : 0) + matched.length * 12 + Math.min(18, connectionCount * 2) + node.confidence * 10));
      return {
        id: node.id,
        entityKey: node.entityKey,
        nodeType: node.nodeType,
        label: node.label,
        summary: node.summary,
        songId: node.songId,
        song: node.song,
        score,
        matchedTokens: matched,
        connections: [
          ...node.outgoingEdges.map((edge) => ({ direction: "out" as const, relation: edge.relationType, weight: edge.weight, node: edge.targetNode })),
          ...node.incomingEdges.map((edge) => ({ direction: "in" as const, relation: edge.relationType, weight: edge.weight, node: edge.sourceNode }))
        ].sort((left, right) => right.weight - left.weight).slice(0, 8)
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export async function getKnowledgeGraphSummary() {
  const [nodes, edges, byType, recent] = await Promise.all([
    prisma.knowledgeNode.count(),
    prisma.knowledgeEdge.count(),
    prisma.knowledgeNode.groupBy({ by: ["nodeType"], _count: { _all: true }, orderBy: { _count: { nodeType: "desc" } } }),
    prisma.knowledgeNode.findMany({ orderBy: { updatedAt: "desc" }, take: 8, select: { id: true, nodeType: true, label: true, songId: true } })
  ]);
  return {
    nodes,
    edges,
    byType: byType.map((item) => ({ type: item.nodeType, count: item._count._all })),
    recent
  };
}
