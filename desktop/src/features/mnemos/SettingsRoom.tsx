import { NeedsNewer, PlaceLine } from "./MnemosParts";
import type { RoomProps } from "./roomKit";

/** Settings: how its quiet hours are woken, and Jev, as the notebook gives
 *  them. */
export function SettingsRoom({ notebook }: RoomProps) {
  if (!notebook) return <NeedsNewer what="Settings" />;
  const { schedule, jev } = notebook.life;
  return (
    <div className="luca-mnemos-room" data-testid="mnemos-settings">
      <PlaceLine testId="mnemos-settings-hours">
        {schedule.length
          ? "Its quiet hours wake on their own, on this Mac."
          : "Nothing wakes its quiet hours on their own."}
      </PlaceLine>
      {jev ? (
        <PlaceLine testId="mnemos-settings-jev">
          {jev.on ? "Jev is on." : "Jev is off."}
        </PlaceLine>
      ) : null}
    </div>
  );
}
