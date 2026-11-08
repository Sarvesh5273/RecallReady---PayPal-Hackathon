export function EnvironmentBadge({ mode }: { mode: string }) {
  return (
    <span
      className={`environment ${mode === "SIMULATION" ? "simulation" : ""}`}
    >
      <span className="status-dot" />
      {mode.replaceAll("_", " ")}
    </span>
  );
}
