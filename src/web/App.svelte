<script lang="ts">
  import { onMount, tick } from "svelte";
  import { authClient } from "./auth.js";
  import { local, recordMove, saveGame, saveCampaign, eraseLocal, offlineSignOut, pendingServerLogout, clearPendingServerLogout, approveDownloadedGame, reconcileDownloadedGames, removeDownloadedGame, retireDownloadedGame, usableOffline, pruneOfflineGames, saveMissingGames, requestPersistentStorage, isQuotaError, MAX_OFFLINE_GAMES, type DownloadedCampaign, type PlayerStats, type PuzzleVersions, type StoredCampaign, type StoredGame, type StoredIdentity } from "./storage.js";
  import { AVATARS, AVATAR_NAMES, CATEGORIES, LEVELS, availableLevels, campaignLevels, directionDescription, surpriseCategory, type CategoryId, type LevelId } from "../shared/words.js";
  import { cellsBetween, findWord, HINT_LIMIT, hintsRemaining, visibleHint, wordAt, type Move, type Point, type Puzzle } from "../shared/game.js";
  import { snapDragEnd } from "./drag.js";
  import { applyUpdate, updateReady } from "./pwa.js";
  import { newMoveId } from "./ids.js";
  import { ACHIEVEMENT_ICONS, nextGoals, type Achievement } from "../shared/achievements.js";
  import { START_CREDITS, type ChallengeState } from "../shared/challenges.js";

  type Identity = Omit<StoredIdentity, "key">;
  type ServerIdentity = Identity & { puzzleVersions: PuzzleVersions };
  let identity: Identity | null = null;
  let serverVersions: PuzzleVersions | null = null;
  let online = navigator.onLine;
  // The device's own network state, so "no internet" and "server not answering" differ.
  let networkUp = navigator.onLine;
  $: connectionLabel = sessionExpired ? "Session udløbet" : online ? "Forbundet" : networkUp ? "Serveren svarer ikke" : "Ingen internet";
  let sessionExpired = false;
  let loading = true;
  let busy = false;
  let message = "";
  let selectionFeedback = "";
  let username = "";
  let password = "";
  let category: CategoryId | "surprise" = "dyr";
  let level: LevelId = "let";
  let games: StoredGame[] = [];
  let campaigns: StoredCampaign[] = [];
  let campaignLevel: LevelId = "let";
  let active: StoredGame | null = null;
  let pending = 0;
  let pendingGameIds: string[] = [];
  let completionHeading: HTMLHeadingElement | undefined;
  let dragStart: Point | null = null;
  let dragEnd: Point | null = null;
  let dragPointerId: number | null = null;
  let dragOrigin: { x: number; y: number } | null = null;
  let dragHasMoved = false;
  let selectedStart: Point | null = null;
  let rejectedStart: Point | null = null;
  let rejectedEnd: Point | null = null;
  let rejectionTimer: ReturnType<typeof setTimeout> | null = null;
  let accounts: Array<{ id: string; name: string; username: string; role: string | null; child: number; banned: number; avatar: string | null; policyVersion: number }> = [];
  let adminPassword = "";
  let profileName = "";
  let profileAvatar: string | null = null;
  let editingProfile = false;
  let newUser = "";
  let newName = "";
  let newPassword = "";
  let newChild = false;
  let setupNeeded = false;
  let setupToken = new URLSearchParams(location.search).get("opsaetning") ?? "";
  let setupName = "";
  let currentPassword = "";
  let nextPassword = "";
  let changingPassword = false;
  let showAccounts = false;
  type WordAdmin = {
    versions: { app: string; words: number; categories: number; childPolicy: number; validation: number; cor: string };
    blockedSequences: number;
    coverage: Array<{ category: CategoryId; name: string; levels: Record<string, { adult: number; child: number; needed: number; adultOpen: boolean; childOpen: boolean }> }>;
    words: Array<{ word: string; category: CategoryId; child: boolean; reason: string | null; readingLevel: number; sources: string[] }>;
  };
  let wordAdmin: WordAdmin | null = null;
  let wordAdminError = "";
  let wordQuery = "";
  let wordCategory = "";
  let wordChild = "";
  $: shownWords = (wordAdmin?.words ?? []).filter((item) =>
    (!wordQuery || item.word.includes(wordQuery.trim().toLocaleUpperCase("da-DK"))) &&
    (!wordCategory || item.category === wordCategory) &&
    (!wordChild || item.child === (wordChild === "ja")));

  async function loadWordAdmin() {
    wordAdminError = "";
    try { wordAdmin = await api("/admin/words") as WordAdmin; }
    catch (cause) { wordAdminError = cause instanceof Error ? cause.message : "Ordlisterne kunne ikke hentes."; }
  }
  let achievements: Achievement[] = [];
  // Confirmed by the server; hints still in the outbox are subtracted locally.
  let challengeInfo: ChallengeState | null = null;
  let pendingHints = 0;
  $: credits = Math.max(0, (challengeInfo?.balance ?? START_CREDITS) - pendingHints);
  let goalsCard: HTMLElement | undefined;
  let newAchievements: Achievement[] = [];
  let achievementFilter: "all" | "unlocked" | "locked" = "all";
  let stats: PlayerStats | null = null;
  $: shownAchievements = achievements.filter((item) => achievementFilter === "all" || item.unlocked === (achievementFilter === "unlocked"));
  let syncing = false;
  let syncTask: Promise<void> | null = null;
  let syncAgain = false;
  let shellReady = false;
  let hintSaving = false;
  let markingWord = false;
  let focusCell: Point = { row: 0, col: 0 };
  let storagePersisted = true;
  const QUOTA_MESSAGE = "Der er ikke plads på enheden til at gemme mere. Frigør plads, eller synkronisér og gennemfør hentede baner.";
  let shownGameId: string | null = null;

  $: childProfile = identity?.child ?? false;
  $: available = category === "surprise" ? campaignLevels(childProfile) : availableLevels(category, childProfile);
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
  $: nextSingleGame = active && !active.campaignId ? games.find((game) => !game.campaignId && !game.completed &&
    game.id !== active?.id && game.puzzle.category === active?.puzzle.category && game.puzzle.level === active?.puzzle.level) : undefined;
  $: activePending = active ? pendingGameIds.includes(active.id) : false;
  $: if ((active?.id ?? null) !== shownGameId) {
    shownGameId = active?.id ?? null;
    newAchievements = [];
    focusCell = { row: 0, col: 0 };
    // Start a newly opened game or the home page at the top instead of the previous scroll position.
    void tick().then(() => window.scrollTo(0, 0));
  }

  async function api(path: string, init?: RequestInit) {
    const response = await fetch(`/api${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error || "Serveren kunne ikke svare."), { status: response.status, details: body });
    return body;
  }

  async function refreshLocal() {
    if (!identity) { games = []; campaigns = []; active = null; pending = 0; pendingGameIds = []; return; }
    const saved = await local.games.where("owner").equals(identity.id).reverse().sortBy("updatedAt");
    games = saved.filter((game) => usableOffline(game, identity!.child));
    campaigns = await local.campaigns.where("owner").equals(identity.id).toArray();
    const queued = await local.moves.where("owner").equals(identity.id).toArray();
    pending = queued.length;
    pendingHints = queued.filter((move) => move.kind === "hint").length;
    pendingGameIds = [...new Set(queued.map((move) => move.gameId))];
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
    const onOnline = () => { networkUp = true; void reconnect(); };
    const onOffline = () => { networkUp = false; online = false; };
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
        const cached = await local.achievements.get(identity.id);
        achievements = cached?.items ?? [];
        stats = cached?.stats ?? null;
        challengeInfo = cached?.challenges ?? null;
        if (online) await syncAll();
        else await refreshLocal();
      }
    } catch (cause) { message = cause instanceof Error ? cause.message : "Lokal lagring er ikke tilgængelig."; }
    finally {
      if (!identity && navigator.onLine) {
        try { setupNeeded = (await api("/setup") as { needed: boolean }).needed; } catch { setupNeeded = false; }
      }
      loading = false;
    }
  }

  async function createFirstAdmin() {
    busy = true; message = "";
    try {
      await api("/setup", { method: "POST", body: JSON.stringify({ token: setupToken.trim(), username, name: setupName, password }) });
      setupNeeded = false;
      history.replaceState(null, "", location.pathname);
      await signIn();
    } catch (cause) { message = cause instanceof Error ? cause.message : "Administratoren kunne ikke oprettes."; }
    finally { busy = false; }
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
      const cached = await local.achievements.get(me.id);
      achievements = cached?.items ?? [];
      stats = cached?.stats ?? null;
      challengeInfo = cached?.challenges ?? null;
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
    identity = null; serverVersions = null; sessionExpired = false; active = null; games = []; campaigns = []; pending = 0; pendingGameIds = []; showAccounts = false; wordAdmin = null; achievements = []; challengeInfo = null; pendingHints = 0;
    message = serverDone ? "Du er logget ud." : "Du er logget ud på denne enhed. Serverudlogning sker ved næste forbindelse.";
  }

  function showLogin() {
    identity = null;
    active = null;
    online = navigator.onLine;
    message = "Log ind igen for at synkronisere dine gemte spil.";
  }

  // Reused until the game is saved, so retrying after a lost response returns the same game.
  let gameRequest: { key: string; id: string } | null = null;

  async function startGame(requestedCategory: CategoryId | "surprise" = category, chosenLevel: LevelId = level) {
    if (!identity || !online) { message = "Opret nye baner, når der er forbindelse til serveren."; return; }
    const chosenCategory = requestedCategory === "surprise" ? surpriseCategory(chosenLevel, Math.random, childProfile) : requestedCategory;
    if (!chosenCategory) { message = "Ingen kategori kan danne en bane på dette niveau endnu."; return; }
    busy = true; message = "";
    try {
      if (!await refreshConnectedAccount() || !identity) return;
      if (await pruneOfflineGames(identity.id, MAX_OFFLINE_GAMES - 1) >= MAX_OFFLINE_GAMES) {
        message = `Der er allerede ${MAX_OFFLINE_GAMES} hentede baner på enheden. Gennemfør eller opgiv nogle af dem, før du henter flere.`;
        return;
      }
      const key = `${identity.id}|${chosenCategory}|${chosenLevel}`;
      if (gameRequest?.key !== key) gameRequest = { key, id: newMoveId() };
      const game = await api("/games", { method: "POST", body: JSON.stringify({ category: chosenCategory, level: chosenLevel, requestId: gameRequest.id }) });
      await saveGame(identity.id, game);
      gameRequest = null;
      storagePersisted = await requestPersistentStorage();
      await refreshLocal();
      active = games.find((item) => item.id === game.puzzle.id) ?? null;
      message = shellReady ? "Banen er gemt og klar offline." : "Banen er gemt. Vent på, at appen bliver klar til offlinebrug.";
    } catch (cause) { message = isQuotaError(cause) ? QUOTA_MESSAGE : cause instanceof Error ? cause.message : "Banen kunne ikke hentes."; }
    finally { busy = false; }
  }

  async function storeCampaign(bundle: DownloadedCampaign) {
    if (!identity) return;
    await saveCampaign(identity.id, bundle);
    await pruneOfflineGames(identity.id);
    storagePersisted = await requestPersistentStorage();
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
    } catch (cause) { message = isQuotaError(cause) ? QUOTA_MESSAGE : cause instanceof Error ? cause.message : "Kampagnen kunne ikke hentes."; }
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
    if (!active?.campaignId || busy) return;
    busy = true;
    try {
      if (nextCampaignGame) { await chooseGame(nextCampaignGame); return; }
      const campaign = campaigns.find((item) => item.id === active?.campaignId);
      if (campaign) await openCampaign(campaign);
      else message = "Kampagnen er ikke længere gemt på enheden. Gå til forsiden for at vælge en anden bane.";
    } finally { busy = false; }
  }

  async function newSingleGame() {
    if (!active || active.campaignId || busy) return;
    if (!online) {
      if (nextSingleGame) {
        busy = true;
        try { await chooseGame(nextSingleGame); }
        finally { busy = false; }
      } else message = "Ingen hentet bane i samme kategori og sværhedsgrad er klar. Opret forbindelse for at hente en ny bane.";
      return;
    }
    await startGame(active.puzzle.category, active.puzzle.level);
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
          if (cause.status === 410) await retireDownloadedGame(game.id);
          else await removeDownloadedGame(game.id);
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

  async function addMove(move: Move, next: Pick<StoredGame, "found" | "hints" | "completed" | "abandoned">): Promise<boolean> {
    if (!active) return false;
    try {
      await recordMove(active, move, next);
      await refreshLocal();
      if (online) void syncAll();
      return true;
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "";
      message = ["Hintet er ugyldigt.", "Ordet har allerede fået et hint.", "Alle hints på denne bane er brugt.", "Banen er allerede afsluttet."].includes(reason)
        ? reason : isQuotaError(cause) ? QUOTA_MESSAGE : "Kunne ikke gemme trækket på enheden. Kontrollér ledig lagerplads.";
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
    if (!active || active.completed || markingWord) return;
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
    markingWord = true;
    try {
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
        await tick();
        completionHeading?.focus();
      } else message = `${word} fundet!`;
      selectionFeedback = message;
    } finally { markingWord = false; }
  }
  // Markings are handled one at a time, so a word marked while the previous one is
  // still being saved waits instead of being dropped.
  let markQueue: Promise<void> = Promise.resolve();
  function submitWord(start: Point, end: Point) {
    markQueue = markQueue.then(() => markWord(start, end)).catch(() => {
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
      const last = active.puzzle.grid.length - 1;
      focusCell = { row: Math.max(0, Math.min(last, row + step.row)), col: Math.max(0, Math.min(last, col + step.col)) };
      document.querySelector<HTMLButtonElement>(`[data-row="${focusCell.row}"][data-col="${focusCell.col}"]`)?.focus();
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
    if (credits < 1) {
      message = "Du har ingen hintkreditter. Klar et mål på forsiden for at få flere.";
      return;
    }
    const word = active.puzzle.words.find((candidate) => !active?.found.includes(candidate) && !active?.hints.includes(candidate));
    if (!word) { message = "Der er ikke flere hints til denne bane."; return; }
    const location = findWord(active.puzzle, word);
    if (!location) return;
    hintSaving = true;
    try {
      if (await addMove({ id: newMoveId(), kind: "hint", word }, { found: active.found, hints: [...active.hints, word], completed: false }))
        selectionFeedback = `Hint til ${word}: begynd i række ${location.start.row + 1}, kolonne ${location.start.col + 1}.`;
    } finally { hintSaving = false; }
  }

  async function showGoals() {
    active = null; selectedStart = null; message = "";
    await tick();
    goalsCard?.scrollIntoView({ block: "start" });
    goalsCard?.focus();
  }

  async function abandon() {
    if (!active || active.completed || markingWord || hintSaving) return;
    if (!confirm("Opgiv banen? En opgivet bane tæller ikke som gennemført og kan ikke spilles videre.")) return;
    selectedStart = null;
    if (!await addMove({ id: newMoveId(), kind: "abandon" }, { found: active.found, hints: active.hints, completed: true, abandoned: true })) return;
    selectionFeedback = "";
    message = "Banen er opgivet.";
    await tick();
    completionHeading?.focus();
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
          let result: { found: string[]; hints: string[]; completed: boolean; abandoned: boolean; revision: number; acknowledged: string[]; rejected: Array<{ id: string; error: string }> };
          try { result = await api(`/games/${id}/sync`, { method: "POST", body: JSON.stringify({ events: moves }) }); }
          catch (cause) {
            if (cause instanceof Error && "status" in cause && cause.status === 404) {
              await removeDownloadedGame(id);
              message = "En bane findes ikke længere på serveren og er fjernet fra denne enhed.";
              continue;
            }
            throw cause;
          }
          // Only events the server acknowledged or rejected leave the outbox. The local
          // state is the server state plus moves that are still waiting.
          await local.transaction("rw", local.moves, local.games, async () => {
            await local.moves.bulkDelete([...result.acknowledged, ...result.rejected.map((item) => item.id)]);
            const remaining = await local.moves.where("gameId").equals(id).toArray();
            const saved = await local.games.get(id);
            if (!saved) return;
            if (!remaining.length && saved.retired) { await local.games.delete(id); return; }
            const waiting = (kind: Move["kind"]) => remaining.filter((move) => move.kind === kind).map((move) => move.word!).filter(Boolean);
            await local.games.update(id, {
              found: [...new Set([...result.found, ...waiting("find")])],
              hints: [...new Set([...result.hints, ...waiting("hint")])],
              // Locally, completed means finished: completed or abandoned.
              completed: result.completed || result.abandoned || remaining.some((move) => move.kind === "complete" || move.kind === "abandon"),
              abandoned: result.abandoned || remaining.some((move) => move.kind === "abandon"),
              revision: result.revision
            });
          });
          if (result.rejected.length) {
            selectionFeedback = "";
            message = result.rejected.length === 1
              ? `Et offlinetræk blev afvist af serveren: ${result.rejected[0].error}`
              : `${result.rejected.length} offlinetræk blev afvist af serveren, fx: ${result.rejected[0].error}`;
          }
        }
      }
      await refreshLocal();
      online = true;
      if (await saveMissingGames(identity.id, await api("/games"))) await refreshLocal();
      const serverCampaigns = await api("/campaigns") as DownloadedCampaign[];
      for (const campaign of serverCampaigns) {
        const ready = games.filter((game) => game.campaignId === campaign.id && !game.completed).length;
        let bundle = campaign;
        // A failed refill (e.g. the server's creation limit) keeps the games already queued.
        if (ready < 3) bundle = await api(`/campaigns/${campaign.id}/refill`, { method: "POST" }).catch(() => campaign) as DownloadedCampaign;
        await storeCampaign(bundle);
      }
      try {
        const items = await api("/achievements") as Achievement[];
        // Announce goals unlocked since the last known list; the first list on a device is not news.
        if (achievements.length) {
          const before = new Set(achievements.filter((item) => item.unlocked).map((item) => item.id));
          const unlocked = items.filter((item) => item.unlocked && !before.has(item.id));
          if (unlocked.length) {
            newAchievements = [...newAchievements, ...unlocked];
            // The completion panel lists them itself.
            if (!active?.completed) message = `Ny achievement: ${unlocked.map((item) => item.title).join(", ")}`;
          }
        }
        achievements = items;
        stats = await api("/stats") as PlayerStats;
        const nextChallenges = await api("/challenges") as ChallengeState;
        // Announce challenges that were open before and have now paid their credit.
        const open = new Set(challengeInfo?.challenges.map((item) => item.id) ?? []);
        const paid = nextChallenges.recent.filter((item) => open.has(item.id));
        if (paid.length && !active?.completed) message = `Mål klaret: ${paid.map((item) => item.title).join(", ")}. Du fik ${paid.length === 1 ? "1 hintkredit" : `${paid.length} hintkreditter`}.`;
        challengeInfo = nextChallenges;
        await local.achievements.put({ owner: identity.id, items, stats, challenges: nextChallenges, updatedAt: Date.now() });
      } catch { /* Spiltræk er allerede synkroniseret; belønninger opdateres ved næste kontakt. */ }
    } catch (cause) {
      if (cause instanceof Error && "status" in cause && cause.status === 401) {
        sessionExpired = true;
        online = false;
        message = "Sessionen er udløbet. Hentede baner kan fortsættes; log ind igen for at synkronisere.";
      } else message = cause instanceof Error ? `Afventer synkronisering: ${cause.message}` : "Afventer synkronisering.";
    } finally { syncing = false; }
  }

  async function changePassword() {
    changingPassword = true;
    try {
      const result = await authClient.changePassword({ currentPassword, newPassword: nextPassword, revokeOtherSessions: true });
      if (result.error) throw new Error(result.error.status === 400 ? "Den nuværende adgangskode er forkert, eller den nye er for kort." : "Adgangskoden kunne ikke ændres.");
      currentPassword = ""; nextPassword = "";
      message = "Adgangskoden er ændret. Andre enheder er logget ud.";
    } catch (cause) { message = cause instanceof Error ? cause.message : "Adgangskoden kunne ikke ændres."; }
    finally { changingPassword = false; }
  }

  function startProfileEdit() {
    profileName = identity?.name ?? "";
    profileAvatar = identity?.avatar ?? null;
    editingProfile = true;
  }

  async function saveProfile() {
    if (!identity) return;
    try {
      const saved = await api("/profile", { method: "PATCH", body: JSON.stringify({ name: profileName, avatar: profileAvatar }) }) as { name: string; avatar: string | null };
      identity = { ...identity, ...saved };
      await local.identity.put({ key: "identity", ...identity });
      editingProfile = false;
      message = "Profilen er gemt.";
    } catch (cause) { message = cause instanceof Error ? cause.message : "Profilen kunne ikke gemmes."; }
  }

  async function setChildProfile(account: (typeof accounts)[number], child: boolean) {
    if (!adminPassword) { message = "Skriv din adgangskode for at ændre profiltype."; return; }
    try {
      await api(`/accounts/${account.id}/policy`, { method: "PATCH", body: JSON.stringify({ child, adminPassword, expectedVersion: account.policyVersion }) });
      message = child ? `${account.name} er nu børneprofil og er logget ud på sine enheder.` : `${account.name} er nu voksenprofil og er logget ud på sine enheder.`;
    } catch (cause) { message = cause instanceof Error ? cause.message : "Profiltypen kunne ikke ændres."; }
    await loadAccounts();
  }

  async function adminAuth(path: string, body: object, failure: string) {
    const response = await fetch(`/api/auth/admin/${path}`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? failure);
  }

  async function resetPassword(account: (typeof accounts)[number]) {
    const next = prompt(`Ny midlertidig adgangskode til ${account.name} (mindst 8 tegn). Kontoen logges ud på alle enheder.`);
    if (next === null) return;
    if (next.length < 8) { message = "Adgangskoden skal have mindst 8 tegn."; return; }
    try {
      await adminAuth("set-user-password", { userId: account.id, newPassword: next }, "Adgangskoden kunne ikke nulstilles.");
      message = `Adgangskoden til ${account.name} er nulstillet. Giv den videre, og bed om at ændre den under Min konto.`;
    } catch (cause) { message = cause instanceof Error ? cause.message : "Adgangskoden kunne ikke nulstilles."; }
  }

  async function deleteAccount(account: (typeof accounts)[number]) {
    const typed = prompt(`Slet ${account.name} permanent? Spil, statistik og achievements slettes og kan ikke gendannes fra appen. Skriv brugernavnet ${account.username} for at bekræfte.`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== account.username.toLowerCase()) { message = "Brugernavnet passede ikke. Kontoen er ikke slettet."; return; }
    try {
      await adminAuth("remove-user", { userId: account.id }, "Kontoen kunne ikke slettes.");
      message = `${account.name} er slettet.`;
    } catch (cause) { message = cause instanceof Error ? cause.message : "Kontoen kunne ikke slettes."; }
    await loadAccounts();
  }

  async function setBanned(account: (typeof accounts)[number], banned: boolean) {
    try {
      const response = await fetch(`/api/auth/admin/${banned ? "ban-user" : "unban-user"}`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: account.id })
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? "Kontoen kunne ikke ændres.");
      message = banned ? `${account.name} er deaktiveret og logget ud.` : `${account.name} er aktiv igen.`;
    } catch (cause) { message = cause instanceof Error ? cause.message : "Kontoen kunne ikke ændres."; }
    await loadAccounts();
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

<header class="topbar" class:playing={!!active}>
  <div class="brand"><span class="brandmark">F<span>I</span>ND</span><small>ORDJAGT PÅ DANSK</small></div>
  {#if identity}
    <div class="top-actions"><span class="connection" class:offline={!online || sessionExpired} title={online && !sessionExpired ? "" : "Hentede baner kan spilles videre. Trækkene sendes, når forbindelsen er tilbage."}>● {connectionLabel}</span>{#if sessionExpired}<button class="text-button" onclick={showLogin}>Log ind igen</button>{/if}<button class="text-button" onclick={signOut} disabled={markingWord}>Log ud</button></div>
  {/if}
</header>

<main class:playing={!!active}>
  {#if loading}
    <section class="card center"><h1>Finder dine baner…</h1></section>
  {:else if !identity}
    {#if setupNeeded}
    <section class="login card">
      <div class="eyebrow">NY INSTALLATION</div><h1>Opret første administrator</h1>
      <p>Administratoren opretter derefter konti til de andre spillere.</p>
      <form onsubmit={(event) => { event.preventDefault(); void createFirstAdmin(); }}>
        <label>Opsætningskode<input bind:value={setupToken} autocomplete="off" required /></label>
        {#if !setupToken}<p class="muted">Koden står i serverens log, fx med <code>docker compose logs find-ord</code>.</p>{/if}
        <label>Brugernavn<input autocomplete="username" bind:value={username} pattern={"[A-Za-z0-9_.\\-]{3,30}"} required /></label>
        <label>Visningsnavn<input bind:value={setupName} maxlength="80" required /></label>
        <label>Adgangskode<input type="password" autocomplete="new-password" minlength="8" bind:value={password} required /></label>
        <button class="primary" disabled={busy || !online} type="submit">{busy ? "Opretter…" : "Opret administrator"}</button>
      </form>
    </section>
    {:else}
    <section class="login card">
      <div class="eyebrow">VELKOMMEN</div><h1>Find ord.<br /><em>Find ro.</em></h1>
      <p>Vælg en kategori, find ordene og tag spillet med dig offline.</p>
      <form onsubmit={(event) => { event.preventDefault(); void signIn(); }}>
        <label>Brugernavn<input autocomplete="username" bind:value={username} required /></label>
        <label>Adgangskode<input type="password" autocomplete="current-password" bind:value={password} required /></label>
        <button class="primary" disabled={busy || !online} type="submit">{busy ? "Logger ind…" : "Log ind"}</button>
      </form>
      <p class="muted">Konti oprettes af en administrator.</p>
    </section>
    {/if}
  {:else}
    {#if !active}
      {#if $updateReady}<div class="update-banner" role="status"><span>En ny version af Find ord er klar.</span><button class="secondary" onclick={() => void applyUpdate()} disabled={markingWord}>Opdatér</button></div>{/if}
      <div class="welcome"><div><div class="eyebrow">{identity.avatar && identity.avatar in AVATARS ? `${AVATARS[identity.avatar as keyof typeof AVATARS]} ` : ""}HEJ {identity.name.toLocaleUpperCase("da-DK")}</div><h1>Find ord.</h1></div><div class="status-pill">{pending ? `${pending} afventer synkronisering` : online ? "Alt er synkroniseret" : "Gemt på enheden"}</div></div>
      {#if identity.child}<p class="child-notice">Børnebaner bruger kun ord, der er godkendt til børn, og gitteret tjekkes for uønskede ord. Ingen kontrol fanger alt, så sig til en voksen, hvis du ser noget mærkeligt.</p>{/if}
      <section class="card launch-card">
        <h2>Endeløs kampagne</h2><p>Vælg en fast sværhedsgrad. Hver bane får en ny kategori, og de næste baner hentes til offlinebrug.</p>
        <div class="launch-fields"><label class="launch-label">Sværhedsgrad<select bind:value={campaignLevel} aria-describedby="campaign-directions">{#each campaignLevels(childProfile) as id (id)}<option value={id}>{LEVELS[id].name} · {LEVELS[id].size} × {LEVELS[id].size}</option>{/each}</select></label></div>
        <p class="level-directions" id="campaign-directions" aria-live="polite">Ordretninger: {directionDescription(campaignLevel)}.</p>
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
        <div class="launch-fields"><label class="launch-label">Kategori<select bind:value={category}><option value="surprise">Overrask mig</option>{#each Object.entries(CATEGORIES) as [id, item] (id)}<option value={id}>{item.name}</option>{/each}</select></label><label class="launch-label">Sværhedsgrad<select bind:value={level} aria-describedby="single-directions">{#each available as id (id)}<option value={id}>{LEVELS[id].name} · {LEVELS[id].size} × {LEVELS[id].size}</option>{/each}</select></label></div>
        <p class="level-directions" id="single-directions" aria-live="polite">Ordretninger: {directionDescription(level)}.</p>
        <button class="primary start-button" onclick={() => startGame()} disabled={busy || !online}>{busy ? "Danner bane…" : "Start bane →"}</button>
        {#if !online}<p class="muted">Nye baner kræver forbindelse. Hentede baner kan spilles offline.</p>{/if}
      </section>
      <section class="card goals-card" id="goals" tabindex="-1" bind:this={goalsCard} aria-labelledby="goals-heading">
        <div class="goals-head"><h2 id="goals-heading">Mål</h2><span class="credit-pill">Hintkreditter: {credits} af {challengeInfo?.max ?? 5}</span></div>
        <p class="muted">Klar et mål for at få 1 hintkredit. Målene har ingen tidsfrist, og et hint koster 1 kredit.</p>
        {#if challengeInfo}
          <ul class="goal-list">{#each challengeInfo.challenges as goal (goal.id)}<li>
            <strong>{goal.title}</strong>
            <progress max={goal.target} value={goal.progress} aria-label={`${goal.title}: ${goal.progress} af ${goal.target}`}></progress>
            <b>{goal.progress}/{goal.target}</b>
            {#if goal.completed}<small>Klaret. Krediten venter, til du har plads under {challengeInfo.max}.</small>{/if}
          </li>{/each}</ul>
          {#if pending}<p class="muted">Træk, der venter på synkronisering, tælles med, når de er sendt.</p>{/if}
        {:else}<p class="muted">Målene vises, når du har forbindelse.</p>{/if}
      </section>
      <details class="card secondary-panel"><summary>Gemte enkeltbaner <span>{games.filter((game) => !game.campaignId).length}</span></summary>
        {#if games.some((game) => !game.campaignId)}
          <div class="saved-list">{#each games.filter((game) => !game.campaignId) as game (game.id)}<button onclick={() => chooseGame(game)}><span><strong>{CATEGORIES[game.puzzle.category].name}</strong><small>{LEVELS[game.puzzle.level].name} · {game.found.length}/{game.puzzle.words.length} ord</small></span><span class="saved-status">{game.abandoned ? "Opgivet" : game.completed ? "Gennemført" : shellReady ? "Klar offline" : "Afventer offlineapp"} ↗</span></button>{/each}</div>
        {:else}<p class="muted">Dine hentede baner vises her.</p>{/if}
        {#if !storagePersisted}<p class="muted">Browseren kan slette hentede baner ved pladsmangel. Synkronisér, før du rydder browserdata.</p>{/if}
        {#if online && pending}<button class="secondary" onclick={syncAll}>Synkronisér nu</button>{/if}
      </details>
      <details class="card secondary-panel"><summary>Achievements <span>{achievements.filter((item) => item.unlocked).length}/{achievements.length}</span></summary>
        {#if achievements.length}
          {#if pending}<p class="muted">{pending} træk afventer synkronisering. Achievements opdateres, når de er modtaget.</p>{/if}
          {#if nextGoals(achievements).length}
            <h3 class="panel-heading">Næste mål</h3>
            <div class="next-goals">{#each nextGoals(achievements) as item (item.id)}<div><span aria-hidden="true">{ACHIEVEMENT_ICONS[item.icon]}</span><strong>{item.title}</strong><progress max={item.target} value={item.current} aria-label={`${item.title}: ${item.current} af ${item.target}`}></progress><b>{item.current}/{item.target}</b></div>{/each}</div>
          {/if}
          <div class="achievement-filter" role="group" aria-label="Vis achievements">
            {#each [["all", "Alle"], ["unlocked", "Optjent"], ["locked", "Mangler"]] as [value, label] (value)}<button class="secondary" aria-pressed={achievementFilter === value} onclick={() => achievementFilter = value as typeof achievementFilter}>{label}</button>{/each}
          </div>
          <div class="achievement-list">{#each shownAchievements as item (item.id)}<div class:unlocked={item.unlocked}><span aria-hidden="true">{ACHIEVEMENT_ICONS[item.icon]}</span><div><strong>{item.title}</strong><small>{item.description}</small>{#if item.unlockedAt}<small>Optjent {new Date(item.unlockedAt).toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" })}</small>{/if}</div><b>{item.unlocked ? "✓" : `${item.current}/${item.target}`}</b></div>{/each}</div>
        {:else}<p class="muted">Dine achievements vises, når du har forbindelse.</p>{/if}
      </details>
      <details class="card secondary-panel"><summary>Statistik</summary>
        {#if stats}
          <dl class="stats-grid">
            <div><dt>Gennemførte baner</dt><dd>{stats.completed}</dd></div>
            <div><dt>Fundne ord</dt><dd>{stats.found}</dd></div>
            <div><dt>Forskellige ord</dt><dd>{stats.unique}</dd></div>
            <div><dt>Uden hint</dt><dd>{stats.withoutHints}</dd></div>
            <div><dt>Spilledage</dt><dd>{stats.activeDays}</dd></div>
          </dl>
          {#if stats.byCategory.length}
            <table class="stats-table"><caption>Pr. kategori</caption><thead><tr><th scope="col">Kategori</th><th scope="col">Baner</th><th scope="col">Ord</th></tr></thead>
              <tbody>{#each stats.byCategory as row (row.category)}<tr><th scope="row">{CATEGORIES[row.category as CategoryId]?.name ?? row.category}</th><td>{row.completed}</td><td>{row.found}</td></tr>{/each}</tbody></table>
          {/if}
          {#if pending}<p class="muted">Tallene er fra sidste synkronisering.</p>{/if}
        {:else}<p class="muted">Din statistik vises, når du har forbindelse.</p>{/if}
      </details>
      <details class="card secondary-panel"><summary>Min konto</summary>
        <p>{identity.avatar && identity.avatar in AVATARS ? AVATARS[identity.avatar as keyof typeof AVATARS] : ""} {identity.name} <small class="muted">@{identity.username}</small></p>
        <p class="muted">Profiltype: {identity.child ? "Barn" : "Voksen"}{identity.role === "admin" ? " · Administrator" : ""}. Kun en administrator kan ændre profiltypen.</p>
        {#if online && !sessionExpired}
          {#if editingProfile}
            <form class="account-form" onsubmit={(event) => { event.preventDefault(); void saveProfile(); }}>
              <label>Visningsnavn<input bind:value={profileName} maxlength="80" required /></label>
              <fieldset class="avatar-choice"><legend>Avatar</legend>
                {#each Object.entries(AVATARS) as [id, symbol] (id)}<label><input type="radio" name="avatar" value={id} bind:group={profileAvatar} /><span aria-hidden="true">{symbol}</span><span class="sr-only">{AVATAR_NAMES[id as keyof typeof AVATARS]}</span></label>{/each}
              </fieldset>
              <div class="form-actions"><button class="secondary" type="submit">Gem profil</button><button class="text-button" type="button" onclick={() => editingProfile = false}>Annullér</button></div>
            </form>
          {:else}<button class="secondary" onclick={startProfileEdit}>Ret navn og avatar</button>{/if}
          <form class="account-form" onsubmit={(event) => { event.preventDefault(); void changePassword(); }}>
            <label>Nuværende adgangskode<input type="password" autocomplete="current-password" bind:value={currentPassword} required /></label>
            <label>Ny adgangskode<input type="password" autocomplete="new-password" minlength="8" bind:value={nextPassword} required /></label>
            <button class="secondary" type="submit" disabled={changingPassword}>{changingPassword ? "Ændrer…" : "Skift adgangskode"}</button>
          </form>
        {:else}<p class="muted">Adgangskoden kan ændres, når du er logget ind med forbindelse.</p>{/if}
      </details>
      {#if identity.role === "admin"}
        <details class="card secondary-panel"><summary>Spillere og konti</summary>
          {#if !showAccounts}<button class="secondary" onclick={loadAccounts}>Administrer konti</button>
          {:else}
            <p class="muted">Børneprofiler får kun børnebaner. Ændres profiltypen, logges kontoen ud på alle enheder, og baner til den gamle profiltype fjernes ved næste forbindelse.</p>
            <label class="admin-password">Din adgangskode (kræves for at ændre profiltype)<input type="password" autocomplete="current-password" bind:value={adminPassword} /></label>
            <div class="account-list">{#each accounts as account (account.id)}<div class="account-row">
              <span>{account.avatar && account.avatar in AVATARS ? AVATARS[account.avatar as keyof typeof AVATARS] : ""} {account.name} <small>@{account.username} · {account.child ? "Barn" : "Voksen"}{account.role === "admin" ? " · Administrator" : ""}{account.banned ? " · Deaktiveret" : ""}</small></span>
              {#if account.id !== identity.id}<span class="account-actions">
                {#if account.role !== "admin"}<button class="text-button" onclick={() => setChildProfile(account, !account.child)}>{account.child ? "Gør til voksen" : "Gør til barn"}</button>{/if}
                <button class="text-button" onclick={() => setBanned(account, !account.banned)}>{account.banned ? "Genaktivér" : "Deaktivér"}</button>
                <button class="text-button" onclick={() => resetPassword(account)}>Nulstil adgangskode</button>
                <button class="text-button danger" onclick={() => deleteAccount(account)}>Slet konto</button>
              </span>{/if}
            </div>{/each}</div>
            <form class="account-form" onsubmit={(event) => { event.preventDefault(); void createAccount(); }}>
              <label>Navn<input bind:value={newName} required /></label><label>Brugernavn<input bind:value={newUser} pattern={"[A-Za-z0-9_.\\-]{3,30}"} required /></label><label>Adgangskode<input type="password" minlength="8" bind:value={newPassword} required /></label><label class="checkbox"><input type="checkbox" bind:checked={newChild} /> Børneprofil</label><button class="secondary" type="submit">Opret spiller</button>
            </form>
          {/if}
        </details>
        <details class="card secondary-panel" ontoggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open && !wordAdmin) void loadWordAdmin(); }}><summary>Ordlister</summary>
          {#if wordAdmin}
            <p class="muted">Find ord {wordAdmin.versions.app} · ordliste v{wordAdmin.versions.words} · kategorier v{wordAdmin.versions.categories} · børnepolitik v{wordAdmin.versions.childPolicy} · validering v{wordAdmin.versions.validation} · COR {wordAdmin.versions.cor} · {wordAdmin.blockedSequences} blokerede sekvenser. Listerne ændres i koden efter den redaktionelle procedure i <code>docs/ordindhold.md</code>; git er historikken, og rollback sker med en tidligere udgave.</p>
            <!-- A scrollable region must be reachable by keyboard (axe: scrollable-region-focusable). -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <div class="table-scroll" tabindex="0" role="region" aria-label="Dækning pr. kategori og niveau"><table class="coverage-table"><caption>Dækning: ord med niveauets længde, voksen / barn</caption>
              <thead><tr><th scope="col">Kategori</th>{#each Object.entries(LEVELS) as [id, item] (id)}<th scope="col">{item.name}<small> ({item.words})</small></th>{/each}</tr></thead>
              <tbody>{#each wordAdmin.coverage as row (row.category)}<tr><th scope="row">{row.name}</th>{#each Object.keys(LEVELS) as id (id)}{@const cell = row.levels[id]}<td class:closed={!cell.adultOpen || !cell.childOpen}>{cell.adult} / {cell.child}{#if !cell.childOpen}<small> lukket for børn</small>{/if}{#if !cell.adultOpen}<small> lukket</small>{/if}</td>{/each}</tr>{/each}</tbody></table></div>
            <div class="word-filters">
              <label>Søg<input type="search" bind:value={wordQuery} autocomplete="off" /></label>
              <label>Kategori<select bind:value={wordCategory}><option value="">Alle</option>{#each Object.entries(CATEGORIES) as [id, item] (id)}<option value={id}>{item.name}</option>{/each}</select></label>
              <label>Børn<select bind:value={wordChild}><option value="">Alle</option><option value="ja">Godkendt</option><option value="nej">Kun voksne</option></select></label>
            </div>
            <p class="muted" aria-live="polite">{shownWords.length} af {wordAdmin.words.length} tilknytninger{shownWords.length > 200 ? " (de første 200 vises)" : ""}.</p>
            <!-- A scrollable region must be reachable by keyboard (axe: scrollable-region-focusable). -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <div class="table-scroll" tabindex="0" role="region" aria-label="Ord og kilder"><table class="word-table"><thead><tr><th scope="col">Ord</th><th scope="col">Kategori</th><th scope="col">Børn</th><th scope="col">Læseniveau</th><th scope="col">COR-kilde</th></tr></thead>
              <tbody>{#each shownWords.slice(0, 200) as item (`${item.category}/${item.word}`)}<tr><td>{item.word}</td><td>{CATEGORIES[item.category].name}</td><td>{item.child ? "Godkendt" : `Nej: ${item.reason}`}</td><td>{item.readingLevel}</td><td><small>{item.sources.join(", ") || "mangler"}</small></td></tr>{/each}</tbody></table></div>
          {:else}<p class="muted">{wordAdminError || "Henter ordlisterne…"}</p>{/if}
        </details>
      {/if}
    {:else}
      <section class="game-heading">
        <button class="back" onclick={() => { active = null; selectedStart = null; message = ""; }} disabled={markingWord}>← Forside</button>
        <div class="game-title"><div class="eyebrow">{active.campaignId ? `KAMPAGNE · BANE ${active.campaignPosition} · ` : ""}{LEVELS[active.puzzle.level].name.toLocaleUpperCase("da-DK")} · {active.puzzle.grid.length} × {active.puzzle.grid.length}</div><h1>{CATEGORIES[active.puzzle.category].name}</h1></div>
        <p class="game-status">{active.found.length} af {active.puzzle.words.length} ord · {pending ? `${pending} træk afventer synkronisering` : online ? "Synkroniseret" : "Gemt på enheden"}</p>
        <p class="game-directions">Ordretninger: {directionDescription(active.puzzle.level)}.</p>
        {#if identity.child}<details class="game-child-notice"><summary>Om børneord</summary><p>Børnebaner bruger kun ord, der er godkendt til børn, og gitteret tjekkes for uønskede ord. Ingen kontrol fanger alt, så sig til en voksen, hvis du ser noget mærkeligt. Ændringer i kontrollen tjekkes ved næste forbindelse.</p></details>{/if}
      </section>
      <div class="game-layout" class:completed-layout={active.completed}>
        <section class="card grid-card"><div class="grid-header"><span>{active.abandoned ? "BANE OPGIVET" : active.completed ? "BANE GENNEMFØRT" : "FIND ORDENE"}</span><span>{active.found.length} / {active.puzzle.words.length}</span><a class="word-jump" href="#word-list">Se ordlisten ↓</a></div>
          {#if active.completed}
            <div class="completion-panel" aria-live="polite">
              <h2 tabindex="-1" bind:this={completionHeading}>{active.abandoned ? "Bane opgivet" : "Bane gennemført!"}</h2>
              <p>Du fandt {active.found.length} af {active.puzzle.words.length} ord.{active.abandoned ? " En opgivet bane tæller ikke som gennemført." : ""}</p>
              <p class="completion-sync">{activePending ? "Resultatet er gemt på enheden og afventer synkronisering. Nye achievements beregnes, når det er synkroniseret." : "Resultatet er gemt."}</p>
              {#if newAchievements.length}<p class="completion-achievements">★ Ny achievement: {newAchievements.map((item) => item.title).join(", ")}</p>{/if}
              <div class="completion-actions">
                {#if active.campaignId}<button class="primary" onclick={nextInCampaign} disabled={busy}>Næste bane →</button>
                {:else}<button class="primary" onclick={newSingleGame} disabled={busy}>{busy ? "Henter bane…" : "Ny bane →"}</button>{/if}
                <button class="secondary" onclick={() => { active = null; selectedStart = null; message = ""; }}>Forside</button>
              </div>
              {#if !online && active.campaignId && !nextCampaignGame}<p class="completion-note">Ingen hentet næste bane er klar. Opret forbindelse for at hente flere.</p>{/if}
              {#if !online && !active.campaignId && !nextSingleGame}<p class="completion-note">Ingen hentet bane i samme kategori og sværhedsgrad er klar. Opret forbindelse for at hente en ny.</p>{/if}
            </div>
          {/if}
          <div class="letter-grid" id="letter-grid" tabindex="-1" style={`--size:${active.puzzle.grid.length}`} onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerUp} onpointercancel={pointerCancel} onlostpointercapture={pointerCancel} role="group" aria-label="Bogstavgitter">
            {#each active.puzzle.grid as row, rowIndex (rowIndex)}
              {#each row as letter, colIndex (colIndex)}
                <button class:found-cell={foundCells.some((cell) => cell.row === rowIndex && cell.col === colIndex)} class:hint-start={shownHint?.start.row === rowIndex && shownHint?.start.col === colIndex} class:preview-cell={selectedCells.some((cell) => cell.row === rowIndex && cell.col === colIndex)} class:preview-start={previewStart?.row === rowIndex && previewStart?.col === colIndex} class:preview-end={previewEnd?.row === rowIndex && previewEnd?.col === colIndex && (previewStart?.row !== rowIndex || previewStart?.col !== colIndex)} class:rejected-cell={rejectedStart !== null && dragStart === null && selectedCells.some((cell) => cell.row === rowIndex && cell.col === colIndex)} class:tap-start={selectedStart?.row === rowIndex && selectedStart?.col === colIndex} data-row={rowIndex} data-col={colIndex} tabindex={focusCell.row === rowIndex && focusCell.col === colIndex ? 0 : -1} onfocus={() => focusCell = { row: rowIndex, col: colIndex }} onkeydown={(event) => keyCell(event, rowIndex, colIndex)} aria-label={`Række ${rowIndex + 1}, kolonne ${colIndex + 1}, ${letter}${shownHint?.start.row === rowIndex && shownHint?.start.col === colIndex ? `, startfelt for hint til ${shownHint.word}` : ""}${selectedStart?.row === rowIndex && selectedStart?.col === colIndex ? ", valgt startfelt" : ""}`}><span>{letter}</span></button>
              {/each}
            {/each}
            {#if previewStart && previewEnd && (previewStart.row !== previewEnd.row || previewStart.col !== previewEnd.col)}
              <svg class="selection-line" class:rejected-line={rejectedStart !== null && dragStart === null} viewBox={`0 0 ${active.puzzle.grid.length} ${active.puzzle.grid.length}`} preserveAspectRatio="none" aria-hidden="true" focusable="false"><line x1={previewStart.col + 0.5} y1={previewStart.row + 0.5} x2={previewEnd.col + 0.5} y2={previewEnd.row + 0.5} /></svg>
            {/if}
          </div>
          <p class="grid-tip">Træk fra første til sidste bogstav, eller tryk på de to ender. Brug piletasterne på tastatur.</p>
          {#if shownHint && selectionFeedback !== `Hint til ${shownHint.word}: begynd i række ${shownHint.start.row + 1}, kolonne ${shownHint.start.col + 1}.`}<p class="hint-location">Hint til {shownHint.word}: begynd i række {shownHint.start.row + 1}, kolonne {shownHint.start.col + 1}. Det blå felt viser starten.</p>{/if}
          <p class="selection-feedback" role="status">{selectionFeedback}</p>
          {#if message && message !== selectionFeedback}<div class="game-message" role="status"><span>{message}</span><button aria-label="Luk besked" onclick={() => message = ""}>×</button></div>{/if}
          {#if !active.completed}
            <div class="hint-controls"><button class="secondary hint-button" onclick={hint} disabled={hintSaving || hintsRemaining(active.puzzle.level, active.hints) === 0 || credits < 1}>Vis et hint · 1 kredit</button><span>Hints tilbage: {hintsRemaining(active.puzzle.level, active.hints)}/{HINT_LIMIT[active.puzzle.level]} · Kreditter: {credits}</span><button class="text-button abandon-button" onclick={abandon} disabled={markingWord || hintSaving}>Opgiv bane</button></div>
            {#if hintsRemaining(active.puzzle.level, active.hints) === 0}<p class="hint-explanation">Alle hints på denne bane er brugt.</p>
            {:else if credits < 1}<p class="hint-explanation">Du har ingen hintkreditter. Klar et mål for at få flere. <button class="text-button" onclick={showGoals} disabled={markingWord}>Se målene</button></p>{/if}
          {/if}
        </section>
        <aside class="card word-card" id="word-list" tabindex="-1"><div class="grid-header"><span>ORDLISTE</span><span>{active.found.length} / {active.puzzle.words.length}</span><a class="grid-jump" href="#letter-grid">Til gitteret ↑</a></div><div class="words">
          {#each active.puzzle.words as word (word)}<div class:found={active.found.includes(word)} class:hinted={shownHint?.word === word}><span class="check">{active.found.includes(word) ? "✓" : ""}</span><span>{word}</span><span class="hintmark">{active.hints.includes(word) ? "· hint" : ""}</span></div>{/each}
          </div>
        </aside>
      </div>
    {/if}
  {/if}
  {#if message && !active}<div class="toast" role="status"><span>{message}</span><button aria-label="Luk besked" onclick={() => message = ""}>×</button></div>{/if}
</main>
