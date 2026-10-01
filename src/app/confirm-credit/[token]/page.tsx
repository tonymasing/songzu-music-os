import { notFound } from "next/navigation";

import { CreditConfirmWorkspace } from "@/components/CreditConfirmWorkspace";
import { toIso } from "@/lib/music";
import { prisma } from "@/lib/prisma";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function ConfirmCreditPage({ params }: PageProps) {
  const { token } = await params;
  const confirmation = await prisma.creditConfirmation.findUnique({
    where: { token },
    include: {
      credit: {
        include: {
          song: true,
          contributor: true
        }
      }
    }
  });

  if (!confirmation) notFound();

  return (
    <CreditConfirmWorkspace
      confirmation={{
        token: confirmation.token,
        status: confirmation.status,
        confirmedAt: toIso(confirmation.confirmedAt),
        displayName: confirmation.displayName,
        notes: confirmation.notes,
        songTitle: confirmation.credit.song.title,
        contributorName: confirmation.credit.contributor.name,
        role: confirmation.credit.role,
        splitPercentage: confirmation.credit.splitPercentage,
        ownershipType: confirmation.credit.ownershipType
      }}
    />
  );
}
