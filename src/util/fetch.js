export async function discardResponseBody(response) {
  if (!response?.body || response.bodyUsed) return;

  try {
    if (typeof response.body.getReader === "function") {
      const reader = response.body.getReader();

      try {
        while (!(await reader.read()).done) {
          // Drain without retaining response chunks in memory.
        }
      } finally {
        reader.releaseLock?.();
      }

      return;
    }

    if (typeof response.arrayBuffer === "function") {
      await response.arrayBuffer();
      return;
    }
  } catch {
    // Fall through to cancellation when draining fails.
  }

  try {
    await response.body.cancel?.();
  } catch {
    // Best effort only; the caller is already on an error or ignored-body path.
  }
}
