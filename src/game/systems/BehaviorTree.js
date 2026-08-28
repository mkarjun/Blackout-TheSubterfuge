/**
 * BehaviorTree.js - The Physical Layer's brain. 100% local, 0ms latency.
 *
 * This file is what makes the "zero-lag guarantee" true: an NPC is fully playable
 * with the network unplugged. The behaviour tree decides what a body *does* every
 * frame; the Cognitive Layer only ever supplies flavour (dialogue) and nudges
 * (action_intent, suspicion deltas) which the tree is free to act on later.
 *
 * Exports
 *   NODE                 - status enum
 *   Selector/Sequence/... - tiny composable node set
 *   buildNpcTree(npc)    - the default NPC tree
 *   ruleBasedResponse()  - schema-valid dialogue when the LLM is slow/absent/off
 */

export const NODE = { SUCCESS: 'SUCCESS', FAILURE: 'FAILURE', RUNNING: 'RUNNING' };

/* ------------------------------------------------------------ tree nodes */

export class BehaviorNode {
  constructor(name = 'node') { this.name = name; }
  // eslint-disable-next-line no-unused-vars
  tick(_ctx) { return NODE.FAILURE; }
}

/** First child that does not fail wins. */
export class Selector extends BehaviorNode {
  constructor(name, children = []) { super(name); this.children = children; }
  tick(ctx) {
    for (const child of this.children) {
      const status = child.tick(ctx);
      if (status !== NODE.FAILURE) return status;
    }
    return NODE.FAILURE;
  }
}

/** All children must succeed, in order. */
export class Sequence extends BehaviorNode {
  constructor(name, children = []) { super(name); this.children = children; }
  tick(ctx) {
    for (const child of this.children) {
      const status = child.tick(ctx);
      if (status !== NODE.SUCCESS) return status;
    }
    return NODE.SUCCESS;
  }
}

export class Condition extends BehaviorNode {
  constructor(name, predicate) { super(name); this.predicate = predicate; }
  tick(ctx) { return this.predicate(ctx) ? NODE.SUCCESS : NODE.FAILURE; }
}

export class Action extends BehaviorNode {
  constructor(name, fn) { super(name); this.fn = fn; }
  tick(ctx) { return this.fn(ctx) ?? NODE.SUCCESS; }
}

export class Inverter extends BehaviorNode {
  constructor(name, child) { super(name); this.child = child; }
  tick(ctx) {
    const s = this.child.tick(ctx);
    if (s === NODE.SUCCESS) return NODE.FAILURE;
    if (s === NODE.FAILURE) return NODE.SUCCESS;
    return s;
  }
}

/** Rate-limits a subtree. Used to stop NPCs re-deciding every single frame. */
export class Cooldown extends BehaviorNode {
  constructor(name, ms, child) {
    super(name);
    this.ms = ms;
    this.child = child;
    this.readyAt = 0;
  }
  tick(ctx) {
    if (ctx.time < this.readyAt) return NODE.FAILURE;
    const status = this.child.tick(ctx);
    if (status !== NODE.RUNNING) this.readyAt = ctx.time + this.ms;
    return status;
  }
}

/* --------------------------------------------------------- the NPC tree */

export const FSM = {
  IDLE: 'IDLE',
  PATROL: 'PATROL',
  INVESTIGATE: 'INVESTIGATE',
  ALERT: 'ALERT',
  CHASE: 'CHASE',
  CONVERSE: 'CONVERSE',
  FLEE: 'FLEE',
  WORK: 'WORK',
};

/**
 * The default tree. Priority order top-to-bottom; the first branch that applies wins.
 * `ctx` is { npc, time, delta, world } and every leaf mutates npc state only.
 *
 * Crucially, the THINKING flag never appears here. An NPC awaiting an LLM payload
 * keeps ticking this exact tree - that is the whole point of the dual-layer design.
 */
