<script lang="ts">
  // Line icons from the design. They are decorative; the text next to them carries the meaning.
  const PATHS = {
    back: "M15 5l-7 7 7 7",
    up: "M6 15l6-6 6 6",
    down: "M6 9l6 6 6-6",
    left: "M15 6l-9 6 9 6",
    right: "M9 6l9 6-9 6",
    check: "M5 12.5l4.5 4.5L19 7.5",
    device: "M9 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2",
    cloud: "M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.1 4.5 4.5 0 0 0 7 18zM9.5 13.5l2 2 3.5-3.5",
    sync: "M20 11a8 8 0 0 0-14.3-4.9M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9M20 20v-4h-4",
    offline: "M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4.2-2.6M14.8 10.3A10 10 0 0 1 19 12.9M2 8.8a15 15 0 0 1 4.3-2.5M10.6 5.1A15 15 0 0 1 22 8.8M12 20h.01",
    alert: "M12 3l9.5 17h-19L12 3zM12 10v4M12 17h.01",
    info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
    lock: "M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
    bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
    star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z",
    update: "M12 3v12M7 10l5 5 5-5M5 20h14",
    empty: "M4 7h16M4 12h10M4 17h7"
  } as const;
  let { name, size = 18 }: { name: keyof typeof PATHS; size?: number } = $props();
</script>

<svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d={PATHS[name]} /></svg>
