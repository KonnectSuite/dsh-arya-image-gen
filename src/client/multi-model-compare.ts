import type { StudioOption, StudioProviderProfile } from '../shared.js'

export interface ComparisonTarget {
  profile: StudioProviderProfile
  ratio: string
  quality: string
  adjusted: boolean
  resolution?: string
  generationQuality?: string
}

/** Every workflow is a comparison target; the shared prompt runs on each. */
export function buildComparisonTargets(
  profiles: readonly StudioProviderProfile[],
  selectedTargets: readonly string[],
  ratio = 'auto',
  quality = 'auto',
  output?: { resolution: string; generationQuality: string },
): ComparisonTarget[] {
  const selected = new Set(selectedTargets)
  return profiles
    .filter(profile => profile.configured && (selected.has(profile.model) || selected.has(profile.provider)))
    .map(profile => ({
      profile,
      ratio,
      quality,
      adjusted: false,
      ...(output === undefined ? {} : { resolution: output.resolution, generationQuality: output.generationQuality }),
    }))
}

/** Start with two workflows, not every imported one, to keep runs bounded. */
export function initialComparisonProviders(
  profiles: readonly StudioProviderProfile[],
  activeWorkflow?: string,
  _activeChannel?: string,
): string[] {
  const configured = profiles.filter(profile => profile.configured)
  if (configured.length === 0) return []
  const active = configured.find(profile => profile.model === activeWorkflow) ?? configured[0]
  const ordered = active === undefined
    ? configured
    : [active, ...configured.filter(profile => profile.model !== active.model)]
  return ordered.slice(0, 2).map(profile => profile.model)
}

/** ComfyUI exposes no shared pickers; kept so the workbench UI compiles unchanged. */
export function comparisonOptionUnion(
  _profiles: readonly StudioProviderProfile[],
  _key: 'ratioOptions' | 'qualityOptions',
): StudioOption[] {
  return []
}

/** ComfyUI exposes no shared resolution or quality pickers. */
export function comparisonOutputOptions(
  _profiles: readonly StudioProviderProfile[],
  _ratio: string,
  _kind: 'resolution' | 'generationQuality',
): StudioOption[] {
  return []
}
