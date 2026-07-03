export async function cancelResponseBody(response) {
  if (!response?.body || response.bodyUsed) return;

  try {
    await response.body.cancel();
  } catch {
    // Best effort only; the caller is already on an error or ignored-body path.
  }
}
