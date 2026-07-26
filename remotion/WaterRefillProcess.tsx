import React from "react";
import {
  AbsoluteFill,
  Series,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
} from "remotion";
import {
  C,
  DISPLAY,
  BODY,
  clayRaised,
  clayRaisedSm,
  clayInset,
  SCENES,
} from "./theme";

/* ------------------------------------------------------------------ */
/* Background: clay gradient + deterministic rising bubbles            */
/* ------------------------------------------------------------------ */

const BUBBLES = [
  { x: 6, r: 10, dur: 150, phase: 0 },
  { x: 14, r: 6, dur: 110, phase: 40 },
  { x: 23, r: 14, dur: 190, phase: 90 },
  { x: 33, r: 8, dur: 130, phase: 20 },
  { x: 44, r: 5, dur: 100, phase: 70 },
  { x: 57, r: 12, dur: 170, phase: 110 },
  { x: 68, r: 7, dur: 120, phase: 30 },
  { x: 76, r: 16, dur: 200, phase: 140 },
  { x: 85, r: 6, dur: 115, phase: 55 },
  { x: 93, r: 11, dur: 160, phase: 10 },
  { x: 49, r: 9, dur: 140, phase: 95 },
  { x: 38, r: 6, dur: 105, phase: 130 },
];

const Bubbles: React.FC = () => {
  const frame = useCurrentFrame();
  const { height, width } = useVideoConfig();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {BUBBLES.map((b, i) => {
        const t = ((frame + b.phase) % b.dur) / b.dur;
        const y = height + 40 - t * (height + 140);
        const opacity = Math.sin(t * Math.PI) * 0.45;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: (b.x / 100) * width,
              top: y,
              width: b.r * 3,
              height: b.r * 3,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.55)",
              boxShadow: "inset 4px 4px 8px rgba(255,255,255,0.9)",
              opacity,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/* Retail refill-station environment: back wall shelf stocked with round
   jugs + a floor counter shadow, so the scene reads as a real neighborhood
   water station rather than an industrial factory line. */
const StationEnvironment: React.FC = () => {
  const { width } = useVideoConfig();
  const shelfJugs = 9;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "38%",
          background: `linear-gradient(180deg, ${C.bgDeep} 0%, ${C.bg} 100%)`,
          opacity: 0.5,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "26%",
          left: "50%",
          transform: "translateX(-50%)",
          width: width * 0.62,
          height: 22,
          borderRadius: 14,
          background: C.surface,
          boxShadow: clayRaisedSm,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "26%",
          left: "50%",
          transform: "translateX(-50%) translateY(-96px)",
          display: "flex",
          gap: 14,
          width: width * 0.62,
          justifyContent: "space-evenly",
        }}
      >
        {[...Array(shelfJugs)].map((_, i) => (
          <div
            key={i}
            style={{
              width: 46,
              height: 76,
              borderRadius: 16,
              background: C.surface,
              border: `3px solid ${C.light}`,
              boxShadow: clayRaisedSm,
              opacity: 0.9,
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "16%",
          background: `linear-gradient(180deg, transparent, ${C.bgDeep})`,
          opacity: 0.6,
        }}
      />
    </AbsoluteFill>
  );
};

const Background: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    <StationEnvironment />
    <Bubbles />
  </AbsoluteFill>
);

/* ------------------------------------------------------------------ */
/* Scene wrapper: crossfade + gentle rise, self-timed inside a Series  */
/* ------------------------------------------------------------------ */

const Scene: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const fadeIn = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 12, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp" }
  );
  const y = interpolate(frame, [0, 18], [22, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <AbsoluteFill
      style={{
        opacity: Math.min(fadeIn, fadeOut),
        transform: `translateY(${y}px)`,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

const SignBadge: React.FC<{ label: string; uv?: boolean }> = ({
  label,
  uv,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - 4, fps, config: { damping: 18 } });
  const accent = uv ? C.uv : C.skydeep;
  return (
    <div
      style={{
        position: "absolute",
        top: 96,
        display: "flex",
        alignItems: "center",
        gap: 18,
        transform: `translateY(${interpolate(s, [0, 1], [-30, 0])}px)`,
        opacity: s,
      }}
    >
      <div
        style={{
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 46,
          color: C.white,
          background: `linear-gradient(145deg, ${uv ? C.uvLight : C.sky}, ${accent})`,
          padding: "16px 40px",
          borderRadius: 999,
          boxShadow: clayRaisedSm,
          letterSpacing: 1,
        }}
      >
        {label}
      </div>
    </div>
  );
};

const Caption: React.FC<{ text: string; uv?: boolean }> = ({ text, uv }) => {
  const frame = useCurrentFrame();
  const op = interpolate(frame, [16, 32], [0, 1], { extrapolateRight: "clamp" });
  const y = interpolate(frame, [16, 32], [16, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <div
      style={{
        position: "absolute",
        bottom: 110,
        maxWidth: 2200,
        textAlign: "center",
        fontFamily: BODY,
        fontWeight: 700,
        fontSize: 52,
        color: uv ? C.uv : C.ink2,
        opacity: op,
        transform: `translateY(${y}px)`,
      }}
    >
      {text}
    </div>
  );
};

const Plinth: React.FC<{ width: number }> = ({ width }) => (
  <div
    style={{
      width,
      height: 34,
      borderRadius: 20,
      background: C.surface,
      boxShadow: clayRaised,
      marginTop: 18,
    }}
  />
);

/* A 5-gallon round bottle whose water level is driven by `level` (0..1),
   with a glassy highlight and refraction band for a higher-fidelity look. */
const Bottle: React.FC<{ level: number; scale?: number; capped?: boolean }> = ({
  level,
  scale = 1,
  capped,
}) => {
  const bodyW = 300 * scale;
  const bodyH = 440 * scale;
  return (
    <div style={{ position: "relative", width: bodyW, height: bodyH + 70 * scale }}>
      {capped && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            transform: "translateX(-50%)",
            width: 110 * scale,
            height: 42 * scale,
            borderRadius: 12 * scale,
            background: `linear-gradient(145deg, ${C.sky}, ${C.skydeep})`,
            boxShadow: clayRaisedSm,
            zIndex: 3,
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 30 * scale,
          transform: "translateX(-50%)",
          width: 84 * scale,
          height: 48 * scale,
          background: C.surface,
          border: `${5 * scale}px solid ${C.light}`,
          borderBottom: "none",
          borderRadius: `${10 * scale}px ${10 * scale}px 0 0`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 72 * scale,
          transform: "translateX(-50%)",
          width: bodyW,
          height: bodyH,
          borderRadius: 48 * scale,
          background: C.surface,
          border: `${6 * scale}px solid ${C.light}`,
          boxShadow: clayRaised,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: `${Math.max(0, Math.min(1, level)) * 100}%`,
            background: `linear-gradient(${C.light}, ${C.skydeep})`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: `${Math.max(0, Math.min(1, level)) * 100}%`,
            height: 6 * scale,
            background: "rgba(255,255,255,0.5)",
            transform: "translateY(3px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 36 * scale,
            left: 42 * scale,
            width: 28 * scale,
            height: 200 * scale,
            borderRadius: 999,
            background: "rgba(255,255,255,0.65)",
            zIndex: 2,
          }}
        />
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Scene 0 — Intro                                                     */
/* ------------------------------------------------------------------ */

const DropLogo: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <defs>
      <linearGradient id="dropg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={C.light} />
        <stop offset="1" stopColor={C.skydeep} />
      </linearGradient>
    </defs>
    <path
      d="M12 2.5C12 2.5 5 11 5 15.5a7 7 0 0 0 14 0C19 11 12 2.5 12 2.5z"
      fill="url(#dropg)"
    />
    <ellipse cx="9.5" cy="14" rx="1.6" ry="3" fill="#fff" opacity="0.7" />
  </svg>
);

const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12 } });
  const titleY = interpolate(spring({ frame: frame - 8, fps, config: { damping: 200 } }), [0, 1], [40, 0]);
  const titleOp = interpolate(frame, [10, 24], [0, 1], { extrapolateRight: "clamp" });
  const subOp = interpolate(frame, [20, 34], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          display: "inline-grid",
          placeItems: "center",
          width: 260,
          height: 260,
          borderRadius: 72,
          background: C.surface,
          boxShadow: clayRaised,
          transform: `scale(${pop})`,
          marginBottom: 44,
        }}
      >
        <DropLogo size={160} />
      </div>
      <div
        style={{
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 150,
          color: C.ink,
          opacity: titleOp,
          transform: `translateY(${titleY}px)`,
          lineHeight: 1,
        }}
      >
        Anchor Drops
      </div>
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 700,
          fontSize: 56,
          color: C.ink2,
          opacity: subOp,
          marginTop: 28,
        }}
      >
        Your neighborhood water refill station
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Scene 1 — At the station: dispensing machine fills the bottle       */
/* ------------------------------------------------------------------ */

