import { useCallback, useEffect, useRef, useState } from 'react';
import ClayButton from '../../ui/ClayButton';

// Web stand-in for the app's react-native-signature-canvas (no web analogue, and
// no new dependency allowed): a plain <canvas> drawn with pointer events, read
// out via canvas.toBlob(). The blob is handed up on Save; the page uploads it to
// Storage BEFORE calling complete_delivery, never a blob: URL — same
// resolve-media-then-write ordering as src/offline/media.ts.
export default function RouteSignaturePad({ onSave, saved }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState(null);

  // Size the backing store to the CSS box so strokes aren't stretched. Devices
  // rotate mid-route, so re-run on resize; resizing clears the canvas, which is
  // acceptable (an unsaved signature is re-drawn in seconds).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function resize() {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1f2937';
    }
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const pos = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  function start(e) {
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    const { x, y } = pos(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawing.current = true;
  }

  function move(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const { x, y } = pos(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(x, y);
    ctx.stroke();
    setDirty(true);
  }

  function end() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setDirty(false);
    setError(null);
    onSave(null);
  }

  function save() {
    if (!dirty) {
      setError('Ask the customer to sign before saving.');
      return;
    }
    setError(null);
    canvasRef.current.toBlob((blob) => onSave(blob), 'image/png');
  }

  return (
    <div className="space-y-3">
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        // touch-none stops the browser from scrolling the page instead of drawing.
        className="w-full h-44 rounded-2xl bg-white clay-inset touch-none block"
        aria-label="Customer signature"
      />
      {error && <p className="text-sm text-clay-danger">{error}</p>}
      <div className="flex gap-2">
        <ClayButton type="button" variant="outline" size="sm" className="flex-1" onClick={clear}>
          Clear
        </ClayButton>
        <ClayButton
          type="button"
          variant={saved ? 'white' : 'primary'}
          size="sm"
          className="flex-1"
          onClick={save}
        >
          {saved ? 'Signature saved ✓' : 'Save signature'}
        </ClayButton>
      </div>
    </div>
  );
}
