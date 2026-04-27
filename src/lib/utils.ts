import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { DEFAULT_AUTO_SCENE_SCHEDULE, type AutoSceneSlot, type SceneId } from "./sceneConfig";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

export function formatDurationLong(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export interface DeepWorkActivity {
  app_name: string;
  window_title: string | null;
  domain: string | null;
  duration_s: number | null;
  project_id: number | null;
}

const DEEP_WORK_MIN_SECONDS = 15 * 60;

const VIDEO_APPS = [
  'vlc',
  'quicktime player',
  'iina',
  'infuse',
  'plex',
  'mpv',
  'elmedia player',
  'movist',
  'apple tv',
  'tv',
];

const VIDEO_SIGNALS = [
  'youtube',
  'youtu.be',
  'netflix',
  'twitch',
  'disney+',
  'disney plus',
  'prime video',
  'hbo max',
  'max.com',
  'apple tv+',
  'hulu',
  'vimeo',
  'dailymotion',
];

export function isVideoActivity(activity: Pick<DeepWorkActivity, 'app_name' | 'window_title' | 'domain'>): boolean {
  const app = activity.app_name.toLowerCase();
  const title = (activity.window_title ?? '').toLowerCase();
  const domain = (activity.domain ?? '').toLowerCase();

  return VIDEO_APPS.some((signal) => app === signal || app.startsWith(signal))
    || VIDEO_SIGNALS.some((signal) => title.includes(signal) || domain.includes(signal));
}

export function isDeepWorkActivity(activity: DeepWorkActivity): boolean {
  return activity.project_id !== null
    && (activity.duration_s ?? 0) >= DEEP_WORK_MIN_SECONDS
    && !isVideoActivity(activity);
}

export function todayLabel(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function normalizeAutoSceneSchedule(schedule: AutoSceneSlot[] | null | undefined): AutoSceneSlot[] {
  const source = schedule && schedule.length > 0 ? schedule : DEFAULT_AUTO_SCENE_SCHEDULE;
  return [...source]
    .filter((slot) =>
      Number.isFinite(slot.startMinutes)
      && slot.startMinutes >= 0
      && slot.startMinutes < 24 * 60
      && typeof slot.scene === 'string')
    .sort((a, b) => a.startMinutes - b.startMinutes);
}

export function getAutoScene(schedule: AutoSceneSlot[], date = new Date()): SceneId {
  const normalized = normalizeAutoSceneSchedule(schedule);
  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  let active = normalized[normalized.length - 1] ?? DEFAULT_AUTO_SCENE_SCHEDULE[DEFAULT_AUTO_SCENE_SCHEDULE.length - 1];

  for (const slot of normalized) {
    if (slot.startMinutes <= currentMinutes) {
      active = slot;
    } else {
      break;
    }
  }

  return active.scene;
}

export function formatMinutesAsTime(minutes: number): string {
  const normalized = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function parseTimeToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return 0;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return 0;
  return hours * 60 + minutes;
}

export function daysLeft(expiresAt: number): number {
  const diff = expiresAt * 1000 - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}
