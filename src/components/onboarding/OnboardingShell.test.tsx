import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OnboardingShell } from './OnboardingShell';

describe('OnboardingShell', () => {
  it('makes the background a native window drag region without marking the card', () => {
    const markup = renderToStaticMarkup(
      <OnboardingShell step={0} total={1}>
        <button type="button">Continue</button>
      </OnboardingShell>,
    );

    const background = markup.match(/<div class="scene-overlay"[^>]*>/)?.[0];
    const card = markup.match(/<div class="onboarding-card glass-card"[^>]*>/)?.[0];

    expect(background).toContain('data-tauri-drag-region');
    expect(card).not.toContain('data-tauri-drag-region');
  });
});
