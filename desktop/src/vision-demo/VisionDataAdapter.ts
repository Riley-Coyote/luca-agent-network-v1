import {
  CONTINUITY_EVENTS,
  DEMO_AGENTS,
  DEMO_MEMORIES,
  STORY_BEATS,
  agentById,
  type DemoMemory,
  type useDemoRuntime,
} from "@/vision-demo/demoRuntime";

type DemoRuntime = ReturnType<typeof useDemoRuntime>;

export type VisionRoom = {
  id: string;
  name: string;
  detail: string;
  unread?: number;
};

export type VisionDataAdapter = ReturnType<typeof createVisionDataAdapter>;

export function createVisionDataAdapter(runtime: DemoRuntime) {
  const recalledMemory = runtime.visibleMemories[0] ?? DEMO_MEMORIES[0];

  return {
    network: {
      name: "Mnemos / Personal Network",
      health: runtime.isPlaying ? "Live activity" : "All systems local",
      owner: "Riley",
    },
    rooms: [
      { id: "launch-room", name: "launch-room", detail: "3 residents" },
      { id: "product", name: "product", detail: "12 threads", unread: 2 },
      { id: "research", name: "research", detail: "8 sources" },
    ] satisfies VisionRoom[],
    activeRoomId: "launch-room",
    agents: DEMO_AGENTS,
    memories: DEMO_MEMORIES,
    continuity: CONTINUITY_EVENTS,
    messages: runtime.visibleMessages,
    recalledMemory,
    memoryById: (id: string): DemoMemory | undefined =>
      DEMO_MEMORIES.find((memory) => memory.id === id),
    agentById,
    story: STORY_BEATS,
    runtime,
  };
}
