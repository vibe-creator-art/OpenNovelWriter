async function deactivateStoryEpisodesForScene(db, sceneId) {
    await db.storyEpisode.updateMany({
        where: { sourceSceneId: sceneId, sourceKind: 'SCENE_SUMMARY', inactiveAt: null },
        data: { inactiveAt: new Date(), inactiveReason: 'SOURCE_DELETED' },
    })
}

module.exports = { deactivateStoryEpisodesForScene }
