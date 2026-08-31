import React from 'react';
import { Modal } from './ApiConfigModal.jsx';

/**
 * SupportPanel - funding, without lying to anyone.
 *
 * Deliberate design decision: nothing here is gated in-game. The app has no backend
 * and no way to verify who has actually supported, so any "supporter unlock" it
 * offered would either be a fake check anyone could bypass or an honour-system badge
 * that means nothing. Instead, the perks live where they can actually be enforced -
 * Buy Me a Coffee's own members-only posts - and this panel is an honest doorway to
 * them.
 *
 * If a real supporter tier is wanted later, the mechanism is a Cloudflare Worker
 * holding a BMC webhook secret, issuing signed tokens the client can present. That is
 * a real feature with real work behind it, not a checkbox.
 */

const BMC = 'https://buymeacoffee.com/arjunmk';
const BMC_MEMBERSHIP = `${BMC}/membership`;
const REPO = 'https://github.com/mkarjun/Blackout-TheSubterfuge';

const TIERS = [
  {
    title: 'Buy a coffee',
    price: 'Any amount, once',
    href: BMC,
    cta: 'Send a coffee',
    primary: true,
    lines: [
      'One-off, whatever you think it is worth.',
      'Pays for the domain and the model credits behind the hosted demo.',
    ],
  },
  {
    title: 'Membership',
    price: 'Small amount, monthly',
    href: BMC_MEMBERSHIP,
    cta: 'Become a member',
    lines: [
      'Dev updates as levels and mechanics land.',
      'Tips and strategy notes - how framing, gossip and lockdowns actually resolve.',
      'A direct line on what gets built next.',
    ],
  },
];

export default function SupportPanel({ onClose }) {
  return (
    <Modal
      title="Support the game"
      subtitle="It is free, and it stays free"
      onClose={onClose}
    >
      <p className="mb-5 text-[12.5px] leading-relaxed text-slate-400">
        Blackout is free to play and the source is open. There is no paywall, no ads and
        nothing switched off unless you pay &mdash; that is not changing. If you want it to
        keep growing, this is the way to help.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {TIERS.map((tier) => (
          <div key={tier.title} className="panel flex flex-col p-4">
            <div className="mb-1 text-[14px] font-semibold text-slate-100">{tier.title}</div>
            <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-dim">{tier.price}</div>
            <ul className="mb-4 flex-1 space-y-1.5">
              {tier.lines.map((line) => (
                <li key={line} className="flex gap-2 text-[11.5px] leading-snug text-slate-400">
                  <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-neon/70" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <a
              href={tier.href}
              target="_blank"
              rel="noreferrer noopener"
              className={`block rounded px-4 py-2.5 text-center text-[11px] uppercase tracking-[0.2em] transition-colors ${
                tier.primary
                  ? 'border border-neon/70 bg-neon/10 text-neon hover:bg-neon/20'
                  : 'border border-edge text-slate-300 hover:border-neon/50 hover:text-neon'
              }`}
            >
              {tier.cta}
            </a>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded border border-edge bg-ink/60 p-3">
        <div className="panel-title mb-1.5">Where the discussion happens</div>
        <p className="text-[11.5px] leading-relaxed text-slate-400">
          Members get updates and a say through Buy Me a Coffee. Anyone at all can open an
          issue on GitHub &mdash; bugs, balance complaints, mechanics you want to see. Both
          get read.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <a href={`${REPO}/issues/new`} target="_blank" rel="noreferrer noopener" className="btn">
            Suggest an idea
          </a>
          <a href={`${REPO}/issues`} target="_blank" rel="noreferrer noopener" className="btn">
            Open issues
          </a>
          <a href={REPO} target="_blank" rel="noreferrer noopener" className="btn">
            Source
          </a>
        </div>
      </div>

      <p className="mt-4 text-[10px] leading-relaxed text-dim">
        Straight answer on perks: supporter status is handled entirely by Buy Me a Coffee,
        because this game has no account system and no server that could check it. Members-only
        posts are posted there. Nothing in the game is locked behind a payment.
      </p>

      <div className="mt-5 flex justify-end">
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
