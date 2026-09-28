// A choice saved in the browser that any component can read and change.
// Read it with useSyncExternalStore(choice.subscribe, choice.get, () => null).
export function savedChoice(key: string, isValid: (value: string) => boolean) {
  // Used when storage is blocked, so the choice still holds for this visit.
  let memory: string | null = null;
  const listeners = new Set<() => void>();

  return {
    get(): string | null {
      try {
        const value = localStorage.getItem(key);
        return value && isValid(value) ? value : null;
      } catch {
        return memory;
      }
    },
    set(value: string | null) {
      memory = value;
      try {
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
      } catch {
        // Private mode or storage off: `memory` keeps it for this visit.
      }
      listeners.forEach((fn) => fn());
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
