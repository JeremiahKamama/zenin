import LaunchExperience from "./launch/LaunchExperience";

// Completion step now orchestrates the staged launch experience
// (personalize -> ready -> launch) instead of an instant redirect.
// Business logic stays in useOnboarding; this is pure presentation.
export function CompletionStep({ answers, plan, onOpen }) {
  return <LaunchExperience answers={answers} plan={plan} onFinish={onOpen} />;
}

export default CompletionStep;
