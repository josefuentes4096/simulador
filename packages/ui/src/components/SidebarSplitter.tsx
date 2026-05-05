import type { MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useRef } from 'react';

interface Props {
  onResize: (deltaPx: number) => void;
}

// Thin vertical bar between the canvas and the sidebar. Click-and-drag to
// resize. Captures global mousemove/mouseup so the drag survives even if the
// cursor temporarily leaves the bar's pixel-thin hit area.
export function SidebarSplitter({ onResize }: Props) {
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);

  const onMouseDown = (e: ReactMouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    lastXRef.current = e.clientX;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = e.clientX - lastXRef.current;
      lastXRef.current = e.clientX;
      onResize(delta);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [onResize]);

  return (
    <div
      className="sidebar-splitter"
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
    />
  );
}
