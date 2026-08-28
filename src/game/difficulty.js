/**
 * difficulty.js - Tuning presets.
 *
 * Every value here is a multiplier or override applied at NPC construction or at the
 * check site, never a fork in the logic: the same code runs on every setting, so a
 * balance change cannot break one difficulty and not another.
 *
 * The three settings are meant to change *what kind of game it is*, not just the
 * numbers - Recruit is a sandbox where you can experiment with framing people, Ghost
 * is a game about never being seen once.
 */

export const DIFFICULTIES = {
  RECRUIT: {
    id: 'RECRUIT',
    label: 'Recruit',
    blurb: 'Forgiving. Slower to suspect, quicker to forget, and they lose you easily.',
    visionRangeMul: 0.82,
    watchGainMul: 0.65,          // how fast being looked at condemns you
    suspicionBiasMul: 0.75,      // personality bias on every incoming delta
    decayMul: 1.8,               // how fast suspicion cools when unseen
    npcSpeedMul: 0.9,
    chaseThresholdDelta: +12,    // they commit to a chase later
    catchGraceMs: 1200,
    lockdownCount: 4,            // convinced staff needed for a lockdown
    hackCooldownMul: 0.75,
    noiseMul: 0.7,
  },
  OPERATIVE: {
    id: 'OPERATIVE',
    label: 'Operative',
    blurb: 'The intended experience. One mistake is survivable. Two is not.',
    visionRangeMul: 1,
    watchGainMul: 1,
    suspicionBiasMul: 1,
    decayMul: 1,
    npcSpeedMul: 1,
    chaseThresholdDelta: 0,
    catchGraceMs: 800,
    lockdownCount: 3,
    hackCooldownMul: 1,
    noiseMul: 1,
  },
  GHOST: {
    id: 'GHOST',
    label: 'Ghost',
    blurb: 'They are looking for you. Being seen once is a problem you carry all night.',
    visionRangeMul: 1.18,
    watchGainMul: 1.5,
    suspicionBiasMul: 1.35,
    decayMul: 0.45,
    // Deliberately 1.0, not higher. The fastest NPC (the guard, 192) must stay under
    // PLAYER_SPEED.WALK (198) or a chase becomes unescapable and the catch grace
    // window is meaningless - a smoke test enforces this. Ghost is hard because it
    // notices you, not because it wins footraces.
    npcSpeedMul: 1,
    chaseThresholdDelta: -15,
    catchGraceMs: 550,
    lockdownCount: 2,
    hackCooldownMul: 1.4,
    noiseMul: 1.35,
  },
};

export const DIFFICULTY_ORDER = ['RECRUIT', 'OPERATIVE', 'GHOST'];
export const DEFAULT_DIFFICULTY = 'OPERATIVE';

export function getDifficulty(id) {
  return DIFFICULTIES[id] || DIFFICULTIES[DEFAULT_DIFFICULTY];
}

export default DIFFICULTIES;
