import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SidebarProjectList } from './SidebarProjectList';

const projects = [
  { id: 1, name: 'Duskry', color: '#2dd4bf', icon: null, created_at: 1 },
  { id: 2, name: 'Personal', color: '#a78bfa', icon: null, created_at: 2 },
];

describe('Sidebar projects', () => {
  it('keeps project drop targets visible before a drag starts', () => {
    const markup = renderToStaticMarkup(
      <SidebarProjectList
        projects={projects}
        dropProjectIds={new Set([1, 2])}
        isDragging={false}
        dragOver={null}
        onManage={vi.fn()}
      />,
    );

    expect(markup).toContain('Drag Review activity here to assign it.');
    expect(markup).toContain('data-drop-project-id="1"');
    expect(markup).toContain('data-drop-project-id="2"');
  });

  it('shows locked projects without making them drop targets', () => {
    const markup = renderToStaticMarkup(
      <SidebarProjectList
        projects={[
        { id: 1, name: 'One', color: '#2dd4bf', icon: null, created_at: 1 },
        { id: 2, name: 'Two', color: '#a78bfa', icon: null, created_at: 2 },
        { id: 3, name: 'Three', color: '#60a5fa', icon: null, created_at: 3 },
        { id: 4, name: 'Locked project', color: '#fb7185', icon: null, created_at: 4 },
        ]}
        dropProjectIds={new Set([1, 2, 3])}
        isDragging={false}
        dragOver={null}
        onManage={vi.fn()}
      />,
    );

    expect(markup).toContain('Locked project, locked on your current plan');
    expect(markup).not.toContain('data-drop-project-id="4"');
  });

  it('announces drag mode and highlights the current project target', () => {
    const markup = renderToStaticMarkup(
      <SidebarProjectList
        projects={projects}
        dropProjectIds={new Set([1, 2])}
        isDragging
        dragOver={2}
        onManage={vi.fn()}
      />,
    );

    expect(markup).toContain('Drop to assign');
    expect(markup).toContain('Personal, drop to assign');
    expect(markup).toContain('sidebar-project--over');
  });
});
