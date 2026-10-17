import type { Caller, MatchBreakdown, MatchingResult, Responder, ResponderMatch } from '@/types';
import { MATCHING_CONFIG, type MatchingConfig } from '@/config/matching';

export type MatchingCaller = Pick<Caller, 'needCategory' | 'language' | 'coverageArea' | 'rulebook'>;
const intersects = <T,>(a: T[], b: T[]) => a.some(value => b.includes(value));

export function scoreResponder(caller: MatchingCaller, responder: Responder, config: MatchingConfig = MATCHING_CONFIG): ResponderMatch {
  const breakdown: MatchBreakdown[] = [];
  const add = (factor: MatchBreakdown['factor'], base: number, defaultMax: number, reason: string) => {
    const maxPoints = config.weights[factor];
    breakdown.push({ factor, points: Math.round(Math.min(Math.max(base / defaultMax, 0), 1) * maxPoints * 100) / 100, maxPoints, reason });
  };
  const expertise = config.expertiseMappings[caller.needCategory];
  if (expertise && intersects(responder.expertise, expertise.exact)) {
    add('expertise', config.expertisePoints.exact, 40, `Exact expertise for ${caller.needCategory.replace(/_/g, ' ')}`);
  } else if (expertise && intersects(responder.expertise, expertise.related)) {
    add('expertise', config.expertisePoints.related, 40, 'Strong related expertise');
  } else if (expertise && intersects(responder.expertise, expertise.general)) {
    add('expertise', config.expertisePoints.general, 40, 'General relevant expertise');
  } else add('expertise', 0, 40, 'No relevant expertise tag');

  const language = config.language.aliases[caller.language.trim().toLowerCase()];
  if (language && responder.languages.includes(language)) {
    add('language', config.language.direct, 20, `Speaks caller’s preferred language (${caller.language})`);
  } else if (language && responder.interpreterLanguages.includes(language)) {
    add('language', config.language.interpreter, 20, `Approved interpreter support for ${caller.language}`);
  } else add('language', 0, 20, `No approved language support for ${caller.language}`);

  if (!config.location.enabled || config.location.disabledNeeds.includes(caller.needCategory)) {
    add('location', 0, 20, 'Location scoring disabled for this request; no location points awarded');
  } else if (caller.coverageArea && responder.coverageAreas.includes(caller.coverageArea)) {
    add('location', config.location.direct, 20, `Direct coverage: ${caller.coverageArea}`);
  } else if (caller.coverageArea && intersects(responder.coverageAreas, config.location.adjacency[caller.coverageArea] ?? [])) {
    add('location', config.location.adjacent, 20, `Adjacent coverage to ${caller.coverageArea}`);
  } else add('location', 0, 20, caller.coverageArea ? 'Outside coverage area' : 'Caller coverage area unknown');

  const workload = config.workload.find(tier => responder.activeCallers <= tier.maxActiveCases);
  add('workload', workload?.points ?? 0, 15, `${responder.activeCallers} active case${responder.activeCallers === 1 ? '' : 's'}`);
  const experience = config.experience.mappings[caller.needCategory];
  if (experience && intersects(responder.experience, experience.exact)) {
    add('experience', config.experience.exact, 5, 'Relevant explicit experience/certification tag');
  } else if (experience && intersects(responder.experience, experience.related)) {
    add('experience', config.experience.related, 5, 'Related explicit experience tag');
  } else add('experience', 0, 5, 'No relevant experience tag');

  const rawScore = Math.round(breakdown.reduce((sum, b) => sum + b.points, 0) * 100) / 100;
  const strongMatch = rawScore >= config.strongMatch.minimumScore && breakdown[0].points >= config.strongMatch.minimumExpertise &&
    (!config.strongMatch.requireLanguageSupport || breakdown[1].points > 0);
  return { responderId: responder.id, status: responder.status, eligible: responder.status === 'available', rawScore,
    activeCases: responder.activeCallers, breakdown, strongMatch,
    explanation: breakdown.map(b => `+${b.points} ${b.reason}`).join('; ') };
}

export function matchResponders(caller: MatchingCaller, responders: Responder[], config: MatchingConfig = MATCHING_CONFIG): MatchingResult {
  const total = Object.values(config.weights).reduce((sum, weight) => sum + weight, 0);
  if (total !== 100 || Object.values(config.weights).some(weight => !Number.isFinite(weight) || weight < 0)) {
    throw new Error('Matching weights must be nonnegative finite values totaling 100.');
  }
  const gates = { available: 0, busy: 1, offline: 2 };
  const candidates = responders.filter(r => r.rulebooks.includes(caller.rulebook)).map(r => scoreResponder(caller, r, config))
    .sort((a, b) => gates[a.status] - gates[b.status] || b.rawScore - a.rawScore || a.responderId.localeCompare(b.responderId));
  const available = candidates.filter(c => c.eligible);
  const primary = available.find(c => c.strongMatch) ?? available[0];
  const expertise = candidates.filter(c => c.status !== 'offline')
    .sort((a, b) => b.breakdown[0].points - a.breakdown[0].points || b.rawScore - a.rawScore || a.responderId.localeCompare(b.responderId))[0];
  return { configVersion: config.version, candidates, recommendedResponderId: primary?.responderId,
    bestExpertiseResponderId: expertise?.responderId, strongAvailableMatch: primary?.strongMatch ?? false,
    explanation: !primary ? 'No available responder. Busy responders are alternatives only; offline responders are unavailable.'
      : primary.strongMatch ? 'Qualified available responder recommended. Assignment requires human approval.'
      : 'No fully qualified available responder. Best available shown; review expertise and language gaps before assigning.' };
}
