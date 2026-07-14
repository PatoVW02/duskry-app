import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  AlertCircle,
  BrainCircuit,
  ChevronDown,
  CirclePause,
  CirclePlay,
  Clock3,
  FolderKanban,
  Info,
  MonitorPlay,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Video,
  WandSparkles,
  X,
} from 'lucide-react';
import { billingPlansEnabled } from '../lib/featureFlags';
import { useLicenseStore, isPro } from '../stores/useLicenseStore';
import { useProjectStore, type Project } from '../stores/useProjectStore';
import {
  useSettingsStore,
  type RuleAutomationMode,
} from '../stores/useSettingsStore';
import './Rules.css';

export interface RuleRecord {
  id: number | null;
  project_id: number;
  field: string;
  operator: string;
  value: string;
  priority: number;
  source: string;
  enabled: boolean;
  confidence: number | null;
  support_count: number;
  created_at: number | null;
}

type RuleCategory = 'system' | 'manual' | 'learned';
type LoadState = 'loading' | 'ready' | 'error';

interface ConditionNode {
  field?: string;
  operator?: string;
  value?: string;
  negated?: boolean;
  combinator?: 'and' | 'or';
  conditions?: ConditionNode[];
}

interface RulesProps {
  onUpgrade?: () => void;
  onOpenProjects?: () => void;
}

interface SystemRule {
  id: string;
  name: string;
  summary: string;
  evidence: string;
  icon: typeof Clock3;
  macOnly?: boolean;
}

const SYSTEM_RULES: SystemRule[] = [
  {
    id: 'idle',
    name: 'Idle protection',
    summary: 'Closes the current activity after your configured idle timeout.',
    evidence: 'Uses local keyboard and pointer idle time. Configure the timeout in Settings > Tracking.',
    icon: Clock3,
  },
  {
    id: 'meeting',
    name: 'Meeting detection',
    summary: 'Keeps calls and screen sharing from being cut off as idle time.',
    evidence: 'Recognizes common meeting applications and meeting window titles locally.',
    icon: Video,
    macOnly: true,
  },
  {
    id: 'playback',
    name: 'Video playback detection',
    summary: 'Keeps active video sessions from being cut off while you watch.',
    evidence: 'Uses display-sleep state and common local player or streaming window titles.',
    icon: MonitorPlay,
    macOnly: true,
  },
];

const MODE_OPTIONS: Array<{
  value: RuleAutomationMode;
  label: string;
  description: string;
}> = [
  {
    value: 'off',
    label: 'Off',
    description: 'Do not suggest or create new learned rules.',
  },
  {
    value: 'suggest',
    label: 'Ask me',
    description: 'Suggest reliable patterns and wait for your approval.',
  },
  {
    value: 'automatic',
    label: 'Autopilot',
    description: 'Create only high-confidence patterns automatically.',
  },
];

const FIELD_OPTIONS = [
  { value: 'app', label: 'Application' },
  { value: 'title', label: 'Window title' },
  { value: 'url', label: 'Website hostname' },
  { value: 'path', label: 'File path' },
];

const TEXT_OPERATOR_OPTIONS = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'equals' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
];

const URL_OPERATOR_OPTIONS = [
  { value: 'host_equals', label: 'matches website' },
  { value: 'contains', label: 'hostname contains' },
];

const RUNNING_ON_MACOS = typeof navigator !== 'undefined'
  && /mac/i.test(`${navigator.platform} ${navigator.userAgent}`);

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function fieldLabel(field: string): string {
  return FIELD_OPTIONS.find((option) => option.value === field)?.label ?? field.replace(/_/g, ' ');
}

function operatorLabel(operator: string): string {
  if (operator === 'host_equals') return 'matches';
  if (operator === 'between_minutes') return 'is between';
  return operator.replace(/_/g, ' ');
}

function normalizeConfidence(confidence: number | null): number | null {
  if (confidence == null || !Number.isFinite(confidence)) return null;
  const percentage = confidence <= 1 ? confidence * 100 : confidence;
  return Math.max(0, Math.min(100, Math.round(percentage)));
}

function parseCompoundRule(rule: RuleRecord): ConditionNode | null {
  if (rule.field !== 'compound') return null;
  try {
    const parsed = JSON.parse(rule.value) as ConditionNode;
    return Array.isArray(parsed.conditions) ? parsed : null;
  } catch {
    return null;
  }
}

