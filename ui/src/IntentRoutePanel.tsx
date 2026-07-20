import type { TaskJourneyDetail, TimelineEvent } from "../../core/types";
import type { AppCopy } from "./i18n";

type IntentRouteCopy = Pick<
  AppCopy["timeline"],
  | "intentRouteTab"
  | "intentRouteAria"
  | "intentRouteLoading"
  | "intentRouteEmpty"
>;

export function IntentRoutePanel({
  copy,
  detail,
  loading,
  onSelectEvent,
}: {
  copy: IntentRouteCopy;
  detail: TaskJourneyDetail | null;
  loading: boolean;
  onSelectEvent: (event: TimelineEvent) => void;
}) {
  if (loading || !detail) {
    return <div className="intent-route-state" role="status">{copy.intentRouteLoading}</div>;
  }
  if (detail.events.length === 0) {
    return <div className="intent-route-state">{copy.intentRouteEmpty}</div>;
  }

  const route = buildRoute(detail);
  const select = (eventId?: string) => {
    const event = detail.events.find((candidate) => candidate.id === eventId);
    if (event) onSelectEvent(event);
  };

  return <section className="intent-route-panel" aria-label={copy.intentRouteAria}>
    <header className="intent-route-header">
      <h2>{copy.intentRouteTab}</h2>
      <p>Observable task events, final response, and verification evidence.</p>
    </header>
    <div className="intent-route" aria-label={copy.intentRouteAria}>
      <div className={`intent-route-status ${route.status.tone}`}>
        <div><span>Task status</span><strong>{route.status.title}</strong><p>{route.status.guidance}</p></div>
        <div className="intent-route-evidence"><span>Why this status</span>{route.status.evidence.map((item) => <button key={item.label} type="button" onClick={() => select(item.eventId)} disabled={!item.eventId}>{item.label}</button>)}</div>
      </div>
      <ol className="intent-route-rail">
        {route.steps.map((step) => <li key={step.label} className={step.tone}><span className="intent-route-marker" /><div><span>{step.label}</span><button type="button" onClick={() => select(step.eventId)} disabled={!step.eventId}>{step.title}</button><small>{step.detail}</small></div></li>)}
      </ol>
    </div>
  </section>;
}

function buildRoute(detail: TaskJourneyDetail) {
  const events = [...detail.events].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const input = events.find((event) => event.kind === "user_prompt") ?? null;
  const finalResponse = events.filter((event) => event.kind === "assistant_message").at(-1) ?? null;
  const verification = events.filter((event) => event.kind === "verification").at(-1) ?? null;
  const hasProof = verification?.status === "success";
  const verificationFailed = verification?.status === "failed";
  const status = hasProof
    ? { tone: "clear", title: "Verified finish", guidance: "The task has a final response and a successful verification event.", evidence: [{ label: "Open final response", eventId: finalResponse?.id }, { label: "Open verification", eventId: verification?.id }] }
    : verificationFailed
      ? { tone: "review", title: "Verification needs attention", guidance: "This task recorded an unsuccessful verification. Review its output before relying on the final response.", evidence: [{ label: "Open failed verification", eventId: verification?.id }, { label: "Open final response", eventId: finalResponse?.id }] }
      : finalResponse
        ? { tone: "review", title: "Outcome needs proof", guidance: "The route reaches a final response, but no successful verification event supports the result.", evidence: [{ label: "Open final response", eventId: finalResponse.id }, { label: "No successful verification recorded", eventId: undefined }] }
        : { tone: "review", title: "Awaiting outcome", guidance: "This task has no observable final agent response yet.", evidence: [{ label: "Open task intent", eventId: input?.id }] };
  const steps = [
    { label: "Task intent", title: input?.detail ?? input?.title ?? "No observable user input", detail: "User input anchors this route.", eventId: input?.id, tone: "intent" },
    { label: "Agent outcome", title: finalResponse?.detail ?? finalResponse?.title ?? "No final response observed", detail: finalResponse ? "Last agent response in this task." : "The agent has not produced a final response in this task boundary.", eventId: finalResponse?.id, tone: finalResponse ? "outcome" : "missing" },
    { label: "Proof", title: verification?.title ?? "No verification observed", detail: verification ? `${verification.status === "success" ? "Successful" : "Unsuccessful"} verification recorded in this task.` : "No test, build, lint, or equivalent proof event was recorded.", eventId: verification?.id, tone: hasProof ? "proof" : "missing" },
  ];
  return { status, steps };
}
