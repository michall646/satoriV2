import React from 'react';
import { Composition } from 'remotion';
import { SneakPeekVideo } from './SneakPeekVideo.jsx';

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="SneakPeek"
        component={SneakPeekVideo}
        durationInFrames={900}
        fps={60}
        width={1920}
        height={1080}
      />
    </>
  );
};
