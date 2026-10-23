

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const dot =
    status === "connected"
      ? "bg-app-success"
      : status === "connecting"
        ? "bg-app-warning"
        : "bg-app-danger";
  const label =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting..."
        : "Disconnected";
  return (
    <output className="flex items-center gap-2" aria-label={label}>
      <span className={`size-2 rounded-full ${dot}`} />
      <span className="text-xs text-app-muted">{label}</span>
    </output>
  );
}
