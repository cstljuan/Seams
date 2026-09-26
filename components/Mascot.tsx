'use client';

import * as React from 'react';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export type MascotHandle = { play: (name: string) => void };

const Mascot = forwardRef<MascotHandle>(function Mascot(_props, forwardedRef) {
  const elementRef = useRef<HTMLElement | null>(null);

  useImperativeHandle(forwardedRef, () => ({
    play(name: string) {
      const mascot = elementRef.current as (HTMLElement & { play?: (action: string) => void }) | null;
      mascot?.play?.(name);
    },
  }), []);

  useEffect(() => {
    // Load the browser-only web component after mount so it is never evaluated during SSR.
    const modulePath = '/brand/arc-mascot.js';
    void import(/* webpackIgnore: true */ modulePath);
  }, []);

  return React.createElement('arc-mascot', {
    ref: elementRef,
    size: '96',
    color: 'var(--text)',
    state: 'idle',
    'aria-label': 'Arc, the Seams mascot',
  });
});

export default Mascot;
