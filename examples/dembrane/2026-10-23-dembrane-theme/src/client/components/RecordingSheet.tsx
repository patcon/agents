import type { ReactNode } from "react";
import { Drawer } from "vaul";

// Ported from dembrane-echo-portal-config's portal-prototypes/00-components.

export type Snap = "tucked" | "open";

// Vaul measures top snap points from the top of the window, so tucked is the
// sticky header (h-14), the strip (h-14) and the grab band (h-6).
const TUCKED = "136px";
const OPEN = 0.78;

/**
 * The recording sheet: it drops from the top, and once listening starts
 * tucks up into a strip under the header. Tap the strip or pull it down to
 * open it again; tap outside it or push it up to tuck it away.
 *
 * Its actions sit at its bottom edge in `strip`, which with the grab band
 * under it is the one part still showing when tucked, so they don't move
 * between the two. Everything above, in `children`, fades out as it tucks.
 *
 * It never closes, only tucks, and isn't modal: tucked, the page under it
 * stays usable.
 */
export function RecordingSheet({
  snap,
  onSnapChange,
  strip,
  children
}: {
  snap: Snap;
  onSnapChange: (snap: Snap) => void;
  strip: ReactNode;
  children: ReactNode;
}) {
  const open = snap === "open";
  return (
    <>
      {/* Vaul draws no overlay when it isn't modal, so the scrim is ours. */}
      <div
        aria-hidden
        className={`fixed inset-0 z-[9] bg-[rgb(45_45_44/0.28)] transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => onSnapChange("tucked")}
      />
      <Drawer.Root
        open
        direction="top"
        modal={false}
        dismissible={false}
        snapPoints={[TUCKED, OPEN]}
        activeSnapPoint={open ? OPEN : TUCKED}
        setActiveSnapPoint={(point) =>
          onSnapChange(point === OPEN ? "open" : "tucked")
        }
      >
        <Drawer.Portal>
          <Drawer.Content
            aria-describedby={undefined}
            className={`fixed inset-x-0 top-0 z-10 h-dvh flex flex-col justify-end outline-none bg-app-surface border-b border-app-quiet ${
              open ? "shadow-[var(--app-float)]" : ""
            }`}
          >
            <Drawer.Title className="sr-only">Recording</Drawer.Title>
            <div className="mx-auto w-full max-w-2xl h-[calc(78dvh-3.5rem)] flex flex-col">
              <div
                className={`flex-1 min-h-0 flex flex-col px-4 pt-6 transition-opacity duration-200 ${
                  open ? "opacity-100" : "pointer-events-none opacity-0"
                }`}
              >
                {children}
              </div>
              {/* The drag handle and the buttons inside are the keyboard's way in. */}
              <div
                className={`shrink-0 ${open ? "" : "cursor-pointer"}`}
                onClick={(e) => {
                  if (!open && !(e.target as HTMLElement).closest("button"))
                    onSnapChange("open");
                }}
              >
                <div className="h-14 px-4 flex items-center gap-3">{strip}</div>
                {/* Something to take hold of when tucked, and the way to tuck it when open. */}
                <div className="h-6 flex items-center justify-center">
                  <Drawer.Handle className="!w-12 !h-1.5 !opacity-100 !bg-app-quiet" />
                </div>
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}

/** The recording dot: red and pulsing while listening, grey otherwise. */
export function LiveDot({ live }: { live: boolean }) {
  return (
    <span
      aria-hidden
      className={`size-2.5 shrink-0 rounded-full ${
        live ? "bg-app-danger animate-pulse" : "bg-app-quiet"
      }`}
    />
  );
}
