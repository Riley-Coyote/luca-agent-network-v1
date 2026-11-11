import { Circle, CircleCheck, CircleDot } from "lucide-react";
import "./WorkPlan.css";

/** Public intent/status only. A turn ending must never complete unfinished steps. */
export type WorkPlanStep = {
  content: string;
  status: "pending" | "in_progress" | "completed";
};
export type WorkPlanSnapshot = { steps: readonly WorkPlanStep[] };

export function WorkPlan({
  plan,
  settled = false,
  privateConversation = true,
}: {
  plan: WorkPlanSnapshot | null | undefined;
  settled?: boolean;
  privateConversation?: boolean;
}) {
  if (!plan?.steps.length) return null;
  const completed = plan.steps.filter(
    (step) => step.status === "completed",
  ).length;
  const list = (
    <ol className="work-plan__steps" aria-label="Plan">
      {plan.steps.map((step, index) => {
        const Mark =
          step.status === "completed"
            ? CircleCheck
            : step.status === "in_progress"
              ? CircleDot
              : Circle;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a plan is an ordered replacement snapshot, not inferred tool identities.
          <li key={index} data-plan-status={step.status}>
            <Mark aria-hidden="true" />
            <span className="sr-only">
              {step.status === "in_progress"
                ? "In progress: "
                : step.status === "completed"
                  ? "Completed: "
                  : "Pending: "}
            </span>
            <span>
              {privateConversation ? step.content : `Step ${index + 1}`}
            </span>
          </li>
        );
      })}
    </ol>
  );
  return settled ? (
    <details className="work-plan" data-testid="work-plan">
      <summary>
        {completed === plan.steps.length
          ? `${completed} steps completed`
          : `${completed} of ${plan.steps.length} steps completed`}
      </summary>
      {list}
    </details>
  ) : (
    <div className="work-plan" data-testid="work-plan">
      {list}
    </div>
  );
}