const DispenserMachine: React.FC<{ flowing: boolean }> = ({ flowing }) => {
  const frame = useCurrentFrame();
  const glow = 14 + Math.sin(frame / 6) * 8;
  return (
    <div
      style={{
        position: "relative",
        width: 340,
        height: 300,
        borderRadius: 40,
        background: `linear-gradient(150deg, ${C.surface}, ${C.pale})`,
        boxShadow: clayRaised,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 28,
      }}
    >
      <div
        style={{
          width: 200,
          height: 54,
          borderRadius: 16,
          background: C.surface,
          boxShadow: clayInset,
          display: "grid",
          placeItems: "center",
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 24,
          color: flowing ? C.skydeep : C.muted,
        }}
      >
        {flowing ? "FILTERING…" : "READY"}
      </div>
      <div style={{ display: "flex", gap: 22, marginTop: 22 }}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: C.sky,
            boxShadow: flowing ? `0 0 ${glow}px ${glow / 2}px ${C.sky}` : "none",
          }}
        />
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: C.uv,
            boxShadow: flowing ? `0 0 ${glow}px ${glow / 2}px ${C.uvLight}` : "none",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          bottom: -14,
          left: "50%",
          transform: "translateX(-50%)",
          width: 90,
          height: 40,
          borderRadius: 14,
          background: `linear-gradient(145deg, ${C.sky}, ${C.skydeep})`,
          boxShadow: clayRaisedSm,
        }}
      />
    </div>
  );
};

const StationScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const level = interpolate(
    spring({ frame: frame - 22, fps, config: { damping: 200, stiffness: 24 } }),
    [0, 1],
    [0.04, 0.95]
  );
  const streamOn = frame > 18 && level < 0.93;
  return (
    <>
      <SignBadge label="Filtered · UV Purified" />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
        <DispenserMachine flowing={streamOn} />
        <div style={{ position: "relative", marginTop: -18 }}>
          {streamOn && (
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: 0,
                marginLeft: -9,
                width: 18,
                height: 130,
                background: `linear-gradient(${C.sky}, ${C.light})`,
                borderRadius: 10,
                opacity: 0.9,
              }}
            />
          )}
          <div style={{ marginTop: 130 }}>
            <Bottle level={level} scale={1.15} />
          </div>
        </div>
        <Plinth width={460} />
      </div>
      <Caption text="Every bottle is refilled on the spot — filtered and UV-purified at our station." />
    </>
  );
};

/* ------------------------------------------------------------------ */
/* Scene 2 — Sealed & handed over for delivery                         */
/* ------------------------------------------------------------------ */

const DeliveryScooter: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size * 0.66} viewBox="0 0 120 80">
    <rect x="46" y="24" width="46" height="30" rx="8" fill={C.surface} stroke={C.sky} strokeWidth="4" />
    <path d="M46 34 h-14 l-10 12" stroke={C.sky} strokeWidth="4" fill="none" strokeLinecap="round" />
    <circle cx="24" cy="60" r="12" fill={C.ink2} />
    <circle cx="24" cy="60" r="4.5" fill={C.surface} />
    <circle cx="90" cy="60" r="12" fill={C.ink2} />
    <circle cx="90" cy="60" r="4.5" fill={C.surface} />
    <path d="M60 24 v-10 h14" stroke={C.sky} strokeWidth="4" fill="none" strokeLinecap="round" />
    <rect x="52" y="30" width="30" height="18" rx="4" fill={C.light} opacity="0.6" />
  </svg>
);

const ReadyScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const capPop = spring({ frame: frame - 6, fps, config: { damping: 12 } });
  const checkDraw = interpolate(spring({ frame: frame - 20, fps, config: { damping: 200 } }), [0, 1], [1, 0]);
  const checkOp = interpolate(frame, [18, 24], [0, 1], { extrapolateRight: "clamp" });
  const scooterX = interpolate(spring({ frame: frame - 38, fps, config: { damping: 200, stiffness: 50 } }), [0, 1], [700, 0]);
  const scooterOp = interpolate(frame, [38, 50], [0, 1], { extrapolateRight: "clamp" });
  return (
    <>
      <SignBadge label="Pure & Ready" />
      <div style={{ display: "flex", alignItems: "center", gap: 110 }}>
        <div style={{ position: "relative", transform: `translateY(${interpolate(capPop, [0, 1], [-10, 0])}px)` }}>
          <Bottle level={0.95} capped scale={1.1} />
          <div
            style={{
              position: "absolute",
              right: -34,
              top: 70,
              width: 118,
              height: 118,
              borderRadius: "50%",
              background: `linear-gradient(145deg, ${C.sky}, ${C.skydeep})`,
              boxShadow: clayRaisedSm,
              display: "grid",
              placeItems: "center",
              opacity: checkOp,
              transform: `scale(${interpolate(checkOp, [0, 1], [0.6, 1])})`,
            }}
          >
            <svg width="68" height="68" viewBox="0 0 24 24">
              <path
                d="M5 13 l4 4 l10 -11"
                fill="none"
                stroke={C.white}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={checkDraw}
              />
            </svg>
          </div>
        </div>
        <div style={{ opacity: scooterOp, transform: `translateX(${scooterX}px)` }}>
          <DeliveryScooter size={340} />
        </div>
      </div>
      <Caption text="Sealed at the station and delivered fresh, same day." />
    </>
  );
};

/* ------------------------------------------------------------------ */
/* Orchestrator                                                        */
/* ------------------------------------------------------------------ */

export const WaterRefillProcess: React.FC = () => {
  return (
    <AbsoluteFill style={{ fontFamily: BODY }}>
      <Background />
      <Series>
        <Series.Sequence durationInFrames={SCENES.intro}>
          <Scene>
            <IntroScene />
          </Scene>
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.station}>
          <Scene>
            <StationScene />
          </Scene>
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.ready}>
          <Scene>
            <ReadyScene />
          </Scene>
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};

/* Static poster (first usable frame for the <video> placeholder). */
export const Poster: React.FC = () => (
  <AbsoluteFill style={{ fontFamily: BODY }}>
    <Background />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <IntroScene />
    </AbsoluteFill>
  </AbsoluteFill>
);
