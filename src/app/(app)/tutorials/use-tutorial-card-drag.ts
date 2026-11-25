import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

type Position = { left: number; top: number };
type Size = { width: number; height: number };
const STORAGE_KEY = "agilecampus.tutorial-card-position.v1";
const BORDER_GAP = 8;
const ARROW_MOVEMENT: Partial<Record<string, Position>> = {
  ArrowLeft: { left: -24, top: 0 },
  ArrowRight: { left: 24, top: 0 },
  ArrowUp: { left: 0, top: -24 },
  ArrowDown: { left: 0, top: 24 },
};

export function constrainTutorialCard(position: Position, card: Size, viewport: Size): Position {
  return {
    left: Math.max(BORDER_GAP, Math.min(position.left, viewport.width - card.width - BORDER_GAP)),
    top: Math.max(BORDER_GAP, Math.min(position.top, viewport.height - card.height - BORDER_GAP)),
  };
}

function rememberPosition(position: Position | null) {
  try {
    if (position) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(position));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* Dragging still works if browser storage is unavailable. */ }
}

export function useTutorialCardDrag(
  card: RefObject<HTMLElement | null>, viewport: Size, width: number, visible: boolean, portalRoot: HTMLElement | null,
) {
  const [position, setPosition] = useState<Position | null>(null);
  const [height, setHeight] = useState(0);
  const drag = useRef<{ id: number; offset: Position; latest?: Position } | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved: Position | null = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
        if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) setPosition(saved);
      } catch { /* Ignore corrupt or unavailable storage. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const element = card.current;
    if (!visible || !element) return;
    const observer = new ResizeObserver(() => setHeight(element.getBoundingClientRect().height));
    observer.observe(element);
    return () => observer.disconnect();
  }, [card, visible, portalRoot]);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    const bounds = card.current?.getBoundingClientRect();
    if (!bounds || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    drag.current = {
      id: event.pointerId,
      offset: { left: event.clientX - bounds.left, top: event.clientY - bounds.top },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (current?.id !== event.pointerId) return;
    const bounds = card.current?.getBoundingClientRect();
    if (!bounds) return;
    const next = constrainTutorialCard(
      { left: event.clientX - current.offset.left, top: event.clientY - current.offset.top },
      bounds,
      { width: window.innerWidth, height: window.innerHeight },
    );
    current.latest = next;
    setPosition(next);
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (current?.id !== event.pointerId) return;
    drag.current = null;
    if (current.latest) rememberPosition(current.latest);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Home") {
      event.preventDefault();
      setPosition(null);
      rememberPosition(null);
      return;
    }
    const movement = ARROW_MOVEMENT[event.key];
    const bounds = card.current?.getBoundingClientRect();
    if (!movement || !bounds) return;
    event.preventDefault();
    const next = constrainTutorialCard({ left: bounds.left + movement.left, top: bounds.top + movement.top }, bounds, viewport);
    setPosition(next);
    rememberPosition(next);
  }

  const movedPosition = position ? constrainTutorialCard(position, { width, height }, viewport) : null;
  return {
    movedPosition,
    handle: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag, onKeyDown },
  };
}
