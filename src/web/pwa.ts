import { writable } from "svelte/store";
import { registerSW } from "virtual:pwa-register";

// A new app version waits until the player chooses to update, so a game is never
// reloaded mid-move. Local games and the outbox live in IndexedDB and survive the reload.
export const updateReady = writable(false);

const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh() { updateReady.set(true); }
});

export function applyUpdate(): Promise<void> {
  return updateServiceWorker(true);
}
