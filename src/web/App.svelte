<script lang="ts">
  import { onMount } from "svelte";
  import { authClient } from "./auth.js";
  import { local, recordMove, saveGame, saveCampaign, eraseLocal, offlineSignOut, pendingServerLogout, clearPendingServerLogout, approveDownloadedGame, reconcileDownloadedGames, removeDownloadedGame, usableOffline, type DownloadedCampaign, type PuzzleVersions, type StoredCampaign, type StoredGame, type StoredIdentity } from "./storage.js";
  import { CATEGORIES, LEVELS, availableLevels, campaignLevels, type CategoryId, type LevelId } from "../shared/words.js";
  import { cellsBetween, findWord, HINT_LIMIT, hintsRemaining, visibleHint, wordAt, type Move, type Point, type Puzzle } from "../shared/game.js";
  import { snapDragEnd } from "./drag.js";
  import { newMoveId } from "./ids.js";
  import type { Achievement } from "../shared/achievements.js";

  type Identity = Omit<StoredIdentity, "key">;
  type ServerIdentity = Identity & { puzzleVersions: PuzzleVersions };
  let identity: Identity | null = null;
  let serverVersions: PuzzleVersions | null = null;
  let online = navigator.onLine;
  let sessionExpired = false;
  let loading = true;
  let busy = false;
  let message = "";
  let selectionFeedback = "";
  let username = "";
  let password = "";
  let category: CategoryId = "dyr";
  let level: LevelId = "let";
  let games: StoredGame[] = [];
  let campaigns: StoredCampaign[] = [];
  let campaignLevel: LevelId = "let";
  let active: StoredGame | null = null;
  let pending = 0;
  let dragStart: Point | null = null;
  let dragEnd: Point | null = null;
  let dragPointerId: number | null = null;
  let dragOrigin: { x: number; y: number } | null = null;
  let dragHasMoved = false;
  let selectedStart: Point | null = null;
  let rejectedStart: Point | null = null;
  let rejectedEnd: Point | null = null;
  let rejectionTimer: ReturnType<typeof setTimeout> | null = null;
  let accounts: Array<{ id: string; name: string; username: string; child: number }> = [];
  let newUser = "";
  let newName = "";
  let newPassword = "";
  let newChild = false;
  let showAccounts = false;
  let achievements: Achievement[] = [];
  let showAchievements = false;
  let syncing = false;
  let syncTask: Promise<void> | null = null;
  let syncAgain = false;
  let shellReady = false;
  let hintSaving = false;

  $: available = availableLevels(category);
  $: if (!available.includes(level)) level = available[0] ?? "let";
  $: previewStart = dragStart ?? rejectedStart;
  $: previewEnd = dragStart ? dragEnd : rejectedEnd;
  $: selectedCells = previewStart && previewEnd ? cellsBetween(previewStart, previewEnd) ?? [] : [];
  $: foundCells = active ? active.found.flatMap((word) => {
    const path = findWord(active!.puzzle, word);
    return path ? cellsBetween(path.start, path.end) ?? [] : [];
  }) : [];
  $: shownHint = active ? visibleHint(active.puzzle, active.found, active.hints) : null;
  $: nextCampaignGame = active?.campaignId ? games.filter((game) => game.campaignId === active?.campaignId &&
    !game.completed && (game.campaignPosition ?? 0) > (active?.campaignPosition ?? 0))
    .sort((a, b) => (a.campaignPosition ?? 0) - (b.campaignPosition ?? 0))[0] : undefined;

  async function api(path: string, init?: RequestInit) {
    const response = await fetch(`/api${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error || "Serveren kunne ikke svare."), { status: response.status, details: body });
    return body;
  }

  async function refreshLocal() {
    if (!identity) { games = []; campaigns = []; active = null; return; }
    const saved = await local.games.where("owner").equals(identity.id).reverse().sortBy("updatedAt");
    games = saved.filter((game) => usableOffline(game, identity!.child));
    campaigns = await local.campaigns.where("owner").equals(identity.id).toArray();
    pending = await local.moves.where("owner").equals(identity.id).count();
    if (active) active = games.find((game) => game.id === active?.id) ?? null;
  }

  async function reconnect() {
    online = navigator.onLine;
    if (!online) return;
    if (await pendingServerLogout()) { await finishServerLogout(); return; }
    if (!identity) return;
    await syncAll();
  }

  async function finishServerLogout(): Promise<boolean> {
    if (!await pendingServerLogout()) return true;
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message || "Serveren kunne ikke afslutte udlogningen.");
      await clearPendingServerLogout();
      return true;
    } catch {
      message = "Du er logget ud på denne enhed. Serverudlogning afventer forbindelse.";
      return false;
    }
  }

  async function reconcileDownloads() {
    if (!identity || !serverVersions) return;
    const { removed, interrupted } = await reconcileDownloadedGames(identity.id, identity.child, serverVersions,
      (id) => api(`/games/${id}`));
    if (interrupted) online = false;
    if (removed) message = removed === 1
      ? "En gemt bane er fjernet efter en ændring i kontoens regler eller indholdspolitik."
      : `${removed} gemte baner er fjernet efter en ændring i kontoens regler eller indholdspolitik.`;
  }

  async function refreshConnectedAccount(): Promise<boolean> {
    if (!identity) return false;
    try {
      const me = await api("/me") as ServerIdentity;
      if (me.id !== identity.id) {
        online = false;
        message = "En anden konto er logget ind på serveren. Log ind med den tidligere konto for at synkronisere.";
        return false;
      }
      identity = me;
      serverVersions = me.puzzleVersions;
      sessionExpired = false;
      await local.identity.put({ key: "identity", ...me });
      await reconcileDownloads();
      await refreshLocal();
      return online;
    } catch (cause) {
      online = false;
      if (cause instanceof Error && "status" in cause && cause.status === 401) {
        sessionExpired = true;
        message = "Sessionen er udløbet. Hentede baner kan fortsættes; log ind igen for at synkronisere.";
      } else message = "Serveren kunne ikke kontrollere kontoen. Hentede baner kan fortsættes offline.";
      return false;
    }
  }

  onMount(() => {
    const onOnline = () => { void reconnect(); };
    const onOffline = () => { online = false; };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.ready.then(() => { shellReady = true; }).catch(() => { shellReady = false; });
    }
    void initialize();
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  });

  async function initialize() {
    try {
      if (await pendingServerLogout()) {
        online = navigator.onLine;
        if (online) await finishServerLogout();
        else message = "Du er logget ud på denne enhed. Serverudlogning afventer forbindelse.";
        return;
      }
      const remembered = await local.identity.get("identity");
      try {
        const me = await api("/me") as ServerIdentity;
        if (remembered && remembered.id !== me.id && await local.moves.count()) {
          identity = null;
          message = `Der er usynkroniserede spil for ${remembered.name}. Log ind med den konto, før du fortsætter.`;
        } else {
          if (remembered && remembered.id !== me.id) await eraseLocal();
          identity = me;
          serverVersions = me.puzzleVersions;
          await local.identity.put({ key: "identity", ...me });
        }
        online = true;
      } catch (cause) {
        if (cause instanceof Error && "status" in cause && cause.status === 401) {
          online = remembered ? false : navigator.onLine;
          identity = remembered ?? null;
          sessionExpired = Boolean(remembered);
          if (remembered) message = "Sessionen er udløbet. Hentede baner kan fortsættes; log ind igen for at synkronisere.";
        } else {
          online = false;
          if (remembered) identity = remembered;
        }
      }
      if (identity) {
        achievements = (await local.achievements.get(identity.id))?.items ?? [];
        if (online) await syncAll();
        else await refreshLocal();
      }
    } catch (cause) { message = cause instanceof Error ? cause.message : "Lokal lagring er ikke tilgængelig."; }
    finally { loading = false; }
  }

  async function signIn() {
    busy = true; message = "";
    try {
      if (!await finishServerLogout()) throw new Error("Afslut den tidligere udlogning, før du logger ind igen.");
      const remembered = await local.identity.get("identity");
      if (remembered && remembered.username !== username && await local.moves.count()) {
        throw new Error("En anden bruger har usynkroniserede spil på enheden. Log ind med den tidligere konto og synkronisér først.");
      }
      const result = await authClient.signIn.username({ username, password });
      if (result.error) throw new Error(result.error.message || "Login mislykkedes.");
      const me = await api("/me") as ServerIdentity;
      if (remembered && remembered.id !== me.id) {
        const unsynced = await local.moves.count();
        if (unsynced) { await authClient.signOut(); throw new Error("En anden bruger har usynkroniserede spil på enheden."); }
        await eraseLocal();
      }
      identity = me;
      serverVersions = me.puzzleVersions;
      sessionExpired = false;
      await local.identity.put({ key: "identity", ...me });
      password = ""; online = true;
      achievements = (await local.achievements.get(me.id))?.items ?? [];
      await syncAll();
    } catch (cause) { message = cause instanceof Error ? cause.message : "Login mislykkedes."; }
    finally { busy = false; }
  }

  async function signOut() {
    const count = await local.moves.count();
    if (count && !confirm(`${count} ændringer er ikke synkroniseret. Log ud og slet dem fra denne enhed?`)) return;
    let serverDone = false;
    if (online) {
      try {
        const result = await authClient.signOut();
        serverDone = !result.error;
      } catch { /* Finish server logout when connectivity returns. */ }
    }
    if (serverDone) await eraseLocal();
    else await offlineSignOut();
    identity = null; serverVersions = null; sessionExpired = false; active = null; games = []; campaigns = []; pending = 0; showAccounts = false; achievements = [];
    message = serverDone ? "Du er logget ud." : "Du er logget ud på denne enhed. Serverudlogning sker ved næste forbindelse.";
  }

  function showLogin() {
    identity = null;
    active = null;
    online = navigator.onLine;
    message = "Log ind igen for at synkronisere dine gemte spil.";
  }

  async function startGame() {
    if (!identity || !online) { message = "Opret nye baner, når der er forbindelse til serveren."; return; }
    busy = true; message = "";
    try {
      if (!await refreshConnectedAccount() || !identity) return;
      const game = await api("/games", { method: "POST", body: JSON.stringify({ category, level }) });
      await saveGame(identity.id, game);
      await refreshLocal();
      active = games.find((item) => item.id === game.puzzle.id) ?? null;
      message = shellReady ? "Banen er gemt og klar offline." : "Banen er gemt. Vent på, at appen bliver klar til offlinebrug.";
    } catch (cause) { message = cause instanceof Error ? cause.message : "Banen kunne ikke hentes."; }
    finally { busy = false; }
  }

  async function storeCampaign(bundle: DownloadedCampaign) {
    if (!identity) return;
    await saveCampaign(identity.id, bundle);
    await refreshLocal();
  }

  async function startCampaignFlow() {
    if (!identity || !online) { message = "En ny kampagne kræver forbindelse til serveren."; return; }
    busy = true; message = "";
    try {
      if (!await refreshConnectedAccount() || !identity) return;
      const bundle = await api("/campaigns", { method: "POST", body: JSON.stringify({ level: campaignLevel }) }) as DownloadedCampaign;
      await storeCampaign(bundle);
      active = games.filter((game) => game.campaignId === bundle.id && !game.completed)
        .sort((a, b) => (a.campaignPosition ?? 0) - (b.campaignPosition ?? 0))[0] ?? null;
      message = active ? "Kampagnebanerne er hentet og klar offline." : "Der er ingen bane klar endnu. Prøv igen med forbindelse.";
    } catch (cause) { message = cause instanceof Error ? cause.message : "Kampagnen kunne ikke hentes."; }
    finally { busy = false; }
  }

  async function openCampaign(campaign: StoredCampaign) {
    const next = games.filter((game) => game.campaignId === campaign.id && !game.completed)
      .sort((a, b) => (a.campaignPosition ?? 0) - (b.campaignPosition ?? 0))[0];
    if (next) { await chooseGame(next); return; }
    if (!online) { message = "Alle hentede kampagnebaner er spillet. Opret forbindelse for at hente flere."; return; }
    try {
      await syncAll();
      const bundle = await api(`/campaigns/${campaign.id}/refill`, { method: "POST" }) as DownloadedCampaign;
      await storeCampaign(bundle);
      const ready = games.filter((game) => game.campaignId === campaign.id && !game.completed)
        .sort((a, b) => (a.campaignPosition ?? 0) - (b.campaignPosition ?? 0))[0];
      if (ready) active = ready;
      else message = "Nye kampagnebaner kunne ikke hentes endnu.";
    } catch (cause) { message = cause instanceof Error ? cause.message : "Kampagnen kunne ikke fortsættes."; }
  }

  async function nextInCampaign() {
    if (!active?.campaignId) return;
    if (nextCampaignGame) { await chooseGame(nextCampaignGame); return; }
    const campaign = campaigns.find((item) => item.id === active?.campaignId);
    if (campaign) await openCampaign(campaign);
  }

  async function chooseGame(game: StoredGame) {
    message = "";
    if (online) {
      if (!await refreshConnectedAccount() || !games.some((item) => item.id === game.id)) return;
      try {
        const current = await api(`/games/${game.id}`);
        await approveDownloadedGame(game.id, current.puzzle);
        game = { ...game, puzzle: current.puzzle, approvedAtDownload: true };
      }
      catch (cause) {
        if (cause instanceof Error && "status" in cause && (cause.status === 410 || cause.status === 404)) {
          await removeDownloadedGame(game.id);
          await refreshLocal();
          message = "Banen er udgået og er fjernet fra denne enhed.";
          return;
        }
        // A downloaded game remains playable when the server is unreachable.
        online = false;
      }
    }
    active = game;
  }

  async function addMove(move: Move, next: Pick<StoredGame, "found" | "hints" | "completed">): Promise<boolean> {
    if (!active) return false;
    try {
      await recordMove(active, move, next);
      await refreshLocal();
      if (online) void syncAll();
      return true;
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "";
      message = ["Hintet er ugyldigt.", "Ordet har allerede fået et hint.", "Alle hints på denne bane er brugt.", "Banen er allerede afsluttet."].includes(reason)
        ? reason : "Kunne ikke gemme trækket på enheden. Kontrollér ledig lagerplads.";
      return false;
    }
  }

  function clearRejection() {
    if (rejectionTimer) clearTimeout(rejectionTimer);
    rejectionTimer = null;
    rejectedStart = null;
    rejectedEnd = null;
  }

  function showRejection(start: Point, end: Point) {
    clearRejection();
    rejectedStart = start;
    rejectedEnd = end;
    rejectionTimer = setTimeout(clearRejection, 750);
  }

  async function markWord(start: Point, end: Point) {
    if (!active || active.completed) return;
    const word = wordAt(active.puzzle, start, end);
    if (!word || active.found.includes(word)) {
      const path = cellsBetween(start, end);
      const letters = path?.map(({ row, col }) => active!.puzzle.grid[row]?.[col] ?? "").join("") ?? "";
      selectionFeedback = word ? "Det ord er allerede fundet." : path
        ? `Markeret: ${letters}. Det er ikke et ord på listen.`
        : "Markér et ord på en lige linje.";
      message = selectionFeedback;
      if (path) showRejection(start, end);
      return;
    }
    const found = [...active.found, word];
    if (!await addMove({ id: newMoveId(), kind: "find", word, start, end }, { found, hints: active.hints, completed: false })) {
      selectionFeedback = message;
      return;
    }
    if (found.length === active.puzzle.words.length && active) {
      if (!await addMove({ id: newMoveId(), kind: "complete" }, { found, hints: active.hints, completed: true })) {
        selectionFeedback = message;
        return;
      }
      message = online ? "Alle ord fundet! Resultatet synkroniseres." : "Alle ord fundet! Resultatet gemmes på serveren, når der er forbindelse.";
    } else message = `${word} fundet!`;
    selectionFeedback = message;
  }
  function submitWord(start: Point, end: Point) {
    void markWord(start, end).catch(() => {
      selectionFeedback = "Kunne ikke registrere ordet. Prøv igen.";
      message = selectionFeedback;
    });
  }

  function cellFromPointer(event: PointerEvent): Point | null {
    const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-row][data-col]");
    if (!element) return null;
    return { row: Number(element.dataset.row), col: Number(element.dataset.col) };
  }
  function pointerInsideGrid(event: PointerEvent): boolean {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX < rect.right &&
      event.clientY >= rect.top && event.clientY < rect.bottom;
  }
  function snappedEnd(event: PointerEvent): Point | null {
    if (!dragStart || !active || !pointerInsideGrid(event)) return null;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const size = active.puzzle.grid.length;
    return snapDragEnd(dragStart, {
      row: (event.clientY - rect.top) / rect.height * size - 0.5,
      col: (event.clientX - rect.left) / rect.width * size - 0.5
    }, size, LEVELS[active.puzzle.level].directions, dragEnd);
  }
  function clearDrag() {
    dragStart = null;
    dragEnd = null;
    dragPointerId = null;
    dragOrigin = null;
    dragHasMoved = false;
  }
  function movedEnough(event: PointerEvent): boolean {
    if (!dragOrigin || !active) return false;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const cellSize = rect.width / active.puzzle.grid.length;
    const threshold = Math.min(10, Math.max(5, cellSize * 0.35));
    return Math.hypot(event.clientX - dragOrigin.x, event.clientY - dragOrigin.y) >= threshold;
  }
  function pointerDown(event: PointerEvent) {
    if (!active || active.completed || dragPointerId !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
    const start = cellFromPointer(event);
    if (!start) return;
    clearRejection();
    selectionFeedback = "";
    dragPointerId = event.pointerId;
    dragStart = start;
    dragEnd = start;
    dragOrigin = { x: event.clientX, y: event.clientY };
    dragHasMoved = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent) {
    if (event.pointerId !== dragPointerId) return;
    if (!dragHasMoved && !movedEnough(event)) return;
    dragHasMoved = true;
    dragEnd = snappedEnd(event) ?? dragEnd;
  }
  function pointerUp(event: PointerEvent) {
    if (event.pointerId !== dragPointerId || !dragStart) return;
    const start = dragStart;
    const inside = pointerInsideGrid(event);
    const wasDrag = dragHasMoved || movedEnough(event);
    const end = inside ? snappedEnd(event) : dragEnd;
    clearDrag();
    if (wasDrag) {
      selectedStart = null;
      if (end && (end.row !== start.row || end.col !== start.col)) submitWord(start, end);
      else {
        selectionFeedback = inside ? "Træk til ordets sidste bogstav, før du slipper." : "Trækket sluttede uden for gitteret. Prøv igen.";
        message = selectionFeedback;
      }
    } else {
      if (!inside) {
        selectionFeedback = "Slip inde i gitteret, eller tryk på start- og slutfelt.";
        message = selectionFeedback;
        return;
      }
      const tapped = cellFromPointer(event);
      if (tapped) {
        if (selectedStart) { const first = selectedStart; selectedStart = null; submitWord(first, tapped); }
        else selectedStart = tapped;
      }
    }
  }
  function pointerCancel() {
    const start = dragStart;
    const end = dragEnd;
    const moved = dragHasMoved;
    clearDrag();
    if (!start || !moved) return;
    selectedStart = null;
    if (active && end && wordAt(active.puzzle, start, end)) {
      submitWord(start, end);
      return;
    }
    selectionFeedback = "Trækket blev afbrudt. Prøv igen.";
    message = selectionFeedback;
  }
  function keyCell(event: KeyboardEvent, row: number, col: number) {
    if (!active || active.completed) return;
    const directions: Record<string, Point> = { ArrowUp: { row: -1, col: 0 }, ArrowDown: { row: 1, col: 0 }, ArrowLeft: { row: 0, col: -1 }, ArrowRight: { row: 0, col: 1 } };
    const step = directions[event.key];
    if (step) {
      event.preventDefault();
      const next = document.querySelector<HTMLButtonElement>(`[data-row="${Math.max(0, Math.min(active.puzzle.grid.length - 1, row + step.row))}"][data-col="${Math.max(0, Math.min(active.puzzle.grid.length - 1, col + step.col))}"]`);
      next?.focus();
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (selectedStart) { const first = selectedStart; selectedStart = null; submitWord(first, { row, col }); }
      else selectedStart = { row, col };
    }
    if (event.key === "Escape") { selectedStart = null; clearRejection(); }
  }

  async function hint() {
    if (!active || active.completed || hintSaving) return;
    if (hintsRemaining(active.puzzle.level, active.hints) === 0) {
      message = "Alle hints på denne bane er brugt.";
      return;
    }
    const word = active.puzzle.words.find((candidate) => !active?.found.includes(candidate) && !active?.hints.includes(candidate));
    if (!word) { message = "Der er ikke flere hints til denne bane."; return; }
    const location = findWord(active.puzzle, word);
    if (!location) return;
    hintSaving = true;
    try {
      if (await addMove({ id: newMoveId(), kind: "hint", word }, { found: active.found, hints: [...active.hints, word], completed: false }))
        message = `Hint til ${word}: begynd i række ${location.start.row + 1}, kolonne ${location.start.col + 1}.`;
    } finally { hintSaving = false; }
  }

  async function syncAll(): Promise<void> {
    if (syncTask) { syncAgain = true; return syncTask; }
    syncTask = (async () => {
      do { syncAgain = false; await performSync(); }
      while (syncAgain && online);
    })();
    try { await syncTask; }
    finally { syncTask = null; }
  }

  async function performSync() {
    if (!identity || !navigator.onLine || !online || syncing) return;
    syncing = true;
    try {
      if (!await refreshConnectedAccount() || !identity) return;
      for (let pass = 0; pass < 10; pass++) {
        const ids = [...new Set((await local.moves.where("owner").equals(identity.id).toArray()).map((move) => move.gameId))];
        if (!ids.length) break;
        for (const id of ids) {
          const moves = (await local.moves.where("gameId").equals(id).toArray()).sort((a, b) => a.sequence - b.sequence).slice(0, 500);
          if (!moves.length) continue;
          let result;
          try { result = await api(`/games/${id}/sync`, { method: "POST", body: JSON.stringify({ events: moves }) }); }
          catch (cause) {
            if (cause instanceof Error && "status" in cause && (cause.status === 410 || cause.status === 404)) {
              await removeDownloadedGame(id);
              message = "En udgået bane er fjernet fra denne enhed.";
              continue;
            }
            if (cause instanceof Error && "details" in cause) {
              const details = cause.details as { rejectedHintId?: string; serverGame?: { hints: string[]; revision: number } };
              if (details.rejectedHintId && details.serverGame) {
                const { rejectedHintId, serverGame } = details;
                await local.transaction("rw", local.moves, local.games, async () => {
                  await local.moves.delete(rejectedHintId);
                  const remaining = await local.moves.where("gameId").equals(id).toArray();
                  const saved = await local.games.get(id);
                  if (saved) await local.games.update(id, {
                    hints: [...new Set([...serverGame.hints, ...remaining.filter((move) => move.kind === "hint").map((move) => move.word!).filter(Boolean)])],
                    revision: serverGame.revision
                  });
                });
                message = "Et offlinehint kunne ikke godkendes, fordi banens hintgrænse blev nået på en anden enhed. Andre træk synkroniseres fortsat.";
                continue;
              }
            }
            throw cause;
          }
          await local.transaction("rw", local.moves, local.games, async () => {
            await local.moves.bulkDelete(moves.map((move) => move.id));
            if (await local.moves.where("gameId").equals(id).count() === 0) {
              await local.games.update(id, { found: result.found, hints: result.hints, completed: result.completed, revision: result.revision });
            }
          });
        }
      }
      await refreshLocal();
      online = true;
      const serverCampaigns = await api("/campaigns") as DownloadedCampaign[];
      for (const campaign of serverCampaigns) {
        const ready = games.filter((game) => game.campaignId === campaign.id && !game.completed).length;
        const bundle = ready < 3
          ? await api(`/campaigns/${campaign.id}/refill`, { method: "POST" }) as DownloadedCampaign
          : campaign;
        await storeCampaign(bundle);
      }
      try {
        const items = await api("/achievements") as Achievement[];
        achievements = items;
        await local.achievements.put({ owner: identity.id, items, updatedAt: Date.now() });
      } catch { /* Spiltræk er allerede synkroniseret; belønninger opdateres ved næste kontakt. */ }
    } catch (cause) {
      if (cause instanceof Error && "status" in cause && cause.status === 401) {
        sessionExpired = true;
        online = false;
        message = "Sessionen er udløbet. Hentede baner kan fortsættes; log ind igen for at synkronisere.";
      } else message = cause instanceof Error ? `Afventer synkronisering: ${cause.message}` : "Afventer synkronisering.";
    } finally { syncing = false; }
  }

  async function loadAccounts() {
    try { accounts = await api("/accounts"); showAccounts = true; }
    catch (cause) { message = cause instanceof Error ? cause.message : "Kunne ikke hente konti."; }
  }
  async function createAccount() {
    try {
      await api("/accounts", { method: "POST", body: JSON.stringify({ username: newUser, name: newName, password: newPassword, child: newChild }) });
      newUser = ""; newName = ""; newPassword = ""; newChild = false;
      await loadAccounts(); message = "Konto oprettet.";
    } catch (cause) { message = cause instanceof Error ? cause.message : "Kontoen kunne ikke oprettes."; }
  }
</script>

<svelte:head>
  <title>Find ord – dansk ordjagt</title>
  <meta name="description" content="Find danske ord i kategorier. Spil også offline." />
</svelte:head>

<header class="topbar">
  <div class="brand"><span class="brandmark">F<span>I</span>ND</span><small>ORDJAGT PÅ DANSK</small></div>
  {#if identity}
    <div class="top-actions"><span class="connection" class:offline={!online}>{online ? "● Forbundet" : "● Offline"}</span>{#if sessionExpired}<button class="text-button" onclick={showLogin}>Log ind igen</button>{/if}<button class="text-button" onclick={signOut}>Log ud</button></div>
  {/if}
</header>

<main>
  {#if loading}
    <section class="card center"><h1>Finder dine baner…</h1></section>
  {:else if !identity}
    <section class="login card">
      <div class="eyebrow">VELKOMMEN</div><h1>Find ord.<br /><em>Find ro.</em></h1>
      <p>Vælg en kategori, find ordene og tag spillet med dig offline.</p>
      <form onsubmit={(event) => { event.preventDefault(); void signIn(); }}>
        <label>Brugernavn<input autocomplete="username" bind:value={username} required /></label>
        <label>Adgangskode<input type="password" autocomplete="current-password" bind:value={password} required /></label>
        <button class="primary" disabled={busy || !online} type="submit">{busy ? "Logger ind…" : "Log ind"}</button>
      </form>
      <p class="muted">Første administrator oprettes på serveren. Derefter kan administrator oprette flere konti.</p>
    </section>
  {:else}
    <div class="welcome"><div><div class="eyebrow">HEJ {identity.name.toLocaleUpperCase("da-DK")}</div><h1>Find ord.</h1></div><div class="status-pill">{pending ? `${pending} afventer synkronisering` : online ? "Alt er synkroniseret" : "Gemt på enheden"}</div></div>
    {#if identity.child}<p class="child-notice">Børneordlisten og kontrollen af skjulte ord er stadig under gennemgang. Spil sammen med en voksen i denne første udgave. Hentede baner kan fortsættes offline; ændringer i sikkerhedskontrollen tjekkes ved næste forbindelse.</p>{/if}

    {#if !active}
      <section class="card launch-card">
        <h2>Endeløs kampagne</h2><p>Vælg en fast sværhedsgrad. Hver bane får en ny kategori, og de næste baner hentes til offlinebrug.</p>
        <div class="launch-fields"><label class="launch-label">Sværhedsgrad<select bind:value={campaignLevel}>{#each campaignLevels() as id (id)}<option value={id}>{LEVELS[id].name} · {LEVELS[id].size} × {LEVELS[id].size}</option>{/each}</select></label></div>
        <button class="primary start-button" onclick={startCampaignFlow} disabled={busy || !online}>{busy ? "Henter baner…" : campaigns.some((item) => item.level === campaignLevel) ? "Fortsæt kampagne →" : "Start kampagne →"}</button>
        {#if campaigns.length}
          <div class="saved-list">{#each campaigns as campaign (campaign.id)}
            <button onclick={() => openCampaign(campaign)}><span><strong>{LEVELS[campaign.level].name} kampagne</strong><small>{games.filter((game) => game.campaignId === campaign.id && !game.completed).length} hentede baner klar</small></span><span class="saved-status">Fortsæt ↗</span></button>
          {/each}</div>
        {/if}
        {#if !online}<p class="muted">Når de hentede baner er spillet, kræver nye baner forbindelse.</p>{/if}
      </section>
      <section class="card launch-card">
        <h2>En enkelt bane</h2><p>Vælg selv kategori og sværhedsgrad.</p>
        <div class="launch-fields"><label class="launch-label">Kategori<select bind:value={category}>{#each Object.entries(CATEGORIES) as [id, item] (id)}<option value={id}>{item.name}</option>{/each}</select></label><label class="launch-label">Sværhedsgrad<select bind:value={level}>{#each available as id (id)}<option value={id}>{LEVELS[id].name} · {LEVELS[id].size} × {LEVELS[id].size}</option>{/each}</select></label></div>
        <button class="primary start-button" onclick={startGame} disabled={busy || !online}>{busy ? "Danner bane…" : "Start bane →"}</button>
        {#if !online}<p class="muted">Nye baner kræver forbindelse. Hentede baner kan spilles offline.</p>{/if}
      </section>
      <details class="card secondary-panel"><summary>Gemte enkeltbaner <span>{games.filter((game) => !game.campaignId).length}</span></summary>
        {#if games.some((game) => !game.campaignId)}
          <div class="saved-list">{#each games.filter((game) => !game.campaignId) as game (game.id)}<button onclick={() => chooseGame(game)}><span><strong>{CATEGORIES[game.puzzle.category].name}</strong><small>{LEVELS[game.puzzle.level].name} · {game.found.length}/{game.puzzle.words.length} ord</small></span><span class="saved-status">{game.completed ? "Gennemført" : shellReady ? "Klar offline" : "Afventer offlineapp"} ↗</span></button>{/each}</div>
        {:else}<p class="muted">Dine hentede baner vises her.</p>{/if}
        {#if online && pending}<button class="secondary" onclick={syncAll}>Synkronisér nu</button>{/if}
      </details>
      <details class="card secondary-panel"><summary>Achievements <span>{achievements.filter((item) => item.unlocked).length}/{achievements.length}</span></summary>
        {#if achievements.length}
          <div class="achievement-list">{#each (showAchievements ? achievements : achievements.slice(0, 6)) as item (item.id)}<div class:unlocked={item.unlocked}><span>{item.unlocked ? "★" : "☆"}</span><div><strong>{item.title}</strong><small>{item.description}</small></div><b>{item.current}/{item.target}</b></div>{/each}</div>
          <button class="secondary" onclick={() => showAchievements = !showAchievements}>{showAchievements ? "Vis færre" : `Vis alle ${achievements.length}`}</button>
        {:else}<p class="muted">Dine achievements vises, når du har forbindelse.</p>{/if}
      </details>
      {#if identity.role === "admin"}
        <details class="card secondary-panel"><summary>Spillere og konti</summary>
          {#if !showAccounts}<button class="secondary" onclick={loadAccounts}>Administrer konti</button>
          {:else}
            <div class="account-list">{#each accounts as account (account.id)}<div>{account.name} <small>@{account.username} {account.child ? "· Barn" : ""}</small></div>{/each}</div>
            <form class="account-form" onsubmit={(event) => { event.preventDefault(); void createAccount(); }}>
              <label>Navn<input bind:value={newName} required /></label><label>Brugernavn<input bind:value={newUser} pattern={"[A-Za-z0-9_.-]{3,30}"} required /></label><label>Adgangskode<input type="password" minlength="8" bind:value={newPassword} required /></label><label class="checkbox"><input type="checkbox" bind:checked={newChild} /> Børneprofil (under gennemgang)</label><button class="secondary" type="submit">Opret spiller</button>
            </form>
          {/if}
        </details>
      {/if}
    {:else}
      <section class="game-heading"><button class="back" onclick={() => { active = null; selectedStart = null; }}>← Forside</button><div class="eyebrow">{active.campaignId ? `KAMPAGNE · BANE ${active.campaignPosition} · ` : ""}{LEVELS[active.puzzle.level].name.toLocaleUpperCase("da-DK")} · {active.puzzle.grid.length} × {active.puzzle.grid.length}</div><h1>{CATEGORIES[active.puzzle.category].name}</h1><p>Find ordene i gitteret. {active.puzzle.level === "let" ? "Ordene står mod højre eller nedad." : active.puzzle.level === "normal" ? "Ordene står vandret eller lodret i begge retninger." : "Ordene kan stå vandret, lodret og skråt i begge retninger."}</p></section>
      <div class="game-layout">
        <section class="card grid-card"><div class="grid-header"><span>{active.completed ? "BANE GENNEMFØRT" : "FIND ORDENE"}</span><span>{active.found.length} / {active.puzzle.words.length}</span></div>
          <div class="letter-grid" style={`--size:${active.puzzle.grid.length}`} onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerUp} onpointercancel={pointerCancel} onlostpointercapture={pointerCancel} role="group" aria-label="Bogstavgitter">
            {#each active.puzzle.grid as row, rowIndex (rowIndex)}
              {#each row as letter, colIndex (colIndex)}
                <button class:found-cell={foundCells.some((cell) => cell.row === rowIndex && cell.col === colIndex)} class:hint-start={shownHint?.start.row === rowIndex && shownHint?.start.col === colIndex} class:preview-cell={selectedCells.some((cell) => cell.row === rowIndex && cell.col === colIndex)} class:preview-start={previewStart?.row === rowIndex && previewStart?.col === colIndex} class:preview-end={previewEnd?.row === rowIndex && previewEnd?.col === colIndex && (previewStart?.row !== rowIndex || previewStart?.col !== colIndex)} class:rejected-cell={rejectedStart !== null && dragStart === null && selectedCells.some((cell) => cell.row === rowIndex && cell.col === colIndex)} class:tap-start={selectedStart?.row === rowIndex && selectedStart?.col === colIndex} data-row={rowIndex} data-col={colIndex} onkeydown={(event) => keyCell(event, rowIndex, colIndex)} aria-label={`Række ${rowIndex + 1}, kolonne ${colIndex + 1}, ${letter}${shownHint?.start.row === rowIndex && shownHint?.start.col === colIndex ? `, startfelt for hint til ${shownHint.word}` : ""}${selectedStart?.row === rowIndex && selectedStart?.col === colIndex ? ", valgt startfelt" : ""}`}><span>{letter}</span></button>
              {/each}
            {/each}
            {#if previewStart && previewEnd && (previewStart.row !== previewEnd.row || previewStart.col !== previewEnd.col)}
              <svg class="selection-line" class:rejected-line={rejectedStart !== null && dragStart === null} viewBox={`0 0 ${active.puzzle.grid.length} ${active.puzzle.grid.length}`} preserveAspectRatio="none" aria-hidden="true" focusable="false"><line x1={previewStart.col + 0.5} y1={previewStart.row + 0.5} x2={previewEnd.col + 0.5} y2={previewEnd.row + 0.5} /></svg>
            {/if}
          </div>
          <p class="grid-tip">Træk fra første til sidste bogstav, eller tryk på de to ender. Brug piletasterne på tastatur.</p>
          {#if shownHint}<p class="hint-location">Hint til {shownHint.word}: begynd i række {shownHint.start.row + 1}, kolonne {shownHint.start.col + 1}. Det blå felt viser starten.</p>{/if}
          {#if selectionFeedback}<p class="selection-feedback">{selectionFeedback}</p>{/if}
        </section>
        <aside class="card word-card"><div class="grid-header"><span>ORDLISTE</span><span>{active.found.length} / {active.puzzle.words.length}</span></div><div class="words">
          {#each active.puzzle.words as word (word)}<div class:found={active.found.includes(word)} class:hinted={shownHint?.word === word}><span class="check">{active.found.includes(word) ? "✓" : ""}</span><span>{word}</span><span class="hintmark">{active.hints.includes(word) ? "· hint" : ""}</span></div>{/each}
          </div>
          {#if active.completed}<div class="finished">✦ Flot klaret! Alle ord er fundet.</div>{#if active.campaignId}<button class="primary start-button" onclick={nextInCampaign}>{nextCampaignGame ? "Næste kampagnebane →" : online ? "Hent næste bane →" : "Forbind for at hente flere baner"}</button>{/if}{:else}
            <div class="hint-controls"><button class="secondary hint-button" onclick={hint} disabled={hintSaving || hintsRemaining(active.puzzle.level, active.hints) === 0}>Vis et hint</button><span>Hints tilbage: {hintsRemaining(active.puzzle.level, active.hints)}/{HINT_LIMIT[active.puzzle.level]}</span></div>
            {#if hintsRemaining(active.puzzle.level, active.hints) === 0}<p class="hint-explanation">Alle hints på denne bane er brugt.</p>{/if}
          {/if}
          <div class="local-status">{pending ? `${pending} træk venter på synkronisering` : online ? "Synkroniseret" : "Gemt på enheden"}</div>
        </aside>
      </div>
    {/if}
  {/if}
  {#if message}<div class="toast" role="status"><span>{message}</span><button aria-label="Luk besked" onclick={() => message = ""}>×</button></div>{/if}
</main>
