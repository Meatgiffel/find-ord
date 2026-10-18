import { CATEGORIES, LEVELS, type CategoryId, type LevelId } from "./words.js";

// Hint credits: every account starts with START_CREDITS, a completed mini challenge gives
// one credit, and one shown hint costs one. The balance never exceeds MAX_CREDITS; a
// completed challenge waits with its credit until there is room.
export const START_CREDITS = 2;
export const MAX_CREDITS = 5;
export const ACTIVE_CHALLENGES = 3;

export type ChallengeKind = "find" | "danish" | "long-word" | "complete-nohint" | "complete-category" | "complete-level";
export type Challenge = { id: string; kind: ChallengeKind; param: string | null; target: number; progress: number; completed: boolean; claimed: boolean; title: string };
// recent lists the latest paid challenges, so a client can announce new rewards.
export type ChallengeState = { balance: number; max: number; challenges: Challenge[]; recent: Challenge[] };

export const LONG_WORD = 8;

export function challengeTitle(kind: ChallengeKind, param: string | null, target: number): string {
  switch (kind) {
    case "find": return `Find ${target} ord`;
    case "danish": return `Find ${target} ord med Æ, Ø eller Å`;
    case "long-word": return `Find ${target} ord på mindst ${LONG_WORD} bogstaver`;
    case "complete-nohint": return target === 1 ? "Gennemfør en bane uden hint" : `Gennemfør ${target} baner uden hint`;
    case "complete-category": return `Gennemfør en bane i ${CATEGORIES[param as CategoryId]?.name ?? param}`;
    case "complete-level": return `Gennemfør en bane på ${LEVELS[param as LevelId]?.name ?? param}`;
  }
}
