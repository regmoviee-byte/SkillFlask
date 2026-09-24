import type { CSSProperties, ReactNode } from 'react';
import { copy } from '../copy';
import { useDelayedFlag } from '../hooks/useDelayedFlag';

export type SkeletonLayout = 'home' | 'skill' | 'today' | 'achievements' | 'form';

interface SkeletonProps {
  layout: SkeletonLayout;
  /** True while the data is still undefined. */
  loading: boolean;
  /** Rendered once the data is ready (and the skeleton, if shown, stayed ≥ 300 ms). */
  children?: ReactNode;
}

function Block({ h, w, r }: { h: number; w?: string | number; r?: number }) {
  const style: CSSProperties = { height: h, width: w ?? '100%', borderRadius: r };
  return <div className="skeleton-block anim-decor" style={style} />;
}

function Line({ w }: { w: string }) {
  return <Block h={14} w={w} r={6} />;
}

function Row() {
  return (
    <div className="skeleton-row">
      <Block h={40} w={40} r={12} />
      <div className="skeleton" style={{ flex: 1, gap: 8 }}>
        <Line w="60%" />
        <Line w="40%" />
      </div>
    </div>
  );
}

const layouts: Record<SkeletonLayout, ReactNode> = {
  home: (
    <>
      <Block h={96} />
      <Row />
      <Row />
      <Row />
    </>
  ),
  // The hero (flask and its numbers), the milestone rack, two actions.
  skill: (
    <>
      <div className="skeleton-row">
        <Block h={228} w={140} r={28} />
        <div className="skeleton" style={{ flex: 1, gap: 10 }}>
          <Line w="40%" />
          <Block h={56} w={64} r={12} />
          <Line w="70%" />
          <Line w="55%" />
        </div>
      </div>
      <Block h={96} />
      <Row />
      <Row />
    </>
  ),
  today: (
    <>
      <Block h={64} />
      <Row />
      <Row />
      <Row />
      <Row />
    </>
  ),
  achievements: (
    <>
      <Block h={120} />
      <div className="skeleton-row">
        <Block h={120} />
        <Block h={120} />
      </div>
      <div className="skeleton-row">
        <Block h={120} />
        <Block h={120} />
      </div>
    </>
  ),
  form: (
    <>
      <Block h={46} r={12} />
      <Block h={46} r={12} />
      <div className="skeleton-row">
        <Block h={46} r={12} />
        <Block h={46} r={12} />
      </div>
      <Block h={46} r={12} />
    </>
  ),
};

/**
 * Loading placeholder that appears only when data is still missing after 150 ms and, once
 * shown, stays for at least 300 ms so it never flickers.
 */
export function Skeleton({ layout, loading, children }: SkeletonProps) {
  const visible = useDelayedFlag(loading);
  if (visible) {
    return (
      <div className="skeleton" role="status" aria-busy="true" aria-label={copy.common.loading}>
        {layouts[layout]}
      </div>
    );
  }
  if (loading) return <div aria-busy="true" />;
  return <>{children}</>;
}
