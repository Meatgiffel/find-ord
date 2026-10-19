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
  import Icon from "./Icon.svelte";

  type Pill = { tone: "ok" | "warn" | "neutral" | "info"; icon: "cloud" | "sync" | "device" | "check"; text: string; short: string };

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
  let viewportW = window.innerWidth;
  let viewportH = window.innerHeight;
  let stageWidth = 0;
  let gridViewport: HTMLDivElement | undefined;
  let gridInner: HTMLDivElement | undefined;
  let singleCard: HTMLElement | undefined;
  let accountPanel: HTMLDetailsElement | undefined;
  let abandonDialog: HTMLDivElement | undefined;
  let confirmAbandon = false;
  let showPassword = false;
  let levelNote = "";
  let campaignNote = "";
  let creating: { title: string; meta: string; size: number; heading: string; text: string } | null = null;
  // Short feedback over the grid; the same text goes to the live region.
  let gridToast: { kind: "ok" | "bad" | "info"; text: string } | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  // Large boards on narrow screens show a movable window ("Tæt på") or the whole board for orientation.
  let overview = false;
  let view = { r0: 0, c0: 0 };
  let lastPointer: { x: number; y: number } | null = null;
  let edgeTimer: ReturnType<typeof setInterval> | null = null;

  const levelIds = Object.keys(LEVELS) as LevelId[];
  const ARROWS = ["→", "↓", "←", "↑", "↘", "↙", "↗", "↖"];
  const DIRECTION_SHORT: Record<number, string> = { 2: "mod højre og nedad", 4: "vandret og lodret", 8: "alle 8 retninger" };
  const directionArrows = (id: LevelId) => ARROWS.slice(0, LEVELS[id].directions).join(" ");
  const avatarTint = (id: string | null | undefined) => id ? Math.max(0, Object.keys(AVATARS).indexOf(id)) % 5 : 0;

  $: size = active?.puzzle.grid.length ?? 8;
  $: wide = viewportW >= 760;
  $: shortLandscape = viewportH <= 520 && viewportW > viewportH;
  $: split = wide || shortLandscape;
  $: roomy = wide && !shortLandscape;
  // The grid's side length: the phone's width, the height of a landscape phone, or what is left beside the word list.
  $: gridBox = Math.floor(shortLandscape ? Math.min(viewportH - 24, viewportW * 0.5)
    : wide ? Math.min(viewportW - 48 - 240 - 24, 760, Math.max(280, viewportH - 120))
    : Math.min(stageWidth || viewportW - 32, Math.max(240, viewportH - 160)));
  $: zoomable = size > 8 && gridBox / size < 24;
  $: viewCells = zoomable ? Math.min(size, Math.max(6, Math.floor(gridBox / 35))) : size;
  $: zoomed = zoomable && !overview;
  $: shownCells = zoomed ? viewCells : size;
  $: cellPx = Math.max(12, Math.floor(gridBox / shownCells * 10) / 10);
  $: panStep = Math.ceil(viewCells / 2);
  $: view = clampView(view, size, viewCells);

  $: foundCaps = active ? active.puzzle.words.flatMap((word, index) => {
    const path = active!.found.includes(word) ? findWord(active!.puzzle, word) : null;
    return path ? [{ word, color: index % 5, ...path }] : [];
  }) : [];
  $: missedCaps = active?.abandoned ? active.puzzle.words.flatMap((word) => {
    const path = active!.found.includes(word) ? null : findWord(active!.puzzle, word);
    return path ? [{ word, ...path }] : [];
  }) : [];
  $: nearestGoal = challengeInfo?.challenges.filter((goal) => !goal.completed)
    .sort((a, b) => (b.progress / b.target) - (a.progress / a.target))[0];
  $: savedSingles = games.filter((game) => !game.campaignId);
  $: campaignForLevel = campaigns.find((item) => item.level === campaignLevel);
  $: readyInCampaign = campaignForLevel ? games.filter((game) => game.campaignId === campaignForLevel!.id && !game.completed).length : 0;
  $: syncPill = (pending
    ? { tone: "warn", icon: "sync", text: `Afventer synkronisering · ${pending} træk`, short: `${pending} træk venter` }
    : online && !sessionExpired ? { tone: "ok", icon: "cloud", text: "Alt er synkroniseret", short: "Synkroniseret" }
    : { tone: "neutral", icon: "device", text: "Gemt på enheden", short: "Gemt" }) as Pill;
  $: gamePill = (activePending
    ? { tone: "warn", icon: "sync", text: `Afventer synkronisering · ${pending} træk`, short: `${pending} træk venter` }
    : online && !sessionExpired ? { tone: "ok", icon: "cloud", text: "Synkroniseret", short: "Synkroniseret" }
    : { tone: "neutral", icon: "device", text: "Gemt på enheden", short: "Gemt" }) as Pill;

  function clampView(next: { r0: number; c0: number }, boardSize: number, cells: number) {
    const max = Math.max(0, boardSize - cells);
    const r0 = Math.max(0, Math.min(max, next.r0)), c0 = Math.max(0, Math.min(max, next.c0));
    return r0 === next.r0 && c0 === next.c0 ? next : { r0, c0 };
  }
  function pan(rows: number, cols: number) {
    view = clampView({ r0: view.r0 + rows, c0: view.c0 + cols }, size, viewCells);
  }
  function centerView(point: Point) {
    view = clampView({ r0: point.row - Math.floor(viewCells / 2), c0: point.col - Math.floor(viewCells / 2) }, size, viewCells);
  }
  function ensureVisible(point: Point) {
    if (!zoomed) return;
    let { r0, c0 } = view;
    if (point.row < r0) r0 = point.row;
    if (point.row >= r0 + viewCells) r0 = point.row - viewCells + 1;
    if (point.col < c0) c0 = point.col;
    if (point.col >= c0 + viewCells) c0 = point.col - viewCells + 1;
    view = clampView({ r0, c0 }, size, viewCells);
  }
  function pickOverview(point: Point) {
    overview = false;
    focusCell = point;
    centerView(point);
  }
  function miniClick(event: MouseEvent) {
    overview = false;
    // Activated from the keyboard: step through the four corners.
    if (event.detail === 0) {
      const max = size - viewCells;
      const corners = [{ r0: 0, c0: 0 }, { r0: 0, c0: max }, { r0: max, c0: max }, { r0: max, c0: 0 }];
      const at = corners.findIndex((item) => item.r0 === view.r0 && item.c0 === view.c0);
      view = corners[(at + 1) % corners.length];
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    centerView({ row: Math.floor((event.clientY - rect.top) / rect.height * size), col: Math.floor((event.clientX - rect.left) / rect.width * size) });
  }
  function capsule(start: Point, end: Point) {
    const x1 = start.col + 0.5, y1 = start.row + 0.5, x2 = end.col + 0.5, y2 = end.row + 0.5, h = 0.84;
    return { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, w: Math.hypot(x2 - x1, y2 - y1) + h, h, angle: Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI };
  }
  function flash(kind: "ok" | "bad" | "info", text: string, spoken = text) {
    if (toastTimer) clearTimeout(toastTimer);
    gridToast = { kind, text };
    selectionFeedback = spoken;
    toastTimer = setTimeout(() => { gridToast = null; }, 1800);
  }
  function leaveGame() {
    active = null; selectedStart = null; message = ""; confirmAbandon = false;
  }
  async function openAccount() {
    leaveGame();
    await tick();
    if (!accountPanel) return;
    accountPanel.open = true;
    accountPanel.scrollIntoView({ block: "start" });
    accountPanel.querySelector("summary")?.focus();
  }
  async function focusSingle() {
    singleCard?.scrollIntoView({ block: "start" });
    singleCard?.focus();
  }

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
    view = { r0: 0, c0: 0 };
    overview = false;
    confirmAbandon = false;
    gridToast = null;
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
    creating = {
      title: requestedCategory === "surprise" ? "Overrask mig" : CATEGORIES[chosenCategory].name,
      meta: `${LEVELS[chosenLevel].name} · ${LEVELS[chosenLevel].size}×${LEVELS[chosenLevel].size}`,
      size: LEVELS[chosenLevel].size,
      heading: "Danner bane…",
      text: `Vi lægger ${LEVELS[chosenLevel].words} ord om ${CATEGORIES[chosenCategory].name.toLocaleLowerCase("da-DK")} ind i gitteret.`
    };
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
      if (shellReady) selectionFeedback = "Banen er gemt og klar offline.";
      else message = "Banen er gemt. Vent på, at appen bliver klar til offlinebrug.";
    } catch (cause) { message = isQuotaError(cause) ? QUOTA_MESSAGE : cause instanceof Error ? cause.message : "Banen kunne ikke hentes."; }
    finally { busy = false; creating = null; }
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
    creating = {
      title: "Endeløs kampagne",
      meta: `${LEVELS[campaignLevel].name} · ${LEVELS[campaignLevel].size}×${LEVELS[campaignLevel].size}`,
      size: LEVELS[campaignLevel].size,
      heading: "Henter baner…",
      text: "De næste baner hentes og gemmes på enheden, så du kan spille dem offline."
    };
    try {
      if (!await refreshConnectedAccount() || !identity) return;
      const bundle = await api("/campaigns", { method: "POST", body: JSON.stringify({ level: campaignLevel }) }) as DownloadedCampaign;
      await storeCampaign(bundle);
      active = games.filter((game) => game.campaignId === bundle.id && !game.completed)
        .sort((a, b) => (a.campaignPosition ?? 0) - (b.campaignPosition ?? 0))[0] ?? null;
      if (active) selectionFeedback = "Kampagnebanerne er hentet og klar offline.";
      else message = "Der er ingen bane klar endnu. Prøv igen med forbindelse.";
    } catch (cause) { message = isQuotaError(cause) ? QUOTA_MESSAGE : cause instanceof Error ? cause.message : "Kampagnen kunne ikke hentes."; }
    finally { busy = false; creating = null; }
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
    rejectionTimer = setTimeout(clearRejection, 1800);
  }

  async function markWord(start: Point, end: Point) {
    if (!active || active.completed || markingWord) return;
    const word = wordAt(active.puzzle, start, end);
    if (!word || active.found.includes(word)) {
      const path = cellsBetween(start, end);
      const letters = path?.map(({ row, col }) => active!.puzzle.grid[row]?.[col] ?? "").join("") ?? "";
      if (word) flash("info", `${word} er allerede fundet`);
      else if (path) {
        flash("bad", "✕ Ikke et ord – prøv igen", `Markeret: ${letters}. Det er ikke et ord på listen.`);
        showRejection(start, end);
      } else flash("bad", "Markér på en lige linje", "Markér et ord på en lige linje.");
      return;
    }
    markingWord = true;
    try {
      const found = [...active.found, word];
      if (!await addMove({ id: newMoveId(), kind: "find", word, start, end }, { found, hints: active.hints, completed: false })) {
        selectionFeedback = "";
        return;
      }
      if (found.length === active.puzzle.words.length && active) {
        if (!await addMove({ id: newMoveId(), kind: "complete" }, { found, hints: active.hints, completed: true })) {
          selectionFeedback = "";
          return;
        }
        message = "";
        flash("ok", `✓ Fundet: ${word}`);
        selectionFeedback = online ? "Alle ord fundet! Resultatet synkroniseres." : "Alle ord fundet! Resultatet gemmes på serveren, når der er forbindelse.";
        await tick();
        completionHeading?.focus();
      } else flash("ok", `✓ Fundet: ${word}`, `${word} fundet!`);
    } finally { markingWord = false; }
  }
  // Markings are handled one at a time, so a word marked while the previous one is
  // still being saved waits instead of being dropped.
  let markQueue: Promise<void> = Promise.resolve();
  function submitWord(start: Point, end: Point) {
    markQueue = markQueue.then(() => markWord(start, end)).catch(() => {
      flash("bad", "Kunne ikke registrere ordet. Prøv igen.");
    });
  }

  function cellFromPointer(event: PointerEvent): Point | null {
    const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-row][data-col]");
    if (!element) return null;
    return { row: Number(element.dataset.row), col: Number(element.dataset.col) };
  }
  function pointerInsideGrid(x: number, y: number): boolean {
    const rect = gridViewport?.getBoundingClientRect();
    return !!rect && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
  }
  // Snaps the end of a drag to the nearest allowed direction. In the zoomed view the
  // end stays inside the visible window, which slides when the finger rests at its edge.
  function endAt(x: number, y: number): Point | null {
    if (!dragStart || !active || !gridInner || !pointerInsideGrid(x, y)) return null;
    const rect = gridInner.getBoundingClientRect();
    const cell = rect.width / size;
    const span = zoomed ? viewCells : size;
    const clamp = (value: number, first: number) => Math.max(first - 0.49, Math.min(first + span - 0.51, value));
    return snapDragEnd(dragStart, {
      row: clamp((y - rect.top) / cell - 0.5, zoomed ? view.r0 : 0),
      col: clamp((x - rect.left) / cell - 0.5, zoomed ? view.c0 : 0)
    }, size, LEVELS[active.puzzle.level].directions, dragEnd);
  }
  function clearDrag() {
    dragStart = null;
    dragEnd = null;
    dragPointerId = null;
    dragOrigin = null;
    dragHasMoved = false;
    lastPointer = null;
    if (edgeTimer) clearInterval(edgeTimer);
    edgeTimer = null;
  }
  function movedEnough(event: PointerEvent): boolean {
    if (!dragOrigin || !active) return false;
    const threshold = Math.min(10, Math.max(5, cellPx * 0.35));
    return Math.hypot(event.clientX - dragOrigin.x, event.clientY - dragOrigin.y) >= threshold;
  }
  async function edgePan() {
    if (!zoomed || !dragHasMoved || !lastPointer || !gridViewport) return;
    const rect = gridViewport.getBoundingClientRect(), zone = rect.width * 0.12;
    const cols = lastPointer.x < rect.left + zone ? -1 : lastPointer.x > rect.right - zone ? 1 : 0;
    const rows = lastPointer.y < rect.top + zone ? -1 : lastPointer.y > rect.bottom - zone ? 1 : 0;
    if (!rows && !cols) return;
    pan(rows, cols);
    await tick();
    if (lastPointer) dragEnd = endAt(lastPointer.x, lastPointer.y) ?? dragEnd;
  }
  function pointerDown(event: PointerEvent) {
    if (!active || active.completed || dragPointerId !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
    const start = cellFromPointer(event);
    if (!start) return;
    if (zoomable && overview) { pickOverview(start); return; }
    clearRejection();
    dragPointerId = event.pointerId;
    dragStart = start;
    dragEnd = start;
    dragOrigin = { x: event.clientX, y: event.clientY };
    dragHasMoved = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    if (zoomed) edgeTimer = setInterval(() => void edgePan(), 300);
  }
  function pointerMove(event: PointerEvent) {
    if (event.pointerId !== dragPointerId) return;
    lastPointer = { x: event.clientX, y: event.clientY };
    if (!dragHasMoved && !movedEnough(event)) return;
    dragHasMoved = true;
    dragEnd = endAt(event.clientX, event.clientY) ?? dragEnd;
  }
  function pointerUp(event: PointerEvent) {
    if (event.pointerId !== dragPointerId || !dragStart) return;
    const start = dragStart;
    const inside = pointerInsideGrid(event.clientX, event.clientY);
    const wasDrag = dragHasMoved || movedEnough(event);
    const end = inside ? endAt(event.clientX, event.clientY) : dragEnd;
    clearDrag();
    if (wasDrag) {
      selectedStart = null;
      if (end && (end.row !== start.row || end.col !== start.col)) submitWord(start, end);
      else flash("info", inside ? "Træk til ordets sidste bogstav, før du slipper." : "Trækket sluttede uden for gitteret. Prøv igen.");
    } else {
      if (!inside) {
        flash("info", "Slip inde i gitteret, eller tryk på start- og slutfelt.");
        return;
      }
      const tapped = cellFromPointer(event);
      if (tapped) {
        if (selectedStart && selectedStart.row === tapped.row && selectedStart.col === tapped.col) {
          selectedStart = null;
          selectionFeedback = "Markering annulleret.";
        } else if (selectedStart) { const first = selectedStart; selectedStart = null; submitWord(first, tapped); }
        else {
          selectedStart = tapped;
          selectionFeedback = `Startfelt valgt: ${active?.puzzle.grid[tapped.row]?.[tapped.col]}, række ${tapped.row + 1}, kolonne ${tapped.col + 1}. Tryk på sidste bogstav.`;
        }
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
    flash("info", "Trækket blev afbrudt. Prøv igen.");
  }
  function keyCell(event: KeyboardEvent, row: number, col: number) {
    if (!active || active.completed) return;
    const directions: Record<string, Point> = { ArrowUp: { row: -1, col: 0 }, ArrowDown: { row: 1, col: 0 }, ArrowLeft: { row: 0, col: -1 }, ArrowRight: { row: 0, col: 1 } };
    const step = directions[event.key];
    if (step) {
      event.preventDefault();
      const last = active.puzzle.grid.length - 1;
      focusCell = { row: Math.max(0, Math.min(last, row + step.row)), col: Math.max(0, Math.min(last, col + step.col)) };
      ensureVisible(focusCell);
      // The window moves by transform, so the browser must not scroll the clipped grid itself.
      document.querySelector<HTMLButtonElement>(`[data-row="${focusCell.row}"][data-col="${focusCell.col}"]`)?.focus({ preventScroll: true });
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (zoomable && overview) { pickOverview({ row, col }); return; }
      if (selectedStart?.row === row && selectedStart.col === col) { selectedStart = null; selectionFeedback = "Markering annulleret."; }
      else if (selectedStart) { const first = selectedStart; selectedStart = null; submitWord(first, { row, col }); }
      else selectedStart = { row, col };
    }
    if (event.key === "Escape") { selectedStart = null; clearRejection(); confirmAbandon = false; }
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
    leaveGame();
    await tick();
    goalsCard?.scrollIntoView({ block: "start" });
    goalsCard?.focus();
  }

  async function abandon() {
    if (!active || active.completed || markingWord || hintSaving) return;
    confirmAbandon = false;
    selectedStart = null;
    if (!await addMove({ id: newMoveId(), kind: "abandon" }, { found: active.found, hints: active.hints, completed: true, abandoned: true })) return;
    selectionFeedback = "Banen er opgivet.";
    message = "";
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
<svelte:window bind:innerWidth={viewportW} bind:innerHeight={viewportH} />

{#snippet avatar(id: string | null | undefined, size = "")}
  <span class={`avatar tint-${avatarTint(id)} ${size}`} aria-hidden="true">{id && id in AVATARS ? AVATARS[id as keyof typeof AVATARS] : "🙂"}</span>
{/snippet}
{#snippet pill(state: Pill, compact = false)}
  <span class={`pill ${state.tone}`} class:compact><Icon name={state.icon} size={15} /><span class="pill-text">{compact ? state.short : state.text}</span></span>
{/snippet}
{#snippet logo(large = false)}
  <span class="logo" class:large>FIND<span class="sr-only"> ord</span></span>
{/snippet}

{#if identity && (!active || roomy)}
  <header class="topbar">
    {@render logo()}
    {#if active}<nav class="crumbs" aria-label="Brødkrumme"><button class="link" onclick={leaveGame} disabled={markingWord}>Forside</button><span aria-hidden="true">/</span><span>{active.campaignId ? `Endeløs kampagne · bane ${active.campaignPosition}` : "Enkelt bane"}</span></nav>{/if}
    <span class="spacer"></span>
    {#if active}<span class="top-pill">{@render pill(gamePill)}</span>{/if}
    <button class="who" onclick={openAccount} aria-label={`Min konto: ${identity.name}`}>{@render avatar(identity.avatar)}<span class="who-name">{identity.name}{identity.role === "admin" ? " · Administrator" : ""}</span></button>
  </header>
{/if}
{#if identity && $updateReady && (!active || active.completed)}
  <div class="update-banner" role="status"><Icon name="update" /><span><b>En ny version er klar.</b>{active ? " Banen er slut, så du kan opdatere nu." : ""}</span><button class="btn info" onclick={() => void applyUpdate()} disabled={markingWord}>Opdatér</button></div>
{/if}

<main class:playing={!!active} class:short={!!active && shortLandscape}>
  {#if loading}
    <section class="loading-screen" aria-live="polite">{@render logo(true)}<h1>Finder dine baner…</h1></section>
  {:else if !identity}
    <section class="auth">
      {@render logo(true)}
      {#if setupNeeded}
        <div><h1>Opret første administrator</h1><p class="lead">Serveren har ingen konti endnu. Administratoren opretter derefter konti til de andre spillere.</p></div>
        {#if message}<div class="notice danger" role="alert"><Icon name="alert" /><span>{message}</span></div>{/if}
        <form onsubmit={(event) => { event.preventDefault(); void createFirstAdmin(); }}>
          <label class="field"><span>Opsætningskode</span><input class="mono" bind:value={setupToken} autocomplete="one-time-code" required /><small>{setupToken ? "Koden virker én gang." : "Koden står i serverens log, fx med docker compose logs find-ord."}</small></label>
          <label class="field"><span>Brugernavn</span><input autocomplete="username" bind:value={username} pattern={"[A-Za-z0-9_.\\-]{3,30}"} required /><small>Bruges til at logge ind. 3–30 bogstaver, tal, punktum, bindestreg eller understreg.</small></label>
          <label class="field"><span>Visningsnavn</span><input bind:value={setupName} maxlength="80" required /><small>Det navn familien ser, fx “Mor” eller “Mette”.</small></label>
          <label class="field"><span>Adgangskode</span><input type="password" autocomplete="new-password" minlength="8" bind:value={password} required /><small>Mindst 8 tegn.</small></label>
          <button class="btn primary large" disabled={busy || !online} type="submit">{busy ? "Opretter…" : "Opret administrator"}</button>
        </form>
      {:else}
        <div><h1>Log ind</h1><p class="lead">Velkommen tilbage til ordjagten.</p></div>
        {#if !online}<div class="notice warn" role="alert"><Icon name="alert" /><span><b>Serveren svarer ikke.</b> Tjek, at hjemmeserveren er tændt og at enheden er på nettet.</span></div>{/if}
        {#if message}<div class="notice" role="status"><Icon name="info" /><span>{message}</span></div>{/if}
        <form onsubmit={(event) => { event.preventDefault(); void signIn(); }}>
          <label class="field"><span>Brugernavn</span><input autocomplete="username" bind:value={username} required /></label>
          <div class="field"><label for="login-password">Adgangskode</label><span class="reveal"><input id="login-password" type={showPassword ? "text" : "password"} autocomplete="current-password" bind:value={password} required /><button type="button" class="link" onclick={() => showPassword = !showPassword} aria-pressed={showPassword} aria-label="Vis adgangskode">{showPassword ? "Skjul" : "Vis"}</button></span></div>
          <button class="btn primary large" disabled={busy || !online} type="submit">{busy ? "Logger ind…" : "Log ind"}</button>
        </form>
        <p class="aside"><Icon name="device" />Når du har logget ind én gang, kan du spille hentede baner på denne enhed uden internet.</p>
        <p class="footnote">Konti oprettes af en administrator. Har du glemt koden, så spørg den voksne, der styrer serveren.</p>
      {/if}
    </section>
  {:else if creating && !active}
    <section class="creating" aria-live="polite">
      <div class="game-top"><div class="title"><h1>{creating.title}</h1><p>{creating.meta}</p></div></div>
      <div class="creating-grid" style={`--size:${creating.size}`}><div class="creating-box"><b>{creating.heading}</b><span>{creating.text}</span></div></div>
    </section>
  {:else if !active}
    <div class="home">
      <div class="hello">
        <h1>Hej, {identity.name}</h1>
        <div class="pills">{@render pill(syncPill)}{@render pill(shellReady ? { tone: "ok", icon: "check", text: "Klar offline", short: "Klar offline" } : { tone: "neutral", icon: "device", text: "Afventer offlineapp", short: "Afventer offlineapp" })}</div>
      </div>
      {#if sessionExpired}
        <div class="notice danger" role="alert"><Icon name="alert" /><div><b>Session udløbet</b><span>Dine træk er gemt på enheden. Log ind igen for at synkronisere dem.</span><button class="btn primary" onclick={showLogin}>Log ind igen</button></div></div>
      {:else if !networkUp}
        <div class="notice" role="status"><Icon name="offline" /><div><b>Ingen internet</b><span>Du kan spille hentede baner videre. Dine træk gemmes på enheden og sendes, når du er online igen.</span></div></div>
      {:else if !online}
        <div class="notice warn" role="status"><Icon name="alert" /><div><b>Serveren svarer ikke</b><span>Hentede baner kan spilles videre. Trækkene sendes, når forbindelsen er tilbage.</span><button class="btn outline warn" onclick={() => void reconnect()}>Prøv nu</button></div></div>
      {/if}
      {#if identity.child}<div class="kid-note">{@render avatar(identity.avatar)}<span><b>Du spiller med børneord.</b> Ordene er godkendt til børn, og gitteret tjekkes for uønskede ord. Ingen kontrol fanger alt, så sig til en voksen, hvis du ser noget mærkeligt.</span></div>{/if}

      <div class="cards">
        <section class="card" aria-labelledby="campaign-heading">
          <div><h2 id="campaign-heading">Endeløs kampagne</h2><p class="sub">{campaignForLevel ? `${readyInCampaign} hentede ${readyInCampaign === 1 ? "bane" : "baner"} klar. Én bane ad gangen.` : "Hver bane får en ny kategori. Banerne hentes til offlinebrug."}</p></div>
          <div class="seg" role="group" aria-label="Niveau i kampagnen">
            {#each levelIds as id (id)}{@const open = campaignLevels(childProfile).includes(id)}<button aria-pressed={campaignLevel === id} aria-disabled={!open} class:locked={!open} onclick={() => { if (open) { campaignLevel = id; campaignNote = ""; } else campaignNote = `${LEVELS[id].name} kan ikke spilles i kampagnen endnu: ingen kategori har ord nok${childProfile ? " blandt børneordene" : ""}.`; }}>{#if !open}<Icon name="lock" size={14} />{/if}{LEVELS[id].name}</button>{/each}
          </div>
          {#if campaignNote}<div class="notice locked" role="status"><Icon name="lock" /><span>{campaignNote}</span></div>{/if}
          <p class="directions"><span class="arrows" aria-hidden="true">{directionArrows(campaignLevel)}</span><span>{LEVELS[campaignLevel].size}×{LEVELS[campaignLevel].size} · Ordene står {directionDescription(campaignLevel)}.</span></p>
          <button class="btn primary" onclick={() => campaignForLevel ? openCampaign(campaignForLevel) : startCampaignFlow()} disabled={busy || (!campaignForLevel && !online)}>{busy ? "Henter baner…" : campaignForLevel ? `Fortsæt på ${LEVELS[campaignLevel].name}` : `Start på ${LEVELS[campaignLevel].name}`}</button>
          {#if !online}<p class="sub">{campaignForLevel ? "Når de hentede baner er spillet, kræver nye baner forbindelse." : "En ny kampagne kræver forbindelse."}</p>{/if}
        </section>

        <section class="card" id="single" tabindex="-1" bind:this={singleCard} aria-labelledby="single-heading">
          <h2 id="single-heading">En enkelt bane</h2>
          <div class="field"><label for="single-category">Kategori</label><select id="single-category" bind:value={category} onchange={() => levelNote = ""}><option value="surprise">Overrask mig</option>{#each Object.entries(CATEGORIES) as [id, item] (id)}<option value={id}>{item.name}</option>{/each}</select></div>
          <div class="seg" role="group" aria-label="Niveau">
            {#each levelIds as id (id)}{@const open = available.includes(id)}<button aria-pressed={level === id} aria-disabled={!open} class:locked={!open} onclick={() => { if (open) { level = id; levelNote = ""; } else levelNote = category === "surprise" ? `Ingen kategori har ord nok til ${LEVELS[id].name} endnu.` : `${CATEGORIES[category as CategoryId].name} har ikke ord nok til ${LEVELS[id].name}${childProfile ? " blandt børneordene" : ""}. Vælg et andet niveau eller en anden kategori.`; }}>{#if !open}<Icon name="lock" size={14} />{/if}{LEVELS[id].name}</button>{/each}
          </div>
          {#if levelNote}<div class="notice locked" role="status"><Icon name="lock" /><span>{levelNote}</span></div>{/if}
          <p class="directions"><span class="arrows" aria-hidden="true">{directionArrows(level)}</span><span>{LEVELS[level].size}×{LEVELS[level].size} · Ordene står {directionDescription(level)}.</span></p>
          <button class="btn outline" onclick={() => startGame()} disabled={busy || !online}>{busy ? "Danner bane…" : "Start bane"}</button>
          {#if !online}<p class="sub">Nye baner kræver forbindelse. Hentede baner kan spilles offline.</p>{/if}
        </section>

        <section class="card" id="goals" tabindex="-1" bind:this={goalsCard} aria-labelledby="goals-heading">
          <div class="card-head"><div><h2 id="goals-heading">Mål</h2><p class="sub">Frivillige og uden tidsfrist. Hvert mål giver 1 hintkredit.</p></div><div class="credits"><span>Hintkreditter</span><b>{credits} af {challengeInfo?.max ?? 5}</b></div></div>
          {#if challengeInfo}
            <ul class="goal-list">{#each challengeInfo.challenges as goal (goal.id)}<li>
              <div class="goal-line"><span>{goal.title}</span><span>{goal.progress} af {goal.target}</span></div>
              {@render bar(goal.progress, goal.target, `${goal.title}: ${goal.progress} af ${goal.target}`)}
              {#if goal.completed}<small>Klaret. Kreditten venter, til du har plads under {challengeInfo.max}.</small>{/if}
            </li>{/each}</ul>
            {#if pending}<p class="sub">Træk, der venter på synkronisering, tælles med, når de er sendt.</p>{/if}
          {:else}<p class="sub">Målene vises, når du har forbindelse.</p>{/if}
        </section>
      </div>

      <div class="card stack">
        <details>
          <summary><span>Gemte baner</span><span class="count">{savedSingles.length ? savedSingles.length : "Ingen gemte baner"}</span><Icon name="down" /></summary>
          <div class="panel-body">
            {#if savedSingles.length}
              <ul class="rows">{#each savedSingles as game (game.id)}<li class="row">
                <div class="row-main"><b>{CATEGORIES[game.puzzle.category].name} · {LEVELS[game.puzzle.level].name}</b><span>{game.found.length} af {game.puzzle.words.length} ord · {game.abandoned ? "Opgivet" : game.completed ? "Gennemført" : shellReady ? "Klar offline" : "Afventer offlineapp"}</span></div>
                <button class="btn outline small" onclick={() => chooseGame(game)}>{game.completed ? "Se" : "Fortsæt"}</button>
              </li>{/each}</ul>
            {:else}
              <div class="empty"><Icon name="empty" size={22} /><span>Når du forlader en bane midt i, gemmes den her automatisk.</span><button class="btn outline small" onclick={focusSingle}>Start en bane</button></div>
            {/if}
            {#if !storagePersisted}<p class="sub">Browseren kan slette hentede baner ved pladsmangel. Synkronisér, før du rydder browserdata.</p>{/if}
            {#if online && pending}<button class="btn outline small" onclick={syncAll}>Synkronisér nu</button>{/if}
          </div>
        </details>
        <details>
          <summary><span>Achievements</span><span class="count">{achievements.filter((item) => item.unlocked).length} af {achievements.length}</span><Icon name="down" /></summary>
          <div class="panel-body">
            {#if achievements.length}
              {#if pending}<p class="sub">{pending} træk afventer synkronisering. Achievements opdateres, når de er modtaget.</p>{/if}
              {#if nextGoals(achievements).length}
                <h3 class="minor">Næste mål</h3>
                <ul class="goal-list">{#each nextGoals(achievements) as item (item.id)}<li>
                  <div class="goal-line"><span><span aria-hidden="true">{ACHIEVEMENT_ICONS[item.icon]}</span> {item.title}</span><span>{item.current} af {item.target}</span></div>
                  {@render bar(item.current, item.target, `${item.title}: ${item.current} af ${item.target}`)}
                </li>{/each}</ul>
              {/if}
              <div class="chips" role="group" aria-label="Vis achievements">
                {#each [["all", "Alle"], ["unlocked", "Optjent"], ["locked", "Mangler"]] as [value, label] (value)}<button class="chip" aria-pressed={achievementFilter === value} onclick={() => achievementFilter = value as typeof achievementFilter}>{label}</button>{/each}
              </div>
              <ul class="badges">{#each shownAchievements as item (item.id)}<li class:unlocked={item.unlocked}>
                <span class="badge-icon" aria-hidden="true">{ACHIEVEMENT_ICONS[item.icon]}</span>
                <b>{item.title}</b>
                <small>{item.description}</small>
                <small class="badge-state">{item.unlocked ? `✓ ${item.unlockedAt ? new Date(item.unlockedAt).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" }) : "Optjent"}` : `${item.current} af ${item.target}`}</small>
              </li>{/each}</ul>
            {:else}<p class="sub">Dine achievements vises, når du har forbindelse.</p>{/if}
          </div>
        </details>
        <details>
          <summary><span>Statistik</span><Icon name="down" /></summary>
          <div class="panel-body">
            {#if stats}
              <dl class="tiles">
                <div><dt>baner klaret</dt><dd>{stats.completed}</dd></div>
                <div><dt>ord fundet</dt><dd>{stats.found}</dd></div>
                <div><dt>forskellige ord</dt><dd>{stats.unique}</dd></div>
                <div><dt>baner uden hint</dt><dd>{stats.withoutHints}</dd></div>
                <div><dt>spilledage</dt><dd>{stats.activeDays}</dd></div>
              </dl>
              {#if stats.byCategory.length}
                <table class="table"><caption>Pr. kategori</caption><thead><tr><th scope="col">Kategori</th><th scope="col" class="num">Baner</th><th scope="col" class="num">Ord</th></tr></thead>
                  <tbody>{#each stats.byCategory as row (row.category)}<tr><th scope="row">{CATEGORIES[row.category as CategoryId]?.name ?? row.category}</th><td class="num">{row.completed}</td><td class="num">{row.found}</td></tr>{/each}</tbody></table>
              {/if}
              {#if pending}<p class="sub">Tallene er fra sidste synkronisering.</p>{/if}
            {:else}<p class="sub">Din statistik vises, når du har forbindelse.</p>{/if}
          </div>
        </details>
        <details bind:this={accountPanel}>
          <summary><span>Min konto</span><Icon name="down" /></summary>
          <div class="panel-body">
            <div class="me">{@render avatar(identity.avatar, "large")}<div><b>{identity.name}</b><span>@{identity.username} · {identity.child ? "Barn" : "Voksen"}{identity.role === "admin" ? " · Administrator" : ""}</span></div></div>
            <p class="sub">Kun en administrator kan ændre profiltypen.</p>
            {#if online && !sessionExpired}
              {#if editingProfile}
                <form class="form" onsubmit={(event) => { event.preventDefault(); void saveProfile(); }}>
                  <label class="field"><span>Visningsnavn</span><input bind:value={profileName} maxlength="80" required /></label>
                  <fieldset class="avatar-choice"><legend>Avatar</legend>
                    {#each Object.entries(AVATARS) as [id, symbol] (id)}<label class={`tint-${avatarTint(id)}`}><input type="radio" name="avatar" value={id} bind:group={profileAvatar} /><span aria-hidden="true">{symbol}</span><span class="sr-only">{AVATAR_NAMES[id as keyof typeof AVATARS]}</span></label>{/each}
                  </fieldset>
                  <div class="actions"><button class="btn primary" type="submit">Gem profil</button><button class="btn plain" type="button" onclick={() => editingProfile = false}>Annullér</button></div>
                </form>
              {:else}<button class="btn outline" onclick={startProfileEdit}>Ret navn og avatar</button>{/if}
              <form class="form" onsubmit={(event) => { event.preventDefault(); void changePassword(); }}>
                <h3 class="minor">Skift adgangskode</h3>
                <label class="field"><span>Nuværende adgangskode</span><input type="password" autocomplete="current-password" bind:value={currentPassword} required /></label>
                <label class="field"><span>Ny adgangskode</span><input type="password" autocomplete="new-password" minlength="8" bind:value={nextPassword} required /><small>Mindst 8 tegn. Andre enheder logges ud.</small></label>
                <div class="actions"><button class="btn outline" type="submit" disabled={changingPassword}>{changingPassword ? "Ændrer…" : "Skift adgangskode"}</button></div>
              </form>
            {:else}<p class="sub">Navn, avatar og adgangskode kan ændres, når du er logget ind med forbindelse.</p>{/if}
            <div class="actions"><button class="btn neutral" onclick={signOut} disabled={markingWord}>Log ud</button></div>
          </div>
        </details>
      </div>

      {#if identity.role === "admin"}
        <div class="divider"><span>Administration</span></div>
        <div class="card stack">
          <details ontoggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open && !showAccounts) void loadAccounts(); }}>
            <summary><span>Spillere og konti</span><span class="count">{showAccounts ? `${accounts.length} konti` : ""}</span><Icon name="down" /></summary>
            <div class="panel-body">
              {#if showAccounts}
                <p class="sub">Børneprofiler får kun børnebaner. Ændres profiltypen, logges kontoen ud på alle enheder, og baner til den gamle profiltype fjernes ved næste forbindelse.</p>
                <label class="field narrow"><span>Din adgangskode</span><input type="password" autocomplete="current-password" bind:value={adminPassword} /><small>Kræves for at ændre profiltype.</small></label>
                <ul class="accounts">{#each accounts as account (account.id)}<li class="row">
                  {@render avatar(account.avatar)}
                  <div class="row-main"><b>{account.name} <span class="handle">@{account.username}</span></b>
                    <span class="tags">{account.role === "admin" ? "Administrator" : account.child ? "Barn" : "Voksen"}{#if account.child}<span class="tag kid">Børneord</span>{/if}{#if account.banned}<span class="tag off">Deaktiveret</span>{/if}</span>
                    {#if account.id !== identity.id}<span class="row-actions">
                      {#if account.role !== "admin"}<button class="btn plain small" onclick={() => setChildProfile(account, !account.child)}>{account.child ? "Gør til voksen" : "Gør til barn"}</button>{/if}
                      <button class="btn plain small" onclick={() => setBanned(account, !account.banned)}>{account.banned ? "Genaktivér" : "Deaktivér"}</button>
                      <button class="btn plain small" onclick={() => resetPassword(account)}>Nulstil adgangskode</button>
                      <button class="btn plain small danger" onclick={() => deleteAccount(account)}>Slet konto</button>
                    </span>{/if}
                  </div>
                </li>{/each}</ul>
                <form class="form new-account" onsubmit={(event) => { event.preventDefault(); void createAccount(); }}>
                  <h3 class="minor">Ny spiller</h3>
                  <label class="field"><span>Navn</span><input bind:value={newName} required /></label>
                  <label class="field"><span>Brugernavn</span><input bind:value={newUser} pattern={"[A-Za-z0-9_.\\-]{3,30}"} required /></label>
                  <label class="field"><span>Adgangskode</span><input type="password" minlength="8" autocomplete="new-password" bind:value={newPassword} required /></label>
                  <label class="check"><input type="checkbox" bind:checked={newChild} /> Børneprofil</label>
                  <div class="actions"><button class="btn primary" type="submit">Opret spiller</button></div>
                </form>
              {:else}<p class="sub">Henter konti…</p>{/if}
            </div>
          </details>
          <details ontoggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open && !wordAdmin) void loadWordAdmin(); }}>
            <summary><span>Ordlister</span><span class="count">{wordAdmin ? `${wordAdmin.coverage.length} kategorier` : ""}</span><Icon name="down" /></summary>
            <div class="panel-body">
              {#if wordAdmin}
                <p class="sub">Find ord {wordAdmin.versions.app} · ordliste v{wordAdmin.versions.words} · kategorier v{wordAdmin.versions.categories} · børnepolitik v{wordAdmin.versions.childPolicy} · validering v{wordAdmin.versions.validation} · COR {wordAdmin.versions.cor} · {wordAdmin.blockedSequences} blokerede sekvenser. Listerne ændres i koden efter den redaktionelle procedure i <code>docs/ordindhold.md</code>; git er historikken, og rollback sker med en tidligere udgave.</p>
                <!-- A scrollable region must be reachable by keyboard (axe: scrollable-region-focusable). -->
                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                <div class="table-scroll" tabindex="0" role="region" aria-label="Dækning pr. kategori og niveau"><table class="table"><caption>Dækning: ord med niveauets længde, voksen / barn</caption>
                  <thead><tr><th scope="col">Kategori</th>{#each Object.entries(LEVELS) as [id, item] (id)}<th scope="col">{item.name}<small> ({item.words})</small></th>{/each}</tr></thead>
                  <tbody>{#each wordAdmin.coverage as row (row.category)}<tr><th scope="row">{row.name}</th>{#each Object.keys(LEVELS) as id (id)}{@const cell = row.levels[id]}<td class:closed={!cell.adultOpen || !cell.childOpen}>{cell.adult} / {cell.child}{#if !cell.childOpen}<small> lukket for børn</small>{/if}{#if !cell.adultOpen}<small> lukket</small>{/if}</td>{/each}</tr>{/each}</tbody></table></div>
                <div class="filters">
                  <label class="field"><span>Søg i ord</span><input type="search" bind:value={wordQuery} autocomplete="off" placeholder="fx brød, ø" /></label>
                  <label class="field"><span>Kategori</span><select bind:value={wordCategory}><option value="">Alle</option>{#each Object.entries(CATEGORIES) as [id, item] (id)}<option value={id}>{item.name}</option>{/each}</select></label>
                  <label class="field"><span>Børn</span><select bind:value={wordChild}><option value="">Alle</option><option value="ja">Godkendt</option><option value="nej">Kun voksne</option></select></label>
                </div>
                <p class="sub" aria-live="polite">{shownWords.length} af {wordAdmin.words.length} tilknytninger{shownWords.length > 200 ? " (de første 200 vises)" : ""}.</p>
                <!-- A scrollable region must be reachable by keyboard (axe: scrollable-region-focusable). -->
                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                <div class="table-scroll" tabindex="0" role="region" aria-label="Ord og kilder"><table class="table"><thead><tr><th scope="col">Ord</th><th scope="col">Kategori</th><th scope="col">Børn</th><th scope="col">Læseniveau</th><th scope="col">COR-kilde</th></tr></thead>
                  <tbody>{#each shownWords.slice(0, 200) as item (`${item.category}/${item.word}`)}<tr><td class="mono">{item.word}</td><td>{CATEGORIES[item.category].name}</td><td>{item.child ? "Godkendt" : `Nej: ${item.reason}`}</td><td>{item.readingLevel}</td><td><small>{item.sources.join(", ") || "mangler"}</small></td></tr>{/each}</tbody></table></div>
              {:else}<p class="sub">{wordAdminError || "Henter ordlisterne…"}</p>{/if}
            </div>
          </details>
        </div>
      {/if}
    </div>
  {:else}
    {@const remaining = hintsRemaining(active.puzzle.level, active.hints)}
    <div class="game" class:split class:short={shortLandscape} bind:clientWidth={stageWidth}>
      <div class="game-top">
        <button class="icon-btn" onclick={leaveGame} disabled={markingWord} aria-label="Til forsiden"><Icon name="back" size={20} /></button>
        <div class="title"><h1>{CATEGORIES[active.puzzle.category].name}</h1><p>{LEVELS[active.puzzle.level].name} · {size}×{size}{active.campaignId ? ` · bane ${active.campaignPosition} i kampagnen` : ""} · {DIRECTION_SHORT[LEVELS[active.puzzle.level].directions]}</p></div>
        {#if !roomy}<span class="top-pill">{@render pill(gamePill, true)}</span>{/if}
        {#if $updateReady && !active.completed}<span class="pill info compact"><Icon name="update" size={15} /><span class="pill-text">Ny version efter banen</span></span>{/if}
      </div>
      {#if identity.child}<div class="kid-note">{@render avatar(identity.avatar)}<span><b>Du spiller med børneord.</b> Ordene er godkendt til børn, og gitteret tjekkes for uønskede ord. Ingen kontrol fanger alt, så sig til en voksen, hvis du ser noget mærkeligt.</span></div>{/if}
      <div class="progress-row"><b>{active.found.length} af {active.puzzle.words.length} ord</b>{@render bar(active.found.length, active.puzzle.words.length, "Fremdrift")}</div>

      <div class="stage">
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="grid-viewport" class:navigate={overview && zoomable} class:done={active.completed} bind:this={gridViewport} style={`--cell:${cellPx}px;--glyph:${cellPx < 24 ? 0.6 : 0.54};width:${shownCells * cellPx}px;height:${shownCells * cellPx}px`} onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerUp} onpointercancel={pointerCancel} onlostpointercapture={pointerCancel} onscroll={(event) => { event.currentTarget.scrollTop = 0; event.currentTarget.scrollLeft = 0; }}>
          <div class="letter-grid" id="letter-grid" bind:this={gridInner} role="group" aria-label={`Bogstavgitter, ${CATEGORIES[active.puzzle.category].name}, ${size} gange ${size}${zoomed ? `, udsnit fra række ${view.r0 + 1}, kolonne ${view.c0 + 1}` : ""}${overview && zoomable ? ". Overblik: vælg et felt for at zoome ind" : ""}`} style={`--size:${size};transform:translate(${zoomed ? -view.c0 * cellPx : 0}px,${zoomed ? -view.r0 * cellPx : 0}px)`}>
            <svg class="caps" viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
              {#each foundCaps as item (item.word)}{@const c = capsule(item.start, item.end)}<rect class={`cap found-${item.color}`} x={-c.w / 2} y={-c.h / 2} width={c.w} height={c.h} rx={c.h / 2} transform={`translate(${c.cx} ${c.cy}) rotate(${c.angle})`} vector-effect="non-scaling-stroke" />{/each}
              {#each missedCaps as item (item.word)}{@const c = capsule(item.start, item.end)}<rect class="cap missed" x={-c.w / 2} y={-c.h / 2} width={c.w} height={c.h} rx={c.h / 2} transform={`translate(${c.cx} ${c.cy}) rotate(${c.angle})`} vector-effect="non-scaling-stroke" />{/each}
              {#if previewStart && previewEnd && (previewStart.row !== previewEnd.row || previewStart.col !== previewEnd.col)}{@const c = capsule(previewStart, previewEnd)}<rect class="cap" class:preview={dragStart !== null} class:rejected={rejectedStart !== null && dragStart === null} x={-c.w / 2} y={-c.h / 2} width={c.w} height={c.h} rx={c.h / 2} transform={`translate(${c.cx} ${c.cy}) rotate(${c.angle})`} vector-effect="non-scaling-stroke" />{/if}
            </svg>
            {#each active.puzzle.grid as row, rowIndex (rowIndex)}
              {#each row as letter, colIndex (colIndex)}
                <button class:start={(dragStart?.row === rowIndex && dragStart?.col === colIndex) || (selectedStart?.row === rowIndex && selectedStart?.col === colIndex)} class:hint-start={shownHint?.start.row === rowIndex && shownHint?.start.col === colIndex} data-row={rowIndex} data-col={colIndex} tabindex={focusCell.row === rowIndex && focusCell.col === colIndex ? 0 : -1} onfocus={() => { focusCell = { row: rowIndex, col: colIndex }; ensureVisible(focusCell); }} onkeydown={(event) => keyCell(event, rowIndex, colIndex)} aria-label={`${letter}, række ${rowIndex + 1}, kolonne ${colIndex + 1}${shownHint?.start.row === rowIndex && shownHint?.start.col === colIndex ? `, startfelt for hint til ${shownHint.word}` : ""}${selectedStart?.row === rowIndex && selectedStart?.col === colIndex ? ", valgt startfelt" : ""}`}><span>{letter}</span></button>
              {/each}
            {/each}
            {#if rejectedEnd && rejectedStart && !dragStart}<span class="reject-badge" aria-hidden="true" style={`left:${(rejectedEnd.col + 1) / size * 100}%;top:${rejectedEnd.row / size * 100}%`}>✕</span>{/if}
          </div>
          {#if gridToast}<div class={`grid-toast ${gridToast.kind}`} aria-hidden="true">{gridToast.text}</div>{/if}
        </div>
        {#if zoomable}
          <div class="zoom-controls">
            <button class="minimap" onclick={miniClick} aria-label="Minikort. Tryk for at flytte udsnittet." style={`--size:${size}`}>
              {#if shownHint}<span class="mini-hint" style={`left:${(shownHint.start.col + 0.5) / size * 100}%;top:${(shownHint.start.row + 0.5) / size * 100}%`}></span>{/if}
              {#if zoomed}<span class="mini-view" style={`left:${view.c0 / size * 100}%;top:${view.r0 / size * 100}%;width:${viewCells / size * 100}%;height:${viewCells / size * 100}%`}></span>{/if}
            </button>
            <div class="zoom-side">
              <div class="seg" role="group" aria-label="Visning"><button aria-pressed={overview} onclick={() => overview = true}>Hele gitteret</button><button aria-pressed={!overview} onclick={() => overview = false}>Tæt på</button></div>
              {#if zoomed}
                <div class="pan" role="group" aria-label="Flyt udsnit">
                  <button class="icon-btn" onclick={() => pan(0, -panStep)} aria-label="Flyt til venstre" disabled={view.c0 === 0}><Icon name="left" /></button>
                  <button class="icon-btn" onclick={() => pan(-panStep, 0)} aria-label="Flyt op" disabled={view.r0 === 0}><Icon name="up" /></button>
                  <button class="icon-btn" onclick={() => pan(panStep, 0)} aria-label="Flyt ned" disabled={view.r0 >= size - viewCells}><Icon name="down" /></button>
                  <button class="icon-btn" onclick={() => pan(0, panStep)} aria-label="Flyt til højre" disabled={view.c0 >= size - viewCells}><Icon name="right" /></button>
                </div>
              {:else}<p class="sub">Tryk der, hvor du vil zoome ind. Markering sker i “Tæt på”.</p>{/if}
            </div>
          </div>
        {/if}
      </div>

      <div class="panel">
        <p class="sr-only" role="status">{selectionFeedback}</p>
        {#if message && message !== selectionFeedback}<div class="notice game-message" role="status"><Icon name="info" /><span>{message}</span><button class="icon-btn plain" aria-label="Luk besked" onclick={() => message = ""}>×</button></div>{/if}
        {#if active.completed}
          <section class="result" class:abandoned={active.abandoned} aria-live="polite">
            <div class="result-head"><span class="result-icon" aria-hidden="true"><Icon name={active.abandoned ? "info" : "check"} size={24} /></span><div><h2 tabindex="-1" bind:this={completionHeading}>{active.abandoned ? "Banen er opgivet" : `${CATEGORIES[active.puzzle.category].name} er klaret`}</h2><p>{active.abandoned ? `Du fandt ${active.found.length} af ${active.puzzle.words.length} ord. De resterende ord er vist i gitteret. En opgivet bane tæller ikke som gennemført.` : `Alle ${active.puzzle.words.length} ord fundet · ${active.hints.length === 0 ? "uden hint" : active.hints.length === 1 ? "1 hint brugt" : `${active.hints.length} hints brugt`}`}</p></div></div>
            <p class="sub">{activePending ? "Resultatet er gemt på enheden og afventer synkronisering. Nye achievements beregnes, når det er synkroniseret." : "Resultatet er gemt."}</p>
            {#if newAchievements.length}
              <div class="new-badges"><b>{newAchievements.length === 1 ? "Ny achievement" : "Nye achievements"}</b>
                {#each newAchievements as item (item.id)}<div class="row"><span class="badge-icon" aria-hidden="true">{ACHIEVEMENT_ICONS[item.icon]}</span><div class="row-main"><b>{item.title}</b><span>{item.description}</span></div><span class="tag new">NY</span></div>{/each}
              </div>
            {/if}
            {#if nearestGoal}<p class="goal-teaser">Mål: <b>{nearestGoal.title}</b> – nu {nearestGoal.progress} af {nearestGoal.target}.</p>{/if}
            <div class="result-actions">
              {#if active.campaignId}<button class="btn primary large" onclick={nextInCampaign} disabled={busy}>{busy ? "Henter bane…" : `Næste bane · ${(active.campaignPosition ?? 0) + 1}`}</button>
              {:else}<button class="btn primary large" onclick={newSingleGame} disabled={busy}>{busy ? "Henter bane…" : `Ny bane i ${CATEGORIES[active.puzzle.category].name}`}</button>{/if}
              <button class="btn neutral large" onclick={leaveGame}>Forside</button>
            </div>
            {#if !online && active.campaignId && !nextCampaignGame}<p class="sub">Ingen hentet næste bane er klar. Opret forbindelse for at hente flere.</p>{/if}
            {#if !online && !active.campaignId && !nextSingleGame}<p class="sub">Ingen hentet bane i samme kategori og sværhedsgrad er klar. Opret forbindelse for at hente en ny.</p>{/if}
          </section>
        {:else}
          <div class="hint-row" role="group" aria-label="Hjælp og bane">
            {#if shownHint}<div class="hint-shown"><span class="hint-dot" aria-hidden="true"></span>Hint vist i gitteret</div>
            {:else}<button class="btn outline hint-btn" onclick={hint} disabled={hintSaving || remaining === 0 || credits < 1}><Icon name="bulb" size={20} /><span>Hint</span><span class="tag ok">1 kredit</span></button>{/if}
            <div class="credits"><span>Hintkreditter</span><b>{credits} af {challengeInfo?.max ?? 5}</b></div>
            <button class="btn plain underline" onclick={() => { confirmAbandon = true; void tick().then(() => abandonDialog?.focus()); }} disabled={markingWord || hintSaving}>Opgiv bane</button>
          </div>
          <p class="sub">{shownHint ? `Hint: ${shownHint.word} starter i række ${shownHint.start.row + 1}, kolonne ${shownHint.start.col + 1}. Den gule stiplede cirkel viser feltet.` : `Hintbudget på banen: ${remaining} af ${HINT_LIMIT[active.puzzle.level]} tilbage.`}</p>
          {#if remaining === 0}<div class="notice">Banens hintbudget er brugt. Dine kreditter er gemt til næste bane.</div>
          {:else if credits < 1 && !shownHint}<div class="notice empty-credits"><span class="zero" aria-hidden="true">0</span><div><b>Ingen hintkreditter lige nu</b><span>Du får nye kreditter, når du når et af dine frivillige mål.</span><button class="link" onclick={showGoals} disabled={markingWord}>Se dine mål →</button></div></div>{/if}
          {#if confirmAbandon}
            <div class="confirm" role="alertdialog" aria-labelledby="abandon-title" aria-describedby="abandon-text" tabindex="-1" bind:this={abandonDialog}>
              <b id="abandon-title">Opgiv banen?</b><span id="abandon-text">De resterende ord bliver vist. En opgivet bane tæller ikke som gennemført og kan ikke spilles videre.</span>
              <div class="actions"><button class="btn primary" onclick={() => confirmAbandon = false}>Spil videre</button><button class="btn neutral strong" onclick={abandon}>Opgiv og vis ordene</button></div>
            </div>
          {/if}
        {/if}
        <section class="word-list" aria-labelledby="words-heading">
          <h2 id="words-heading">{active.completed ? "Ordene" : "Ord at finde"}</h2>
          <ul>{#each active.puzzle.words as word (word)}{@const found = active.found.includes(word)}{@const hinted = !found && shownHint?.word === word}<li class:found class:hinted>
            <span class="mark" aria-hidden="true">{#if found}<Icon name="check" size={14} />{/if}</span><span class="word">{word}</span>{#if found}<span class="sr-only">, fundet</span>{/if}{#if hinted}<span class="tag hint">HINT</span>{/if}
          </li>{/each}</ul>
        </section>
        {#if roomy && !active.completed}<p class="keys"><span><kbd>← ↑ → ↓</kbd> flyt</span><span><kbd>Enter</kbd> start / slut</span><span><kbd>Esc</kbd> annullér</span></p>{/if}
      </div>
    </div>
  {/if}
  {#if message && !active && identity && !loading}<div class="toast" role="status"><span>{message}</span><button aria-label="Luk besked" onclick={() => message = ""}>×</button></div>{/if}
</main>

{#snippet bar(value: number, max: number, label: string)}
  <div class="bar" role="progressbar" aria-label={label} aria-valuemin="0" aria-valuemax={max} aria-valuenow={value}><span style={`width:${max ? Math.min(100, value / max * 100) : 0}%`}></span></div>
{/snippet}
