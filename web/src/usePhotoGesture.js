import { useRef } from "react";
// Coordinates are local to the image surface; two contacts always suppress navigation.
export default function usePhotoGesture({ transform, setTransform, onNavigate, onActivate = () => {}, natural = false }) {
  const contacts = useRef(new Map()), gesture = useRef(null);
  const pair = () => { const [a, b] = [...contacts.current.values()]; return { distance: Math.hypot(a.x-b.x, a.y-b.y), x:(a.x+b.x)/2, y:(a.y+b.y)/2 }; };
  const beginPinch = () => { gesture.current = { type:"pinch", start:pair(), transform }; };
  return {
    onPointerDown(e) {
      if (e.target.closest("button")) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      contacts.current.set(e.pointerId, {x:e.clientX,y:e.clientY});
      if (contacts.current.size === 1) {
        onActivate(); gesture.current = { type: transform.zoom > 1 || natural ? "pan" : "swipe", x:e.clientX, y:e.clientY, transform };
      } else if (contacts.current.size === 2) beginPinch();
    },
    onPointerMove(e) {
      if (!contacts.current.has(e.pointerId)) return;
      contacts.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
      const g = gesture.current; if (!g) return;
      if (contacts.current.size === 2 && g.type === "pinch") {
        const p = pair(), box=e.currentTarget.getBoundingClientRect();
        const zoom=Math.max(1,Math.min(8,g.transform.zoom*p.distance/Math.max(1,g.start.distance)));
        const ratio=zoom/g.transform.zoom;
        setTransform({zoom,x:zoom===1?0:p.x-box.left-box.width/2-(g.start.x-box.left-box.width/2-g.transform.x)*ratio,y:zoom===1?0:p.y-box.top-box.height/2-(g.start.y-box.top-box.height/2-g.transform.y)*ratio});
      } else if (g.type === "pan") setTransform({...g.transform,x:g.transform.x+e.clientX-g.x,y:g.transform.y+e.clientY-g.y});
    },
    onPointerUp(e) {
      const g = gesture.current;
      contacts.current.delete(e.pointerId);
      if (g?.type === "swipe" && contacts.current.size === 0) {
        const dx=e.clientX-g.x,dy=e.clientY-g.y;
        if (Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.5) onNavigate(dx<0?1:-1);
      }
      // Never turn the end of a pinch into a swipe.
      gesture.current = null;
    },
    onPointerCancel() { contacts.current.clear(); gesture.current=null; },
  };
}
