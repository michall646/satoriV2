import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import metadata from '../public/metadata.json';

const VIEWPORT_W = metadata?.viewport?.width || 1440;
const VIEWPORT_H = metadata?.viewport?.height || 900;

/**
 * Computes smooth spring-interpolated camera target (x, y) and zoom level
 * directly from the recorded Playwright metadata.json events for the given scene.
 */
function useSceneCamera(sceneMeta, localFrame, fps, zoomProfile) {
  const events = sceneMeta?.events || [];

  return useMemo(() => {
    const tMs = (localFrame / fps) * 1000;

    // Default center of viewport
    let baseX = VIEWPORT_W / 2;
    let baseY = VIEWPORT_H / 2;

    if (events.length > 0) {
      // Find surrounding events for linear base interpolation, then smooth via spring
      let prev = events[0];
      let next = events[events.length - 1];
      for (let i = 0; i < events.length; i++) {
        if (events[i].tMs <= tMs) prev = events[i];
        if (events[i].tMs >= tMs) {
          next = events[i];
          break;
        }
      }
      if (prev === next || next.tMs === prev.tMs) {
        baseX = prev.x;
        baseY = prev.y;
      } else {
        const alpha = (tMs - prev.tMs) / (next.tMs - prev.tMs);
        baseX = prev.x + (next.x - prev.x) * alpha;
        baseY = prev.y + (next.y - prev.y) * alpha;
      }
    }

    // Apply spring-driven zoom keyframes defined for the scene
    let scale = 1.0;
    let focusStrength = 0.0;

    for (const kf of zoomProfile) {
      const enterSpring = spring({
        frame: localFrame - kf.inFrame,
        fps,
        config: { damping: 18, stiffness: 85, mass: 0.9 },
      });
      const exitSpring = kf.outFrame
        ? spring({
            frame: localFrame - kf.outFrame,
            fps,
            config: { damping: 20, stiffness: 80, mass: 0.9 },
          })
        : 0;
      const weight = Math.max(0, enterSpring - exitSpring);
      scale += (kf.zoom - 1.0) * weight;
      focusStrength = Math.max(focusStrength, weight * (kf.follow ?? 0.65));
      if (kf.targetX != null && kf.targetY != null) {
        baseX = baseX * (1 - weight * 0.5) + kf.targetX * (weight * 0.5);
        baseY = baseY * (1 - weight * 0.5) + kf.targetY * (weight * 0.5);
      }
    }

    // Offset from center of 1440x900 viewport, clamped so window edges remain sleek
    const rawDx = (VIEWPORT_W / 2 - baseX) * focusStrength;
    const rawDy = (VIEWPORT_H / 2 - baseY) * focusStrength;
    const maxPanX = ((scale - 1) * VIEWPORT_W) / 2 + 80;
    const maxPanY = ((scale - 1) * VIEWPORT_H) / 2 + 60;
    const tx = Math.max(-maxPanX, Math.min(maxPanX, rawDx));
    const ty = Math.max(-maxPanY, Math.min(maxPanY, rawDy));

    // Recent click pulse from metadata
    const recentClick = events.find(
      (ev) => ev.type === 'click' && tMs >= ev.tMs && tMs - ev.tMs < 420
    );
    const clickBoost = recentClick
      ? Math.sin(((tMs - recentClick.tMs) / 420) * Math.PI) * 0.022
      : 0;

    return {
      scale: scale + clickBoost,
      tx,
      ty,
      cursorX: baseX,
      cursorY: baseY,
    };
  }, [events, localFrame, fps, zoomProfile]);
}

function KineticLowerThird({ indexLabel, eyebrow, title, subtitle, localFrame, durationFrames, fps }) {
  const enter = spring({
    frame: localFrame - 10,
    fps,
    config: { damping: 16, stiffness: 110, mass: 0.8 },
  });
  const exit = spring({
    frame: localFrame - (durationFrames - 28),
    fps,
    config: { damping: 18, stiffness: 120 },
  });
  const vis = Math.max(0, Math.min(1, enter - exit));
  const translateY = interpolate(vis, [0, 1], [28, 0]);

  return (
    <div
      style={{
        position: 'absolute',
        left: 88,
        bottom: 58,
        zIndex: 30,
        opacity: vis,
        transform: `translate3d(0, ${translateY}px, 0)`,
        display: 'flex',
        alignItems: 'stretch',
        gap: 18,
        padding: '16px 24px',
        borderRadius: 14,
        background: 'linear-gradient(135deg, rgba(11, 13, 18, 0.88) 0%, rgba(17, 20, 28, 0.78) 100%)',
        border: '1px solid rgba(91, 141, 239, 0.32)',
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.65), 0 0 32px rgba(47, 107, 255, 0.16)',
        backdropFilter: 'blur(18px)',
      }}
    >
      <div
        style={{
          width: 3,
          borderRadius: 999,
          background: 'linear-gradient(180deg, #7aa5ff 0%, #2f6bff 100%)',
          boxShadow: '0 0 12px #5b8def',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: '#7aa5ff',
            fontWeight: 700,
          }}
        >
          <span
            style={{
              padding: '2px 7px',
              borderRadius: 4,
              background: 'rgba(91, 141, 239, 0.18)',
              border: '1px solid rgba(91, 141, 239, 0.4)',
              color: '#a8c4ff',
            }}
          >
            {indexLabel}
          </span>
          <span>{eyebrow}</span>
        </div>
        <div
          style={{
            fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: '#f1f5f9',
            lineHeight: 1.2,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
            fontSize: 14,
            color: '#94a3b8',
            letterSpacing: '-0.005em',
          }}
        >
          {subtitle}
        </div>
      </div>
    </div>
  );
}

