import type {
  AgentActivityDescriptor,
  TranscriptItem,
} from "./agentSessionTypes";
import { getToolString } from "./agentSessionUtils";

type ToolItem = Extract<TranscriptItem, { type: "tool" }>;

export type ImageToolContent = {
  src: string;
  title: string | null;
};

/**
 * A base64 image block is inlined as a data URI, so the same lightbox that
 * shows `view_image`'s input can show what a tool handed back. The cap keeps a
 * large blob out of the transcript: roughly 4 MB of base64 (~3 MB of bytes),
 * which is well past any screenshot and well short of anything that would
 * stall the webview.
 */
const MAX_RESULT_IMAGE_DATA_URI_CHARS = 4 * 1024 * 1024;

function imageSourceFromArgs(item: ToolItem): string | null {
  const source = getToolString(item.args, ["source"]);
  if (!source) {
    return null;
  }
  const trimmed = source.trim();
  if (
    !trimmed.startsWith("data:image/") &&
    !trimmed.startsWith("http://") &&
    !trimmed.startsWith("https://")
  ) {
    return null;
  }
  return trimmed;
}

function imageSourceFromResult(item: ToolItem): string | null {
  const first = item.resultImages?.[0];
  if (!first) {
    return null;
  }
  return first.length <= MAX_RESULT_IMAGE_DATA_URI_CHARS ? first : null;
}

/**
 * The picture a tool row should show, if it has one.
 *
 * An `image`-class tool shows what it was pointed at; any tool that *returned*
 * an image block shows that, so a picture a resident just made is visible while
 * the turn is still running.
 */
export function buildImageContent(
  item: ToolItem,
  descriptor: AgentActivityDescriptor,
): ImageToolContent | null {
  const src =
    (descriptor.renderClass === "image" ? imageSourceFromArgs(item) : null) ??
    imageSourceFromResult(item);
  if (!src) {
    return null;
  }
  return {
    src,
    title: descriptor.preview ?? descriptor.object ?? null,
  };
}
