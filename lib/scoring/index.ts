// lib/scoring/index.ts
// Backward-compatibility re-export.
// The real implementation now lives in lib/engine/index.ts
// This wrapper keeps existing imports working without changes.

export {
  scoreCallerInput,
  sortCallers,
  maskPhone,
  applyHumanOverride,
  rescoreRepeatedCaller,
} from '@/lib/engine';

export type { EngineResult, EngineResult as ScoringResult } from '@/lib/engine';
