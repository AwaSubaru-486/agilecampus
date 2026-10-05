export async function runConfirmedHandoff<T>(
  confirmed: boolean,
  persistOperation: () => Promise<void>,
  sendRequest: () => Promise<T>,
): Promise<{ cancelled: true } | { cancelled: false; value: T }> {
  if (!confirmed) return { cancelled: true };
  await persistOperation();
  return { cancelled: false, value: await sendRequest() };
}
