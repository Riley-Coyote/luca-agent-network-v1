import { RecoveryScreen } from "./RecoveryScreen";

export function RelaunchRequiredScreen() {
  return (
    <RecoveryScreen
      testId="relaunch-required"
      title="Restart Luca to finish recovery"
      body="Your identity was updated. Luca needs to restart so syncing and residents run under it."
    />
  );
}
