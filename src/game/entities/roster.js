/**
 * roster.js - Cast definitions + per-session secret role assignment.
 *
 * The `persona` and `secret` strings go straight into each NPC's system prompt, so
 * they are written as instructions to an actor, not as lore. Keep them short: they
 * are paid for on every single cognition tick.
 *
 * Secret roles are re-rolled per session (assignSecretRoles), which is what stops the
 * social deduction from being solvable by memory after one playthrough.
 */

export const ARCHETYPES = {
  GUARD: 'GUARD',
  SCIENTIST: 'SCIENTIST',
  TECH: 'TECH',
  CHIEF: 'CHIEF',
};

export const NPC_ROSTER = [
  {
    id: 'NPC_GUARD_1',
    name: 'Vance Ruiz',
    role: 'a floor guard on a double shift',
    archetype: ARCHETYPES.GUARD,
    persona: 'twitchy, sees patterns everywhere, trusts nobody twice',
    secret: 'You falsified last week\'s patrol log to hide a nap. An investigation could expose you.',
    color: 0x7dd3fc,
    speed: 111,
    runSpeed: 192,
    visionRange: 354,
    fov: 1.5,
    chaseThreshold: 62,
    watchGainPerSec: 5.5,
    suspicionBias: 1.15,
  },
  {
    id: 'NPC_SCI_1',
    name: 'Dr. Imani Osei',
    role: 'the lead researcher',
    archetype: ARCHETYPES.SCIENTIST,
    persona: 'precise, condescending, guards her research like territory',
    secret: 'You have been selling sample data offsite. Any audit ruins you, so you steer suspicion elsewhere.',
    color: 0xa78bfa,
    speed: 93,
    runSpeed: 156,
    visionRange: 294,
    fov: 1.35,
    chaseThreshold: 88,
    watchGainPerSec: 4.5,
    suspicionBias: 0.95,
  },
  {
    id: 'NPC_SCI_2',
    name: 'Dr. Petra Kall',
    role: 'a research assistant',
    archetype: ARCHETYPES.SCIENTIST,
    persona: 'anxious, over-explains, desperate to be believed',
    secret: 'You saw someone near the generator earlier and said nothing. The guilt is eating you.',
    color: 0xf9a8d4,
    speed: 102,
    runSpeed: 174,
    visionRange: 282,
    fov: 1.4,
    chaseThreshold: 92,
    watchGainPerSec: 4.0,
    suspicionBias: 1.05,
  },
  {
    id: 'NPC_TECH_1',
    name: 'Milo Frey',
    role: 'the maintenance technician',
    archetype: ARCHETYPES.TECH,
    persona: 'laconic, practical, quietly resents management',
    secret: 'You disabled a corridor camera weeks ago for privacy. If that surfaces, you look like the saboteur.',
    color: 0xfbbf24,
    speed: 105,
    runSpeed: 168,
    visionRange: 309,
    fov: 1.45,
    chaseThreshold: 78,
    watchGainPerSec: 4.8,
    suspicionBias: 1.0,
  },
  {
    id: 'NPC_CHIEF',
    name: 'Chief Dana Rook',
    role: 'head of facility security',
    archetype: ARCHETYPES.CHIEF,
    persona: 'commanding, decisive, allergic to ambiguity',
    secret: 'You are one incident from dismissal. You need a culprit tonight, and you are not fussy about which.',
    color: 0xff4d5e,
    speed: 117,
    // Just under PLAYER_SPEED.WALK (198): Rook is the most dangerous person on the
    // floor, but a straight sprint has to remain a real option or the grace window
    // above is meaningless against her.
    runSpeed: 189,
    visionRange: 378,
    fov: 1.6,
    chaseThreshold: 55,
    watchGainPerSec: 6.5,
    suspicionBias: 1.25,
  },
];

export const ROSTER_IDS = NPC_ROSTER.map((n) => n.id);

export function getNpcDef(id) {
  return NPC_ROSTER.find((n) => n.id === id) || null;
}

/* ------------------------------------------------------- secret roles */

/**
 * Motives layered on top of the fixed cast. Re-rolled every session so the same
 * character is not always the weak link.
 *
 *  WITNESS   - starts with a real lead; will volunteer it if trust is high.
 *  PARANOID  - gains suspicion faster and spreads it to peers aggressively.
 *  TURNCOAT  - will cover for the player if their suspicion stays low.
 *  CAREERIST - pushes suspicion onto whoever is already the frontrunner.
 *  STEADY    - no special motive; the control group.
 */
export const SECRET_ROLES = {
  WITNESS: {
    id: 'WITNESS',
    label: 'Witness',
    motive: 'You glimpsed the saboteur but not their face. You want someone to believe you.',
    suspicionMultiplier: 1.1,
    spreadMultiplier: 1.2,
  },
  PARANOID: {
    id: 'PARANOID',
    label: 'Paranoid',
    motive: 'You are certain the saboteur is in this room. Everyone is a candidate.',
    suspicionMultiplier: 1.55,
    spreadMultiplier: 1.5,
  },
  TURNCOAT: {
    id: 'TURNCOAT',
    label: 'Turncoat',
    motive: 'You have your own reasons to want this place shut down. A quiet ally would be welcome.',
    suspicionMultiplier: 0.6,
    spreadMultiplier: 0.7,
  },
  CAREERIST: {
    id: 'CAREERIST',
    label: 'Careerist',
    motive: 'You need this resolved fast and cleanly. Whoever looks guiltiest will do.',
    suspicionMultiplier: 1.0,
    spreadMultiplier: 1.4,
  },
  STEADY: {
    id: 'STEADY',
    label: 'Steady',
    motive: 'You want the facts and nothing louder than the facts.',
    suspicionMultiplier: 0.9,
    spreadMultiplier: 0.9,
  },
};

/**
 * Deal one secret role per NPC. WITNESS and PARANOID are always dealt (they drive the
 * mystery); the rest are filled at random.
 *
 * @param {Function} [rng] Injectable for deterministic tests / seeded runs.
 * @returns {Object<string, {role:string, motive:string, ...}>}
 */
export function assignSecretRoles(rng = Math.random, cast = ROSTER_IDS) {
  const ids = [...cast];
  // Fisher-Yates so the guaranteed roles land on random cast members.
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }

  const guaranteed = ['WITNESS', 'PARANOID'];
  const filler = ['TURNCOAT', 'CAREERIST', 'STEADY'];
  const assignment = {};

  ids.forEach((id, index) => {
    const roleId = index < guaranteed.length
      ? guaranteed[index]
      : filler[Math.floor(rng() * filler.length)];
    assignment[id] = { ...SECRET_ROLES[roleId] };
  });

  return assignment;
}

export default { NPC_ROSTER, ROSTER_IDS, ARCHETYPES, SECRET_ROLES, assignSecretRoles, getNpcDef };
