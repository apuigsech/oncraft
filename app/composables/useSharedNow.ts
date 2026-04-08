const _sharedNow = ref(Date.now());
let _subscribers = 0;
let _timer: ReturnType<typeof setInterval> | null = null;

function ensureTimer() {
  if (_timer) return;
  _timer = setInterval(() => {
    _sharedNow.value = Date.now();
  }, 1000);
}

function releaseTimer() {
  if (_subscribers > 0 || !_timer) return;
  clearInterval(_timer);
  _timer = null;
}

export function useSharedNow() {
  _subscribers += 1;
  ensureTimer();

  onUnmounted(() => {
    _subscribers = Math.max(0, _subscribers - 1);
    releaseTimer();
  });

  return _sharedNow;
}