export function buildNpcTree() {
  return new Selector('root', [
    // 1. Physically staggered (just accused / just shoved) - brief lockout.
    new Sequence('stunned', [
      new Condition('is-stunned', ({ npc, time }) => time < npc.stunnedUntil),
      new Action('hold', ({ npc }) => { npc.setFsm(FSM.IDLE); npc.stopMoving(); return NODE.RUNNING; }),
    ]),

    // 2. Talking to the player - hold position and face them.
    new Sequence('converse', [
      new Condition('in-conversation', ({ npc }) => npc.conversationWith !== null),
      new Action('face-and-hold', ({ npc }) => {
        npc.setFsm(FSM.CONVERSE);
        npc.stopMoving();
        npc.faceTarget(npc.conversationWith);
        return NODE.RUNNING;
      }),
    ]),

    // 3. Terrified NPCs run for the nearest exit regardless of rank.
    new Sequence('flee', [
      new Condition('is-fleeing', ({ npc, time }) => npc.fleeUntil > time),
      new Action('run-away', ({ npc }) => {
        npc.setFsm(FSM.FLEE);
        npc.fleeFromThreat();
        return NODE.RUNNING;
      }),
    ]),

    // 4. Player in view and already distrusted -> close the distance.
    new Sequence('chase', [
      new Condition('sees-player', ({ npc }) => npc.canSeePlayer),
      new Condition('suspicious-enough', ({ npc }) => npc.suspicionOfPlayer() >= npc.chaseThreshold),
      new Action('pursue', ({ npc }) => {
        npc.setFsm(FSM.CHASE);
        npc.moveTowardPoint(npc.lastKnownPlayerPos, { run: true });
        return NODE.RUNNING;
      }),
    ]),

    // 5. Player in view but not yet damning -> stand up, watch, raise suspicion.
    new Sequence('alert', [
      new Condition('sees-player', ({ npc }) => npc.canSeePlayer),
      new Action('watch', ({ npc, delta }) => {
        npc.setFsm(FSM.ALERT);
        npc.stopMoving();
        npc.faceTarget(npc.lastKnownPlayerPos);
        npc.accrueSuspicion('PLAYER', npc.watchGainPerSec * (delta / 1000));
        return NODE.RUNNING;
      }),
    ]),

    // 6. Something was heard/seen recently -> go look.
    new Sequence('investigate', [
      new Condition('has-poi', ({ npc, time }) => npc.pointOfInterest !== null && time < npc.poiExpiresAt),
      new Action('walk-to-poi', ({ npc }) => {
        npc.setFsm(FSM.INVESTIGATE);
        const arrived = npc.moveTowardPoint(npc.pointOfInterest, { run: npc.alertLevel >= 2 });
        if (arrived) npc.clearPointOfInterest();
        return NODE.RUNNING;
      }),
    ]),

    // 7. Scientists drift back to their station instead of pacing corridors.
    new Sequence('work', [
      new Condition('is-worker', ({ npc }) => npc.archetype === 'SCIENTIST' || npc.archetype === 'TECH'),
      new Condition('idle-window', ({ npc, time }) => time < npc.workUntil),
      new Action('do-work', ({ npc }) => {
        npc.setFsm(FSM.WORK);
        npc.stopMoving();
        return NODE.RUNNING;
      }),
    ]),

    // 8. Default: walk the patrol ring, pausing at waypoints.
    new Action('patrol', ({ npc, time }) => {
      npc.setFsm(FSM.PATROL);
      const arrived = npc.followPatrol();
      if (arrived) npc.scheduleWaypointPause(time);
      return NODE.RUNNING;
    }),
  ]);
}

/* -------------------------------------------------- rule-based dialogue */

const pick = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];

/**
 * Local dialogue generator - the mandated fallback when the LLM times out (4s),
 * errors, or is switched off entirely. Output is the *same strict schema* the model
 * is asked for, so downstream code has exactly one shape to handle.
 *
 * Lines are keyed by (trigger, suspicion band) and flavoured by archetype, which is
 * enough variety that a network-less session still reads as characters rather than
 * a stuck barks table.
 *
 * @param {object} ctx
 * @param {object} ctx.npc      { id, name, archetype, emotion }
 * @param {string} ctx.trigger  Trigger id, see TRIGGERS below.
 * @param {number} ctx.suspicion Current suspicion of PLAYER, 0-100.
 * @param {object} ctx.world    { lightsOn, alertLevel, room }
 * @returns {object} NPC response object matching the strict schema.
 */
