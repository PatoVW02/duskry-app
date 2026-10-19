import { format, fromUnixTime } from 'date-fns';
import type { Activity } from '../stores/useActivityStore';

/** A repeated app name or placeholder does not identify a document or conversation. */
export function hasSpecificWindowTitle(appName: string, title: string | null | undefined): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/\.exe$/i, '').replace(/[^\p{L}\p{N}]+/gu, '');
  return (title?.trim() ?? '').split(/\s[—–|\-]\s/u).some((part) => {
    const normalized = normalize(part);
    return Boolean(normalized) && normalized !== normalize(appName.trim())
      && !['untitled', 'untitledwindow', 'newtab', 'newchat', 'newconversation', 'home', 'chatgpt', 'claude', 'gemini', 'copilot'].includes(normalized);
  });
}

export function activityContextLabel(activity: Activity): string {
  const title = activity.window_title?.trim();
  if (hasSpecificWindowTitle(activity.app_name, title)) return title!;
  const fileName = activity.file_path?.replace(/\\/g, '/').split('/').pop();
  const context = fileName || title || activity.domain || 'No window title';
  const start = format(fromUnixTime(activity.started_at), 'HH:mm');
  const end = activity.ended_at == null ? 'ongoing' : format(fromUnixTime(activity.ended_at), 'HH:mm');
  return `${context} · ${start}–${end}`;
}

/** Keep visits with indistinguishable titles separate so a correction targets one visit. */
export function activityTitleGroupKey(activity: Activity): string {
  return hasSpecificWindowTitle(activity.app_name, activity.window_title)
    ? JSON.stringify(['title', activity.window_title!.trim()])
    : JSON.stringify(['visit', activity.id]);
}
