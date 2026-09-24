import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, View, type ViewStyle } from 'react-native';
import { durationFor, enterOffset, staggerDelay } from '../lib/motion';

/**
 * The app's movement (U4).
 *
 * Built on React Native's own `Animated` rather than react-native-reanimated.
 * Reanimated is the better tool for gesture-driven work at 120fps, but it is
 * a native dependency on a live app, and everything here is a fade and a few
 * points of travel that `Animated` already does on the UI thread with
 * `useNativeDriver`. The app's toasts, sheets and skeletons are all built
 * this way already and behave.
 *
 * Every component here degrades to "no movement, correct final state" when
 * the phone asks for reduced motion.
 */

/**
 * Whether this phone has "Reduce motion" switched on.
 *
 * Read once and then watched, because it can be toggled while the app is
 * open. Defaults to false if the platform will not say - motion is the
 * ordinary case, and a failed query should not disable the whole app's feel.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let alive = true;
    // Every call here is defended, and not out of superstition. An effect
    // that throws makes React skip the component's REMAINING effects - and
    // the next one along is the one that starts the animation, which would
    // leave the content parked at opacity 0 forever. Found exactly that way:
    // on web the listener API is not the same shape, and twelve detail
    // screens rendered invisible.
    try {
      const query = AccessibilityInfo.isReduceMotionEnabled?.();
      if (query && typeof query.then === 'function') {
        query
          .then((on) => {
            if (alive) setReduce(Boolean(on));
          })
          .catch(() => undefined);
      }
    } catch {
      // Leave it at false: motion is the ordinary case.
    }

    let sub: { remove?: () => void } | undefined;
    try {
      sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduce);
    } catch {
      sub = undefined;
    }
    return () => {
      alive = false;
      try {
        sub?.remove?.();
      } catch {
        // Nothing to undo.
      }
    };
  }, []);

  return reduce;
}

/**
 * Content settling into place: a short fade with a few points of rise.
 *
 * Used where a screen swaps its skeleton for the real thing, which was a hard
 * cut. `index` staggers the first few children of a list.
 */
export function FadeIn({
  children,
  index = 0,
  style,
}: {
  children: ReactNode;
  index?: number;
  style?: ViewStyle;
}) {
  const reduce = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const duration = durationFor('enter', reduce);
    if (duration === 0) {
      anim.setValue(1);
      return;
    }
    const delay = staggerDelay(index, reduce);
    const run = Animated.timing(anim, { toValue: 1, duration, delay, useNativeDriver: true });
    run.start();

    // The content is visible at the end whatever happens to the animation.
    // An animation that never starts, or is interrupted before it finishes,
    // must not be able to leave a screen blank - the failure mode of a fade
    // is invisible content, which is far worse than no fade at all.
    const safety = setTimeout(() => anim.setValue(1), delay + duration + 400);
    return () => {
      clearTimeout(safety);
      run.stop();
    };
  }, [anim, index, reduce]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [enterOffset(reduce), 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * A row that leaves when it is done with (U4).
 *
 * The case this exists for: you approve a request in "Awaiting me" and the
 * row is simply gone on the next frame, with nothing connecting your tap to
 * the list changing. Now it collapses and fades, then tells the screen it has
 * finished so the row can actually be dropped from the data.
 *
 * `gone` is the trigger rather than unmounting the row, because a component
 * cannot animate its own removal: by the time React unmounts it, it is
 * already off the screen.
 */
export function LeaveOnDone({
  gone,
  onGone,
  children,
}: {
  gone: boolean;
  onGone?: () => void;
  children: ReactNode;
}) {
  const reduce = useReduceMotion();
  const anim = useRef(new Animated.Value(1)).current;
  const [height, setHeight] = useState<number | null>(null);

  // Held in a ref, not read as a dependency: a parent that re-creates this
  // callback on every render would otherwise restart the exit forever, and
  // the row would never actually leave.
  const done = useRef(onGone);
  done.current = onGone;

  useEffect(() => {
    if (!gone) return;
    const duration = durationFor('exit', reduce);
    if (duration === 0) {
      done.current?.();
      return;
    }
    let called = false;
    const finish = () => {
      if (called) return;
      called = true;
      done.current?.();
    };

    const run = Animated.timing(anim, { toValue: 0, duration, useNativeDriver: false });
    run.start(({ finished }) => {
      if (finished) finish();
    });

    // `onGone` is what actually removes the row, so it must happen even if
    // the animation is interrupted, never starts, or the callback is dropped.
    // The failure this prevents is worse than a missing animation: a row you
    // confirmed sitting there as though nothing happened.
    const safety = setTimeout(finish, duration + 400);
    return () => {
      clearTimeout(safety);
      run.stop();
    };
  }, [gone, anim, reduce]);

  return (
    <Animated.View
      onLayout={(e) => {
        // Measured once, while it is still at full size, so the collapse has
        // somewhere to travel to.
        if (height === null) setHeight(e.nativeEvent.layout.height);
      }}
      style={{
        opacity: anim,
        // Height is not native-driver-able, which is why this one animation
        // runs on the JS thread. It is 180ms on a single row.
        ...(gone && height !== null
          ? { height: anim.interpolate({ inputRange: [0, 1], outputRange: [0, height] }) }
          : {}),
        overflow: 'hidden',
      }}
    >
      <View>{children}</View>
    </Animated.View>
  );
}
