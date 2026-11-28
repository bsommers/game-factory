// Tiny synchronous event bus. The sim emits ('hit' | 'win' | 'lose' | ...); UI/audio/tools subscribe. Never import DOM here.
export function createBus() {
  const subs = new Map();
  return {
    on(type, fn) { (subs.get(type) ?? subs.set(type, new Set()).get(type)).add(fn); return () => subs.get(type)?.delete(fn); },
    off(type, fn) { subs.get(type)?.delete(fn); },
    emit(type, payload) { for (const fn of [...(subs.get(type) ?? [])]) fn(payload); },
  };
}
