/**
 * Top bar of the right panel: collapse on the left; on the right, switches
 * between the person, the chat's highlighted messages and what was shared in it.
 * Over the profile's cover it floats on a blurred backdrop.
 */
import { PanelCollapseIcon, PersonIcon, SharedIcon, StarIcon } from './icons';

export type PanelView = 'profile' | 'highlights' | 'shared';

interface Props {
  view: PanelView;
  onView?: (v: PanelView) => void;
  highlightCount: number;
  onCollapse: () => void;
  /** Shown beside the collapse button (views without a cover). */
  title?: string;
  /** Floats over the cover image. */
  overlay?: boolean;
}

const VIEWS: { id: PanelView; label: string; icon: JSX.Element }[] = [
  { id: 'profile', label: 'Profile', icon: <PersonIcon /> },
  { id: 'highlights', label: 'Highlighted messages', icon: <StarIcon /> },
  { id: 'shared', label: 'Media, files and links', icon: <SharedIcon /> },
];

export function PanelBar({ view, onView, highlightCount, onCollapse, title, overlay }: Props) {
  return (
    <div className={`panel-bar ${overlay ? 'overlay' : ''}`}>
      <button type="button" className="panel-bar-btn" onClick={onCollapse} aria-label="Collapse panel" title="Collapse">
        <PanelCollapseIcon />
      </button>
      {title && <h2 className="panel-bar-title">{title}</h2>}
      {onView && (
        <div className="panel-views" role="tablist" aria-label="Panel">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              className="panel-view"
              aria-selected={view === v.id}
              aria-label={v.id === 'highlights' ? `${v.label} (${highlightCount})` : v.label}
              title={v.label}
              onClick={() => onView(v.id)}
            >
              {v.icon}
              {v.id === 'highlights' && highlightCount > 0 && <span className="toolbar-count">{highlightCount}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
