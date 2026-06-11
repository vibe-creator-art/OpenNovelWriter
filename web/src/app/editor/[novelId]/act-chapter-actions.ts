import type { Dispatch, SetStateAction } from 'react'
import { actApi, chapterApi, outlineApi, Chapter, ChapterWithScenes } from '@/lib/api'

type ActsFromDb = { number: number; title: string | null }

interface ActChapterActionsDeps {
    novelId: string | null
    chapters: ChapterWithScenes[]
    sortedChapters: ChapterWithScenes[]
    chaptersByAct: Record<number, ChapterWithScenes[]>
    emptyActs: Set<number>
    actsFromDb: ActsFromDb[]
    actTitles: Record<number, string>
    actSummaries: Record<number, string>
    actLabelIds: Record<number, string[]>
    getDefaultChapterTitle: (chapterNumber: number) => string
    isDefaultChapterTitle: (title: string) => boolean
    setChapters: Dispatch<SetStateAction<ChapterWithScenes[]>>
    setChapterContents: Dispatch<SetStateAction<Record<string, string>>>
    setEmptyActs: Dispatch<SetStateAction<Set<number>>>
    setActsFromDb: Dispatch<SetStateAction<ActsFromDb[]>>
    setExpandedActs: Dispatch<SetStateAction<Set<number>>>
    setViewFilter: Dispatch<SetStateAction<'everything' | 'act' | 'chapter'>>
    setSelectedActNumber: Dispatch<SetStateAction<number | null>>
    setActTitles: Dispatch<SetStateAction<Record<number, string>>>
    setActSummaries: Dispatch<SetStateAction<Record<number, string>>>
    setActLabelIds: Dispatch<SetStateAction<Record<number, string[]>>>
}