function SceneClip({
  sceneIndex,
  file,
  durationFrames,
  playbackRate = 1.0,
  zoomProfile,
  caption,
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sceneMeta = metadata?.scenes?.[sceneIndex] || { events: [] };

  // Map Remotion frame to video timestamp accounting for playbackRate
  const effectiveFrame = frame * playbackRate;
  const { scale, tx, ty, cursorX, cursorY } = useSceneCamera(
    sceneMeta,
    effectiveFrame,
    fps,
    zoomProfile
  );

  // Smooth fade/scale envelope at scene boundaries
  const fadeIn = interpolate(frame, [0, 16], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(
    frame,
    [durationFrames - 18, durationFrames],
    [1, 0],
    { extrapolateLeft: 'clamp' }
  );
  const opacity = Math.min(fadeIn, fadeOut);

  // Subtle 3D tilt reacting to cursor position for mysterious depth
  const rotateY = ((cursorX - VIEWPORT_W / 2) / VIEWPORT_W) * 2.4;
  const rotateX = -((cursorY - VIEWPORT_H / 2) / VIEWPORT_H) * 1.8;

  return (
    <AbsoluteFill
      style={{
        opacity,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        perspective: 1800,
      }}
    >
      {/* Ambient dynamic glow tracking active cursor coordinate */}
      <div
        style={{
          position: 'absolute',
          width: 850,
          height: 850,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(47, 107, 255, 0.22) 0%, rgba(91, 141, 239, 0.06) 45%, transparent 70%)',
          transform: `translate3d(${(cursorX - 720) * 0.45}px, ${(cursorY - 450) * 0.45}px, 0)`,
          filter: 'blur(40px)',
          pointerEvents: 'none',
        }}
      />

      {/* Camera rig wrapper */}
      <div
        style={{
          width: 1504,
          height: 940,
          transform: `scale(${scale}) translate3d(${tx}px, ${ty}px, 0) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
          transformOrigin: 'center center',
          borderRadius: 18,
          background: '#0b0d12',
          border: '1px solid rgba(148, 163, 184, 0.18)',
          boxShadow:
            '0 40px 110px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(91, 141, 239, 0.22), 0 0 70px rgba(47, 107, 255, 0.18)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Sleek Window Chrome Header */}
        <div
          style={{
            height: 36,
            background: 'linear-gradient(90deg, #0e1118 0%, #131824 50%, #0e1118 100%)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: 99, background: '#334155' }} />
          <span style={{ width: 10, height: 10, borderRadius: 99, background: '#334155' }} />
          <span style={{ width: 10, height: 10, borderRadius: 99, background: '#5b8def', boxShadow: '0 0 8px #5b8def' }} />
          <div
            style={{
              marginLeft: 'auto',
              marginRight: 'auto',
              fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
              fontSize: 11,
              letterSpacing: '0.08em',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 99, background: '#4ade80' }} />
            <span>satori.tcs.uj.edu.pl // v2.0</span>
          </div>
        </div>

        {/* High-DPI Recorded Video Canvas */}
        <div style={{ position: 'relative', width: '100%', flex: 1, overflow: 'hidden', background: '#0b0d12' }}>
          <OffthreadVideo
            src={staticFile(file)}
            playbackRate={playbackRate}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
          {/* Subtle top/bottom vignette inside frame */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              boxShadow: 'inset 0 0 50px rgba(5, 7, 11, 0.45)',
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>

      {/* Kinetic Typography Lower-Third */}
      <KineticLowerThird
        indexLabel={caption.indexLabel}
        eyebrow={caption.eyebrow}
        title={caption.title}
        subtitle={caption.subtitle}
        localFrame={frame}
        durationFrames={durationFrames}
        fps={fps}
      />
    </AbsoluteFill>
  );
}

function MysteriousOutro({ localFrame, fps }) {
  const enter = spring({
    frame: localFrame,
    fps,
    config: { damping: 16, stiffness: 90 },
  });
  const scale = interpolate(enter, [0, 1], [0.92, 1.0]);
  const opacity = interpolate(localFrame, [0, 14], [0, 1], { extrapolateRight: 'clamp' });

  const ASCII_WATER = '░▒▓█ STILL WATER HOLDS THE SHAPE OF EVERY THOUGHT · SUBMIT CODE WATCH THE VERDICT LAND █▓▒░';

  return (
    <AbsoluteFill
      style={{
        opacity,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(ellipse 75% 65% at 50% 50%, rgba(20, 34, 68, 0.45) 0%, rgba(6, 8, 13, 0.98) 75%)',
      }}
    >
      <div
        style={{
          fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
          fontSize: 12,
          letterSpacing: '0.26em',
          color: '#4d86ff',
          marginBottom: 18,
          textShadow: '0 0 16px rgba(77, 134, 255, 0.65)',
          transform: `scale(${scale})`,
        }}
      >
        {ASCII_WATER.slice(0, 44)}
      </div>
      <div
        style={{
          fontFamily: '"Inter", system-ui, sans-serif',
          fontSize: 82,
          fontWeight: 800,
          letterSpacing: '-0.035em',
          color: '#f8fafc',
          transform: `scale(${scale})`,
          display: 'flex',
          alignItems: 'baseline',
          gap: 18,
          textShadow: '0 12px 45px rgba(0, 0, 0, 0.8)',
        }}
      >
        <span>Satori</span>
        <span
          style={{
            color: '#5b8def',
            fontWeight: 600,
            textShadow: '0 0 32px rgba(91, 141, 239, 0.65)',
          }}
        >
          V2
        </span>
      </div>
      <div
        style={{
          marginTop: 14,
          fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
          fontSize: 15,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: '#94a3b8',
        }}
      >
        ONE API · LIVE SSE VERDICTS · KOLEJKA NATIVE
      </div>
    </AbsoluteFill>
  );
}

export const SneakPeekVideo = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#05070b',
        backgroundImage: `
          radial-gradient(circle at 18% 22%, rgba(37, 99, 235, 0.16) 0%, transparent 48%),
          radial-gradient(circle at 82% 78%, rgba(77, 134, 255, 0.12) 0%, transparent 52%),
          linear-gradient(180deg, #05070b 0%, #090d16 50%, #05070b 100%)
        `,
        overflow: 'hidden',
      }}
    >
      {/* Subtle architectural monospace grid overlay in background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(148, 163, 184, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.03) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          transform: `translateY(${(frame * 0.25) % 48}px)`,
        }}
      />

      {/* SCENE 1: 0.0s -> 4.8s (288 frames) — Wave Hero & Command Switch */}
      <Sequence from={0} durationInFrames={295}>
        <SceneClip
          sceneIndex={0}
          file="clip-1.webm"
          durationFrames={295}
          playbackRate={1.15}
          zoomProfile={[
            { inFrame: 8, outFrame: 145, zoom: 1.22, follow: 0.55 },
            { inFrame: 155, outFrame: 285, zoom: 1.38, follow: 0.75, targetX: 720, targetY: 260 },
          ]}
          caption={{
            indexLabel: '01 // AWAKENING',
            eyebrow: 'INTERACTIVE FLUID TYPOGRAPHY · ⌘K PALETTE',
            title: 'Still Water Holds the Shape of Every Thought',
            subtitle: 'Reactive ASCII wave physics meets instant, keyboard-first contest switching.',
          }}
        />
      </Sequence>

      {/* SCENE 2: 4.7s -> 9.7s (300 frames) — Problem Cockpit & Code Dispatch */}
      <Sequence from={282} durationInFrames={305}>
        <SceneClip
          sceneIndex={1}
          file="clip-2.webm"
          durationFrames={305}
          playbackRate={1.25}
          zoomProfile={[
            { inFrame: 10, outFrame: 110, zoom: 1.24, follow: 0.65 },
            { inFrame: 115, outFrame: 295, zoom: 1.36, follow: 0.7, targetX: 720, targetY: 430 },
          ]}
          caption={{
            indexLabel: '02 // THE COCKPIT',
            eyebrow: 'HIGH-DENSITY PROBLEM MATRIX · CODEMIRROR 6',
            title: 'Zero-Friction Code Dispatch',
            subtitle: 'Filter by verdict, inspect telemetry, and submit C++20 solutions in one stroke.',
          }}
        />
      </Sequence>

      {/* SCENE 3: 9.55s -> 13.9s (265 frames) — Sub-Second Live SSE Verdict */}
      <Sequence from={574} durationInFrames={266}>
        <SceneClip
          sceneIndex={2}
          file="clip-3.webm"
          durationFrames={266}
          playbackRate={1.08}
          zoomProfile={[
            { inFrame: 6, outFrame: 145, zoom: 1.42, follow: 0.78, targetX: 500, targetY: 225 },
            { inFrame: 150, outFrame: 255, zoom: 1.24, follow: 0.6, targetX: 520, targetY: 460 },
          ]}
          caption={{
            indexLabel: '03 // LIVE TELEMETRY',
            eyebrow: 'REAL-TIME SSE STREAM · KOLEJKA JUDGE',
            title: 'Queued → Compiling → Testing → Accepted',
            subtitle: 'Every testcase streamed live in under two seconds. No manual refresh.',
          }}
        />
      </Sequence>

      {/* OUTRO LOCKUP: 13.8s -> 15.0s (72 frames) */}
      <Sequence from={828} durationInFrames={72}>
        <MysteriousOutro localFrame={frame - 828} fps={60} />
      </Sequence>
    </AbsoluteFill>
  );
};
