import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { X } from 'lucide-react';
import { useActivityStore, type RuleSuggestion } from '../../stores/useActivityStore';

interface SmartRuleNoticeProps {
  onReview: () => void;
}

type PendingAction = 'create' | 'never' | 'undo' | null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SmartRuleNotice({ onReview }: SmartRuleNoticeProps) {
  const notice = useActivityStore((state) => state.ruleNotices[0] ?? null);
  const dismissRuleNotice = useActivityStore((state) => state.dismissRuleNotice);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setPendingAction(null);
    setActionError(null);

    if (!notice || notice.auto_created) return;

    // A suggestion is counted as prompted only once it is actually visible.
    void invoke('mark_rule_suggestion_prompted', {
      projectId: notice.project_id,
      field: notice.field,
      operator: notice.operator,
      value: notice.value,
    }).catch(() => {});
  }, [notice]);

  if (!notice) return null;

  const dismiss = () => dismissRuleNotice();

  const runAction = async (
    action: Exclude<PendingAction, null>,
    operation: (current: RuleSuggestion) => Promise<unknown>,
  ) => {
    setPendingAction(action);
    setActionError(null);
    try {
      await operation(notice);
      dismiss();
    } catch (error) {
      setActionError(errorMessage(error));
      setPendingAction(null);
    }
  };

  const useRule = () => void runAction('create', (current) => invoke<number>('create_suggested_rule', {
    projectId: current.project_id,
    field: current.field,
    operator: current.operator,
    value: current.value,
  }));

  const neverSuggest = () => void runAction('never', (current) => invoke('dismiss_rule_suggestion', {
    projectId: current.project_id,
    field: current.field,
    operator: current.operator,
    value: current.value,
  }));

  const undoRule = () => {
    if (notice.rule_id == null) return;
    void runAction('undo', (current) => invoke('delete_rule', { ruleId: current.rule_id }));
  };

  const reviewRule = () => {
    dismiss();
    onReview();
  };

  const busy = pendingAction !== null;

  return createPortal(
    <div
      role="region"
      aria-label="Smart rule notice"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 4500,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        padding: 24,
        pointerEvents: 'none',
      }}
    >
      <div
        className="glass-card"
        style={{
          width: 430,
          padding: '16px 18px',
          background: 'rgba(8,22,17,0.94)',
          border: '0.5px solid rgba(255,255,255,0.14)',
          boxShadow: '0 18px 54px rgba(0,0,0,0.46)',
          pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div
            aria-hidden="true"
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: notice.project_color,
              marginTop: 6,
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'rgba(255,255,255,0.88)', marginBottom: 5 }}>
              {notice.auto_created ? 'Autopilot created a smart rule' : 'Duskry noticed a reliable pattern'}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.48)', lineHeight: 1.5 }}>
              {Math.round(notice.confidence * 100)}% of {notice.total_count} matching activities
              {notice.day_count > 1 ? ` across ${notice.day_count} days` : ''} belong to{' '}
              <span style={{ color: notice.project_color, fontWeight: 600 }}>
                {notice.project_name}
              </span>
              . {notice.auto_created ? 'Future matches will be handled automatically when' : 'Duskry can handle future activities when'}{' '}
              <span style={{ color: 'rgba(255,255,255,0.72)' }}>{notice.label}</span>.
            </div>
            {actionError && (
              <div role="alert" style={{ color: '#fca5a5', fontSize: 11.5, lineHeight: 1.4, marginTop: 7 }}>
                Could not complete that action. {actionError}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            title="Dismiss"
            aria-label="Dismiss smart rule notice"
            disabled={busy}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '0.5px solid rgba(255,255,255,0.10)',
              borderRadius: 8,
              width: 26,
              height: 26,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255,255,255,0.45)',
              cursor: busy ? 'wait' : 'pointer',
              flexShrink: 0,
            }}
          >
            <X size={13} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          {notice.auto_created ? (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={undoRule}
                disabled={busy || notice.rule_id == null}
                title={notice.rule_id == null ? 'This rule could not be identified' : 'Delete the rule Autopilot just created'}
                style={{ width: 'auto', fontSize: 12, padding: '7px 14px' }}
              >
                {pendingAction === 'undo' ? 'Undoing…' : 'Undo'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={reviewRule}
                disabled={busy}
                style={{ width: 'auto', fontSize: 12, padding: '7px 14px' }}
              >
                Review
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={dismiss}
                disabled={busy}
                style={{ width: 'auto', fontSize: 12, padding: '7px 14px' }}
              >
                Got it
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={neverSuggest}
                disabled={busy}
                style={{ width: 'auto', fontSize: 12, padding: '7px 14px' }}
              >
                {pendingAction === 'never' ? 'Saving…' : 'Never'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={dismiss}
                disabled={busy}
                style={{ width: 'auto', fontSize: 12, padding: '7px 14px' }}
              >
                Not now
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={useRule}
                disabled={busy}
                style={{ width: 'auto', fontSize: 12, padding: '7px 14px' }}
              >
                {pendingAction === 'create' ? 'Creating…' : 'Use rule'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
