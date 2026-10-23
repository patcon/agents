import { useEffect, type ReactNode } from "react";
import { Button, Text } from "@cloudflare/kumo";
import {
  XIcon
} from "@phosphor-icons/react";

/** Bottom sheet on phones, side panel from `md` up. */
export function Drawer({
  open,
  onClose,
  title,
  children
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={`fixed inset-0 z-40 ${open ? "" : "pointer-events-none"}`}
      inert={!open}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <aside
        aria-label={title}
        className={`absolute inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl md:inset-y-0 md:left-auto md:right-0 md:w-[28rem] md:max-h-none md:rounded-none bg-kumo-base ring ring-kumo-line flex flex-col transition-transform duration-200 ${
          open
            ? "translate-y-0 md:translate-x-0"
            : "translate-y-full md:translate-y-0 md:translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-kumo-line">
          <Text size="sm" bold>
            {title}
          </Text>
          <Button
            variant="ghost"
            shape="square"
            aria-label="Close"
            onClick={onClose}
            icon={<XIcon size={16} />}
          />
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </div>
  );
}
