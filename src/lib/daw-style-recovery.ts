const READY_PROPERTY = "--songzu-global-styles-ready";
const MAX_ATTEMPTS = 2;

function completeSheet(link: HTMLLinkElement) {
  try {
    return Array.from(link.sheet?.cssRules ?? []).some((rule) =>
      rule instanceof CSSStyleRule && rule.style.getPropertyValue(READY_PROPERTY).trim() === "1"
    );
  } catch {
    return false;
  }
}

function sourceStylesheet() {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
    .find((link) => !link.dataset.dawStyleRecovery && new URL(link.href).origin === location.origin) ?? null;
}

// Recover CSS alone: never reload the document or discard unsaved recording/DSP state.
export function installDawStyleRecovery() {
  let attempts = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout>;
  let timeout: ReturnType<typeof setTimeout>;
  let pending = false;
  let recovered = document.querySelector<HTMLLinkElement>('link[data-daw-style-recovery="true"]');
  let original = sourceStylesheet();

  const ready = () => getComputedStyle(document.documentElement).getPropertyValue(READY_PROPERTY).trim() === "1";
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(check, 500);
  };
  const check = () => {
    if (disposed) return;
    // HMR may replace the link node itself, not just update its href.
    original = sourceStylesheet();
    // A later successful HMR update takes precedence over the temporary recovery sheet.
    if (recovered && original && completeSheet(original)) {
      clearTimeout(timeout);
      pending = false;
      recovered.remove();
      recovered = null;
    }
    if (ready() || pending || attempts >= MAX_ATTEMPTS) return;
    if (!original) return;
    attempts += 1;
    pending = true;
    const candidate = original.cloneNode(false) as HTMLLinkElement;
    const url = new URL(original.href);
    url.searchParams.set("dawStyleRecovery", `${Date.now()}-${attempts}`);
    candidate.href = url.href;
    candidate.removeAttribute("data-precedence");
    candidate.dataset.dawStyleRecovery = "true";
    candidate.media = "not all";
    const fail = () => {
      if (!pending) return;
      clearTimeout(timeout);
      pending = false;
      candidate.remove();
      if (recovered === candidate) recovered = null;
      schedule();
    };
    candidate.onerror = fail;
    candidate.onload = () => {
      if (disposed || !pending) return;
      if (!completeSheet(candidate)) { fail(); return; }
      clearTimeout(timeout);
      pending = false;
      candidate.media = original?.media || "all";
    };
    recovered = candidate;
    original.after(candidate);
    timeout = setTimeout(fail, 8000);
  };
  const observer = new MutationObserver(schedule);
  const loaded = (event: Event) => {
    if (event.target instanceof HTMLLinkElement && event.target.rel === "stylesheet") schedule();
  };
  observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "media", "disabled"] });
  document.addEventListener("load", loaded, true);
  window.addEventListener("focus", schedule);
  window.addEventListener("online", schedule);
  schedule();
  return () => {
    disposed = true;
    clearTimeout(timer);
    clearTimeout(timeout);
    observer.disconnect();
    document.removeEventListener("load", loaded, true);
    window.removeEventListener("focus", schedule);
    window.removeEventListener("online", schedule);
    // The repaired global sheet is still needed when navigating out of the DAW.
    if (pending) recovered?.remove();
  };
}