export function ruleBasedResponse({ npc, trigger, suspicion = 0, world = {}, rng = Math.random }) {
  const band = suspicion >= 70 ? 'high' : suspicion >= 35 ? 'mid' : 'low';
  const arch = npc.archetype || 'GUARD';
  const dark = world.lightsOn === false;

  const LINES = {
    PLAYER_APPROACH: {
      low: {
        GUARD: ['Badge visible at all times. You know the drill.', 'Move along, nothing to see down here.'],
        SCIENTIST: ['I am mid-run. Whatever it is, make it quick.', 'You should not be on this floor tonight.'],
        TECH: ['Careful, half these panels are live.', 'You lost? Everything down here is labelled wrong.'],
        CHIEF: ['State your business, then state it again slower.', 'Everyone is accounted for. Stay that way.'],
      },
      mid: {
        GUARD: ['You again. That is twice in ten minutes.', 'Stand where I can see your hands.'],
        SCIENTIST: ['You keep turning up wherever things break.', 'Why are you always two rooms from the problem?'],
        TECH: ['You are hovering. People who hover want something.', 'Whatever you touched, tell me now.'],
        CHIEF: ['I am building a timeline and you are all over it.', 'Do not wander. I will want you findable.'],
      },
      high: {
        GUARD: ['Hands where I can see them. Now.', 'You are done walking around unescorted.'],
        SCIENTIST: ['Stay back. I am calling this in.', 'I know it is you. I just cannot prove it yet.'],
        TECH: ['Do not come closer. I mean it.', 'You broke my generator. I watched you do it.'],
        CHIEF: ['You are my prime suspect. Do not move.', 'Lockdown protocol. You are coming with me.'],
      },
    },
    PLAYER_TALK: {
      low: {
        GUARD: ['Nothing to report. Quiet shift, mostly.', 'Ask the Chief, that is above my pay grade.'],
        SCIENTIST: ['If you want the archive, you want Osei, not me.', 'I saw nothing. I was in the clean room.'],
        TECH: ['Power has been flaky since the retrofit.', 'Not my department. Talk to security.'],
        CHIEF: ['I ask the questions on this floor.', 'Tell me where you have been. All of it.'],
      },
      mid: {
        GUARD: ['Funny question from someone with no badge.', 'Why do you want to know that, exactly?'],
        SCIENTIST: ['That is a very specific thing to ask.', 'You are fishing. Poorly.'],
        TECH: ['I answer that, you owe me a straight answer.', 'Ask me again when the lights work.'],
        CHIEF: ['Every word you say goes in the log.', 'Convince me you belong down here.'],
      },
      high: {
        GUARD: ['I am not talking to you without the Chief present.', 'Save it. I already called it in.'],
        SCIENTIST: ['Get away from me before I scream.', 'I will not be your alibi. Find another.'],
        TECH: ['You have said enough. Both of us know it.', 'No. Whatever you are selling, no.'],
        CHIEF: ['Explain the generator. Now, in detail.', 'Your story changed twice. Try a third time.'],
      },
    },
    SAW_TAMPERING: {
      low: { GUARD: ['Hey! Step away from that panel.'], SCIENTIST: ['That equipment is calibrated. Do not touch it.'], TECH: ['Hands off. You will fry yourself.'], CHIEF: ['Away from the console. Immediately.'] },
      mid: { GUARD: ['That is deliberate. That is sabotage.'], SCIENTIST: ['You are wrecking six months of work!'], TECH: ['I knew it. I knew it was a person.'], CHIEF: ['Caught in the act. Log it, seal the room.'] },
      high: { GUARD: ['Sabotage confirmed! Everyone, on me!'], SCIENTIST: ['It is them! It has been them all along!'], TECH: ['Stop! You will take the whole grid down!'], CHIEF: ['That is our saboteur. Take them down.'] },
    },
    LIGHTS_OUT: {
      low: { GUARD: ['Lights again. Third time this month.'], SCIENTIST: ['Wonderful. My samples are on backup power.'], TECH: ['That is not a fault. Somebody pulled that.'], CHIEF: ['All units, report. Keep the corridors covered.'] },
      mid: { GUARD: ['Blackout, and you are standing right here.'], SCIENTIST: ['Convenient darkness. Very convenient.'], TECH: ['Breakers do not trip themselves. Someone helped.'], CHIEF: ['Nobody moves in the dark. Nobody.'] },
      high: { GUARD: ['You cut the power. Stay exactly there.'], SCIENTIST: ['They cut it! They are in here with us!'], TECH: ['That was you at the breaker. I felt it go.'], CHIEF: ['Blackout is a hostile act. Full lockdown.'] },
    },
    FOUND_EVIDENCE: {
      low: { GUARD: ['What is this doing on the floor?'], SCIENTIST: ['This is not lab issue. Where did it come from?'], TECH: ['That is a splicer. Nobody here needs one.'], CHIEF: ['Bag it. This is evidence now.'] },
      mid: { GUARD: ['Someone dropped this. Someone careless.'], SCIENTIST: ['Prototype hardware, out of the cabinet. Explain.'], TECH: ['Found the toy. Now I want the owner.'], CHIEF: ['We have hardware. Now we build the case.'] },
      high: { GUARD: ['This is theirs. It has to be theirs.'], SCIENTIST: ['Proof. Finally, actual proof.'], TECH: ['That settles it for me. It is them.'], CHIEF: ['Evidence secured. Bring them in.'] },
    },
    ACCUSED: {
      low: { GUARD: ['Say that again with the Chief listening.'], SCIENTIST: ['Absurd. I was logged in the clean room.'], TECH: ['Me? I am the one keeping the lights on.'], CHIEF: ['Careful. Accusations are a two-way door.'] },
      mid: { GUARD: ['Do not put this on me. Check the logs.'], SCIENTIST: ['You are deflecting. Everyone can hear it.'], TECH: ['Nice try. Where were you at shift change?'], CHIEF: ['Interesting. The suspect names a suspect.'] },
      high: { GUARD: ['Liar! Chief, they are covering for themselves!'], SCIENTIST: ['That is a confession dressed as an accusation.'], TECH: ['You are burning me to save yourself. No.'], CHIEF: ['Noted, and dismissed. You are still my problem.'] },
    },
    IDLE: {
      low: { GUARD: ['Corridor clear. Same as an hour ago.'], SCIENTIST: ['Run stable. Temperature nominal.'], TECH: ['This coupling needs replacing, not patching.'], CHIEF: ['Sector sweep complete. Continue.'] },
      mid: { GUARD: ['Something is off about tonight.'], SCIENTIST: ['I keep hearing doors that should be locked.'], TECH: ['Readings are wrong and nobody cares.'], CHIEF: ['Keep your eyes up. We are not alone.'] },
      high: { GUARD: ['Nobody walks alone until this is over.'], SCIENTIST: ['I am not leaving this room. Not tonight.'], TECH: ['I want a name before the lights go again.'], CHIEF: ['Someone in this facility is lying to me.'] },
    },
  };

  const THOUGHTS = {
    low: ['Probably nothing. Probably.', 'Keep it professional, keep it moving.', 'Log it and forget it.'],
    mid: ['Their timing keeps lining up.', 'Two coincidences is a pattern.', 'Watch them, do not spook them.'],
    high: ['It is them. Get help before they move.', 'Do not be alone with this one.', 'Enough proof. Act now.'],
  };

  const set = LINES[trigger] || LINES.IDLE;
  const byBand = set[band] || set.low;
  const options = byBand[arch] || byBand.GUARD || ['...'];

  const emotion = band === 'high'
    ? (arch === 'SCIENTIST' ? 'ALARMED' : 'HOSTILE')
    : band === 'mid' ? 'SUSPICIOUS'
      : (trigger === 'PLAYER_TALK' ? 'COOPERATIVE' : 'NEUTRAL');

  const intent = trigger === 'SAW_TAMPERING'
    ? (band === 'low' ? 'INVESTIGATE' : 'ACCUSE')
    : band === 'high'
      ? (arch === 'SCIENTIST' ? 'FLEE' : 'ACCUSE')
      : band === 'mid' ? 'FOLLOW' : (trigger === 'IDLE' ? 'IGNORE' : 'INVESTIGATE');

  // Deltas mirror how damning the trigger is. Darkness makes everyone edgier.
  const base = {
    SAW_TAMPERING: 22,
    FOUND_EVIDENCE: 12,
    LIGHTS_OUT: 8,
    ACCUSED: 6,
    PLAYER_APPROACH: 3,
    PLAYER_TALK: 1,
    IDLE: 0,
  }[trigger] ?? 2;

  const delta = Math.round(base * (dark ? 1.35 : 1) * (band === 'high' ? 1.2 : 1));

  return {
    dialogue: pick(options, rng),
    internal_thought: pick(THOUGHTS[band], rng),
    emotion_state: emotion,
    action_intent: intent,
    target_entity: 'PLAYER',
    suspicion_delta: delta ? { PLAYER: delta } : {},
    _source: 'rules',
  };
}

export const TRIGGERS = [
  'PLAYER_APPROACH', 'PLAYER_TALK', 'SAW_TAMPERING', 'LIGHTS_OUT',
  'FOUND_EVIDENCE', 'ACCUSED', 'IDLE',
];

export default { NODE, FSM, buildNpcTree, ruleBasedResponse, TRIGGERS };
