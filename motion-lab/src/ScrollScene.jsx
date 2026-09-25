import { useLayoutEffect, useRef } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, getScene } from '../../components/water/scene';
import { WaterMarkup, applyScene } from '../../components/water/WaterBackground';

// frame → p (scroll progress), frame → t (ambient time). Same getScene + applyScene
// the site runs, so scrubbing here = scrolling the homepage.
export const ScrollScene = ({ layout }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const ref = useRef(null);
  const p = frame / (durationInFrames - 1);
  const t = frame / fps;

  useLayoutEffect(() => {
    applyScene(ref.current, getScene(p, t, { ...layout, scrollY: p * layout.scrollMax, reduced: false }));
  });

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {/* absolute, not fixed: the studio canvas is the viewport here */}
      <WaterMarkup ref={ref} style={{ position: 'absolute', zIndex: 0 }} />
      <div style={{ position: 'absolute', left: 12, bottom: 10, font: '600 14px system-ui', color: C.ink }}>
        p = {p.toFixed(3)} · scrollY = {Math.round(p * layout.scrollMax)}px
      </div>
    </AbsoluteFill>
  );
};