export const createActChapterActions = (deps: ActChapterActionsDeps) => {
    const {
        novelId,
        chapters,
        sortedChapters,
        chaptersByAct,
        emptyActs,
        actsFromDb,
        actTitles,
        actSummaries,
        actLabelIds,
        getDefaultChapterTitle,
        isDefaultChapterTitle,
        setChapters,
        setChapterContents,
        setEmptyActs,
        setActsFromDb,
        setExpandedActs,
        setViewFilter,
        setSelectedActNumber,
        setActTitles,
        setActSummaries,
        setActLabelIds,
    } = deps

    const sortChapters = (list: ChapterWithScenes[]) => {
        return [...list].sort((a, b) => {
            if (a.actNumber !== b.actNumber) return a.actNumber - b.actNumber
            return a.order - b.order
        })
    }

    const getTitleUpdateMap = (nextChapters: ChapterWithScenes[]) => {
        const nextSorted = sortChapters(nextChapters)
        const maxIndex = Math.min(sortedChapters.length, nextSorted.length)
        let start = 0
        while (start < maxIndex && sortedChapters[start].id === nextSorted[start].id) {
            start++
        }
        if (start === maxIndex) {
            return new Map<string, string>()
        }
        let end = maxIndex - 1
        while (end >= start && sortedChapters[end].id === nextSorted[end].id) {
            end--
        }

        const titleUpdateMap = new Map<string, string>()
        for (let idx = start; idx <= end; idx++) {
            const chapter = nextSorted[idx]
            if (!isDefaultChapterTitle(chapter.title)) continue
            const newTitle = getDefaultChapterTitle(idx + 1)
            if (newTitle !== chapter.title) {
                titleUpdateMap.set(chapter.id, newTitle)
            }
        }
        return titleUpdateMap
    }

    const handleCreateChapter = async (actNumber: number = 1) => {
        if (!novelId) return
        try {
            const chaptersInAct = chapters.filter(c => c.actNumber === actNumber)
            const maxOrder = chaptersInAct.length > 0
                ? Math.max(...chaptersInAct.map(c => c.order))
                : -1
            const newOrder = maxOrder + 1

            // Find where this chapter will be in the global sorted order
            // It goes after all existing chapters in this act
            let newGlobalIndex = 0
            for (const chapter of sortedChapters) {
                if (chapter.actNumber < actNumber) {
                    newGlobalIndex++
                } else if (chapter.actNumber === actNumber) {
                    newGlobalIndex++
                } else {
                    break
                }
            }
            const newChapterTitle = getDefaultChapterTitle(newGlobalIndex + 1)

            // Create new chapter
            const newChapter = await chapterApi.create(novelId, {
                title: newChapterTitle,
                actNumber,
                order: newOrder,
            })

            // Fast path: if adding to the absolute end of the book, no placeholder updates needed
            const isAppendingToEnd = newGlobalIndex === sortedChapters.length

            if (!isAppendingToEnd) {
                // Update placeholder titles for chapters after the insertion point
                const chaptersNeedingTitleUpdate: { id: string; oldIdx: number }[] = []
                sortedChapters.forEach((chapter, idx) => {
                    if (idx >= newGlobalIndex && isDefaultChapterTitle(chapter.title)) {
                        chaptersNeedingTitleUpdate.push({ id: chapter.id, oldIdx: idx })
                    }
                })

                // Update placeholder titles in database (only if there are any)
                if (chaptersNeedingTitleUpdate.length > 0) {
                    for (const { id, oldIdx } of chaptersNeedingTitleUpdate) {
                        const newTitle = getDefaultChapterTitle(oldIdx + 2)
                        await chapterApi.update(id, { title: newTitle })
                    }
                }

                // Build title update map for local state
                const titleUpdateMap = new Map<string, string>()
                chaptersNeedingTitleUpdate.forEach(({ id, oldIdx }) => {
                    titleUpdateMap.set(id, getDefaultChapterTitle(oldIdx + 2))
                })

                setChapters(prev => [
                    ...prev.map(c => {
                        const newTitle = titleUpdateMap.get(c.id)
                        return newTitle ? { ...c, title: newTitle } : c
                    }),
                    { ...newChapter, scenes: (newChapter as ChapterWithScenes).scenes || [] }
                ])
            } else {
                setChapters(prev => [...prev, { ...newChapter, scenes: (newChapter as ChapterWithScenes).scenes || [] }])
            }

            setChapterContents(prev => ({ ...prev, [newChapter.id]: '' }))

            // Remove from empty acts since it now has a chapter
            setEmptyActs(prev => {
                const next = new Set(prev)
                next.delete(actNumber)
                return next
            })
        } catch (error) {
            console.error('Failed to create chapter:', error)
        }
    }

    const handleCreateAct = async () => {
        if (!novelId) return

        // Calculate the next act number
        const existingActNumbers = [
            ...chapters.map(c => c.actNumber),
            ...Array.from(emptyActs)
        ]
        const maxActNumber = existingActNumbers.length > 0
            ? Math.max(...existingActNumbers)
            : 0
        const newActNumber = maxActNumber + 1

        // Persist empty act to database (with no title - will show as "Act N")
        await actApi.upsert(novelId, { number: newActNumber })

        // Update actsFromDb so sidebar shows the new act
        setActsFromDb(prev => [...prev, { number: newActNumber, title: null }])

        // Add to empty acts (will be removed when a chapter is added)
        setEmptyActs(prev => new Set([...prev, newActNumber]))

        setActLabelIds(prev => ({ ...prev, [newActNumber]: [] }))

        // Expand the new act
        setExpandedActs(prev => new Set([...prev, newActNumber]))

        // Switch view to new act
        setViewFilter('act')
        setSelectedActNumber(newActNumber)
    }

    const handleDeleteChapter = async (chapter: Chapter) => {
        try {
            await chapterApi.delete(chapter.id)

            // Find the global index of the deleted chapter
            const deletedGlobalIndex = sortedChapters.findIndex(c => c.id === chapter.id)

            // Check if this was the last chapter in its act
            const chaptersInSameAct = chapters.filter(c => c.actNumber === chapter.actNumber && c.id !== chapter.id)
            if (chaptersInSameAct.length === 0) {
                // This was the last chapter, add act to emptyActs to preserve it
                setEmptyActs(prev => new Set([...prev, chapter.actNumber]))
            }

            // Update placeholder titles for chapters after the deleted one
            const chaptersNeedingTitleUpdate: { id: string; oldIdx: number }[] = []
            sortedChapters.forEach((c, idx) => {
                if (idx > deletedGlobalIndex && isDefaultChapterTitle(c.title)) {
                    chaptersNeedingTitleUpdate.push({ id: c.id, oldIdx: idx })
                }
            })

            // Update placeholder titles in database (only if there are any)
            if (chaptersNeedingTitleUpdate.length > 0) {
                for (const { id, oldIdx } of chaptersNeedingTitleUpdate) {
                    // After deletion, chapter at old index N moves to N-1
                    const newTitle = getDefaultChapterTitle(oldIdx) // oldIdx is already 0-indexed, so it becomes the 1-indexed new position
                    await chapterApi.update(id, { title: newTitle })
                }
            }

            // Build title update map for local state
            const titleUpdateMap = new Map<string, string>()
            chaptersNeedingTitleUpdate.forEach(({ id, oldIdx }) => {
                titleUpdateMap.set(id, getDefaultChapterTitle(oldIdx))
            })

            setChapters(prev => prev
                .filter(c => c.id !== chapter.id)
                .map(c => {
                    const newTitle = titleUpdateMap.get(c.id)
                    return newTitle ? { ...c, title: newTitle } : c
                })
            )
            setChapterContents(prev => {
                const next = { ...prev }
                delete next[chapter.id]
                return next
            })
        } catch (error) {
            console.error('Failed to delete chapter:', error)
        }
    }

    // Delete an entire act and all its chapters
    const handleDeleteAct = async (actNumber: number) => {
        if (!novelId) return
        try {
            const chaptersToDelete = chapters.filter(c => c.actNumber === actNumber)
            const deletedChapterCount = chaptersToDelete.length

            try {
                await outlineApi.deleteActOutline(novelId, actNumber)
            } catch (e) {
                console.error('Failed to delete act outline:', e)
            }

            // Delete all chapters in the act (sequentially to avoid race conditions)
            for (const chapter of chaptersToDelete) {
                await chapterApi.delete(chapter.id)
            }

            // Delete the act record from database
            try {
                await actApi.delete(novelId, actNumber)
            } catch {
                // Act records can be absent for chapter-only acts; continue cleanup.
                console.log('Act record not found, continuing with cleanup')
            }

            // Find all acts that need to be renumbered (those after this act)
            const allActNumbers = [...new Set([
                ...chapters.map(c => c.actNumber),
                ...Array.from(emptyActs),
                ...actsFromDb.map(a => a.number)
            ])].filter(n => n > actNumber).sort((a, b) => a - b)

            const outlineRemap: Record<number, number> = {}
            for (const num of allActNumbers) {
                outlineRemap[num] = num - 1
            }
            if (Object.keys(outlineRemap).length > 0) {
                try {
                    await outlineApi.remapActNumbers(novelId, outlineRemap)
                } catch (e) {
                    console.error('Failed to remap act outlines after delete:', e)
                }
            }

            const actsToShift = actsFromDb.filter(a => a.number > actNumber).sort((a, b) => a.number - b.number)
            if (actsToShift.length > 0) {
                const maxActNumber = Math.max(
                    ...allActNumbers,
                    actNumber,
                    ...actsFromDb.map(a => a.number),
                )
                const tempOffset = maxActNumber + allActNumbers.length + 1

                const buildActPayload = (number: number, actNum: number) => {
                    const payload: { number: number; title?: string; summary?: string; labelIds?: string[] } = { number }
                    const title = actTitles[actNum] ?? actsFromDb.find(a => a.number === actNum)?.title ?? null
                    const summary = actSummaries[actNum]
                    const labelIds = actLabelIds[actNum]
                    if (title) payload.title = title
                    if (summary) payload.summary = summary
                    if (labelIds) payload.labelIds = labelIds
                    return payload
                }

                for (const act of actsToShift) {
                    const tempNumber = act.number + tempOffset
                    await actApi.upsert(novelId, buildActPayload(tempNumber, act.number))
                    await actApi.delete(novelId, act.number)
                }

                for (const act of actsToShift) {
                    const tempNumber = act.number + tempOffset
                    const newNumber = act.number - 1
                    await actApi.upsert(novelId, buildActPayload(newNumber, act.number))
                    await actApi.delete(novelId, tempNumber)
                }
            }

            // Update subsequent chapters' actNumber in database
            const chaptersToRenumber = chapters.filter(c => c.actNumber > actNumber)
            if (chaptersToRenumber.length > 0) {
                await chapterApi.reorder(novelId, chaptersToRenumber.map(c => ({
                    id: c.id,
                    order: c.order,
                    actNumber: c.actNumber - 1,
                })))
            }

            // Update chapter placeholder titles
            const chaptersNeedingTitleUpdate: { id: string; oldIdx: number }[] = []
            sortedChapters.forEach((c, idx) => {
                if (c.actNumber > actNumber && isDefaultChapterTitle(c.title)) {
                    chaptersNeedingTitleUpdate.push({ id: c.id, oldIdx: idx })
                }
            })

            if (chaptersNeedingTitleUpdate.length > 0) {
                for (const { id, oldIdx } of chaptersNeedingTitleUpdate) {
                    const newTitle = getDefaultChapterTitle(oldIdx - deletedChapterCount + 1)
                    await chapterApi.update(id, { title: newTitle })
                }
            }

            // Build title update map for local state
            const titleUpdateMap = new Map<string, string>()
            chaptersNeedingTitleUpdate.forEach(({ id, oldIdx }) => {
                titleUpdateMap.set(id, getDefaultChapterTitle(oldIdx - deletedChapterCount + 1))
            })

            // Update local chapters state - remove deleted, update actNumber and titles
            setChapters(prev => prev
                .filter(c => c.actNumber !== actNumber)
                .map(c => {
                    let updated = c
                    if (c.actNumber > actNumber) {
                        updated = { ...updated, actNumber: c.actNumber - 1 }
                    }
                    const newTitle = titleUpdateMap.get(c.id)
                    if (newTitle) {
                        updated = { ...updated, title: newTitle }
                    }
                    return updated
                })
            )

            // Update actTitles - shift keys down
            const newActTitles: Record<number, string> = {}
            Object.entries(actTitles).forEach(([numStr, title]) => {
                const num = Number(numStr)
                if (num < actNumber) {
                    newActTitles[num] = title
                } else if (num > actNumber) {
                    newActTitles[num - 1] = title
                }
                // num === actNumber is deleted, skip
            })
            setActTitles(newActTitles)

            setActSummaries(prev => {
                const next: Record<number, string> = {}
                Object.entries(prev).forEach(([numStr, summary]) => {
                    const num = Number(numStr)
                    if (num < actNumber) {
                        next[num] = summary
                    } else if (num > actNumber) {
                        next[num - 1] = summary
                    }
                })
                return next
            })

            setActLabelIds(prev => {
                const next: Record<number, string[]> = {}
                Object.entries(prev).forEach(([numStr, ids]) => {
                    const num = Number(numStr)
                    if (num < actNumber) {
                        next[num] = ids
                    } else if (num > actNumber) {
                        next[num - 1] = ids
                    }
                })
                return next
            })

            // Update actsFromDb
            setActsFromDb(prev => prev
                .filter(a => a.number !== actNumber)
                .map(a => a.number > actNumber ? { ...a, number: a.number - 1 } : a)
            )

            // Remove chapter contents for deleted chapters
            setChapterContents(prev => {
                const newContents = { ...prev }
                chaptersToDelete.forEach(c => delete newContents[c.id])
                return newContents
            })

            // Update emptyActs - shift numbers down
            setEmptyActs(prev => {
                const newSet = new Set<number>()
                prev.forEach(num => {
                    if (num < actNumber) {
                        newSet.add(num)
                    } else if (num > actNumber) {
                        newSet.add(num - 1)
                    }
                    // num === actNumber is deleted, skip
                })
                return newSet
            })

            // Switch view
            setViewFilter('everything')
            setSelectedActNumber(null)
        } catch (error) {
            console.error('Failed to delete act:', error)
        }
    }

    // Insert chapter before or after a target chapter
    const handleInsertChapter = async (targetChapter: Chapter, position: 'before' | 'after') => {
        if (!novelId) return
        try {
            const actChapters = chaptersByAct[targetChapter.actNumber] || []
            const insertOrder = position === 'before'
                ? targetChapter.order
                : targetChapter.order + 1

            // Find the global index where new chapter will be inserted
            const targetGlobalIndex = sortedChapters.findIndex(c => c.id === targetChapter.id)
            const newGlobalIndex = position === 'before' ? targetGlobalIndex : targetGlobalIndex + 1
            const newChapterTitle = getDefaultChapterTitle(newGlobalIndex + 1)

            // Find chapters that need order increment (in the same act, at or after insert point)
            const chaptersToUpdate = actChapters.filter(c => c.order >= insertOrder)

            // Create new chapter with the insert order and correct title
            const newChapter = await chapterApi.create(novelId, {
                title: newChapterTitle,
                actNumber: targetChapter.actNumber,
                order: insertOrder,
            })

            // Batch update affected chapters to increment their order
            if (chaptersToUpdate.length > 0) {
                await chapterApi.reorder(novelId, chaptersToUpdate.map(c => ({
                    id: c.id,
                    order: c.order + 1,
                })))
            }

            // Find chapters with placeholder titles that need updating
            // Only chapters at index >= newGlobalIndex shift, and they shift by +1
            const chaptersNeedingTitleUpdate: { id: string; oldIdx: number }[] = []
            sortedChapters.forEach((chapter, idx) => {
                if (idx >= newGlobalIndex && isDefaultChapterTitle(chapter.title)) {
                    chaptersNeedingTitleUpdate.push({ id: chapter.id, oldIdx: idx })
                }
            })

            // Update placeholder titles in database (only if there are any)
            if (chaptersNeedingTitleUpdate.length > 0) {
                for (const { id, oldIdx } of chaptersNeedingTitleUpdate) {
                    // oldIdx was 0-indexed old position, new position is oldIdx + 1 (shifted by insert)
                    // Title should be (newPosition + 1) since titles are 1-indexed
                    const newTitle = getDefaultChapterTitle(oldIdx + 2)
                    await chapterApi.update(id, { title: newTitle })
                }
            }

            // Update local state - build a map for efficient lookup
            const titleUpdateMap = new Map<string, string>()
            chaptersNeedingTitleUpdate.forEach(({ id, oldIdx }) => {
                titleUpdateMap.set(id, getDefaultChapterTitle(oldIdx + 2))
            })

            setChapters(prev => [
                ...prev.map(c => {
                    let updated = c
                    // Update order for chapters in the same act
                    if (c.actNumber === targetChapter.actNumber && c.order >= insertOrder) {
                        updated = { ...updated, order: c.order + 1 }
                    }
                    // Update placeholder title if needed
                    const newTitle = titleUpdateMap.get(c.id)
                    if (newTitle) {
                        updated = { ...updated, title: newTitle }
                    }
                    return updated
                }),
                { ...newChapter, scenes: (newChapter as ChapterWithScenes).scenes || [] },
            ])
            setChapterContents(prev => ({ ...prev, [newChapter.id]: '' }))

            // Remove from empty acts since it now has a chapter
            setEmptyActs(prev => {
                const next = new Set(prev)
                next.delete(targetChapter.actNumber)
                return next
            })
        } catch (error) {
            console.error('Failed to insert chapter:', error)
        }
    }

    // Insert act before or after a target act
    const handleInsertAct = async (targetActNumber: number, position: 'before' | 'after') => {
        if (!novelId) return
        try {
            const newActNumber = position === 'before' ? targetActNumber : targetActNumber + 1

            const actNumbersToShift = [...new Set([
                ...chapters.map(c => c.actNumber),
                ...Array.from(emptyActs),
                ...actsFromDb.map(a => a.number),
            ])].filter(n => n >= newActNumber)
            const outlineRemap: Record<number, number> = {}
            for (const num of actNumbersToShift) {
                outlineRemap[num] = num + 1
            }
            if (Object.keys(outlineRemap).length > 0) {
                try {
                    await outlineApi.remapActNumbers(novelId, outlineRemap)
                } catch (e) {
                    console.error('Failed to remap act outlines after insert:', e)
                }
            }

            // Find chapters that need actNumber increment (at or after the new act number)
            const chaptersToUpdate = chapters.filter(c => c.actNumber >= newActNumber)

            // Batch update affected chapters to increment their actNumber
            if (chaptersToUpdate.length > 0) {
                await chapterApi.reorder(novelId, chaptersToUpdate.map(c => ({
                    id: c.id,
                    order: c.order,
                    actNumber: c.actNumber + 1,
                })))
            }

            const actsToShift = actsFromDb.filter(a => a.number >= newActNumber).sort((a, b) => a.number - b.number)
            if (actsToShift.length > 0) {
                const allActNumbers = [...new Set([
                    ...chapters.map(c => c.actNumber),
                    ...Array.from(emptyActs),
                    ...actsFromDb.map(a => a.number),
                ])]
                const maxActNumber = Math.max(...allActNumbers, newActNumber)
                const tempOffset = maxActNumber + allActNumbers.length + 1

                const buildActPayload = (number: number, actNum: number) => {
                    const payload: { number: number; title?: string; summary?: string; labelIds?: string[] } = { number }
                    const title = actTitles[actNum] ?? actsFromDb.find(a => a.number === actNum)?.title ?? null
                    const summary = actSummaries[actNum]
                    const labelIds = actLabelIds[actNum]
                    if (title) payload.title = title
                    if (summary) payload.summary = summary
                    if (labelIds) payload.labelIds = labelIds
                    return payload
                }

                for (const act of actsToShift) {
                    const tempNumber = act.number + tempOffset
                    await actApi.upsert(novelId, buildActPayload(tempNumber, act.number))
                    await actApi.delete(novelId, act.number)
                }

                for (const act of actsToShift) {
                    const tempNumber = act.number + tempOffset
                    const newNumber = act.number + 1
                    await actApi.upsert(novelId, buildActPayload(newNumber, act.number))
                    await actApi.delete(novelId, tempNumber)
                }
            }

            setActTitles(prev => {
                const next: Record<number, string> = {}
                Object.entries(prev).forEach(([numStr, title]) => {
                    const num = Number(numStr)
                    if (num < newActNumber) {
                        next[num] = title
                    } else {
                        next[num + 1] = title
                    }
                })
                return next
            })

            setActSummaries(prev => {
                const next: Record<number, string> = {}
                Object.entries(prev).forEach(([numStr, summary]) => {
                    const num = Number(numStr)
                    if (num < newActNumber) {
                        next[num] = summary
                    } else {
                        next[num + 1] = summary
                    }
                })
                return next
            })

            setActLabelIds(prev => {
                const next: Record<number, string[]> = {}
                Object.entries(prev).forEach(([numStr, ids]) => {
                    const num = Number(numStr)
                    if (num < newActNumber) {
                        next[num] = ids
                    } else {
                        next[num + 1] = ids
                    }
                })
                next[newActNumber] = []
                return next
            })

            // Update local state for chapters
            setChapters(prev => prev.map(c => {
                if (c.actNumber >= newActNumber) {
                    return { ...c, actNumber: c.actNumber + 1 }
                }
                return c
            }))

            // Shift empty acts that are at or after the new act number
            setEmptyActs(prev => {
                const newSet = new Set<number>()
                prev.forEach(actNum => {
                    if (actNum >= newActNumber) {
                        newSet.add(actNum + 1)
                    } else {
                        newSet.add(actNum)
                    }
                })
                // Add the new empty act
                newSet.add(newActNumber)
                return newSet
            })

            // Persist the new empty act to database
            await actApi.upsert(novelId, { number: newActNumber })

            // Update actsFromDb - shift existing acts and add the new one
            setActsFromDb(prev => [
                ...prev.map(a => a.number >= newActNumber ? { ...a, number: a.number + 1 } : a),
                { number: newActNumber, title: null }
            ])

            // Expand the new act
            setExpandedActs(prev => new Set([...prev, newActNumber]))

            // Switch view to new act
            setViewFilter('act')
            setSelectedActNumber(newActNumber)
        } catch (error) {
            console.error('Failed to insert act:', error)
        }
    }

    const handleReorderActs = async (activeActNumber: number, overActNumber: number) => {
        if (!novelId) return
        if (activeActNumber === overActNumber) return
        try {
            const actNumbers = [...new Set([
                ...chapters.map(c => c.actNumber),
                ...Array.from(emptyActs),
                ...actsFromDb.map(a => a.number)
            ])].sort((a, b) => a - b)
            const activeIndex = actNumbers.indexOf(activeActNumber)
            const overIndex = actNumbers.indexOf(overActNumber)
            if (activeIndex === -1 || overIndex === -1) return

            const nextActNumbers = [...actNumbers]
            const [movedAct] = nextActNumbers.splice(activeIndex, 1)
            nextActNumbers.splice(overIndex, 0, movedAct)

            const actNumberMap = new Map<number, number>()
            nextActNumbers.forEach((oldNumber, index) => {
                actNumberMap.set(oldNumber, index + 1)
            })

            const changedActs = new Set<number>()
            actNumberMap.forEach((newNumber, oldNumber) => {
                if (newNumber !== oldNumber) {
                    changedActs.add(oldNumber)
                }
            })
            if (changedActs.size === 0) return

            const chapterUpdates = chapters
                .filter(c => changedActs.has(c.actNumber))
                .map(c => ({
                    id: c.id,
                    order: c.order,
                    actNumber: actNumberMap.get(c.actNumber) || c.actNumber,
                }))

            if (chapterUpdates.length > 0) {
                await chapterApi.reorder(novelId, chapterUpdates)
            }

            const actsToUpdate = actsFromDb.filter(act => changedActs.has(act.number))
            if (actsToUpdate.length > 0) {
                const maxActNumber = actNumbers.length > 0 ? Math.max(...actNumbers) : 0
                const tempOffset = maxActNumber + actNumbers.length + 1
                const buildActPayload = (number: number, title: string | null, summary?: string, labelIds?: string[]) => {
                    const payload: { number: number; title?: string; summary?: string; labelIds?: string[] } = { number }
                    if (title) payload.title = title
                    if (summary) payload.summary = summary
                    if (labelIds) payload.labelIds = labelIds
                    return payload
                }

                for (const act of actsToUpdate) {
                    const tempNumber = act.number + tempOffset
                    const summary = actSummaries[act.number]
                    const title = actTitles[act.number] ?? act.title
                    const labelIds = actLabelIds[act.number]
                    await actApi.upsert(novelId, buildActPayload(tempNumber, title, summary, labelIds))
                    await actApi.delete(novelId, act.number)
                }

                for (const act of actsToUpdate) {
                    const newNumber = actNumberMap.get(act.number) || act.number
                    const tempNumber = act.number + tempOffset
                    const summary = actSummaries[act.number]
                    const title = actTitles[act.number] ?? act.title
                    const labelIds = actLabelIds[act.number]
                    await actApi.upsert(novelId, buildActPayload(newNumber, title, summary, labelIds))
                    await actApi.delete(novelId, tempNumber)
                }
            }

            const outlineRemap: Record<number, number> = {}
            changedActs.forEach((oldNumber) => {
                const newNumber = actNumberMap.get(oldNumber)
                if (!newNumber || newNumber === oldNumber) return
                outlineRemap[oldNumber] = newNumber
            })
            if (Object.keys(outlineRemap).length > 0) {
                try {
                    await outlineApi.remapActNumbers(novelId, outlineRemap)
                } catch (e) {
                    console.error('Failed to remap act outlines after reorder:', e)
                }
            }

            let titleUpdateMap = new Map<string, string>()
            if (chapterUpdates.length > 0) {
                const updateMap = new Map(chapterUpdates.map(u => [u.id, u]))
                const nextChapters = chapters.map(chapter => {
                    const update = updateMap.get(chapter.id)
                    if (!update) return chapter
                    return { ...chapter, order: update.order, actNumber: update.actNumber }
                })
                titleUpdateMap = getTitleUpdateMap(nextChapters)
                if (titleUpdateMap.size > 0) {
                    for (const [id, title] of titleUpdateMap) {
                        await chapterApi.update(id, { title })
                    }
                }
            }

            setChapters(prev => {
                if (chapterUpdates.length === 0 && titleUpdateMap.size === 0) return prev
                const updateMap = new Map(chapterUpdates.map(u => [u.id, u]))
                return prev.map(chapter => {
                    const update = updateMap.get(chapter.id)
                    const newTitle = titleUpdateMap.get(chapter.id)
                    if (!update && !newTitle) return chapter
                    return {
                        ...chapter,
                        order: update ? update.order : chapter.order,
                        actNumber: update ? update.actNumber : chapter.actNumber,
                        title: newTitle || chapter.title,
                    }
                })
            })

            setActTitles(prev => {
                const next: Record<number, string> = {}
                Object.entries(prev).forEach(([numStr, title]) => {
                    const oldNumber = Number(numStr)
                    const newNumber = actNumberMap.get(oldNumber) || oldNumber
                    next[newNumber] = title
                })
                return next
            })

            setActSummaries(prev => {
                const next: Record<number, string> = {}
                Object.entries(prev).forEach(([numStr, summary]) => {
                    const oldNumber = Number(numStr)
                    const newNumber = actNumberMap.get(oldNumber) || oldNumber
                    next[newNumber] = summary
                })
                return next
            })

            setActLabelIds(prev => {
                const next: Record<number, string[]> = {}
                Object.entries(prev).forEach(([numStr, ids]) => {
                    const oldNumber = Number(numStr)
                    const newNumber = actNumberMap.get(oldNumber) || oldNumber
                    next[newNumber] = ids
                })
                return next
            })

            setActsFromDb(prev => prev.map(act => {
                const newNumber = actNumberMap.get(act.number) || act.number
                return newNumber === act.number ? act : { ...act, number: newNumber }
            }))

            setEmptyActs(prev => {
                const next = new Set<number>()
                prev.forEach(actNumber => {
                    next.add(actNumberMap.get(actNumber) || actNumber)
                })
                return next
            })

            setExpandedActs(prev => {
                const next = new Set<number>()
                prev.forEach(actNumber => {
                    next.add(actNumberMap.get(actNumber) || actNumber)
                })
                return next
            })

            setSelectedActNumber(prev => {
                if (prev === null) return prev
                return actNumberMap.get(prev) || prev
            })
        } catch (error) {
            console.error('Failed to reorder acts:', error)
        }
    }

    // Handle reordering chapters from Menu view drag-and-drop
    const handleReorderChapters = async (updates: { id: string; order: number; actNumber: number }[]) => {
        if (!novelId) return
        try {
            // Call the batch reorder API
            await chapterApi.reorder(novelId, updates)

            const updateMap = new Map(updates.map(u => [u.id, u]))
            const nextChapters = chapters.map(chapter => {
                const update = updateMap.get(chapter.id)
                if (!update) return chapter
                return { ...chapter, order: update.order, actNumber: update.actNumber }
            })
            const titleUpdateMap = getTitleUpdateMap(nextChapters)
            if (titleUpdateMap.size > 0) {
                for (const [id, title] of titleUpdateMap) {
                    await chapterApi.update(id, { title })
                }
            }

            // Update local state
            setChapters(prev => prev.map(chapter => {
                const update = updateMap.get(chapter.id)
                const newTitle = titleUpdateMap.get(chapter.id)
                if (!update && !newTitle) return chapter
                return {
                    ...chapter,
                    order: update ? update.order : chapter.order,
                    actNumber: update ? update.actNumber : chapter.actNumber,
                    title: newTitle || chapter.title,
                }
            }))
        } catch (error) {
            console.error('Failed to reorder chapters:', error)
        }
    }

    return {
        handleCreateChapter,
        handleCreateAct,
        handleDeleteChapter,
        handleDeleteAct,
        handleInsertChapter,
        handleInsertAct,
        handleReorderActs,
        handleReorderChapters,
    }
}
