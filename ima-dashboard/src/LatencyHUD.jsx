import React, { useEffect, useRef, useState } from 'react';

const COUNT_UP_MS = 700;

// Animates a number counting up to `target` whenever it changes, via
// requestAnimationFrame rather than a CSS transition - keeps the exact
// decimal formatting under our control (see formatMs) for every intermediate
// frame, not just the final value.
function useCountUp(target) {
  const [value, setValue] = useState(target);
  const frameRef = useRef(null);
  const prevTargetRef = useRef(target);

  useEffect(() => {
    if (typeof target !== 'number' || Number.isNaN(target)) return undefined;
    if (prevTargetRef.current === target) return undefined;
    prevTargetRef.current = target;

    const start = performance.now();

    function tick(now) {
      const progress = Math.min((now - start) / COUNT_UP_MS, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      setValue(target * eased);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        setValue(target);
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target]);

  return value;
}

function formatMs(ms) {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return '--';
  if (ms < 10) return ms.toFixed(2);
  if (ms < 100) return ms.toFixed(1);
  return Math.round(ms).toLocaleString();
}

// The proof itself: one unmissable headline number (total retrieval time,
// counting up from a real measured value - never hardcoded), the hop-by-hop
// trace underneath it, and the LLM/end-to-end time kept small and secondary
// since retrieval speed is the thing being demonstrated.
export function LatencyHUD({ retrievals = [], totalRetrievalMs = 0, totalLlmMs = 0, totalMs = 0, label, accent = '#E60033' }) {
  const animatedMs = useCountUp(totalRetrievalMs);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-center justify-between mb-4">
        {label && (
          <span
            className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full border"
            style={{ color: accent, borderColor: `${accent}55`, backgroundColor: `${accent}1a` }}
          >
            {label}
          </span>
        )}
        <span className="text-[10px] font-mono uppercase tracking-widest text-white/30 ml-auto">
          {retrievals.length} hop{retrievals.length === 1 ? '' : 's'}
        </span>
      </div>

      <div
        className="font-mono font-bold leading-none tracking-tight text-4xl md:text-5xl"
        style={{ color: accent, textShadow: `0 0 30px ${accent}55` }}
      >
        retrieval: {formatMs(animatedMs)}
        <span className="text-lg md:text-xl font-medium ml-1.5">ms</span>
      </div>

      <p className="text-[11px] font-mono text-white/30 mt-2 mb-4">
        llm {formatMs(totalLlmMs)} ms &middot; end-to-end {formatMs(totalMs)} ms
      </p>

      {retrievals.length > 0 && (
        <div className="space-y-1.5 border-t border-white/10 pt-3">
          {retrievals.map((r) => (
            <div key={r.hop} className="flex items-center gap-2 text-[11px] font-mono">
              <span className="w-5 shrink-0 text-white/25">#{r.hop}</span>
              <span className="flex-1 truncate text-white/50" title={r.query}>{r.query}</span>
              <span className="shrink-0 text-white/60">{formatMs(r.retrievalMs)} ms</span>
              <span className="shrink-0 w-14 text-right text-white/30">{r.hitCount} hit{r.hitCount === 1 ? '' : 's'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default LatencyHUD;
