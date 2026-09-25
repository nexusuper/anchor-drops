import { Composition } from 'remotion';
import { ScrollScene } from './ScrollScene';

// Layout measured from the production homepage (next build && next start) at each size:
// the hero orb slot in document coordinates and the page's scroll range.
// Re-measure if the homepage layout changes.
const DESKTOP = { vw: 1440, vh: 900, scrollMax: 3362, anchor: { x: 916, y: 284, d: 380 } };
const MOBILE = { vw: 390, vh: 844, scrollMax: 6305, anchor: { x: 45, y: 692.15625, d: 300 } };

// Timeline = one full top-to-bottom scroll: frame 0 is p = 0, last frame is p = 1.
const FPS = 30;
const FRAMES = 20 * FPS;

export const RemotionRoot = () => (
  <>
    <Composition
      id="WaterScrollDesktop"
      component={ScrollScene}
      durationInFrames={FRAMES}
      fps={FPS}
      width={DESKTOP.vw}
      height={DESKTOP.vh}
      defaultProps={{ layout: DESKTOP }}
    />
    <Composition
      id="WaterScrollMobile"
      component={ScrollScene}
      durationInFrames={FRAMES}
      fps={FPS}
      width={MOBILE.vw}
      height={MOBILE.vh}
      defaultProps={{ layout: MOBILE }}
    />
  </>
);
