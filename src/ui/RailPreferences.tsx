/**
 * Settings > Preferences: choose which features appear in the left rail and
 * their order. Chats always stays.
 */
import type { ReactNode } from 'react';
import {
  DEFAULT_RAIL,
  isDefaultRail,
  LOCKED,
  moveRail,
  setShown,
  type RailId,
  type RailPrefs,
} from '../core/settings/railPrefs';
import { ChevronDownIcon, ChevronUpIcon } from './icons';

export interface RailItemInfo {
  id: RailId;
  label: string;
  icon: ReactNode;
  /** False for features that are not ready yet. */
  available: boolean;
}

interface Props {
  prefs: RailPrefs;
  items: RailItemInfo[];
  onChange(p: RailPrefs): void;
}

export function RailPreferences({ prefs, items, onChange }: Props) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const shown = prefs.order.filter((id) => !prefs.hidden.includes(id)).length;
  return (
    <section className="settings-card" aria-labelledby="set-rail">
      <div className="settings-row">
        <h3 id="set-rail">Left sidebar</h3>
        <span className="rail-pref-count">
          {shown} of {prefs.order.length} shown
        </span>
      </div>
      <p className="settings-note">
        Choose the features you use and put them in your order. Chats always stays. Saved on this device.
      </p>
      <ul className="rail-pref-list" aria-label="Sidebar items">
        {prefs.order.map((id, i) => {
          const item = byId.get(id);
          if (!item) return null;
          const locked = LOCKED.includes(id);
          const on = !prefs.hidden.includes(id);
          return (
            <li key={id} className={`rail-pref${on ? '' : ' is-off'}`}>
              <span className="rail-pref-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="rail-pref-text">
                <span className="rail-pref-name">{item.label}</span>
                {locked ? (
                  <span className="rail-pref-tag">Always shown</span>
                ) : (
                  !item.available && <span className="rail-pref-tag">Coming soon</span>
                )}
              </span>
              <span className="rail-pref-move">
                <button
                  type="button"
                  className="rail-pref-btn"
                  aria-label={`Move ${item.label} up`}
                  disabled={i === 0}
                  onClick={() => onChange(moveRail(prefs, id, -1))}
                >
                  <ChevronUpIcon />
                </button>
                <button
                  type="button"
                  className="rail-pref-btn"
                  aria-label={`Move ${item.label} down`}
                  disabled={i === prefs.order.length - 1}
                  onClick={() => onChange(moveRail(prefs, id, 1))}
                >
                  <ChevronDownIcon />
                </button>
              </span>
              <label className="rail-pref-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={on}
                  disabled={locked}
                  aria-label={`Show ${item.label} in the sidebar`}
                  onChange={(e) => onChange(setShown(prefs, id, e.target.checked))}
                />
                <span className="rail-pref-track" aria-hidden="true" />
              </label>
            </li>
          );
        })}
      </ul>
      <div className="settings-actions">
        <button
          type="button"
          className="ghost-pill"
          disabled={isDefaultRail(prefs)}
          onClick={() => onChange({ order: [...DEFAULT_RAIL.order], hidden: [] })}
        >
          Reset to default
        </button>
      </div>
    </section>
  );
}
