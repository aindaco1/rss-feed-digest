import { readBoundedText } from "@dustwave/worker-core/response-body";

export const remainingMs = (deadline = Infinity) => Math.max(0, deadline - Date.now());

export function requestTimeout(timeoutMs, deadline) {
  const remaining = Math.min(timeoutMs, remainingMs(deadline));
  if (remaining <= 0) throw new Error("Stage deadline exceeded");
  return remaining;
}

// The timeout covers headers AND the body. A headers-only timeout leaves slow
// bodies holding the entire digest open indefinitely.
export async function fetchText(url, init = {}, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeout(options.timeoutMs ?? 15_000, options.deadline));
  try {
    const response = await (options.fetchImpl || fetch)(url, {
      ...init,
      signal: init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal
    });
    const text = await readBoundedText(response, options.maxBytes ?? 5_000_000);
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

export const retryableStatus = status => [403, 408, 425, 429].includes(status) || (status >= 500 && status <= 599);

export async function pause(ms, deadline) {
  if (ms <= 0) return;
  const delay = requestTimeout(ms, deadline);
  await new Promise(resolve => setTimeout(resolve, delay));
}
