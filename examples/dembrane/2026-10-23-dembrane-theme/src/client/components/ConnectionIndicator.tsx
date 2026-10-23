

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const dot =
    status === "connected"
      ? "bg-green-500"
      : status === "connecting"
        ? "bg-yellow-500"
        : "bg-red-500";
  const label =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting..."
        : "Disconnected";
  return (
    <output className="flex items-center gap-2" aria-label={label}>
      <span className={`size-2 rounded-full ${dot}`} />
      <span className="hidden sm:inline text-xs text-app-muted">{label}</span>
    </output>
  );
}
