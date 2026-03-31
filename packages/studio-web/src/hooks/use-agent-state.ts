import { useOfficeStore } from "../stores/use-office-store";
import type { AgentState } from "../types/agent";

/**
 * Hook to get and update a specific agent's state.
 */
export function useAgentState(agentId: string) {
  const character = useOfficeStore((s) =>
    s.scene.characters.find((c) => c.id === agentId),
  );
  const updateState = useOfficeStore((s) => s.updateCharacterState);

  return {
    state: (character?.state ?? "idle") as AgentState,
    name: character?.name ?? agentId,
    animal: character?.animal ?? "bear",
    role: character?.role ?? "Unknown",
    team: character?.team ?? "unknown",
    setState: (state: AgentState) => updateState(agentId, state),
  };
}
