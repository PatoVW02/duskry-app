import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RefreshCw, Trash2, Copy, Check } from 'lucide-react';

type LogLevel = 'stop' | 'start' | 'resume' | 'idle' | 'warn' | 'info';

function classifyLine(line: string): LogLevel {
  const l = line.toLowerCase();
  if (l.includes('stopped activity') || l.includes('manual pause') || l.includes('paused')) return 'stop';
  if (l.includes('started activity') || l.includes('tracking loop start') || l.includes('tracker thread')) return 'start';
  if (l.includes('resumed') || l.includes('user active again') || l.includes('resume')) return 'resume';
  if (l.includes('idle') || l.includes('idle suppressed')) return 'idle';
  if (l.includes('timeout') || l.includes('timed out') || l.includes('db error') || l.includes('none')) return 'warn';
  return 'info';
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  stop:   'rgba(248,113,113,0.85)',
  start:  'rgba(52,211,153,0.85)',
  resume: 'rgba(45,212,191,0.85)',
  idle:   'rgba(251,191,36,0.85)',
  warn:   'rgba(251,146,60,0.85)',
  info:   'rgba(255,255,255,0.55)',
};

export function TrackerLog() {
  const [lines, setLines]     = useState<string[]>([]);
  const [path, setPath]       = useState('');
  const [copied, setCopied]   = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const result = await invoke<string[]>('get_tracker_log', { lines: 400 });
    setLines(result);
  };

  useEffect(() => {
    invoke<string>('get_tracker_log_path').then(setPath);
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines, autoScroll]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  };

  const copyPath = async () => {
    await navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const clearLog = async () => {
    await invoke('clear_tracker_log');
    setLines([]);
  };

  return (
    <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
            Tracker Log
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
            Live — refreshes every 3 s
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={load}
            title="Refresh now"
            style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6, padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              color: 'rgba(255,255,255,0.6)', fontSize: 11,
            }}
          >
            <RefreshCw size={11} /> Refresh
          </button>
          <button
            onClick={copyPath}
            title="Copy log file path"
            style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6, padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              color: copied ? 'rgba(52,211,153,0.9)' : 'rgba(255,255,255,0.6)', fontSize: 11,
            }}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied!' : 'Copy path'}
          </button>
          <button
            onClick={clearLog}
            title="Clear log"
            style={{
              background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
              borderRadius: 6, padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              color: 'rgba(248,113,113,0.7)', fontSize: 11,
            }}
          >
            <Trash2 size={11} /> Clear
          </button>
        </div>
      </div>

      {/* Log area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{
          height: 340,
          overflowY: 'auto',
          background: 'rgba(0,0,0,0.25)',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.07)',
          padding: '10px 12px',
          fontFamily: 'ui-monospace, "Cascadia Code", "SF Mono", monospace',
          fontSize: 11,
          lineHeight: '1.6',
        }}
      >
        {lines.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.25)', paddingTop: 4 }}>
            No log entries yet. The log fills as the tracker runs.
          </div>
        ) : (
          lines.map((line, i) => {
            const level = classifyLine(line);
            return (
              <div key={i} style={{ color: LEVEL_COLORS[level], whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {line}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Legend + path */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {(Object.entries(LEVEL_COLORS) as [LogLevel, string][]).map(([level, color]) => (
            <span key={level} style={{ fontSize: 10, color, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
              {level}
            </span>
          ))}
        </div>
        {path && (
          <div
            title={path}
            style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}
          >
            {path}
          </div>
        )}
      </div>
    </div>
  );
}
