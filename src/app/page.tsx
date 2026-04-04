'use client';

import { useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';

const VoxelScene = dynamic(() => import('@/components/VoxelScene'), { ssr: false });

export default function Home() {
  const [count, setCount] = useState(1);
  const [arcsOn, setArcsOn] = useState(false);
  const [timelapseOn, setTimelapseOn] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleHire = useCallback(() => {
    setCount(c => c + 1);
  }, []);

  return (
    <div ref={wrapperRef} className="flex h-screen w-screen" style={{ background: '#D3BCAE' }}>
      <div
        className="flex flex-col items-center justify-center gap-8 shrink-0"
        style={{ width: 340 }}
      >
        <div className="text-7xl font-extrabold text-neutral-800">{count}</div>
        <div className="text-xs font-semibold uppercase tracking-[3px] text-neutral-600 -mt-4">
          employees
        </div>
        <button
          onClick={handleHire}
          className="w-52 h-52 rounded-full border-none text-white text-4xl font-extrabold tracking-wide cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95"
          style={{
            background: 'linear-gradient(145deg, #2ecc71, #27ae60)',
            boxShadow: '0 8px 30px rgba(46, 204, 113, 0.35)',
          }}
        >
          HIRE
        </button>
        <div className="flex gap-2.5 mt-4">
          <ToggleBtn active={arcsOn} onClick={() => setArcsOn(!arcsOn)}>Arcs</ToggleBtn>
          <ToggleBtn active={timelapseOn} onClick={() => setTimelapseOn(!timelapseOn)}>Timelapse</ToggleBtn>
        </div>
      </div>

      <div className="flex-1 relative">
        <VoxelScene officeCount={count} arcsOn={arcsOn} timelapseOn={timelapseOn} bgSyncRef={wrapperRef} />
      </div>
    </div>
  );
}

function ToggleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-md text-xs font-semibold cursor-pointer transition-all duration-150 border ${
        active
          ? 'bg-neutral-700 text-amber-300 border-neutral-600'
          : 'bg-neutral-800/30 text-neutral-600 border-neutral-700/50 hover:text-neutral-800 hover:border-neutral-500'
      }`}
    >
      {children}
    </button>
  );
}