function nodeSummary(node: ConditionNode): string {
  if (Array.isArray(node.conditions)) {
    const joiner = node.combinator === 'or' ? ' OR ' : ' AND ';
    return node.conditions.map(nodeSummary).filter(Boolean).join(joiner);
  }
  const value = node.value?.trim() || 'empty value';
  return `${node.negated ? 'not ' : ''}${fieldLabel(node.field ?? 'condition')} ${operatorLabel(node.operator ?? 'matches')} “${value}”`;
}

function ruleSummary(rule: RuleRecord): string {
  const compound = parseCompoundRule(rule);
  if (compound) return nodeSummary(compound);
  if (rule.field === 'compound') return 'Compound rule';
  return `${fieldLabel(rule.field)} ${operatorLabel(rule.operator)} “${rule.value}”`;
}

function createdLabel(timestamp: number | null): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date);
}

function projectForRule(projects: Project[], rule: RuleRecord): Project | undefined {
  return projects.find((project) => project.id === rule.project_id);
}

export function Rules({ onUpgrade, onOpenProjects }: RulesProps) {
  const projects = useProjectStore((state) => state.projects);
  const fetchProjects = useProjectStore((state) => state.fetchProjects);
  const tier = useLicenseStore((state) => state.tier);
  const {
    ruleAutomationMode,
    ruleAutomationSaving,
    setRuleAutomationMode,
    rulesOverrideActive,
    setRulesOverrideActive,
  } = useSettingsStore();

  const [rules, setRules] = useState<RuleRecord[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [category, setCategory] = useState<RuleCategory>('manual');
  const [search, setSearch] = useState('');
  const [expandedRuleIds, setExpandedRuleIds] = useState<Set<number>>(() => new Set());
  const [busyRuleIds, setBusyRuleIds] = useState<Set<number>>(() => new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newProjectId, setNewProjectId] = useState('');
  const [newField, setNewField] = useState('app');
  const [newOperator, setNewOperator] = useState('contains');
  const [newValue, setNewValue] = useState('');
  const [createState, setCreateState] = useState<'idle' | 'saving'>('idle');
  const [createError, setCreateError] = useState<string | null>(null);

  const rulesUnlocked = !billingPlansEnabled || isPro(tier);

  const loadRules = useCallback(async (showLoading = true) => {
    if (showLoading) setLoadState('loading');
    setLoadError(null);
    try {
      const result = await invoke<RuleRecord[]>('get_rules');
      setRules(result);
      setLoadState('ready');
    } catch (error) {
      setLoadError(errorMessage(error));
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    void loadRules();
    if (projects.length === 0) void fetchProjects();
  }, [fetchProjects, loadRules, projects.length]);

  useEffect(() => {
    if (!newProjectId && projects.length > 0) {
      setNewProjectId(String(projects[0].id));
    }
  }, [newProjectId, projects]);

  const manualRules = useMemo(
    () => rules.filter((rule) => rule.source !== 'learned'),
    [rules],
  );
  const learnedRules = useMemo(
    () => rules.filter((rule) => rule.source === 'learned'),
    [rules],
  );

  const visibleRules = useMemo(() => {
    if (category === 'system') return [];
    const candidates = category === 'learned' ? learnedRules : manualRules;
    const query = search.trim().toLocaleLowerCase();
    if (!query) return candidates;
    return candidates.filter((rule) => {
      const project = projectForRule(projects, rule);
      return [ruleSummary(rule), project?.name, rule.enabled ? 'enabled' : 'paused']
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(query));
    });
  }, [category, learnedRules, manualRules, projects, search]);

  const setMode = async (mode: RuleAutomationMode) => {
    setModeError(null);
    try {
      await setRuleAutomationMode(mode);
    } catch (error) {
      setModeError(errorMessage(error));
    }
  };

  const toggleOverride = async () => {
    setModeError(null);
    try {
      await setRulesOverrideActive(!rulesOverrideActive);
    } catch (error) {
      setModeError(errorMessage(error));
    }
  };

  const beginRuleAction = (ruleId: number) => {
    setBusyRuleIds((current) => new Set(current).add(ruleId));
    setActionError(null);
  };

  const endRuleAction = (ruleId: number) => {
    setBusyRuleIds((current) => {
      const next = new Set(current);
      next.delete(ruleId);
      return next;
    });
  };

  const toggleRule = async (rule: RuleRecord) => {
    if (rule.id == null) return;
    beginRuleAction(rule.id);
    try {
      await invoke('set_rule_enabled', { ruleId: rule.id, enabled: !rule.enabled });
      await loadRules(false);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      endRuleAction(rule.id);
    }
  };

  const deleteRule = async (ruleId: number) => {
    beginRuleAction(ruleId);
    try {
      await invoke('delete_rule', { ruleId });
      setDeleteConfirmId(null);
      setExpandedRuleIds((current) => {
        const next = new Set(current);
        next.delete(ruleId);
        return next;
      });
      await loadRules(false);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      endRuleAction(ruleId);
    }
  };

  const toggleRuleDetails = (ruleId: number) => {
    setExpandedRuleIds((current) => {
      const next = new Set(current);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  };

  const openCreate = () => {
    if (!rulesUnlocked) {
      onUpgrade?.();
      return;
    }
    if (projects.length === 0) {
      onOpenProjects?.();
      return;
    }
    setCreateError(null);
    setShowCreate(true);
  };

  const changeNewField = (field: string) => {
    setNewField(field);
    const validOperators = field === 'url' ? URL_OPERATOR_OPTIONS : TEXT_OPERATOR_OPTIONS;
    if (!validOperators.some((operator) => operator.value === newOperator)) {
      setNewOperator(validOperators[0].value);
    }
  };

  const createRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const projectId = Number(newProjectId);
    const value = newValue.trim();
    if (!projectId || !value) {
      setCreateError('Choose a project and enter what this rule should match.');
      return;
    }
    setCreateState('saving');
    setCreateError(null);
    try {
      await invoke<number>('create_rule', {
        projectId,
        field: newField,
        operator: newOperator,
        value,
        priority: 0,
      });
      setNewValue('');
      setShowCreate(false);
      setCategory('manual');
      await loadRules(false);
    } catch (error) {
      setCreateError(errorMessage(error));
    } finally {
      setCreateState('idle');
    }
  };

  const counts: Record<RuleCategory, number> = {
    system: SYSTEM_RULES.length,
    manual: manualRules.length,
    learned: learnedRules.length,
  };

  return (
    <section className="rules-page" aria-label="Rules workspace">
      <section className="rules-page__automation glass-card" aria-labelledby="rules-automation-heading">
        <div className="rules-page__section-heading">
          <div className="rules-page__heading-icon" aria-hidden="true">
            <WandSparkles size={17} />
          </div>
          <div>
            <h2 id="rules-automation-heading">Rule automation</h2>
            <p>Choose how Duskry turns your corrections into new rules.</p>
          </div>
          <span className="rules-page__local-badge">Runs locally</span>
        </div>

        <div className="rules-page__mode-grid" role="group" aria-label="Rule automation mode">
          {MODE_OPTIONS.map((mode) => {
            const selected = rulesUnlocked && ruleAutomationMode === mode.value;
            return (
              <button
                key={mode.value}
                type="button"
                className={`rules-page__mode${selected ? ' rules-page__mode--selected' : ''}`}
                aria-pressed={selected}
                disabled={!rulesUnlocked || ruleAutomationSaving}
                onClick={() => void setMode(mode.value)}
              >
                <span className="rules-page__mode-label">
                  <span className="rules-page__mode-radio" aria-hidden="true" />
                  {mode.label}
                </span>
                <span>{mode.description}</span>
              </button>
            );
          })}
        </div>

        {!rulesUnlocked && (
          <div className="rules-page__upgrade-note">
            <ShieldCheck size={15} aria-hidden="true" />
            <span>Learned rule automation is available with Pro.</span>
            {onUpgrade && (
              <button type="button" onClick={onUpgrade}>View plans</button>
            )}
          </div>
        )}

        <div className="rules-page__automation-foot">
          <div>
            <strong>Rules can override the focus project</strong>
            <span>When a matching app or website rule is more specific, use its target project.</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={rulesOverrideActive}
            aria-label="Allow rules to override the focus project"
            className={`rules-page__switch${rulesOverrideActive ? ' rules-page__switch--on' : ''}`}
            onClick={() => void toggleOverride()}
          >
            <span aria-hidden="true" />
          </button>
        </div>

        <p className="rules-page__mode-help">
          <Info size={13} aria-hidden="true" />
          {rulesUnlocked
            ? 'Enabled manual and learned rules keep matching in every automation mode. Off only stops new learning.'
            : 'Your existing rules are retained while automation is locked and become available again with Pro.'}
        </p>
        {modeError && <ErrorNotice message={modeError} />}
      </section>

      <section className="rules-page__library glass-card" aria-labelledby="rules-library-heading">
        <div className="rules-page__library-header">
          <div>
            <h2 id="rules-library-heading">Rule library</h2>
            <p>See what Duskry uses, where it sends activity, and why.</p>
          </div>
          <button
            type="button"
            className="rules-page__primary-action"
            onClick={openCreate}
            disabled={rulesUnlocked && projects.length === 0 && !onOpenProjects}
          >
            <Plus size={15} aria-hidden="true" />
            {!rulesUnlocked ? 'Upgrade to add rules' : projects.length === 0 ? 'Create a project first' : 'New rule'}
          </button>
        </div>

        <div className="rules-page__toolbar">
          <div className="rules-page__tabs" role="tablist" aria-label="Rule category">
            {(['system', 'manual', 'learned'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`rules-tab-${tab}`}
                aria-selected={category === tab}
                aria-controls="rules-category-panel"
                className={category === tab ? 'rules-page__tab rules-page__tab--active' : 'rules-page__tab'}
                onClick={() => {
                  setCategory(tab);
                  setDeleteConfirmId(null);
                }}
              >
                {tab === 'system' ? 'System' : tab === 'manual' ? 'Manual' : 'Learned'}
                <span>{counts[tab]}</span>
              </button>
            ))}
          </div>
          {category !== 'system' && (
            <label className="rules-page__search">
              <span className="rules-page__sr-only">Search {category} rules</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search rules or projects"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="Clear rule search">
                  <X size={14} />
                </button>
              )}
            </label>
          )}
        </div>

        {showCreate && (
          <form className="rules-page__create" onSubmit={(event) => void createRule(event)}>
            <div className="rules-page__create-heading">
              <div>
                <h3>New manual rule</h3>
                <p>Future matching activity will be assigned to the selected project.</p>
              </div>
              <button type="button" onClick={() => setShowCreate(false)} aria-label="Close new rule form">
                <X size={16} />
              </button>
            </div>
            <div className="rules-page__create-fields">
              <label>
                <span>Target project</span>
                <select value={newProjectId} onChange={(event) => setNewProjectId(event.target.value)} required>
                  <option value="">Choose a project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Match</span>
                <select value={newField} onChange={(event) => changeNewField(event.target.value)}>
                  {FIELD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Condition</span>
                <select value={newOperator} onChange={(event) => setNewOperator(event.target.value)}>
                  {(newField === 'url' ? URL_OPERATOR_OPTIONS : TEXT_OPERATOR_OPTIONS).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="rules-page__create-value">
                <span>Value</span>
                <input
                  value={newValue}
                  onChange={(event) => setNewValue(event.target.value)}
                  placeholder={newField === 'url' ? 'example.com' : newField === 'path' ? '/Projects/Duskry' : 'Enter a value'}
                  autoFocus
                  required
                />
              </label>
            </div>
            {createError && <ErrorNotice message={createError} />}
            <div className="rules-page__create-actions">
              {onOpenProjects && (
                <button type="button" className="rules-page__text-action" onClick={onOpenProjects}>
                  Build a multi-condition rule
                </button>
              )}
              <button type="button" className="rules-page__secondary-action" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button type="submit" className="rules-page__primary-action" disabled={createState === 'saving'}>
                {createState === 'saving' ? 'Creating…' : 'Create rule'}
              </button>
            </div>
          </form>
        )}

        {actionError && <ErrorNotice message={actionError} />}

        <div
          id="rules-category-panel"
          role="tabpanel"
          aria-labelledby={`rules-tab-${category}`}
          className="rules-page__rule-list"
        >
          {category === 'system' ? (
            SYSTEM_RULES.map((rule) => <SystemRuleCard key={rule.id} rule={rule} />)
          ) : loadState === 'loading' ? (
            <LoadingState />
          ) : loadState === 'error' ? (
            <ErrorState message={loadError ?? 'Rules could not be loaded.'} onRetry={() => void loadRules()} />
          ) : visibleRules.length === 0 ? (
            <EmptyState
              category={category}
              searching={Boolean(search.trim())}
              onClearSearch={() => setSearch('')}
              onCreate={openCreate}
              canCreate={rulesUnlocked && projects.length > 0}
            />
          ) : (
            visibleRules.map((rule) => {
              const ruleId = rule.id;
              if (ruleId == null) return null;
              return (
                <StoredRuleCard
                  key={ruleId}
                  rule={rule}
                  project={projectForRule(projects, rule)}
                  expanded={expandedRuleIds.has(ruleId)}
                  busy={busyRuleIds.has(ruleId)}
                  confirmingDelete={deleteConfirmId === ruleId}
                  onToggleDetails={() => toggleRuleDetails(ruleId)}
                  onToggle={() => void toggleRule(rule)}
                  onAskDelete={() => setDeleteConfirmId(ruleId)}
                  onCancelDelete={() => setDeleteConfirmId(null)}
                  onDelete={() => void deleteRule(ruleId)}
                />
              );
            })
          )}
        </div>
      </section>
    </section>
  );
}

function StoredRuleCard({
  rule,
  project,
  expanded,
  busy,
  confirmingDelete,
  onToggleDetails,
  onToggle,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  rule: RuleRecord;
  project: Project | undefined;
  expanded: boolean;
  busy: boolean;
  confirmingDelete: boolean;
  onToggleDetails: () => void;
  onToggle: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const learned = rule.source === 'learned';
  const confidence = normalizeConfidence(rule.confidence);
  const detailsId = `rule-details-${rule.id}`;
  const created = createdLabel(rule.created_at);

  return (
    <article className={`rules-page__rule${rule.enabled ? '' : ' rules-page__rule--paused'}`}>
      <div className="rules-page__rule-main">
        <div className={`rules-page__rule-source rules-page__rule-source--${learned ? 'learned' : 'manual'}`} aria-hidden="true">
          {learned ? <BrainCircuit size={16} /> : <Sparkles size={16} />}
        </div>
        <div className="rules-page__rule-copy">
          <div className="rules-page__rule-title-row">
            <h3>{ruleSummary(rule)}</h3>
            <span className={`rules-page__status${rule.enabled ? ' rules-page__status--enabled' : ''}`}>
              {rule.enabled ? 'Enabled' : 'Paused'}
            </span>
          </div>
          <div className="rules-page__rule-meta">
            <span className="rules-page__project-chip">
              <span style={{ background: project?.color ?? 'rgba(255,255,255,0.45)' }} aria-hidden="true" />
              <FolderKanban size={12} aria-hidden="true" />
              {project?.name ?? 'Unknown project'}
            </span>
            {learned && confidence != null && <span>{confidence}% confidence</span>}
            {learned && <span>{rule.support_count} supporting {rule.support_count === 1 ? 'activity' : 'activities'}</span>}
          </div>
        </div>
        <div className="rules-page__rule-actions">
          <button
            type="button"
            className="rules-page__icon-action"
            disabled={busy}
            onClick={onToggle}
            aria-label={rule.enabled ? `Pause rule: ${ruleSummary(rule)}` : learned ? `Resume as a manual rule: ${ruleSummary(rule)}` : `Resume rule: ${ruleSummary(rule)}`}
            title={rule.enabled ? 'Pause rule' : learned ? 'Resume as manual rule' : 'Resume rule'}
          >
            {rule.enabled ? <CirclePause size={17} /> : <CirclePlay size={17} />}
          </button>
          <button
            type="button"
            className="rules-page__icon-action"
            disabled={busy}
            onClick={onAskDelete}
            aria-label={`Delete rule: ${ruleSummary(rule)}`}
            title="Delete rule"
          >
            <Trash2 size={16} />
          </button>
          <button
            type="button"
            className="rules-page__disclosure"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={onToggleDetails}
          >
            Details
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {confirmingDelete && (
        <div className="rules-page__delete-confirm" role="alert">
          <span>Delete this rule? Existing activity assignments will stay unchanged.</span>
          <button type="button" onClick={onCancelDelete} disabled={busy}>Keep rule</button>
          <button type="button" className="rules-page__danger-action" onClick={onDelete} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}

      {expanded && (
        <div className="rules-page__details" id={detailsId}>
          <div>
            <span>Category</span>
            <strong>{learned ? 'Learned from corrections' : 'Created manually'}</strong>
          </div>
          <div>
            <span>Target</span>
            <strong>{project?.name ?? 'Unknown project'}</strong>
          </div>
          <div>
            <span>Evidence</span>
            <strong>
              {learned
                ? confidence == null
                  ? `${rule.support_count} supporting activities`
                  : `${confidence}% confidence from ${rule.support_count} supporting ${rule.support_count === 1 ? 'activity' : 'activities'}`
                : 'Explicitly created by you'}
            </strong>
          </div>
          <div>
            <span>Created</span>
            <strong>{created ?? 'Date unavailable'}</strong>
          </div>
          <div className="rules-page__details-wide">
            <span>Condition</span>
            <strong>{ruleSummary(rule)}</strong>
          </div>
          {learned && confidence != null && (
            <div className="rules-page__details-wide">
              <span>Confidence</span>
              <div className="rules-page__confidence-row">
                <progress max={100} value={confidence} aria-label={`Rule confidence: ${confidence}%`} />
                <strong>{confidence}%</strong>
              </div>
            </div>
          )}
          {!rule.enabled && learned && (
            <p className="rules-page__details-note">
              Resuming this learned rule makes it a manual rule, so future evidence cannot pause it automatically.
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function SystemRuleCard({ rule }: { rule: SystemRule }) {
  const Icon = rule.icon;
  const [expanded, setExpanded] = useState(false);
  const detailsId = `system-rule-details-${rule.id}`;
  const available = !rule.macOnly || RUNNING_ON_MACOS;
  return (
    <article className="rules-page__rule">
      <div className="rules-page__rule-main">
        <div className="rules-page__rule-source rules-page__rule-source--system" aria-hidden="true">
          <Icon size={16} />
        </div>
        <div className="rules-page__rule-copy">
          <div className="rules-page__rule-title-row">
            <h3>{rule.name}</h3>
            <span className="rules-page__status rules-page__status--system">
              {available ? 'Built in' : 'macOS only'}
            </span>
          </div>
          <p className="rules-page__system-summary">{rule.summary}</p>
          <div className="rules-page__rule-meta">
            <span>Applies globally</span>
            <span>{available ? 'Always active' : 'Available on macOS'}</span>
          </div>
        </div>
        <button
          type="button"
          className="rules-page__disclosure"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((current) => !current)}
        >
          Details
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <div className="rules-page__details rules-page__details--system" id={detailsId}>
          <div className="rules-page__details-wide">
            <span>How it works</span>
            <strong>{rule.evidence}</strong>
          </div>
        </div>
      )}
    </article>
  );
}

function LoadingState() {
  return (
    <div className="rules-page__state" role="status" aria-live="polite">
      <RefreshCw className="rules-page__spin" size={22} aria-hidden="true" />
      <strong>Loading rules…</strong>
      <span>Checking the rules stored on this device.</span>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rules-page__state rules-page__state--error" role="alert">
      <AlertCircle size={23} aria-hidden="true" />
      <strong>Rules could not be loaded</strong>
      <span>{message}</span>
      <button type="button" className="rules-page__secondary-action" onClick={onRetry}>
        <RefreshCw size={14} aria-hidden="true" />
        Try again
      </button>
    </div>
  );
}

function EmptyState({
  category,
  searching,
  onClearSearch,
  onCreate,
  canCreate,
}: {
  category: Exclude<RuleCategory, 'system'>;
  searching: boolean;
  onClearSearch: () => void;
  onCreate: () => void;
  canCreate: boolean;
}) {
  return (
    <div className="rules-page__state">
      {category === 'learned' ? <BrainCircuit size={23} aria-hidden="true" /> : <Sparkles size={23} aria-hidden="true" />}
      <strong>{searching ? 'No matching rules' : `No ${category} rules yet`}</strong>
      <span>
        {searching
          ? 'Try another project name, condition, or status.'
          : category === 'learned'
            ? 'Correct activity assignments and Duskry will surface reliable local patterns here.'
            : 'Create a rule to assign future activity automatically.'}
      </span>
      {searching ? (
        <button type="button" className="rules-page__secondary-action" onClick={onClearSearch}>Clear search</button>
      ) : category === 'manual' && canCreate ? (
        <button type="button" className="rules-page__secondary-action" onClick={onCreate}>
          <Plus size={14} aria-hidden="true" />
          Create a rule
        </button>
      ) : null}
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="rules-page__error-notice" role="alert">
      <AlertCircle size={15} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
