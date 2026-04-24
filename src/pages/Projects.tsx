import { useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useProjectStore } from '../stores/useProjectStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { PROJECT_COLORS } from '../styles/tokens';
import { Plus, ChevronDown, ChevronRight, X, Lock, Target } from 'lucide-react';
import { Select } from '../components/ui/Select';

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

export function Projects() {
  const projects = useProjectStore((s) => s.projects);
  const createProject = useProjectStore((s) => s.createProject);
  const { activeProjectId, setActiveProject } = useSettingsStore();

  const activeProject = projects.find((p) => (p.id as number) === activeProjectId) ?? null;

  // ── project creation ───────────────────────────────
  const [showForm, setShowForm]   = useState(false);
  const [name, setName]           = useState('');
  const [color, setColor]         = useState(PROJECT_COLORS[0]);
  const [creating, setCreating]   = useState(false);

  // ── rules management ──────────────────────────────
  const [expandedId, setExpandedId]     = useState<number | null>(null);
  const [projectRules, setProjectRules] = useState<Record<number, Rule[]>>({});
  const [addingRuleFor, setAddingRuleFor] = useState<number | null>(null);
  const [ruleCombinator, setRuleCombinator] = useState<'and' | 'or'>('and');
  const [ruleNodes, setRuleNodes] = useState<RuleNode[]>(() => [emptyCondition()]);
  const [savingRule, setSavingRule]     = useState(false);

  // ── rule-apply modal ──────────────────────────────
  const [ruleApplyModal, setRuleApplyModal] = useState<{
    ruleId: number; projectId: number; projectName: string; projectColor: string;
  } | null>(null);
  const [applyRange, setApplyRange]     = useState<'today' | 'from_date' | 'date_range'>('today');
  const [applyFromDate, setApplyFromDate] = useState('');
  const [applyToDate, setApplyToDate]   = useState('');
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyResult, setApplyResult]   = useState<number | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    await createProject(name.trim(), color);
    setName('');
    setColor(PROJECT_COLORS[0]);
    setShowForm(false);
    setCreating(false);
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
            {projects.map((p) => {
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

      {/* ── System rules ─────────────────────────────── */}
      <div className="glass-card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
          <Lock size={12} style={{ color: 'rgba(45,212,191,0.65)', flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.40)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            System rules
          </span>
        </div>
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '11px 14px', borderRadius: 8,
          background: 'rgba(45,212,191,0.05)',
          border: '0.5px solid rgba(45,212,191,0.15)',
        }}>
          <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>⏸</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>Idle timeout</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.42)', lineHeight: 1.55 }}>
              After <strong style={{ color: 'rgba(255,255,255,0.70)' }}>5 minutes</strong> of no keyboard or mouse
              input, the current activity is automatically paused. Tracking resumes the moment you return.
              Meetings and video playback are detected automatically and never interrupted.
            </div>
          </div>
          <span style={{
            flexShrink: 0, fontSize: 10.5, fontWeight: 500,
            padding: '2px 8px', borderRadius: 999,
            background: 'rgba(45,212,191,0.10)', color: 'rgba(45,212,191,0.65)',
            border: '0.5px solid rgba(45,212,191,0.18)',
          }}>
            built-in
          </span>
        </div>
      </div>

      {/* ── Projects ──────────────────────────────────── */}
      <div className="glass-card" style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 500 }}>Projects</div>
          <button className="btn-primary" style={{ width: 'auto', padding: '6px 14px', fontSize: 12 }}
            onClick={() => setShowForm(!showForm)}>
            <Plus size={12} style={{ display: 'inline', marginRight: 5 }} />
            New project
          </button>
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
              const isExpanded = expandedId === pid;
              const rules = projectRules[pid] ?? [];

              return (
                <div key={pid} style={{ borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
                  {/* project row */}
                  <div className="project-row" style={{ padding: '11px 0', borderBottom: 'none' }}>
                    <span className="project-dot" style={{ background: p.color, width: 10, height: 10 }} />
                    <span style={{ fontSize: 13.5, flex: 1 }}>{p.name}</span>
                    {isExpanded && rules.length > 0 && (
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', marginRight: 6 }}>
                        {rules.length} rule{rules.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    <button
                      onClick={() => toggleExpand(pid)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: isExpanded ? 'rgba(45,212,191,0.70)' : 'rgba(255,255,255,0.30)',
                        fontSize: 11.5, padding: '2px 4px',
                      }}
                    >
                      {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      Rules
                    </button>
                  </div>

                  {/* rules panel */}
                  {isExpanded && (
                    <div style={{
                      marginLeft: 20, marginBottom: 12,
                      borderLeft: `2px solid ${p.color}30`,
                      paddingLeft: 14,
                    }}>
                      {rules.length === 0 && addingRuleFor !== pid && (
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
                      ) : (
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
