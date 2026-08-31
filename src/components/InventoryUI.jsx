import React from 'react';
import { ITEMS } from '../assets/tilemaps/labMap.js';

/**
 * InventoryUI - the run checklist and whatever you are carrying.
 *
 * Renders bare content; the surrounding HudPanel owns the frame, title and n/3 badge.
 *
 * The exit is listed alongside the three sabotage targets rather than appearing once
 * they are done: a player needs to see the door is the fourth step before walking to
 * it and finding it shut.
 */

const OBJECTIVE_LABELS = [
  ['POWER', 'Overload the generator core'],
  ['DATA', 'Wipe the research archive'],
  ['CAMERAS', 'Loop the camera feeds'],
];

export default function InventoryUI({ inventory = [], objectives = {} }) {
  const done = objectives.done || 0;

  return (
    <div>
      <ul className="space-y-1">
        {OBJECTIVE_LABELS.map(([key, label]) => {
          const complete = Boolean(objectives[key]);
          return (
            <li key={key} className="flex items-center gap-2 text-[11px]">
              <span
                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm border ${
                  complete ? 'border-neon bg-neon/70' : 'border-edge bg-transparent'
                }`}
              />
              <span className={complete ? 'text-dim line-through' : 'text-slate-300'}>{label}</span>
            </li>
          );
        })}
        <li className="flex items-center gap-2 text-[11px]">
          <span
            className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm border ${
              objectives.ESCAPE ? 'border-neon bg-neon/70' : done >= 3 ? 'border-caution' : 'border-edge'
            }`}
          />
          <span className={done >= 3 ? 'text-caution' : 'text-dim'}>
            Release the blast door {done < 3 && '(locked)'}
          </span>
        </li>
      </ul>

      <div className="mt-2.5 border-t border-edge pt-2">
        <div className="panel-title mb-1.5">Carrying</div>
        {inventory.length === 0 ? (
          <div className="text-[11px] leading-snug text-dim">
            Nothing. Lab A and the Atrium have something worth taking.
          </div>
        ) : (
          <ul className="space-y-1">
            {inventory.map((id, i) => {
              const item = ITEMS[id];
              return (
                <li key={`${id}-${i}`} className="text-[11px]">
                  <span className="text-[#a78bfa]">{item?.label || id}</span>
                  {item?.hint && <div className="text-[10px] leading-tight text-dim">{item.hint}</div>}
                </li>
              );
            })}
          </ul>
        )}
        {inventory.length > 0 && (
          <div className="mt-1.5 text-[10px] text-neon/70">Press F to plant it where you stand.</div>
        )}
      </div>
    </div>
  );
}
