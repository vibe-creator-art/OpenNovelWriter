import type {
    StoryStateVisualizationFact,
    StoryStateVisualizationMoment,
} from '@/lib/api'

export type StoryFactMomentState = 'active' | 'starts' | 'ends' | 'inactive'

export type ResolvedStoryFact = StoryStateVisualizationFact & {
    validFromOrder: number | null
    validToOrder: number | null
}

export function resolveStoryFacts(
    facts: StoryStateVisualizationFact[],
    moments: StoryStateVisualizationMoment[]
): ResolvedStoryFact[] {
    const orderByMomentId = new Map(moments.map((moment) => [moment.id, moment.storyOrder] as const))
    return facts.map((fact) => ({
        ...fact,
        validFromOrder: fact.validFromMomentId ? orderByMomentId.get(fact.validFromMomentId) ?? null : null,
        validToOrder: fact.validToMomentId ? orderByMomentId.get(fact.validToMomentId) ?? null : null,
    }))
}

export function isStoryFactActiveAt(
    fact: ResolvedStoryFact,
    selectedOrder: number | null
) {
    if (selectedOrder === null) {
        return fact.validFromMomentId === null && fact.validToMomentId === null
    }
    const started = fact.validFromOrder === null || fact.validFromOrder <= selectedOrder
    const notEnded = fact.validToOrder === null || selectedOrder < fact.validToOrder
    return started && notEnded
}

export function getStoryFactMomentState(
    fact: ResolvedStoryFact,
    selectedMoment: StoryStateVisualizationMoment | null
): StoryFactMomentState {
    if (selectedMoment && fact.validToMomentId === selectedMoment.id) return 'ends'
    if (!isStoryFactActiveAt(fact, selectedMoment?.storyOrder ?? null)) return 'inactive'
    if (selectedMoment && fact.validFromMomentId === selectedMoment.id) return 'starts'
    return 'active'
}

export function storyFactTouchesEntity(fact: ResolvedStoryFact, entityId: string) {
    return fact.subjectEntityId === entityId || fact.objectEntityId === entityId
}

export function storyFactMatchesSearch(
    fact: ResolvedStoryFact,
    query: string,
    entityNames: Map<string, string>
) {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return true
    return [
        fact.factText,
        fact.predicateKey,
        fact.objectValue ?? '',
        entityNames.get(fact.subjectEntityId) ?? '',
        fact.objectEntityId ? entityNames.get(fact.objectEntityId) ?? '' : '',
    ].some((value) => value.toLocaleLowerCase().includes(normalized))
}

export function firstActiveMomentOrderForEntity(
    facts: ResolvedStoryFact[],
    entityId: string
) {
    const related = facts.filter((fact) => fact.credible && storyFactTouchesEntity(fact, entityId))
    if (related.some((fact) => fact.validFromMomentId === null)) return null
    const orders = related
        .map((fact) => fact.validFromOrder)
        .filter((order): order is number => order !== null)
    return orders.length > 0 ? Math.min(...orders) : null
}
