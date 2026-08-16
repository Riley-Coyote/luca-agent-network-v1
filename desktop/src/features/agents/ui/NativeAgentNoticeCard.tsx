import { UsersRound } from "lucide-react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { canonicalLucaResidentPubkey } from "@/features/luca/canonicalLucaResident";
import { useLucaResidentsQuery } from "@/features/luca/residents/hooks";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/shared/ui/attachment";

export function NativeAgentNoticeCard({
  signerPubkey,
}: {
  signerPubkey: string | undefined;
}) {
  const residentsQuery = useLucaResidentsQuery();
  const { goAgents } = useAppNavigation();
  const lucaPubkey = canonicalLucaResidentPubkey(
    residentsQuery.data?.residents,
  );

  if (!lucaPubkey || normalizePubkey(signerPubkey ?? "") !== lucaPubkey) {
    return null;
  }

  return (
    <Attachment
      className="mt-2 max-w-[min(100%,32rem)] shadow-none"
      data-testid="native-agent-notice"
      size="sm"
    >
      <AttachmentMedia>
        <UsersRound aria-hidden="true" />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>Agents already on this Mac</AttachmentTitle>
        <AttachmentDescription>
          Review first. Nothing imports automatically.
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction
          onClick={() => void goAgents({ reviewNative: true })}
          size="sm"
          type="button"
          variant="outline"
        >
          Review agents
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  );
}
