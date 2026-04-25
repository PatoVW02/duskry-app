import { useEffect, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { format, fromUnixTime, isToday } from 'date-fns';
import { useProjectStore } from '../stores/useProjectStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useActivityStore, type Activity } from '../stores/useActivityStore';
import { useLicenseStore, isPro } from '../stores/useLicenseStore';
import { PROJECT_COLORS } from '../styles/tokens';
import { Plus, ChevronDown, ChevronRight, X, Target, Lock, Trash2 } from 'lucide-react';
import { Select } from '../components/ui/Select';
import { formatDuration } from '../lib/utils';

interface Rule {
  id: number;
  project_id: number;
  field: string;
  operator: string;
  value: string;
  priority: number;
}

interface RuleCondition {
  type?: 'condition';
  field: string;
  operator: string;
  value: string;
  negated: boolean;
}

interface RuleGroup {
  type?: 'group';
  combinator: 'and' | 'or';
  conditions: RuleNode[];
}

type RuleNode = RuleCondition | RuleGroup;
type SerializableRuleNode =
  | Omit<RuleCondition, 'type'>
  | { combinator: 'and' | 'or'; conditions: SerializableRuleNode[] };

interface CompoundRuleValue {
  combinator: 'and' | 'or';
  conditions: RuleNode[];
}

interface ActivityGroup {
  key: string;
  label: string;
  activities: Activity[];
  total_s: number;
  started_at: number;
}

interface AppActivityGroup {
  key: string;
  appName: string;
  groups: ActivityGroup[];
  activities: Activity[];
  total_s: number;
  started_at: number;
}

const FIELD_OPTIONS = [
  { value: 'app',   label: 'App name' },
  { value: 'title', label: 'Window title' },
  { value: 'url',   label: 'Browser URL' },
];

const OPERATOR_OPTIONS = [
  { value: 'contains',    label: 'contains' },
  { value: 'equals',      label: 'equals' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with',   label: 'ends with' },
];

const emptyCondition = (): RuleCondition => ({
  type: 'condition',
  field: 'app',
  operator: 'contains',
  value: '',
  negated: false,
});

const emptyGroup = (): RuleGroup => ({
  type: 'group',
  combinator: 'or',
  conditions: [emptyCondition(), emptyCondition()],
});

function isGroup(node: RuleNode): node is RuleGroup {
  return 'conditions' in node;
}

function parseCompoundRule(rule: Rule): CompoundRuleValue | null {
  if (rule.field !== 'compound') return null;
  try {
    const parsed = JSON.parse(rule.value) as CompoundRuleValue;
    if (!Array.isArray(parsed.conditions)) return null;
    return {
      combinator: parsed.combinator === 'or' ? 'or' : 'and',
      conditions: parsed.conditions.map(normalizeRuleNode),
    };
  } catch {
    return null;
  }
}

function normalizeRuleNode(node: RuleNode): RuleNode {
  if (isGroup(node)) {
    return {
      type: 'group',
      combinator: node.combinator === 'or' ? 'or' : 'and',
      conditions: Array.isArray(node.conditions) ? node.conditions.map(normalizeRuleNode) : [],
    };
  }
  return {
    type: 'condition',
    field: node.field,
    operator: node.operator,
    value: node.value,
    negated: Boolean(node.negated),
  };
}

function fieldLabel(field: string) {
  return field === 'app' ? 'app name' : field === 'url' ? 'browser URL' : field === 'title' ? 'window title' : field;
}

function operatorLabel(operator: string) {
  return operator.replace('_', ' ');
}

function conditionLabel(condition: RuleCondition) {
  return `${condition.negated ? 'NOT ' : ''}${fieldLabel(condition.field)} ${operatorLabel(condition.operator)} "${condition.value}"`;
}

function nodeHasValue(node: RuleNode): boolean {
  return isGroup(node)
    ? node.conditions.some(nodeHasValue)
    : Boolean(node.value.trim());
}

function cleanRuleNode(node: RuleNode): RuleNode | null {
  if (isGroup(node)) {
    const conditions = node.conditions
      .map(cleanRuleNode)
      .filter((child): child is RuleNode => child !== null);
    if (conditions.length === 0) return null;
    return {
      type: 'group',
      combinator: node.combinator,
      conditions,
    };
  }
  const value = node.value.trim();
  if (!value) return null;
  return { ...node, type: 'condition', value };
}

function stripNodeTypes(node: RuleNode): SerializableRuleNode {
  if (isGroup(node)) {
    return {
      combinator: node.combinator,
      conditions: node.conditions.map(stripNodeTypes),
    };
  }
  return {
    field: node.field,
    operator: node.operator,
    value: node.value,
    negated: node.negated,
  };
}

function ruleNodeKey(node: RuleNode, index: number) {
  return isGroup(node)
    ? `group-${node.combinator}-${index}`
    : `${node.field}-${node.operator}-${node.value}-${index}`;
}

function displayAppName(name: string): string {
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function activitySubtitle(activity: Activity): string {
  return activity.domain ?? activity.file_path ?? activity.window_title ?? 'No context';
}

function activityGroupLabel(activity: Activity): string {
  return activity.domain ?? activity.window_title?.trim() ?? activity.file_path ?? 'No context';
}

function buildActivityGroups(activities: Activity[]): AppActivityGroup[] {
  const byApp = new Map<string, Activity[]>();
  for (const activity of activities) {
    const list = byApp.get(activity.app_name) ?? [];
    list.push(activity);
    byApp.set(activity.app_name, list);
  }

  return Array.from(byApp.entries())
    .map(([appName, appActivities]) => {
      const byContext = new Map<string, Activity[]>();
      for (const activity of appActivities) {
        const label = activityGroupLabel(activity);
        const list = byContext.get(label) ?? [];
        list.push(activity);
        byContext.set(label, list);
      }
      const groups = Array.from(byContext.entries())
        .map(([label, items]) => {
          const sorted = [...items].sort((a, b) => b.started_at - a.started_at);
          return {
            key: `${appName}::${label}`,
            label,
            activities: sorted,
            total_s: sorted.reduce((sum, activity) => sum + (activity.duration_s ?? 0), 0),
            started_at: Math.min(...sorted.map((activity) => activity.started_at)),
          };
        })
        .sort((a, b) => b.total_s - a.total_s || b.started_at - a.started_at);
      const sortedActivities = [...appActivities].sort((a, b) => b.started_at - a.started_at);
      return {
        key: appName,
        appName,
        groups,
        activities: sortedActivities,
        total_s: sortedActivities.reduce((sum, activity) => sum + (activity.duration_s ?? 0), 0),
        started_at: Math.min(...sortedActivities.map((activity) => activity.started_at)),
      };
    })
    .sort((a, b) => b.total_s - a.total_s || b.started_at - a.started_at);
}

export function Projects({ onUpgrade }: { onUpgrade: () => void }) {
  const projects = useProjectStore((s) => s.projects);
  const createProject = useProjectStore((s) => s.createProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const { activeProjectId, setActiveProject } = useSettingsStore();
  const { tier } = useLicenseStore();
  const activities = useActivityStore((s) => s.activities);
  const viewDate = useActivityStore((s) => s.viewDate);
  const fetchForDate = useActivityStore((s) => s.fetchForDate);

  const activeProject = projects.find((p) => (p.id as number) === activeProjectId) ?? null;

  // Projects beyond the free-tier limit (3) are locked — oldest 3 stay active.
  const lockedProjectIds = (() => {
    if (isPro(tier)) return new Set<number>();
    const sorted = [...projects].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
    return new Set(sorted.slice(3).map((p) => p.id as number));
  })();

  // Clear active focus project if it became locked after a downgrade.
  useEffect(() => {
    if (activeProjectId && lockedProjectIds.has(activeProjectId)) {
      setActiveProject(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier, activeProjectId]);

  // ── project creation ───────────────────────────────
  const [showForm, setShowForm]   = useState(false);
  const [name, setName]           = useState('');
  const [color, setColor]         = useState(PROJECT_COLORS[0]);
  const [creating, setCreating]   = useState(false);

  // ── rules management ──────────────────────────────
  const [expandedId, setExpandedId]     = useState<number | null>(null);
  const [expandedActivitiesId, setExpandedActivitiesId] = useState<number | null>(null);
  const [expandedActivityGroups, setExpandedActivityGroups] = useState<Set<string>>(() => new Set());
  const [projectRules, setProjectRules] = useState<Record<number, Rule[]>>({});
  const [addingRuleFor, setAddingRuleFor] = useState<number | null>(null);
  const [ruleCombinator, setRuleCombinator] = useState<'and' | 'or'>('and');
  const [ruleNodes, setRuleNodes] = useState<RuleNode[]>(() => [emptyCondition()]);
  const [savingRule, setSavingRule]     = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<number | null>(null);

  // ── rule-apply modal ──────────────────────────────
  const [ruleApplyModal, setRuleApplyModal] = useState<{
    ruleId: number; projectId: number; projectName: string; projectColor: string;
  } | null>(null);
  const [applyRange, setApplyRange]     = useState<'today' | 'from_date' | 'date_range'>('today');
  const [applyFromDate, setApplyFromDate] = useState('');
  const [applyToDate, setApplyToDate]   = useState('');
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyResult, setApplyResult]   = useState<number | null>(null);

  useEffect(() => {
    fetchForDate(viewDate);
    if (isToday(viewDate)) {
      const id = setInterval(() => fetchForDate(viewDate), 10_000);
      return () => clearInterval(id);
    }
  }, [viewDate, fetchForDate]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    await createProject(name.trim(), color);
    setName('');
    setColor(PROJECT_COLORS[0]);
    setShowForm(false);
    setCreating(false);
  };

  const handleDeleteProject = async (projectId: number) => {
    setDeletingProjectId(projectId);
    try {
      await deleteProject(projectId);
      if (activeProjectId === projectId) await setActiveProject(0);
      if (expandedId === projectId) setExpandedId(null);
      if (expandedActivitiesId === projectId) setExpandedActivitiesId(null);
      setProjectRules((rules) => {
        const next = { ...rules };
        delete next[projectId];
        return next;
      });
      await fetchForDate(viewDate);
    } finally {
      setDeletingProjectId(null);
      setDeleteConfirmId(null);
    }
  };

  const loadRules = async (projectId: number) => {
    const rules = await invoke<Rule[]>('get_rules_for_project', { projectId });
    setProjectRules((r) => ({ ...r, [projectId]: rules }));
  };

  const toggleExpand = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setAddingRuleFor(null);
      return;
    }
    setExpandedId(id);
    setAddingRuleFor(null);
    setRuleCombinator('and');
    setRuleNodes([emptyCondition()]);
    await loadRules(id);
  };

  const handleAddRule = async (projectId: number) => {
    const cleanedNodes = ruleNodes
      .map(cleanRuleNode)
      .filter((node): node is RuleNode => node !== null);
    if (cleanedNodes.length === 0) return;
    setSavingRule(true);
    const first = cleanedNodes[0];
    const isSimple = cleanedNodes.length === 1 && !isGroup(first) && !first.negated;
    const ruleId = await invoke<number>('create_rule', {
      projectId,
      field: isSimple ? first.field : 'compound',
      operator: isSimple ? first.operator : 'matches',
      value: isSimple ? first.value : JSON.stringify({ combinator: ruleCombinator, conditions: cleanedNodes.map(stripNodeTypes) }),
      priority: 0,
    });
    await loadRules(projectId);
    setRuleCombinator('and');
    setRuleNodes([emptyCondition()]);
    setAddingRuleFor(null);
    setSavingRule(false);
    // offer retroactive application
    const today = new Date().toISOString().split('T')[0];
    const project = projects.find((p) => p.id === projectId);
    setApplyFromDate(today);
    setApplyToDate(today);
    setApplyRange('today');
    setApplyResult(null);
    setRuleApplyModal({
      ruleId,
      projectId,
      projectName: project?.name ?? 'this project',
      projectColor: project?.color ?? '#86EFAC',
    });
  };

  const updateRuleNode = (path: number[], updater: (node: RuleNode) => RuleNode) => {
    const updateAtPath = (nodes: RuleNode[], depth: number): RuleNode[] => {
      const index = path[depth];
      return nodes.map((node, i) => {
        if (i !== index) return node;
        if (depth === path.length - 1) return updater(node);
        if (!isGroup(node)) return node;
        return { ...node, conditions: updateAtPath(node.conditions, depth + 1) };
      });
    };
    setRuleNodes((nodes) => updateAtPath(nodes, 0));
  };

  const updateRuleCondition = (path: number[], patch: Partial<RuleCondition>) => {
    updateRuleNode(path, (node) => isGroup(node) ? node : { ...node, ...patch });
  };

  const updateRuleGroup = (path: number[], patch: Partial<RuleGroup>) => {
    updateRuleNode(path, (node) => isGroup(node) ? { ...node, ...patch } : node);
  };

  const addNodeToGroup = (path: number[], nodeToAdd: RuleNode) => {
    if (path.length === 0) {
      setRuleNodes((nodes) => [...nodes, nodeToAdd]);
      return;
    }
    updateRuleNode(path, (node) => isGroup(node)
      ? { ...node, conditions: [...node.conditions, nodeToAdd] }
      : node);
  };

  const removeRuleNode = (path: number[]) => {
    if (path.length === 1) {
      setRuleNodes((nodes) => nodes.length === 1
        ? [emptyCondition()]
        : nodes.filter((_, i) => i !== path[0]));
      return;
    }
    const parentPath = path.slice(0, -1);
    const removeIndex = path[path.length - 1];
    updateRuleNode(parentPath, (node) => {
      if (!isGroup(node)) return node;
      return {
        ...node,
        conditions: node.conditions.length === 1
          ? [emptyCondition()]
          : node.conditions.filter((_, i) => i !== removeIndex),
      };
    });
  };

  const doApplyRule = async () => {
    if (!ruleApplyModal || applyLoading) return;
    setApplyLoading(true);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const now = Math.floor(Date.now() / 1000);
    let fromTs: number, toTs: number;
    if (applyRange === 'today') {
      fromTs = Math.floor(todayStart.getTime() / 1000);
      toTs = now;
    } else if (applyRange === 'from_date') {
      fromTs = Math.floor(new Date(applyFromDate + 'T00:00:00').getTime() / 1000);
      toTs = now;
    } else {
      fromTs = Math.floor(new Date(applyFromDate + 'T00:00:00').getTime() / 1000);
      toTs   = Math.floor(new Date(applyToDate   + 'T23:59:59').getTime() / 1000);
    }
    try {
      const count = await invoke<number>('apply_rule_to_activities', {
        ruleId: ruleApplyModal.ruleId, fromTs, toTs,
      });
      setApplyResult(count);
    } catch { /* ignore */ }
    setApplyLoading(false);
  };

  const handleDeleteRule = async (ruleId: number, projectId: number) => {
    await invoke('delete_rule', { ruleId });
    await loadRules(projectId);
  };

  const toggleActivities = (projectId: number) => {
    setExpandedActivitiesId((id) => id === projectId ? null : projectId);
  };

  const toggleActivityGroup = (key: string) => {
    setExpandedActivityGroups((groups) => {
      const next = new Set(groups);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const renderRuleNodeDisplay = (node: RuleNode, index: number, combinator: 'and' | 'or', depth = 0): ReactNode => {
    const prefix = index > 0 ? combinator.toUpperCase() : depth > 0 ? '(' : '';
    if (isGroup(node)) {
      return (
        <div key={ruleNodeKey(node, index)} style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 6,
          minWidth: 0,
          paddingLeft: depth > 0 ? 10 : 0,
        }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.24)', width: 30, flexShrink: 0, paddingTop: 2 }}>
            {prefix}
          </span>
          <div style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            borderLeft: depth > 0 ? '1px solid rgba(45,212,191,0.18)' : undefined,
            paddingLeft: depth > 0 ? 8 : 0,
          }}>
            {node.conditions.map((child, childIndex) => renderRuleNodeDisplay(child, childIndex, node.combinator, depth + 1))}
          </div>
          {depth > 0 && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.24)', paddingTop: 2 }}>)</span>}
        </div>
      );
    }
    return (
      <div key={ruleNodeKey(node, index)} style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minWidth: 0,
        paddingLeft: depth > 1 ? 10 : 0,
      }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.24)', width: 30, flexShrink: 0 }}>
          {prefix}
        </span>
        <span style={{
          fontSize: 12,
          fontWeight: 500,
          flex: 1,
          background: 'rgba(255,255,255,0.07)',
          padding: '2px 7px',
          borderRadius: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {conditionLabel(node)}
        </span>
      </div>
    );
  };

  const renderRuleNodeEditor = (node: RuleNode, path: number[], depth = 0): ReactNode => {
    if (isGroup(node)) {
      return (
        <div key={path.join('-')} style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          padding: '8px 8px 8px 10px',
          borderLeft: '1px solid rgba(45,212,191,0.22)',
          background: depth > 0 ? 'rgba(255,255,255,0.025)' : 'transparent',
          borderRadius: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.38)' }}>Group matches</span>
            <Select
              value={node.combinator}
              onChange={(v) => updateRuleGroup(path, { combinator: v === 'or' ? 'or' : 'and' })}
              options={[
                { value: 'and', label: 'all conditions' },
                { value: 'or', label: 'any condition' },
              ]}
            />
            <button
              type="button"
              onClick={() => removeRuleNode(path)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.24)', padding: '4px', display: 'flex', alignItems: 'center' }}
              title="Remove group"
            >
              <X size={12} />
            </button>
          </div>
          {node.conditions.map((child, index) => renderRuleNodeEditor(child, [...path, index], depth + 1))}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => addNodeToGroup(path, emptyCondition())} style={{ background: 'none', border: '0.5px dashed rgba(255,255,255,0.14)', cursor: 'pointer', color: 'rgba(255,255,255,0.35)', fontSize: 12, borderRadius: 6, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Plus size={11} /> Add condition
            </button>
            <button type="button" onClick={() => addNodeToGroup(path, emptyGroup())} style={{ background: 'none', border: '0.5px dashed rgba(45,212,191,0.22)', cursor: 'pointer', color: 'rgba(45,212,191,0.58)', fontSize: 12, borderRadius: 6, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Plus size={11} /> Add group
            </button>
          </div>
        </div>
      );
    }

    return (
      <div key={path.join('-')} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', paddingLeft: depth > 0 ? 6 : 0 }}>
        <button
          type="button"
          onClick={() => updateRuleCondition(path, { negated: !node.negated })}
          style={{
            width: 'auto',
            padding: '6px 9px',
            fontSize: 11,
            borderRadius: 6,
            border: `0.5px solid ${node.negated ? 'rgba(248,113,113,0.35)' : 'rgba(255,255,255,0.10)'}`,
            background: node.negated ? 'rgba(248,113,113,0.12)' : 'rgba(255,255,255,0.05)',
            color: node.negated ? 'rgba(248,113,113,0.82)' : 'rgba(255,255,255,0.38)',
          }}
        >
          NOT
        </button>
        <Select value={node.field} onChange={(v) => updateRuleCondition(path, { field: v })} options={FIELD_OPTIONS} />
        <Select value={node.operator} onChange={(v) => updateRuleCondition(path, { operator: v })} options={OPERATOR_OPTIONS} />
        <input
          className="glass-input"
          placeholder="e.g. VS Code"
          value={node.value}
          onChange={(e) => updateRuleCondition(path, { value: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && addingRuleFor && handleAddRule(addingRuleFor)}
          style={{ flex: '1 1 130px', fontSize: 12, padding: '7px 10px' }}
          autoFocus={path.length === 1 && path[0] === 0}
        />
        <button
          type="button"
          onClick={() => removeRuleNode(path)}
          title="Remove condition"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.24)', padding: '4px', display: 'flex', alignItems: 'center' }}
        >
          <X size={12} />
        </button>
      </div>
    );
  };

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Today's Focus ────────────────────────────── */}
      <div className="glass-card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
          <Target size={12} style={{ color: 'rgba(45,212,191,0.65)', flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.40)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Today's Focus
          </span>
        </div>

        {/* Active project indicator */}
        {activeProject ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.10)' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: activeProject.color, flexShrink: 0 }} />
            <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1 }}>{activeProject.name}</span>
            <button
              onClick={() => setActiveProject(0)}
              title="Clear focus"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.28)', display: 'flex', padding: 2 }}
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '0.5px dashed rgba(255,255,255,0.10)' }}>
            No focus project set, select one below or from the menu bar.
          </div>
        )}

        {/* Project selector pills */}
        {projects.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {projects
              .filter((p) => !lockedProjectIds.has(p.id as number))
              .map((p) => {
              const pid = p.id as number;
              const isActive = pid === activeProjectId;
              return (
                <button
                  key={pid}
                  onClick={() => setActiveProject(isActive ? 0 : pid)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
                    fontSize: 12, fontWeight: isActive ? 500 : 400,
                    background: isActive ? `${p.color}22` : 'rgba(255,255,255,0.05)',
                    border: `0.5px solid ${isActive ? p.color + '55' : 'rgba(255,255,255,0.10)'}`,
                    color: isActive ? p.color : 'rgba(255,255,255,0.65)',
                    transition: 'all 0.12s',
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                  {p.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Projects ──────────────────────────────────── */}
      <div className="glass-card" style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 500 }}>Projects</div>
            {!isPro(tier) && (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                {projects.length - lockedProjectIds.size}/3
              </span>
            )}
          </div>
          {!isPro(tier) && projects.length >= 3 ? (
            <button
              onClick={onUpgrade}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                border: '0.5px solid rgba(45,212,191,0.35)',
                background: 'rgba(45,212,191,0.08)', color: 'rgba(45,212,191,0.85)',
                fontSize: 12, fontFamily: 'Inter, sans-serif',
              }}
            >
              <Lock size={11} />
              Upgrade for unlimited
            </button>
          ) : (
            <button className="btn-primary" style={{ width: 'auto', padding: '6px 14px', fontSize: 12 }}
              onClick={() => setShowForm(!showForm)}>
              <Plus size={12} style={{ display: 'inline', marginRight: 5 }} />
              New project
            </button>
          )}
        </div>

        {showForm && (
          <div style={{
            padding: '16px', borderRadius: 10, marginBottom: 16,
            background: 'rgba(255,255,255,0.04)',
            border: '0.5px solid rgba(255,255,255,0.10)',
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <input
              className="glass-input"
              placeholder="Project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <div className="color-picker">
              {PROJECT_COLORS.map((c) => (
                <button key={c} className={`color-swatch ${color === c ? 'selected' : ''}`}
                  style={{ backgroundColor: c }} onClick={() => setColor(c)} aria-label={c} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" onClick={handleCreate} disabled={creating || !name.trim()}>
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button className="btn-secondary" style={{ maxWidth: 100 }} onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {projects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'rgba(255,255,255,0.28)', fontSize: 13 }}>
            No projects yet. Create one to start categorizing your time.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {projects.map((p) => {
              const pid = p.id as number;
              const isLocked = lockedProjectIds.has(pid);
              const isExpanded = expandedId === pid;
              const activitiesOpen = expandedActivitiesId === pid;
              const rules = projectRules[pid] ?? [];
              const assignedActivities = activities
                .filter((activity) => activity.project_id === pid)
                .sort((a, b) => b.started_at - a.started_at);
              const activityGroups = buildActivityGroups(assignedActivities);
              const projectTotalSecs = assignedActivities.reduce((sum, activity) => sum + (activity.duration_s ?? 0), 0);

              return (
                <div key={pid} style={{ borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
                  {/* project row */}
                  <div
                    className={`project-row project-page-row${activitiesOpen && !isLocked ? ' is-open' : ''}`}
                    onClick={() => !isLocked && toggleActivities(pid)}
                    style={{
                      padding: '11px 0',
                      borderBottom: 'none',
                      cursor: isLocked ? 'default' : 'pointer',
                      opacity: isLocked ? 0.45 : 1,
                    }}
                  >
                    {isLocked ? (
                      <Lock size={13} style={{ color: 'rgba(255,255,255,0.30)', flexShrink: 0 }} />
                    ) : activitiesOpen ? (
                      <ChevronDown size={13} style={{ color: 'rgba(255,255,255,0.30)', flexShrink: 0 }} />
                    ) : (
                      <ChevronRight size={13} style={{ color: 'rgba(255,255,255,0.22)', flexShrink: 0 }} />
                    )}
                    <span className="project-dot" style={{ background: p.color, width: 10, height: 10 }} />
                    <span style={{ fontSize: 13.5, flex: 1 }}>{p.name}</span>
                    {isLocked ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); onUpgrade(); }}
                        style={{
                          padding: '3px 10px', borderRadius: 5, cursor: 'pointer',
                          border: '0.5px solid rgba(45,212,191,0.30)',
                          background: 'rgba(45,212,191,0.08)', color: 'rgba(45,212,191,0.75)',
                          fontSize: 11, fontFamily: 'Inter, sans-serif',
                        }}
                      >
                        Upgrade to unlock →
                      </button>
                    ) : (
                      <>
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', marginRight: 6 }}>
                          {assignedActivities.length} activit{assignedActivities.length === 1 ? 'y' : 'ies'}
                        </span>
                        {projectTotalSecs > 0 && (
                          <span style={{ fontSize: 11, color: p.color, fontVariantNumeric: 'tabular-nums', marginRight: 8 }}>
                            {formatDuration(projectTotalSecs)}
                          </span>
                        )}
                        {isExpanded && rules.length > 0 && (
                          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', marginRight: 6 }}>
                            {rules.length} rule{rules.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        <button
                          className={`project-rules-button${isExpanded ? ' is-open' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(pid);
                          }}
                        >
                          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          Rules
                        </button>
                        {deleteConfirmId === pid ? (
                          <>
                            <button
                              className="delete-confirm-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteProject(pid);
                              }}
                              disabled={deletingProjectId === pid}
                              style={{
                                padding: '3px 9px', borderRadius: 5, cursor: deletingProjectId === pid ? 'default' : 'pointer',
                                border: '0.5px solid rgba(239,68,68,0.35)',
                                background: 'rgba(239,68,68,0.10)', color: 'rgba(248,113,113,0.88)',
                                fontSize: 11, fontFamily: 'Inter, sans-serif',
                              }}
                            >
                              {deletingProjectId === pid ? 'Deleting…' : 'Delete'}
                            </button>
                            <button
                              className="cancel-confirm-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirmId(null);
                              }}
                              style={{
                                padding: '3px 8px', borderRadius: 5, cursor: 'pointer',
                                border: '0.5px solid rgba(255,255,255,0.12)',
                                background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.45)',
                                fontSize: 11, fontFamily: 'Inter, sans-serif',
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            className="icon-delete-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmId(pid);
                            }}
                            title="Delete project"
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              width: 24, height: 24, borderRadius: 6, cursor: 'pointer',
                              border: '0.5px solid rgba(255,255,255,0.08)',
                              background: 'rgba(255,255,255,0.03)', color: 'rgba(255,90,90,0.50)',
                              flexShrink: 0,
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {/* rules panel */}
                  {isExpanded && !isLocked && (
                    <div style={{
                      marginLeft: 20, marginBottom: 12,
                      borderLeft: `2px solid ${p.color}30`,
                      paddingLeft: 14,
                    }}>
                      {!isPro(tier) && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '8px 12px', borderRadius: 8, marginBottom: 8,
                          background: 'rgba(45,212,191,0.05)',
                          border: '0.5px solid rgba(45,212,191,0.15)',
                        }}>
                          <Lock size={11} style={{ color: 'rgba(45,212,191,0.60)', flexShrink: 0 }} />
                          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', flex: 1 }}>Auto-rules are available on Pro</span>
                          <button
                            onClick={onUpgrade}
                            style={{
                              padding: '3px 10px', borderRadius: 5, cursor: 'pointer',
                              border: '0.5px solid rgba(45,212,191,0.30)',
                              background: 'rgba(45,212,191,0.10)', color: 'rgba(45,212,191,0.80)',
                              fontSize: 11, fontFamily: 'Inter, sans-serif',
                            }}
                          >
                            Upgrade →
                          </button>
                        </div>
                      )}
                      {rules.length === 0 && addingRuleFor !== pid && isPro(tier) && (
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', padding: '4px 0 8px' }}>
                          No rules yet. Activities won't be auto-assigned to this project.
                        </div>
                      )}

                      {/* existing rules */}
                      {rules.map((r, ruleIndex) => {
                        const compound = parseCompoundRule(r);
                        const singleCompoundCondition =
                          compound?.conditions.length === 1 && !isGroup(compound.conditions[0])
                            ? compound.conditions[0]
                            : null;
                        return (
                          <div key={r.id}>
                            {ruleIndex > 0 && (
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '4px 0 2px',
                              }}>
                                <span style={{ width: 72, flexShrink: 0 }} />
                                <span style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: 'rgba(45,212,191,0.68)',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.06em',
                                  flexShrink: 0,
                                }}>
                                  OR
                                </span>
                                <span style={{ height: 1, flex: 1, background: 'rgba(45,212,191,0.10)' }} />
                              </div>
                            )}
                            <div style={{
                              display: 'flex', alignItems: compound && !singleCompoundCondition ? 'flex-start' : 'center', gap: 8,
                              padding: '6px 0',
                              borderBottom: '0.5px solid rgba(255,255,255,0.05)',
                            }}>
                              {singleCompoundCondition ? (
                                <>
                                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', width: 72, flexShrink: 0 }}>
                                    {fieldLabel(singleCompoundCondition.field)}
                                  </span>
                                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', flexShrink: 0 }}>
                                    {operatorLabel(singleCompoundCondition.operator)}
                                  </span>
                                  <span style={{
                                    fontSize: 12, fontWeight: 500, flex: 1,
                                    background: 'rgba(255,255,255,0.07)',
                                    padding: '1px 7px', borderRadius: 4,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  }}>
                                    {singleCompoundCondition.value}
                                  </span>
                                </>
                              ) : compound ? (
                                <>
                                  <span style={{ fontSize: 10.5, color: 'rgba(45,212,191,0.65)', width: 72, flexShrink: 0, paddingTop: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                    {compound.combinator === 'and' ? 'All' : 'Any'}
                                  </span>
                                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {compound.conditions.map((node, index) => renderRuleNodeDisplay(node, index, compound.combinator))}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', width: 72, flexShrink: 0 }}>
                                    {fieldLabel(r.field)}
                                  </span>
                                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', flexShrink: 0 }}>
                                    {operatorLabel(r.operator)}
                                  </span>
                                  <span style={{
                                    fontSize: 12, fontWeight: 500, flex: 1,
                                    background: 'rgba(255,255,255,0.07)',
                                    padding: '1px 7px', borderRadius: 4,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  }}>
                                    {r.value}
                                  </span>
                                </>
                              )}
                              <button
                                onClick={() => handleDeleteRule(r.id, pid)}
                                title="Delete rule"
                                style={{
                                  background: 'none', border: 'none', cursor: 'pointer',
                                  color: 'rgba(255,255,255,0.22)', padding: '2px', display: 'flex', alignItems: 'center',
                                  flexShrink: 0,
                                }}
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {/* add-rule form */}
                      {addingRuleFor === pid ? (
                        <div style={{
                          marginTop: 8, padding: '10px 12px', borderRadius: 8,
                          background: 'rgba(255,255,255,0.03)',
                          border: '0.5px solid rgba(255,255,255,0.08)',
                          display: 'flex', flexDirection: 'column', gap: 8,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.38)' }}>Match</span>
                            <Select
                              value={ruleCombinator}
                              onChange={(v) => setRuleCombinator(v === 'or' ? 'or' : 'and')}
                              options={[
                                { value: 'and', label: 'all conditions' },
                                { value: 'or', label: 'any condition' },
                              ]}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                            {ruleNodes.map((node, index) => renderRuleNodeEditor(node, [index]))}
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              onClick={() => addNodeToGroup([], emptyCondition())}
                              style={{
                                alignSelf: 'flex-start',
                                background: 'none',
                                border: '0.5px dashed rgba(255,255,255,0.14)',
                                cursor: 'pointer', color: 'rgba(255,255,255,0.35)',
                                fontSize: 12, borderRadius: 6, padding: '5px 10px',
                                display: 'flex', alignItems: 'center', gap: 5,
                              }}
                            >
                              <Plus size={11} /> Add condition
                            </button>
                            <button
                              type="button"
                              onClick={() => addNodeToGroup([], emptyGroup())}
                              style={{
                                alignSelf: 'flex-start',
                                background: 'none',
                                border: '0.5px dashed rgba(45,212,191,0.22)',
                                cursor: 'pointer', color: 'rgba(45,212,191,0.58)',
                                fontSize: 12, borderRadius: 6, padding: '5px 10px',
                                display: 'flex', alignItems: 'center', gap: 5,
                              }}
                            >
                              <Plus size={11} /> Add group
                            </button>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className="btn-primary"
                              onClick={() => handleAddRule(pid)}
                              disabled={savingRule || !ruleNodes.some(nodeHasValue)}
                              style={{ fontSize: 12, padding: '5px 14px', width: 'auto' }}
                            >
                              {savingRule ? 'Saving…' : 'Add rule'}
                            </button>
                            <button
                              className="btn-secondary"
                              onClick={() => { setAddingRuleFor(null); setRuleCombinator('and'); setRuleNodes([emptyCondition()]); }}
                              style={{ fontSize: 12, padding: '5px 14px', width: 'auto' }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : isPro(tier) ? (
                        <button
                          onClick={() => { setAddingRuleFor(pid); setRuleCombinator('and'); setRuleNodes([emptyCondition()]); }}
                          style={{
                            marginTop: 8,
                            background: 'none',
                            border: '0.5px dashed rgba(255,255,255,0.14)',
                            cursor: 'pointer', color: 'rgba(255,255,255,0.35)',
                            fontSize: 12, borderRadius: 6, padding: '5px 12px',
                            display: 'flex', alignItems: 'center', gap: 5,
                          }}
                        >
                          <Plus size={11} /> Add rule
                        </button>
                      ) : null}
                    </div>
                  )}

                  {/* assigned activities panel */}
                  {activitiesOpen && (
                    <div style={{
                      marginLeft: 20,
                      marginBottom: 12,
                      borderLeft: `2px solid ${p.color}30`,
                      paddingLeft: 14,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}>
                      {assignedActivities.length === 0 ? (
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', padding: '4px 0 8px' }}>
                          No activities assigned to this project for this day.
                        </div>
                      ) : (
                        activityGroups.map((appGroup) => {
                          const appGroupKey = `${pid}::app::${appGroup.key}`;
                          const appGroupOpen = expandedActivityGroups.has(appGroupKey);
                          return (
                            <div key={appGroupKey} style={{ borderBottom: '0.5px solid rgba(255,255,255,0.05)' }}>
                              <div
                                onClick={() => toggleActivityGroup(appGroupKey)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '7px 0',
                                  minWidth: 0,
                                  cursor: 'pointer',
                                }}
                              >
                                {appGroupOpen ? (
                                  <ChevronDown size={12} style={{ color: 'rgba(255,255,255,0.32)', flexShrink: 0 }} />
                                ) : (
                                  <ChevronRight size={12} style={{ color: 'rgba(255,255,255,0.24)', flexShrink: 0 }} />
                                )}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{
                                    fontSize: 12.5,
                                    fontWeight: 500,
                                    color: 'rgba(255,255,255,0.78)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}>
                                    {displayAppName(appGroup.appName)}
                                  </div>
                                  <div style={{
                                    fontSize: 11,
                                    color: 'rgba(255,255,255,0.32)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    marginTop: 1,
                                  }}>
                                    {appGroup.groups.length} context{appGroup.groups.length === 1 ? '' : 's'}
                                  </div>
                                </div>
                                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', flexShrink: 0 }}>
                                  {appGroup.activities.length} activit{appGroup.activities.length === 1 ? 'y' : 'ies'}
                                </span>
                                <span style={{
                                  fontSize: 11,
                                  color: 'rgba(255,255,255,0.38)',
                                  fontVariantNumeric: 'tabular-nums',
                                  flexShrink: 0,
                                  minWidth: 54,
                                  textAlign: 'right',
                                }}>
                                  {formatDuration(appGroup.total_s)}
                                </span>
                              </div>

                              {appGroupOpen && (
                                <div style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column' }}>
                                  {appGroup.groups.map((group) => {
                                    const groupKey = `${pid}::ctx::${group.key}`;
                                    const groupOpen = expandedActivityGroups.has(groupKey);
                                    return (
                                      <div key={groupKey} style={{ borderTop: '0.5px solid rgba(255,255,255,0.035)' }}>
                                        <div
                                          onClick={() => toggleActivityGroup(groupKey)}
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            padding: '6px 0',
                                            minWidth: 0,
                                            cursor: 'pointer',
                                          }}
                                        >
                                          {groupOpen ? (
                                            <ChevronDown size={11} style={{ color: 'rgba(255,255,255,0.30)', flexShrink: 0 }} />
                                          ) : (
                                            <ChevronRight size={11} style={{ color: 'rgba(255,255,255,0.22)', flexShrink: 0 }} />
                                          )}
                                          <div style={{
                                            flex: 1,
                                            minWidth: 0,
                                            fontSize: 11.5,
                                            color: 'rgba(255,255,255,0.48)',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                          }}>
                                            {group.label}
                                          </div>
                                          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.26)', flexShrink: 0 }}>
                                            {group.activities.length}
                                          </span>
                                          <span style={{
                                            fontSize: 10.5,
                                            color: 'rgba(255,255,255,0.34)',
                                            fontVariantNumeric: 'tabular-nums',
                                            flexShrink: 0,
                                            minWidth: 50,
                                            textAlign: 'right',
                                          }}>
                                            {formatDuration(group.total_s)}
                                          </span>
                                        </div>

                                        {groupOpen && group.activities.map((activity) => (
                                          <div
                                            key={activity.id}
                                            style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: 10,
                                              padding: '6px 0 6px 20px',
                                              borderTop: '0.5px solid rgba(255,255,255,0.025)',
                                              minWidth: 0,
                                            }}
                                          >
                                            <span style={{
                                              fontSize: 11,
                                              color: 'rgba(255,255,255,0.30)',
                                              width: 46,
                                              flexShrink: 0,
                                              fontVariantNumeric: 'tabular-nums',
                                            }}>
                                              {format(fromUnixTime(activity.started_at), 'HH:mm')}
                                            </span>
                                            <div style={{
                                              flex: 1,
                                              minWidth: 0,
                                              fontSize: 11.5,
                                              color: 'rgba(255,255,255,0.48)',
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                              whiteSpace: 'nowrap',
                                            }}>
                                              {activitySubtitle(activity)}
                                            </div>
                                            <span style={{
                                              fontSize: 11,
                                              color: 'rgba(255,255,255,0.32)',
                                              fontVariantNumeric: 'tabular-nums',
                                              flexShrink: 0,
                                            }}>
                                              {formatDuration(activity.duration_s ?? 0)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
      {/* ── Rule-apply modal ─────────────────────────────── */}
      {ruleApplyModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.60)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseDown={(e) => e.target === e.currentTarget && applyResult !== null && setRuleApplyModal(null)}
        >
          <div className="glass-card" style={{ width: 400, padding: '24px 26px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 5 }}>Apply rule to past activities?</div>
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.48)', lineHeight: 1.55 }}>
                Assign unassigned activities matching this rule to{' '}
                <span style={{ color: ruleApplyModal.projectColor, fontWeight: 500 }}>{ruleApplyModal.projectName}</span>.
              </div>
            </div>

            {/* Range options */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(['today', 'from_date', 'date_range'] as const).map((key) => {
                const labels = { today: 'Today only', from_date: 'From a specific date to today', date_range: 'Custom date range' };
                const active = applyRange === key;
                return (
                  <div key={key} onClick={() => setApplyRange(key)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
                    <span style={{ width: 15, height: 15, borderRadius: '50%', flexShrink: 0, border: `2px solid ${active ? 'rgba(45,212,191,0.80)' : 'rgba(255,255,255,0.22)'}`, background: active ? 'rgba(45,212,191,0.18)' : 'transparent', transition: 'all 0.12s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {active && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(45,212,191,0.90)' }} />}
                    </span>
                    {labels[key]}
                  </div>
                );
              })}
            </div>

            {/* Date inputs */}
            {applyRange === 'from_date' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)' }}>From</span>
                <input type="date" className="glass-input" value={applyFromDate} onChange={(e) => setApplyFromDate(e.target.value)} style={{ fontSize: 12, flex: 1 }} />
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)' }}>to today</span>
              </div>
            )}
            {applyRange === 'date_range' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <input type="date" className="glass-input" value={applyFromDate} onChange={(e) => setApplyFromDate(e.target.value)} style={{ fontSize: 12, flex: 1 }} />
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)' }}>→</span>
                <input type="date" className="glass-input" value={applyToDate} onChange={(e) => setApplyToDate(e.target.value)} style={{ fontSize: 12, flex: 1 }} />
              </div>
            )}

            {/* Result */}
            {applyResult !== null && (
              <div style={{ fontSize: 13, color: 'rgba(45,212,191,0.85)', padding: '8px 12px', borderRadius: 8, background: 'rgba(45,212,191,0.08)', border: '0.5px solid rgba(45,212,191,0.20)' }}>
                ✓ Applied to {applyResult} activit{applyResult === 1 ? 'y' : 'ies'}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              {applyResult === null ? (
                <>
                  <button className="btn-primary" onClick={doApplyRule} disabled={applyLoading || (applyRange !== 'today' && !applyFromDate)} style={{ fontSize: 12.5 }}>
                    {applyLoading ? 'Applying…' : 'Apply'}
                  </button>
                  <button className="btn-secondary" onClick={() => setRuleApplyModal(null)} style={{ fontSize: 12.5, maxWidth: 90 }}>
                    Skip
                  </button>
                </>
              ) : (
                <button className="btn-primary" onClick={() => setRuleApplyModal(null)} style={{ fontSize: 12.5, width: 'auto', padding: '8px 20px' }}>
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
