'use client';

import { useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';

const VoxelScene = dynamic(() => import('@/components/VoxelScene'), { ssr: false });

export default function Home() {
  const [count, setCount] = useState(1);
  const [arcsOn] = useState(true);
  const [timelapseOn] = useState(true);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleHire = useCallback(() => {
    setCount(c => c + 1);
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="flex h-screen w-screen"
      style={{ background: '#D3BCAE' }}
    >
      <div
        className="flex flex-col justify-center gap-8 shrink-0"
        style={{ width: 'clamp(360px, 38vw, 620px)' }}
      >
        <div
          style={{
            padding: 'clamp(24px, 4vw, 48px) clamp(24px, 6vw, 72px)',
            boxSizing: 'border-box',
          }}
        >
          <div className="max-w-md">
            <div className="text-sm font-semibold uppercase tracking-[4px] text-neutral-600 [font-family:var(--font-geist-sans)]">
              Brainbase
            </div>
            <h1 className="mt-4 text-6xl font-extrabold leading-[0.95] text-neutral-900 [font-family:var(--font-geist-pixel-line)]">
              Brainbase is your AI workforce
            </h1>
            <p className="mt-5 max-w-sm text-base leading-6 text-neutral-700 [font-family:var(--font-geist-sans)]">
              Hire intelligent teammates instantly and watch your office grow in real time.
            </p>
          </div>

          <button
            onClick={handleHire}
            className="mt-8 w-52 h-52 rounded-full border-none text-white text-4xl font-extrabold tracking-wide cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95 [font-family:var(--font-geist-sans)]"
            style={{
              background: 'linear-gradient(145deg, #2ecc71, #27ae60)',
              boxShadow: '0 8px 30px rgba(46, 204, 113, 0.35)',
            }}
          >
            HIRE
          </button>
        </div>
      </div>

      <div className="flex-1 min-w-0 relative">
        <VoxelScene officeCount={count} arcsOn={arcsOn} timelapseOn={timelapseOn} bgSyncRef={wrapperRef} />
      </div>
    </div>
  );
}
