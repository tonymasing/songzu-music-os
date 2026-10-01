import { NextResponse } from "next/server";

import { getMusicReferences, importHermesReferenceLibrary, referenceLibraryHealth } from "@/lib/reference-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [health, items] = await Promise.all([referenceLibraryHealth(), getMusicReferences()]);
  return NextResponse.json({ health, items });
}

export async function POST() {
  try {
    const report = await importHermesReferenceLibrary();
    const [health, items] = await Promise.all([referenceLibraryHealth(), getMusicReferences()]);
    return NextResponse.json({ report, health, items });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "無法更新風格參考資料庫。" },
      { status: 500 }
    );
  }
}
